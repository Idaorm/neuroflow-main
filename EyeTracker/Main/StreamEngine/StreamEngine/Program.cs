using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Globalization;
using StreamEngineTobii.Models;
using Tobii.StreamEngine;

namespace StreamEngineDemo.Services
{
    public class EyeTrackerService
    {
        private static IntPtr _apiContext;
        private static IntPtr _deviceContext;
        private static List<GazeData> _gazePoints = new List<GazeData>();
        private static CancellationTokenSource _cts;
        private static bool _isRunning = false;
        private static tobii_gaze_point_callback_t _gazeCallback;
        private static Thread _acquisitionThread;

        public static IReadOnlyList<GazeData> GazePoints => _gazePoints;
        public static bool IsRunning => _isRunning;

        public static int sceneIndex = 0; // Variabile che tiene traccia dell'indice di scena

        public static void Start()
        {
            if (_isRunning)
            {
                Console.WriteLine("Registrazione già in corso.");
                return;
            }

            _gazePoints.Clear();
            _cts = new CancellationTokenSource();
            _isRunning = true;

            // Crea contesto e device
            var result = Interop.tobii_api_create(out _apiContext, null);
            Debug.Assert(result == tobii_error_t.TOBII_ERROR_NO_ERROR);

            result = Interop.tobii_enumerate_local_device_urls(_apiContext, out var urls);
            Debug.Assert(result == tobii_error_t.TOBII_ERROR_NO_ERROR);
            if (urls.Count == 0) throw new Exception("Nessun eye tracker trovato.");

            result = Interop.tobii_device_create(_apiContext, urls[0], Interop.tobii_field_of_use_t.TOBII_FIELD_OF_USE_STORE_OR_TRANSFER_FALSE, out _deviceContext);
            Debug.Assert(result == tobii_error_t.TOBII_ERROR_NO_ERROR);

            _gazeCallback = new tobii_gaze_point_callback_t(OnGazePoint);
            result = Interop.tobii_gaze_point_subscribe(_deviceContext, _gazeCallback);
            Console.WriteLine($"[DEBUG] tobii_api_create: OK");
            Console.WriteLine($"[DEBUG] device trovato: {urls[0]}");
            Console.WriteLine($"[DEBUG] gaze_point_subscribe: {result}");
            if (result != tobii_error_t.TOBII_ERROR_NO_ERROR)
            {
                Console.WriteLine($"[ERRORE] Subscribe fallito: {result}. Tobii Experience e' aperto?");
                _isRunning = false;
                return;
            }

            // Avvio thread di acquisizione
            _acquisitionThread = new Thread(() =>
            {
                var token = _cts.Token;
                Console.WriteLine("Registrazione iniziata.");

                while (!token.IsCancellationRequested)
                {
                    result = Interop.tobii_wait_for_callbacks(new[] { _deviceContext });
                    if (result == tobii_error_t.TOBII_ERROR_TIMED_OUT) continue;

                    result = Interop.tobii_device_process_callbacks(_deviceContext);
                }

                Console.WriteLine("Registrazione interrotta.");
            });
            _acquisitionThread.IsBackground = true;
            _acquisitionThread.Start();
        }

        public static void Stop()
        {
            if (!_isRunning) return;

            _cts?.Cancel();
            Thread.Sleep(200); // attesa minima per sicurezza

            Interop.tobii_gaze_point_unsubscribe(_deviceContext);
            Interop.tobii_device_destroy(_deviceContext);
            Interop.tobii_api_destroy(_apiContext);

            _gazeCallback = null;
            _isRunning = false;
        }

        public static void SaveToCsv()
        {
            sceneIndex++;
            string timestamp = DateTime.Now.ToString("dd-MM-yyyy HH-mm-ss");
            string filename = $"gaze_data Scena {sceneIndex}.csv";
            string desktopPath = Environment.GetFolderPath(Environment.SpecialFolder.Desktop);
            string filePath = Path.Combine(desktopPath, filename);

            using (var writer = new StreamWriter(filePath))
            {
                writer.WriteLine("X,Y,Timestamp");

                foreach (var gaze in _gazePoints)
                {
                    writer.WriteLine($"{gaze.X.ToString(CultureInfo.InvariantCulture)},{gaze.Y.ToString(CultureInfo.InvariantCulture)},{gaze.Timestamp}");
                }
            }

            Console.WriteLine($"File salvato in: {filePath}");
        }

        private static void OnGazePoint(ref tobii_gaze_point_t gazePoint, IntPtr userData)
        {
            if (gazePoint.validity == tobii_validity_t.TOBII_VALIDITY_VALID)
            {
                long ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                _gazePoints.Add(new GazeData
                {
                    X = gazePoint.position.x,
                    Y = gazePoint.position.y,
                    Timestamp = ts
                });
                Console.WriteLine($"GAZE {gazePoint.position.x:F5} {gazePoint.position.y:F5} {ts}");
            }
        }

        public static void Main(string[] args)
        {
            /*
            Start();
            Console.WriteLine("Acquisizione in corso... premi un tasto per fermare.");
            Console.ReadKey();
            Stop();
            SaveToCsv();

            // rimuovere o mantenere?
            Console.WriteLine("Ecco i isultati raccolti: ");
            foreach (var gaze in GazePoints) {
                Console.WriteLine($"X: {gaze.X} Y: {gaze.Y} Timestamp: {gaze.Timestamp}");
            }
            */


            while (true)
            {
                string? command = Console.ReadLine();
                if (command == null) continue;

                switch (command.Trim())
                {
                    case "Start":
                        Start();
                        break;
                    case "Stop":
                        Stop();
                        break;
                    case "Save":
                        SaveToCsv();
                        break;
                    case "Exit":
                        return;
                    default:
                        break;
                }
            }
        }
    }
}