import sys
import json
import subprocess
import time
import threading
import re
import unicodedata
import websocket
import os
from contextlib import closing

from pathlib import Path
from env_utils import load_env_file, load_emotiv_credentials
from platform_utils import (get_venv_python, open_path, open_url,
                             kill_processes_on_ports, terminate_process_tree,
                             get_neuroflow_data_dir)

# ============================================================
# PERCORSI
# ============================================================
BASE_DIR = Path(__file__).resolve().parent
load_env_file(BASE_DIR / ".env")

PATH_EMOTIV    = str(BASE_DIR / "emotiv" / "cortex-example" / "python")
PATH_EYETRACKER = str(BASE_DIR / "EyeTracker" / "Main")

PY_EMOTIV      = get_venv_python(Path(PATH_EMOTIV)    / ".venv")
PY_EYETRACKER  = get_venv_python(Path(PATH_EYETRACKER) / ".venv")

CARTELLA_DATI  = str(get_neuroflow_data_dir())
os.environ["NEUROFLOW_DATA_DIR"] = CARTELLA_DATI

# ============================================================
# VARIABILI GLOBALI
# ============================================================
esperimento_attivo  = False
processi_attivi     = []
processo_eyetracker = None
chiusura_in_corso   = False
nome_sessione       = ""
data_sessione       = ""

# NOTA: il listener tastiera è stato RIMOSSO da qui.
# La freccia destra è gestita interamente dall'EyeTracker,
# che invia i marker con formato slide_N_nomefile al server Emotiv.

# ============================================================
# COMUNICAZIONE CON REACT / TAURI
# ============================================================
def send_to_frontend(tipo, payload):
    msg = json.dumps({"tipo": tipo, "dati": payload})
    sys.stdout.write(msg + "\n")
    sys.stdout.flush()


def processo_in_esecuzione(processo):
    return processo is not None and processo.poll() is None

def registra_processo(processo):
    if processo is not None:
        processi_attivi.append(processo)

def pulisci_porte():
    kill_processes_on_ports(8080, 8765)

# ============================================================
# WEBSOCKET
# ============================================================
def invia_comando_ws(payload):
    """Apre una connessione usa-e-getta, invia il dato e la chiude."""
    try:
        tmp_ws = websocket.WebSocket()
        tmp_ws.connect("ws://localhost:8765", timeout=2)
        tmp_ws.send(json.dumps(payload))
        time.sleep(0.1)
        tmp_ws.close()
        return True
    except Exception:
        return False


def salva_excel_ws(percorso_excel, session_name, event_time=None):
    """Attende l'esito del salvataggio prima di chiudere il server EEG."""
    try:
        with closing(websocket.create_connection("ws://localhost:8765", timeout=90)) as ws:
            ws.send(json.dumps({
                "action": "save_excel",
                "path": percorso_excel,
                "session_name": session_name,
                "event_time": event_time if event_time is not None else time.time(),
            }))
            deadline = time.monotonic() + 90
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError("Timeout durante il salvataggio Excel")
                ws.settimeout(remaining)
                response = json.loads(ws.recv())
                if response.get("type") == "save_result":
                    break
    except (OSError, ValueError, websocket.WebSocketException) as e:
        raise RuntimeError(f"Nessuna conferma dal server EEG: {e}") from e

    if not response.get("success"):
        raise RuntimeError(response.get("error") or "Salvataggio Excel non riuscito")
    if response.get("filename") != percorso_excel or not os.path.isfile(percorso_excel):
        raise RuntimeError("Il server EEG non ha creato il file Excel atteso")
    return percorso_excel


def verifica_connessione_ws(processo):
    """Aspetta che il server sia pronto prima di procedere."""
    for _ in range(60):
        if processo.poll() is not None:
            raise RuntimeError(
                f"server.py terminato con codice {processo.returncode}; "
                "controllare il traceback su stderr."
            )
        try:
            tmp_ws = websocket.WebSocket()
            tmp_ws.connect("ws://localhost:8765", timeout=1)
            tmp_ws.close()
            send_to_frontend("log", "WebSocket connesso.")
            return
        except Exception:
            time.sleep(0.1)
    raise RuntimeError("Il server EEG non risponde su ws://localhost:8765.")

# ============================================================
# PROCESSI
# ============================================================
def termina_processo_e_figli(processo):
    terminate_process_tree(processo)


def apri_dashboard():
    try:
        open_url("http://localhost:8080/charts.html")
    except Exception as e:
        send_to_frontend("errore", str(e))


def apri_eyetracker():
    global processo_eyetracker
    if processo_in_esecuzione(processo_eyetracker):
        return
    try:
        processo_eyetracker = subprocess.Popen(
            [PY_EYETRACKER, "avvio.py"],
            cwd=PATH_EYETRACKER,
            stdin=subprocess.DEVNULL,
        )
        registra_processo(processo_eyetracker)
    except Exception as e:
        send_to_frontend("errore", str(e))


def avvio_automatico_interfacce():
    for _ in range(30):
        if not esperimento_attivo:
            return
        time.sleep(0.1)
    if not esperimento_attivo:
        return
    apri_eyetracker()
    if not esperimento_attivo:
        return
    apri_dashboard()


