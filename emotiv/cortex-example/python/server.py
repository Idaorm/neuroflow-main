import asyncio
import json
import logging
import math
import threading
import queue
import time
import numpy as np
import pandas as pd
from datetime import datetime
from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed
from cortex import Cortex
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from env_utils import load_emotiv_credentials

for stream in (sys.stdout, sys.stderr):
    if stream is not None and hasattr(stream, "reconfigure"):
        stream.reconfigure(errors="backslashreplace")

logging.getLogger("websockets").setLevel(logging.CRITICAL)

client_id, client_secret = load_emotiv_credentials()

user = {
    "client_id": client_id,
    "client_secret": client_secret,
}

data_queue = queue.Queue()
connected_clients = set()
status_clients = set()


class DataCollector:
    def __init__(self, user):
        self.c = Cortex(user["client_id"], user["client_secret"], debug_mode=False)
        self.c.bind(create_session_done=self.on_create_session_done)
        self.c.bind(new_data_labels=self.on_new_data_labels)
        self.c.bind(new_mot_data=self.on_new_mot_data)
        self.c.bind(new_met_data=self.on_new_met_data)
        self.c.bind(new_pow_data=self.on_new_pow_data)
        self.c.bind(inform_error=self.on_inform_error)

        self.mot_buffer = []
        self.met_buffer = []
        self.pow_buffer = []
        self.labels = {}
        self.last_mot = None
        self.last_error = None
        self.last_live_sample = None

        self.marker_buffer = []
        self.current_marker = None
        self.last_time = None

    def on_create_session_done(self, *args, **kwargs):
        print("\n✅ [CORTEX] Sessione creata con successo!")
        self.c.sub_request(["mot", "met", "pow"])

    def on_new_data_labels(self, *args, **kwargs):
        data = kwargs.get("data")
        stream = data.get("streamName")
        self.labels[stream] = data.get("labels")
        print(f"📋 [LABELS] Ricevute etichette per: {stream}")

    def on_new_mot_data(self, *args, **kwargs):
        raw = kwargs.get("data")
        if raw:
            raw["_marker"] = self.current_marker
            self.mot_buffer.append(raw)
            self.last_mot = raw

    def on_new_met_data(self, *args, **kwargs):
        raw = kwargs.get("data")
        if raw:
            raw["_marker"] = self.current_marker
            self.last_time = raw.get("time")
            self.last_error = None
            self.met_buffer.append(raw)
            data_queue.put(raw)

    def on_new_pow_data(self, *args, **kwargs):
        raw = kwargs.get("data")
        if raw:
            raw["_marker"] = self.current_marker
            self.pow_buffer.append(raw)

    def on_inform_error(self, *args, **kwargs):
        err = kwargs.get("error_data")
        self.last_error = str(err.get("message", err)) if isinstance(err, dict) else str(err)
        print(f"\n❌ [CORTEX ERROR]: {err}")

    def stream_status(self):
        if self.last_error:
            state, message = "error", "Cortex: " + self.last_error
        elif self.last_live_sample is not None and time.monotonic() - self.last_live_sample < 15:
            state, message = "streaming", "Receiving EEG metrics"
        else:
            state, message = "waiting", "Connected to NeuroFlow; waiting for Cortex metrics"
        return {"type": "stream_status", "state": state, "message": message}

    def start(self):
        self.c.open()

    def set_marker(self, label, event_time=None):
        try:
            ts = float(event_time) if event_time is not None else time.time()
        except (TypeError, ValueError):
            ts = time.time()

        self.current_marker = label if label else None
        entry = {
            "time": ts,
            "label": label or "—",
            "samples_at_set": len(self.met_buffer),
        }
        self.marker_buffer.append(entry)
        print(f"  [MARKER] {entry}")

    def set_stop_marker(self, event_time=None):
        if any(row.get("label") == "stop" for row in self.marker_buffer):
            return False
        self.set_marker("stop", event_time)
        return True

    def clear_marker(self):
        self.current_marker = None

    def _get_slide_windows(self, snap_markers):
        """Calcola la finestra temporale (t_start, t_end) per ogni slide."""
        slide_markers = [
            m for m in snap_markers
            if str(m.get("label", "")).startswith("slide_")
        ]
        windows = []
        for i, m in enumerate(slide_markers):
            t_start = float(m["time"])
            if i + 1 < len(slide_markers):
                t_end = float(slide_markers[i + 1]["time"])
            else:
                stop_m = [s for s in snap_markers
                          if s.get("label") in ("stop", "STOP_TOBII")]
                t_end = float(stop_m[0]["time"]) if stop_m else float("inf")
            windows.append({
                "label":   m["label"],
                "t_start": t_start,
                "t_end":   t_end,
            })
        return windows

    def _filter_by_window(self, data_list, t_start, t_end):
        return [r for r in data_list
                if t_start <= float(r.get("time", 0)) < t_end]

    def save_to_excel(self, filename=None, session_name=None):
        cartella_default = os.path.expanduser(
            os.environ.get("NEUROFLOW_DATA_DIR", "~/Documents/NeuroTech_Data")
        )
        os.makedirs(cartella_default, exist_ok=True)

        if filename is None:
            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = os.path.join(cartella_default, f"dati_emotiv_{ts}.xlsx")
        else:
            os.makedirs(os.path.dirname(filename), exist_ok=True)

        print(f"\nSalvataggio in corso → {filename} ...")
        saved = []

        try:
            snap_mot     = list(self.mot_buffer)
            snap_met     = list(self.met_buffer)
            snap_pow     = list(self.pow_buffer)
            snap_markers = list(self.marker_buffer)

            windows = self._get_slide_windows(snap_markers)

            with pd.ExcelWriter(filename, engine="openpyxl") as writer:

                # ── Foglio Sessione ──────────────────────────────────────
                info = pd.DataFrame({
                    "Info": [
                        "Nome sessione", "Data sessione",
                        "Campioni mot", "Campioni met", "Campioni pow",
                        "Marker inseriti", "Immagini registrate",
                    ],
                    "Valore": [
                        session_name or "",
                        datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                        len(snap_mot), len(snap_met), len(snap_pow),
                        len(snap_markers), len(windows),
                    ]
                })
                info.to_excel(writer, sheet_name="Sessione", index=False)

                # ── Foglio Markers ───────────────────────────────────────
                if snap_markers:
                    df_m = pd.DataFrame(snap_markers,
                                        columns=["time", "label", "samples_at_set"])
                    df_m.to_excel(writer, sheet_name="Markers", index=False)
                    saved.append(f"Markers ({len(df_m)} eventi)")

                # ── Foglio Performance completa ──────────────────────────
                if snap_met and "met" in self.labels:
                    df = pd.DataFrame([r["met"] for r in snap_met],
                                      columns=self.labels["met"])
                    df.insert(0, "time", [r["time"] for r in snap_met])
                    df["marker"] = [r.get("_marker") or "" for r in snap_met]
                    df.to_excel(writer, sheet_name="Performance", index=False)
                    saved.append(f"Performance ({len(df)} righe)")

                # ── Foglio BandPower completa ────────────────────────────
                if snap_pow and "pow" in self.labels:
                    df = pd.DataFrame([r["pow"] for r in snap_pow],
                                      columns=self.labels["pow"])
                    df.insert(0, "time", [r["time"] for r in snap_pow])
                    df["marker"] = [r.get("_marker") or "" for r in snap_pow]
                    df.to_excel(writer, sheet_name="BandPower", index=False)
                    saved.append(f"BandPower ({len(df)} righe)")

                # ── Foglio Motion completa ───────────────────────────────
                if snap_mot and "mot" in self.labels:
                    df = pd.DataFrame([r["mot"] for r in snap_mot],
                                      columns=self.labels["mot"])
                    df.insert(0, "time", [r["time"] for r in snap_mot])
                    df["marker"] = [r.get("_marker") or "" for r in snap_mot]
                    df.to_excel(writer, sheet_name="Motion", index=False)
                    saved.append(f"Motion ({len(df)} righe)")

                # ── Foglio RiepilogoImmagini: una riga per foto ──────────
                # Colonne metriche da mostrare nel riepilogo (esclude le colonne .isActive)
                _METRIC_COLS = ["attention", "eng", "exc", "lex", "str", "rel", "int"]

                if windows and snap_met and "met" in self.labels:
                    met_cols = self.labels["met"]
                    rows = []
                    for win in windows:
                        sub = self._filter_by_window(
                            snap_met, win["t_start"], win["t_end"]
                        )
                        row = {"slide": win["label"],
                               "campioni": len(sub),
                               "durata_s": round(win["t_end"] - win["t_start"], 1)
                                           if win["t_end"] != float("inf") else ""}
                        if sub:
                            arr = pd.DataFrame([r["met"] for r in sub],
                                               columns=met_cols)
                            for col in met_cols:
                                try:
                                    row[col] = round(float(arr[col].mean()), 4)
                                except Exception:
                                    row[col] = ""
                        else:
                            for col in met_cols:
                                row[col] = ""
                        rows.append(row)

                    df_ric = pd.DataFrame(rows)
                    df_ric.to_excel(writer, sheet_name="RiepilogoImmagini", index=False)
                    saved.append(f"RiepilogoImmagini ({len(df_ric)} immagini)")

                # ── Foglio RiepilogoBande: onde cerebrali medie per foto ─
                if windows and snap_pow and "pow" in self.labels:
                    band_names = ["theta", "alpha", "betaL", "betaH", "gamma"]
                    rows = []
                    for win in windows:
                        sub = self._filter_by_window(
                            snap_pow, win["t_start"], win["t_end"]
                        )
                        row = {"slide": win["label"], "campioni": len(sub)}
                        if sub:
                            arr = pd.DataFrame([r["pow"] for r in sub],
                                               columns=self.labels["pow"])
                            for band in band_names:
                                cols = [c for c in arr.columns
                                        if c.endswith("/" + band)]
                                if cols:
                                    try:
                                        row[band] = round(
                                            float(arr[cols].mean().mean()), 6
                                        )
                                    except Exception:
                                        row[band] = ""
                                else:
                                    row[band] = ""
                        else:
                            for band in band_names:
                                row[band] = ""
                        rows.append(row)

                    df_band = pd.DataFrame(rows)
                    df_band.to_excel(writer, sheet_name="RiepilogoBande", index=False)
                    saved.append(f"RiepilogoBande ({len(df_band)} immagini)")

                # ── Formattazione ────────────────────────────────────────
                for sname in writer.sheets:
                    ws = writer.sheets[sname]
                    ws.freeze_panes = "A2"
                    for col in ws.columns:
                        ws.column_dimensions[col[0].column_letter].width = 18

            print(f"✅ Salvato: {filename}")
            for s in saved:
                print(f"   • {s}")
            return filename

        except Exception as e:
            print(f"❌ Errore durante il salvataggio: {e}")
            raise


