import threading
import time
import os
from pathlib import Path
from PyQt6.QtWidgets import QMainWindow, QProgressDialog
from PyQt6.QtCore import pyqtSignal, QObject, Qt, QTimer

from config import STYLE_BASE, DATA_DIR
from services import sync_emotiv, save_emotiv_data
from screens.setup_screen import SetupScreen
from screens.recording_screen import RecordingScreen
from screens.result_screen import ResultScreen
from recorder import GazeRecorder

_session_epochs = {"start": None, "stop": None}

# Sentinel creato da backend.py quando NeuroFlow ferma la sessione
SENTINEL_FILE = Path(os.environ.get("NEUROFLOW_DATA_DIR",
    str(Path.home() / "Documents" / "NeuroTech_Data"))) / ".stop_signal"


class GazeSignal(QObject):
    point = pyqtSignal(float, float)


class _StopResult:
    def __init__(self, emotiv_excel_path, points_per_image, progress,
                 session_start_epoch, session_end_epoch):
        self.emotiv_excel_path = emotiv_excel_path
        self.points_per_image = points_per_image
        self.progress = progress
        self.session_start_epoch = session_start_epoch
        self.session_end_epoch = session_end_epoch


class MainWindow(QMainWindow):
    stop_finished = pyqtSignal(object)

    def __init__(self):
        super().__init__()
        self.setWindowTitle("Eye Tracker & Emotiv Integration")
        self.setStyleSheet(STYLE_BASE)

        self.recorder = None
        self.gaze_sig = GazeSignal()
        self.image_paths = []
        self.session_name = "sessione"
        self._recording_screen = None

        # Timer sentinel — controlla se NeuroFlow ha fermato la sessione
        self._sentinel_timer = QTimer()
        self._sentinel_timer.setInterval(1000)
        self._sentinel_timer.timeout.connect(self._check_sentinel)

        self.stop_finished.connect(self._finish_stop)
        self._show_setup()

    def _show_setup(self):
        self._sentinel_timer.stop()
        self._recording_screen = None
        try:
            SENTINEL_FILE.unlink(missing_ok=True)
        except Exception:
            pass
        self.setCentralWidget(
            SetupScreen(on_start=self._on_start, on_aggregate=self._on_aggregate, on_analyze=self._on_analyze)
        )
        self.showNormal()

    def _on_start(self, image_paths, session_name):
        self.image_paths = image_paths
        self.session_name = session_name

        try:
            SENTINEL_FILE.unlink(missing_ok=True)
        except Exception:
            pass

        _session_epochs["start"] = sync_emotiv(f"START_{session_name}")

        try:
            self.recorder = GazeRecorder()
            self.recorder.start()
        except Exception as e:
            print(f"[Errore Tobii] Impossibile avviare il tracker: {e}")
            self.recorder = None

        screen = RecordingScreen(
            image_paths=self.image_paths,
            on_stop=self._on_stop,
            on_marker=self._send_marker,
        )
        self._recording_screen = screen
        self.setCentralWidget(screen)
        self.showFullScreen()
        self._sentinel_timer.start()

    def _check_sentinel(self):
        """Se NeuroFlow ferma la sessione, ferma anche l'EyeTracker."""
        if SENTINEL_FILE.exists():
            print("[ui] Sentinel rilevato — stop da NeuroFlow")
            self._sentinel_timer.stop()
            try:
                SENTINEL_FILE.unlink(missing_ok=True)
            except Exception:
                pass
            if self._recording_screen is not None:
                self._recording_screen._stop()

    def _send_marker(self, label, event_time):
        threading.Thread(
            target=sync_emotiv,
            args=(label,),
            daemon=True
        ).start()

    def _on_stop(self, marker_times):
        """
        Chiamato quando l'utente preme "Termina Registrazione".
        L'EyeTracker gestisce tutto: salva i dati gaze E chiede
        il salvataggio Excel a Emotiv.
        """
        self._sentinel_timer.stop()
        _session_epochs["stop"] = sync_emotiv("STOP_TOBII")

        progress = QProgressDialog(
            "Salvataggio dati EEG e gaze...", None, 0, 0, self
        )
        progress.setWindowModality(Qt.WindowModality.WindowModal)
        progress.setWindowFlags(
            progress.windowFlags() | Qt.WindowType.CustomizeWindowHint
        )
        progress.show()

        def worker():
            try:
                session_start_epoch = _session_epochs["start"]
                session_end_epoch = _session_epochs["stop"]

                # Salva i dati gaze Tobii
                if self.recorder:
                    self.recorder.stop()
                    if self.recorder._thread:
                        self.recorder._thread.join(timeout=2)
                    all_points = list(self.recorder.points)
                    print(f"[ui] Punti Tobii totali: {len(all_points)}")
                    self.recorder.save_csv(
                        str(DATA_DIR / f"{self.session_name}.csv")
                    )
                else:
                    all_points = []

                # Chiede il salvataggio Excel a Emotiv
                emotiv_res = save_emotiv_data(self.session_name)
                print(f"[ui] emotiv_res: {emotiv_res}")
                emotiv_excel_path = emotiv_res.get("filename")

                if emotiv_res.get("session_start_epoch") is not None:
                    session_start_epoch = emotiv_res["session_start_epoch"]
                    session_end_epoch = emotiv_res["session_end_epoch"]

                # Fallback: cerca l'Excel più recente
                if not emotiv_excel_path or not os.path.exists(str(emotiv_excel_path)):
                    emotiv_excel_path = _find_latest_excel(DATA_DIR)
                    print(f"[ui] Excel trovato per ricerca: {emotiv_excel_path}")

                points_per_image = _split_points_by_image(all_points, marker_times)
                print(f"[ui] Punti per immagine: {[len(p) for p in points_per_image]}")

                result = _StopResult(
                    emotiv_excel_path=emotiv_excel_path,
                    points_per_image=points_per_image,
                    progress=progress,
                    session_start_epoch=session_start_epoch,
                    session_end_epoch=session_end_epoch,
                )
                self.stop_finished.emit(result)

            except Exception as e:
                import traceback
                traceback.print_exc()
                print(f"[ui] Errore nel worker: {e}")

        threading.Thread(target=worker, daemon=True).start()

    def _finish_stop(self, result):
        try:
            result.progress.close()
            self.showNormal()
            self.setCentralWidget(
                ResultScreen(
                    image_paths=self.image_paths,
                    session_name=self.session_name,
                    points_per_image=result.points_per_image,
                    on_restart=self._show_setup,
                    emotiv_file=result.emotiv_excel_path,
                    session_start_epoch=result.session_start_epoch,
                    session_end_epoch=result.session_end_epoch,
                )
            )
        except Exception as e:
            import traceback
            traceback.print_exc()
            print(f"[ui] Errore in _finish_stop: {e}")

    def _on_analyze(self, image_paths, session_name, points_per_image, emotiv_file):
        """Apre la schermata risultati con una sessione già registrata."""
        self.image_paths      = image_paths
        self.session_name     = session_name
        self.showNormal()
        self.setCentralWidget(
            ResultScreen(
                image_paths=image_paths,
                session_name=session_name,
                points_per_image=points_per_image,
                on_restart=self._show_setup,
                emotiv_file=emotiv_file,
            )
        )

    def _on_aggregate(self, image_path, session_summary, all_points):
        self.image_paths = [image_path]
        self.session_name = session_summary
        self.showNormal()
        self.setCentralWidget(
            ResultScreen(
                image_paths=[image_path],
                session_name=session_summary,
                points_per_image=all_points,
                on_restart=self._show_setup,
            )
        )


def _find_latest_excel(data_dir):
    try:
        files = list(Path(data_dir).glob("NeuroFlow_*.xlsx"))
        if not files:
            return None
        return str(max(files, key=lambda f: f.stat().st_mtime))
    except Exception:
        return None


def _split_points_by_image(all_points, marker_times):
    n = len(marker_times)
    result = [[] for _ in range(n)]
    boundaries = list(marker_times) + [float("inf")]
    for pt in all_points:
        t = pt[2]
        for i in range(n):
            if boundaries[i] <= t < boundaries[i + 1]:
                result[i].append(pt)
                break
    return result