def avvia_tutto(session_name):
    global esperimento_attivo, chiusura_in_corso, nome_sessione, data_sessione

    if esperimento_attivo:
        return

    session_name = str(session_name or "").strip()
    if not session_name:
        send_to_frontend("errore", "Session name is required.")
        return

    try:
        load_emotiv_credentials()
    except (OSError, RuntimeError) as e:
        send_to_frontend("errore", str(e))
        return

    nome_sessione     = session_name
    data_sessione     = time.strftime("%Y-%m-%d")
    chiusura_in_corso = False
    esperimento_attivo = True

    # slide_update a 0 — il contatore slide non è più usato dal backend
    send_to_frontend("slide_update", 0)
    pulisci_porte()

    try:
        processo_server_emotiv = subprocess.Popen(
            [PY_EMOTIV, "server.py"],
            cwd=PATH_EMOTIV,
            stdin=subprocess.DEVNULL,
        )
        registra_processo(processo_server_emotiv)
        verifica_connessione_ws(processo_server_emotiv)

        processo_http = subprocess.Popen(
            [PY_EMOTIV, "-m", "http.server", "8080"],
            cwd=PATH_EMOTIV,
            stdin=subprocess.DEVNULL,
        )
        registra_processo(processo_http)

    except Exception as e:
        esperimento_attivo = False
        send_to_frontend("errore", f"Impossibile avviare: {e}")
        completa_chiusura()
        return

    threading.Thread(target=avvio_automatico_interfacce, daemon=True).start()
    send_to_frontend("stato", "attivo")


def _ferma_tutto_worker():
    global chiusura_in_corso, nome_sessione, data_sessione

    stop_time = time.time()

    try:
        os.makedirs(CARTELLA_DATI, exist_ok=True)
        safe_name = unicodedata.normalize("NFD", nome_sessione)
        safe_name = "".join(
            c for c in safe_name if unicodedata.category(c) != "Mn"
        )
        safe_name = re.sub(r"\s+", "_", safe_name.strip())
        safe_name = re.sub(r"[^A-Za-z0-9_-]", "", safe_name) or "Session"

        base_name     = f"NeuroFlow_{safe_name}_{data_sessione}"
        percorso_excel = os.path.join(CARTELLA_DATI, f"{base_name}.xlsx")

        dup = 2
        while os.path.exists(percorso_excel):
            percorso_excel = os.path.join(CARTELLA_DATI, f"{base_name}_{dup}.xlsx")
            dup += 1

        salva_excel_ws(percorso_excel, nome_sessione, stop_time)
        send_to_frontend("salvato", percorso_excel)

    except Exception as e:
        send_to_frontend("errore", f"Impossibile salvare l'Excel: {e}")

    finally:
        completa_chiusura()


def ferma_tutto():
    global esperimento_attivo, chiusura_in_corso

    if not esperimento_attivo or chiusura_in_corso:
        return

    chiusura_in_corso  = True
    esperimento_attivo = False
    send_to_frontend("stato", "salvataggio")
    threading.Thread(target=_ferma_tutto_worker, daemon=True).start()


def cleanup_processi_avviati():
    global processi_attivi, processo_eyetracker

    for processo in processi_attivi[:]:
        try:
            termina_processo_e_figli(processo)
        except Exception as e:
            print(f"[cleanup] PID {getattr(processo, 'pid', '?')}: {e}",
                  file=sys.stderr)

    processi_attivi.clear()
    processo_eyetracker = None

    try:
        pulisci_porte()
    except Exception as e:
        print(f"[cleanup] porte: {e}", file=sys.stderr)


def completa_chiusura():
    global chiusura_in_corso

    cleanup_processi_avviati()
    chiusura_in_corso = False

    try:
        send_to_frontend("slide_update", 0)
        send_to_frontend("stato", "fermo")
    except Exception:
        pass


def shutdown_backend():
    global chiusura_in_corso

    if esperimento_attivo and not chiusura_in_corso:
        ferma_tutto()
        deadline = time.monotonic() + 100
        while chiusura_in_corso and time.monotonic() < deadline:
            time.sleep(0.2)

    cleanup_processi_avviati()


# ============================================================
# MOTORE DI ASCOLTO
# ============================================================
def main_loop():
    send_to_frontend("stato", "fermo")

    for line in sys.stdin:
        try:
            msg = json.loads(line.strip())
            cmd = msg.get("cmd")

            if cmd == "avvia":
                avvia_tutto(msg.get("session_name", ""))
            elif cmd == "ferma":
                ferma_tutto()
            elif cmd == "shutdown":
                shutdown_backend()
                break
            elif cmd == "apri_dashboard":
                apri_dashboard()
            elif cmd == "apri_eyetracker":
                apri_eyetracker()
            elif cmd == "apri_cartella":
                os.makedirs(CARTELLA_DATI, exist_ok=True)
                open_path(CARTELLA_DATI)

        except Exception:
            pass


if __name__ == "__main__":
    try:
        main_loop()
    finally:
        cleanup_processi_avviati()