collector = DataCollector(user)


def run_cortex():
    global collector
    while True:
        try:
            print("⏳ [CORTEX] Avvio connessione...")
            collector.start()
        except Exception as e:
            print(f"❌ [CORTEX] Connessione interrotta: {e}")
        print("🔄 [CORTEX] Tentativo di riconnessione tra 5 secondi...")
        time.sleep(5)
        collector = DataCollector(user)

threading.Thread(target=run_cortex, daemon=True).start()


async def handler(websocket):
    connected_clients.add(websocket)
    try:
        async for message in websocket:
            try:
                cmd = json.loads(message)
                if cmd.get("action") == "subscribe_status":
                    status_clients.add(websocket)
                    await websocket.send(json.dumps(collector.stream_status()))
                elif cmd.get("action") == "save_excel":
                    percorso_ricevuto = cmd.get("path")
                    session_name = cmd.get("session_name", "")
                    try:
                        collector.set_stop_marker(cmd.get("event_time"))
                        filename = collector.save_to_excel(percorso_ricevuto, session_name)
                        error = None
                    except Exception as e:
                        filename = None
                        error = str(e)
                    resp = {
                        "type": "save_result",
                        "success": filename is not None,
                        "filename": filename,
                        "error": error,
                    }
                    await websocket.send(json.dumps(resp))
                elif cmd.get("action") == "finalize_finish":
                    collector.set_stop_marker(cmd.get("event_time"))
                elif cmd.get("action") == "set_marker":
                    label = cmd.get("label", "")
                    event_time = cmd.get("event_time")
                    collector.set_marker(label, event_time)
            except json.JSONDecodeError:
                pass
    except ConnectionClosed:
        pass
    finally:
        connected_clients.discard(websocket)
        status_clients.discard(websocket)


