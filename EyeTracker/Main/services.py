import threading
import time
import json
import os
import re
import unicodedata
from pathlib import Path
import websocket

DATA_DIR = Path(
    os.environ.get(
        "NEUROFLOW_DATA_DIR",
        str(Path.home() / "Documents" / "NeuroTech_Data"),
    )
).expanduser()


def _run_with_hard_timeout(func, timeout_seconds, fallback_value):
    result_box = {"value": fallback_value, "done": False}

    def target():
        try:
            result_box["value"] = func()
        except Exception as e:
            print(f"[hard_timeout] Eccezione: {e}")
        finally:
            result_box["done"] = True

    t = threading.Thread(target=target, daemon=True)
    t.start()
    t.join(timeout=timeout_seconds)
    return result_box["value"]


def sync_emotiv(label_name):
    """
    Invia un marker al server Emotiv senza aspettare risposta.
    Il server risponde con marker_result ma aspettarlo causa blocchi.
    """
    sent_epoch = time.time()

    def _do_send():
        ws = websocket.create_connection("ws://localhost:8765", timeout=2)
        ws.send(json.dumps({
            "action": "set_marker",
            "label": label_name,
            "event_time": sent_epoch,
        }))
        ws.close()  # nessun recv — evita blocchi
        return sent_epoch

    result = _run_with_hard_timeout(_do_send, timeout_seconds=5, fallback_value=None)
    return result if result is not None else sent_epoch


def save_emotiv_data(session_name="sessione"):
    """
    Chiede al server Emotiv di salvare l'Excel e aspetta conferma.
    """
    fallback = {"filename": None, "session_start_epoch": None, "session_end_epoch": None}

    safe = unicodedata.normalize("NFD", session_name)
    safe = "".join(c for c in safe if unicodedata.category(c) != "Mn")
    safe = re.sub(r"\s+", "_", safe.strip())
    safe = re.sub(r"[^A-Za-z0-9_-]", "", safe) or "Session"
    date_str = time.strftime("%Y-%m-%d")
    base_name = f"NeuroFlow_{safe}_{date_str}"

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    percorso_excel = str(DATA_DIR / f"{base_name}.xlsx")

    idx = 2
    while os.path.exists(percorso_excel):
        percorso_excel = str(DATA_DIR / f"{base_name}_{idx}.xlsx")
        idx += 1

    print(f"[services] Richiedo salvataggio Excel: {percorso_excel}")

    def _do_save():
        ws = websocket.create_connection("ws://localhost:8765", timeout=90)
        ws.send(json.dumps({
            "action": "save_excel",
            "path": percorso_excel,
            "session_name": session_name,
            "event_time": time.time(),
        }))

        deadline = time.monotonic() + 90
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("Timeout salvataggio Excel")
            ws.settimeout(remaining)
            resp = json.loads(ws.recv())
            if resp.get("type") == "save_result":
                ws.close()
                if resp.get("success"):
                    filename = resp.get("filename") or percorso_excel
                    print(f"[services] Excel salvato: {filename}")
                    return {
                        "filename": filename,
                        "session_start_epoch": resp.get("session_start_epoch"),
                        "session_end_epoch": resp.get("session_end_epoch"),
                    }
                else:
                    print(f"[services] Salvataggio fallito: {resp.get('error')}")
                    return fallback

    return _run_with_hard_timeout(_do_save, timeout_seconds=95, fallback_value=fallback)