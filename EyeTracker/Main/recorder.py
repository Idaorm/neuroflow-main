import subprocess, threading, time, csv, os
from pathlib import Path
import sys


BASE_DIR = Path(__file__).resolve().parent


CSHARP_DIR = BASE_DIR / "StreamEngine" / "StreamEngine" / "bin" / "Debug" / "net9.0"
CSHARP_EXE = CSHARP_DIR / "StreamEngine.exe"



class GazeRecorder:

    def __init__(self, on_point=None):
        self.on_point = on_point
        self._proc = None
        self._thread = None
        self.points = []
        self.running = False

    def start(self):
        if sys.platform != "win32":
            raise RuntimeError(
                "L'acquisizione Tobii Stream Engine è supportata "
                "solo su Windows nella configurazione attuale di NeuroFlow."
            )

        self.points = []
        self.running = True

        if self._proc and self._proc.poll() is None:
            try:
                self._proc.stdin.write("Exit\n")
                self._proc.stdin.flush()
                self._proc.wait(timeout=3)
            except Exception:
                self._proc.kill()
            self._proc = None

        if not CSHARP_EXE.exists():
            raise FileNotFoundError(f"StreamEngine.exe non trovato in:\n{CSHARP_EXE}\nCompila il progetto C# prima.")

        self._proc = subprocess.Popen(
            [str(CSHARP_EXE)],
            cwd=str(CSHARP_DIR),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=0
        )
        self._proc.stdin.write("Start\n")
        self._proc.stdin.flush()
        print(f"[recorder] Avviato — EXE: {CSHARP_EXE}")

        self._thread = threading.Thread(target=self._read, daemon=True)
        self._thread.start()

    def _read(self):
        proc = self._proc
        while proc and proc.poll() is None:
            try:
                line = proc.stdout.readline().strip()
                if not line:
                    continue
                if line.startswith("GAZE"):
                    parts = line.split()
                    if len(parts) == 4:
                        x = float(parts[1].replace(",", "."))
                        y = float(parts[2].replace(",", "."))
                        t_raw = int(parts[3])
                        t_epoch = time.time()
                        if 0 <= x <= 1 and 0 <= y <= 1:
                            self.points.append((x, y, t_epoch, t_raw))
                            if self.on_point:
                                self.on_point(x, y, t_epoch)
                else:
                    print(f"[C#] {line}")
            except Exception as e:
                print(f"[recorder._read] {e}")
                break
        print(f"[recorder] Thread terminato — punti raccolti: {len(self.points)}")

    def stop(self):
        self.running = False
        if self._proc and self._proc.poll() is None:
            try:
                self._proc.stdin.write("Stop\n")
                self._proc.stdin.flush()
                time.sleep(0.8)
                self._proc.stdin.write("Exit\n")
                self._proc.stdin.flush()
                self._proc.wait(timeout=5)
            except Exception as e:
                print(f"[recorder] stop error: {e}")
        print(f"[recorder] Stop — {len(self.points)} punti totali")

    def save_csv(self, path):
        with open(path, "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["X", "Y", "Timestamp", "Timestamp_raw"])
            w.writerows(self.points)
        print(f"[recorder] CSV salvato: {path} ({len(self.points)} righe)")