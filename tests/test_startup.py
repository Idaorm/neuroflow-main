"""Regression checks for configuration and failed EEG startup."""

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import backend
import env_utils


class ConfigurationTest(unittest.TestCase):
    def test_env_file_preserves_existing_environment(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / ".env"
            path.write_text(
                '# comment\nEMOTIV_CLIENT_ID="from-file"\n'
                "EMOTIV_CLIENT_SECRET='file-secret'\n",
                encoding="utf-8",
            )
            with mock.patch.dict(os.environ, {"EMOTIV_CLIENT_ID": "external"}, clear=True):
                env_utils.load_env_file(path)
                self.assertEqual(os.environ["EMOTIV_CLIENT_ID"], "external")
                self.assertEqual(os.environ["EMOTIV_CLIENT_SECRET"], "file-secret")

    def test_credentials_load_from_project_root(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / ".env").write_text(
                "EMOTIV_CLIENT_ID=test\nEMOTIV_CLIENT_SECRET=secret\n",
                encoding="utf-8",
            )
            with mock.patch.object(env_utils, "__file__", str(root / "env_utils.py")):
                with mock.patch.dict(os.environ, {}, clear=True):
                    self.assertEqual(env_utils.load_emotiv_credentials(), ("test", "secret"))

    def test_missing_credentials_do_not_expose_other_secret(self):
        with mock.patch.object(env_utils, "load_env_file"):
            with mock.patch.dict(os.environ, {"EMOTIV_CLIENT_SECRET": "private"}, clear=True):
                with self.assertRaisesRegex(RuntimeError, "EMOTIV_CLIENT_ID") as error:
                    env_utils.load_emotiv_credentials()
                self.assertNotIn("private", str(error.exception))


class StartupTest(unittest.TestCase):
    def setUp(self):
        self.state = mock.patch.multiple(
            backend, esperimento_attivo=False, processi_attivi=[],
            chiusura_in_corso=False, keyboard_listener=None,
        )
        self.state.start()
        self.addCleanup(self.state.stop)

    def test_missing_credentials_report_error_without_starting_children(self):
        with mock.patch.object(backend, "load_emotiv_credentials", side_effect=RuntimeError("Missing credentials")):
            with mock.patch.object(backend, "send_to_frontend") as send:
                with mock.patch.object(backend.subprocess, "Popen") as popen:
                    backend.avvia_tutto("Test")
        popen.assert_not_called()
        send.assert_called_once_with("errore", "Missing credentials")
        self.assertFalse(backend.esperimento_attivo)

    def test_crashed_server_is_cleaned_up_without_reporting_active(self):
        process = mock.Mock(returncode=1)
        process.poll.return_value = 1
        with mock.patch.object(backend, "load_emotiv_credentials"):
            with mock.patch.object(backend, "pulisci_porte"):
                with mock.patch.object(backend, "termina_processo_e_figli") as terminate:
                    with mock.patch.object(backend, "send_to_frontend") as send:
                        with mock.patch.object(backend.subprocess, "Popen", return_value=process) as popen:
                            backend.avvia_tutto("Test")
        self.assertEqual(popen.call_count, 1)
        terminate.assert_called_once_with(process)
        self.assertFalse(backend.esperimento_attivo)
        self.assertEqual(backend.processi_attivi, [])
        self.assertNotIn(mock.call("stato", "attivo"), send.call_args_list)
        self.assertIn(mock.call("stato", "fermo"), send.call_args_list)
        self.assertTrue(any(call.args[0] == "errore" for call in send.call_args_list))

    def test_unreachable_server_times_out(self):
        process = mock.Mock()
        process.poll.return_value = None
        with mock.patch.object(backend.websocket, "WebSocket", side_effect=OSError("refused")):
            with mock.patch.object(backend.time, "sleep"):
                with self.assertRaisesRegex(RuntimeError, "8765"):
                    backend.verifica_connessione_ws(process)

    def test_ready_recording_does_not_insert_a_marker(self):
        process = mock.Mock()
        process.poll.return_value = None
        with mock.patch.object(backend.websocket, "WebSocket"):
            with mock.patch.object(backend, "send_to_frontend"):
                with mock.patch.object(backend, "invia_marker") as marker:
                    backend.verifica_connessione_ws(process)
        marker.assert_not_called()


if __name__ == "__main__":
    unittest.main()
