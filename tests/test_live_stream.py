"""Checks live metrics, opt-in dashboard status and Cortex reconnect warnings."""
import asyncio
import importlib.util
import json
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

SERVER_DIR = Path(__file__).resolve().parents[1] / 'emotiv' / 'cortex-example' / 'python'


def load_server():
    sys.path.insert(0, str(SERVER_DIR))
    try:
        spec = importlib.util.spec_from_file_location('live_server_test', SERVER_DIR / 'server.py')
        module = importlib.util.module_from_spec(spec)
        with mock.patch.dict(os.environ, {'EMOTIV_CLIENT_ID': 'test', 'EMOTIV_CLIENT_SECRET': 'test'}):
            with mock.patch('threading.Thread.start'):
                spec.loader.exec_module(module)
        return module
    finally:
        sys.path.remove(str(SERVER_DIR))


class LiveStreamTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.server = load_server()

    def test_acquisition_preserves_original_values_in_all_streams(self):
        collector = self.server.collector
        collector.current_marker = 'inizio slide1'
        values = [0.123456789, -12.987654321, 0.0, 1, True, None]
        for stream in ('mot', 'met', 'pow'):
            with self.subTest(stream=stream):
                sample = {'time': 1234.56789, stream: list(values)}
                getattr(collector, f'on_new_{stream}_data')(data=sample)
                saved = getattr(collector, f'{stream}_buffer')[-1]
                self.assertEqual(saved[stream], values)
                self.assertEqual(saved['time'], 1234.56789)
                self.assertEqual(saved['_marker'], 'inizio slide1')
        self.assertEqual(collector.last_mot['mot'], values)
        self.assertEqual(self.server.data_queue.get_nowait()['met'], values)

    def test_registration_warning_reports_error_and_closes_cortex_only(self):
        client = self.server.collector.c
        client.ws = mock.Mock()
        client.handle_warning({'code': 11, 'message': 'The APIs cannot be registered. Please re-open the connection.'})
        client.ws.close.assert_called_once_with()
        status = self.server.collector.stream_status()
        self.assertEqual(status['state'], 'error')
        self.assertIn('cannot be registered', status['message'])

    def test_partial_metrics_keep_missing_values_as_null(self):
        payload = self.server.live_payload({'met': [True, .2, True, .4, True, .6, .7, False, None, True, .8]})
        self.assertEqual(payload['foc'], 20)
        self.assertIsNone(payload['str'])
        self.assertEqual(payload['rel'], 80)
        json.dumps(payload, allow_nan=False)

    def test_empty_invalid_and_nonfinite_samples_do_not_crash(self):
        for raw in (None, {}, {'met': None}, {'met': [1]}, {'met': [None] * 11}, {'met': [float('nan')] * 11}, {'met': [float('inf')] * 11}):
            self.assertIsNone(self.server.live_payload(raw))
        self.server.collector.last_mot = {'mot': [None] * 10}
        payload = self.server.live_payload({'met': [.2] * 11})
        self.assertNotIn('mot', payload)

    async def test_save_client_receives_no_unsolicited_status(self):
        class SaveClient:
            def __init__(self):
                self.messages = []
            def __aiter__(self):
                return self.commands()
            async def commands(self):
                yield json.dumps({"action": "save_excel", "path": "test.xlsx", "event_time": 1240.75})
            async def send(self, message):
                self.messages.append(json.loads(message))
        client = SaveClient()
        def saved_with_stop(*args):
            self.assertEqual(self.server.collector.marker_buffer[-1]['label'], 'stop')
            self.assertEqual(self.server.collector.marker_buffer[-1]['time'], 1240.75)
            return 'test.xlsx'
        with mock.patch.object(self.server.collector, 'save_to_excel', side_effect=saved_with_stop):
            await self.server.handler(client)
        self.assertEqual([message['type'] for message in client.messages], ['save_result'])
        self.assertNotIn(client, self.server.connected_clients)
        self.assertNotIn(client, self.server.status_clients)

    async def test_bad_sample_does_not_stop_next_valid_sample_or_status(self):
        dashboard = mock.Mock()
        dashboard.send = mock.AsyncMock()
        legacy_client = mock.Mock()
        legacy_client.send = mock.AsyncMock()
        self.server.connected_clients.update((dashboard, legacy_client))
        self.server.status_clients.add(dashboard)
        self.server.data_queue.put({'met': [None] * 11})
        self.server.data_queue.put({'met': [.4] * 11})
        task = asyncio.create_task(self.server.broadcast_loop())
        try:
            for _ in range(30):
                if legacy_client.send.await_count: break
                await asyncio.sleep(.02)
            self.assertFalse(task.done())
            messages = [json.loads(call.args[0]) for call in legacy_client.send.await_args_list]
            self.assertEqual([m['type'] for m in messages], ['data'])
            self.assertEqual(messages[0]['foc'], 40)
            status = [json.loads(call.args[0]) for call in dashboard.send.await_args_list]
            self.assertTrue(any(m['type'] == 'stream_status' for m in status))
        finally:
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task


if __name__ == '__main__':
    unittest.main()