def finite_number(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return number if math.isfinite(number) else None


def live_payload(raw):
    met = raw.get("met") if isinstance(raw, dict) else None
    if not isinstance(met, (list, tuple)) or len(met) < 11:
        return None
    values = {}
    for key, index in {"foc": 1, "eng": 3, "exc": 5, "str": 8, "rel": 10}.items():
        number = finite_number(met[index])
        values[key] = None if number is None else round(
            max(0.0, min(100.0, number * 100)), 2
        )
    if all(value is None for value in values.values()):
        return None
    payload = {
        "type": "data", **values,
        "session_samples": len(collector.met_buffer),
        "active_marker": collector.current_marker or "",
    }
    if collector.last_mot:
        mot = collector.last_mot.get("mot")
        if isinstance(mot, (list, tuple)) and len(mot) >= 10:
            numbers = [finite_number(v) for v in mot[:7]]
            if all(n is not None for n in numbers):
                keys = ("q0", "q1", "q2", "q3", "accX", "accY", "accZ")
                payload["mot"] = {
                    k: round(n, 6 if i < 4 else 4)
                    for i, (k, n) in enumerate(zip(keys, numbers))
                }
    return payload


async def broadcast(payload, clients):
    message = json.dumps(payload, allow_nan=False)
    for ws in clients.copy():
        try:
            await ws.send(message)
        except Exception:
            connected_clients.discard(ws)
            status_clients.discard(ws)


async def broadcast_loop():
    last_status = time.monotonic() - 1
    while True:
        if not data_queue.empty() and connected_clients:
            payload = live_payload(data_queue.get_nowait())
            if payload is not None:
                collector.last_live_sample = time.monotonic()
                await broadcast(payload, connected_clients)

        if status_clients and time.monotonic() - last_status >= 1:
            await broadcast(collector.stream_status(), status_clients)
            last_status = time.monotonic()
        await asyncio.sleep(0.05)


async def main():
    async with serve(handler, "localhost", 8765):
        await broadcast_loop()


if __name__ == "__main__":
    asyncio.run(main())