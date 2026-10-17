"""Checks the save acknowledgement used before stopping the EEG server."""

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import backend


class SaveFlowTest(unittest.TestCase):
    def test_waits_for_save_result_after_live_data(self):
        with tempfile.TemporaryDirectory() as folder:
            filename = str(Path(folder) / "session.xlsx")
            Path(filename).write_bytes(b"created by server")
            ws = mock.create_autospec(backend.websocket.WebSocket, instance=True)
            ws.recv.side_effect = [
                json.dumps({"type": "data", "foc": 42}),
                json.dumps({"type": "save_result", "success": True, "filename": filename}),
            ]
            with mock.patch.object(backend.websocket, "create_connection", return_value=ws):
                self.assertEqual(backend.salva_excel_ws(filename, "Test", 1234.5), filename)
            self.assertEqual(json.loads(ws.send.call_args.args[0])["event_time"], 1234.5)
            self.assertEqual(ws.recv.call_count, 2)
            ws.close.assert_called_once()

    def test_reports_server_error(self):
        ws = mock.create_autospec(backend.websocket.WebSocket, instance=True)
        ws.recv.return_value = json.dumps({
            "type": "save_result", "success": False, "error": "Permission denied",
        })
        with mock.patch.object(backend.websocket, "create_connection", return_value=ws):
            with self.assertRaisesRegex(RuntimeError, "Permission denied"):
                backend.salva_excel_ws("session.xlsx", "Test")
        ws.close.assert_called_once()


if __name__ == "__main__":
    unittest.main()
