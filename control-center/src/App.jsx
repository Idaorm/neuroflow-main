import { useState, useEffect, useRef } from "react";
import { Command } from "@tauri-apps/plugin-shell";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./App.css";
import SessionViewer from './components/SessionViewer';

export default function App() {
  const [stato, setStato] = useState("fermo");
  const [slide, setSlide] = useState(1);
  const [showViewer, setShowViewer] = useState(false);
  const [sessionName, setSessionName] = useState("");

  const pyRef = useRef(null);
  const closingRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    let unlistenClose = null;
    let child = null;

    const sleep = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms));

    const requestShutdown = async (
      targetChild,
      timeoutMs = 120000
    ) => {
      if (!targetChild) return;

      try {
        await targetChild.write(
          JSON.stringify({ cmd: "shutdown" }) + "\n"
        );
      } catch (e) {
        console.error(
          "Backend shutdown request error:",
          e
        );
      }

      const deadline = Date.now() + timeoutMs;

      while (
        pyRef.current === targetChild &&
        Date.now() < deadline
      ) {
        await sleep(100);
      }

      // Ultima risorsa: il backend non ha risposto
      // allo shutdown cooperativo.
      if (pyRef.current === targetChild) {
        try {
          await targetChild.kill();
        } catch (e) {
          console.error(
            "Backend forced kill error:",
            e
          );
        }

        if (pyRef.current === targetChild) {
          pyRef.current = null;
        }
      }
    };

    const startBackend = async () => {
      try {
        const cmd = Command.create("python", [
          __BACKEND_PATH__,
        ]);

        cmd.stdout.on("data", (line) => {
          try {
            const msg = JSON.parse(line);

            if (msg.tipo === "stato") {
              setStato(msg.dati);
            }

            if (msg.tipo === "slide_update") {
              setSlide(msg.dati);
            }

            if (msg.tipo === "errore") {
              console.error("Python backend error:", msg.dati);
            }
          } catch (e) {}
        });

        cmd.stderr.on("data", (line) => {
          console.error("Python stderr:", line);
        });

        cmd.on("error", (error) => {
          console.error(
            "Python backend error:",
            error
          );
        });

        cmd.on("close", () => {
          if (pyRef.current === child) {
            pyRef.current = null;
          }
        });

        child = await cmd.spawn();

        if (disposed) {
          try {
            await child.write(
              JSON.stringify({ cmd: "shutdown" }) + "\n"
            );
          } catch (e) {}

          await sleep(500);

          try {
            await child.kill();
          } catch (e) {}

          return;
        }

        pyRef.current = child;

      } catch (e) {
        console.error(
          "Python startup error:",
          e
        );
      }
    };

    const installCloseHandler = async () => {
      try {
        const appWindow = getCurrentWindow();

        unlistenClose =
          await appWindow.onCloseRequested(
            async (event) => {
              if (closingRef.current) {
                return;
              }

              event.preventDefault();
              closingRef.current = true;

              const targetChild = pyRef.current;

              await requestShutdown(
                targetChild,
                120000
              );

              await appWindow.destroy();
            }
          );

        if (disposed && unlistenClose) {
          unlistenClose();
          unlistenClose = null;
        }

      } catch (e) {
        console.error(
          "Close handler installation error:",
          e
        );
      }
    };

    void startBackend();
    void installCloseHandler();

    return () => {
      disposed = true;

      if (unlistenClose) {
        unlistenClose();
        unlistenClose = null;
      }

      // Hot reload / smontaggio React:
      // chiediamo lo shutdown invece di killare
      // immediatamente Python.
      if (!closingRef.current && pyRef.current) {
        const targetChild = pyRef.current;
        void requestShutdown(
          targetChild,
          120000
        );
      }
    };
  }, []);

  const inviaComando = (cmd, payload = {}) => {
    if (pyRef.current) {
      const msg = JSON.stringify({ cmd, ...payload }) + "\n";
      pyRef.current.write(new TextEncoder().encode(msg));
    }
  };

  const apriCartellaDati = () => {
    inviaComando("apri_cartella");
  };

  const isAttivo = stato === "attivo";
  const isSalvataggio = stato === "salvataggio";

  const today = new Date();
  const sessionDate = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");

  const safeSessionName = sessionName
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_-]/g, "");

  const sessionFilePreview = safeSessionName
    ? `NeuroFlow_${safeSessionName}_${sessionDate}.xlsx`
    : "NeuroFlow_SESSION_NAME_DATE.xlsx";

  return (
    <div className="min-h-screen bg-[#f4f4f2] text-[#111111] font-sans">
      <div className="mx-auto max-w-6xl px-8 py-10">

        {/* HEADER */}
        <header className="flex items-center justify-between mb-10">
          <div>
            <p className="text-xs font-semibold tracking-[0.2em] text-[#8a8a85] uppercase mb-1">
              Experiment Control Center
            </p>
            <h1 className="text-3xl font-black tracking-tight text-[#111111]">
              NeuroTech Suite
            </h1>
          </div>

          <div className="flex items-center gap-3">

            <button
              onClick={() => setShowViewer(!showViewer)}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold tracking-widest uppercase border transition-colors shadow-sm ${
                showViewer
                  ? "bg-[#111111] text-white border-[#111111]"
                  : "bg-white text-[#111111] border-[#e5e5e0] hover:bg-[#111111] hover:text-white"
              }`}
            >
              📊 {showViewer ? "Close Data" : "View Data"}
            </button>

            <button
              onClick={apriCartellaDati}
              className="flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold tracking-widest uppercase bg-white text-[#111111] border border-[#e5e5e0] hover:bg-[#111111] hover:text-white transition-colors shadow-sm"
            >
              📁 Data Folder
            </button>

            <div
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold tracking-widest uppercase
              ${
                isAttivo
                  ? "bg-[#111111] text-white"
                  : isSalvataggio
                    ? "bg-[#d8a63e]/15 text-[#8a6a1f] border border-[#d8a63e]/30"
                    : "bg-white text-[#8a8a85] border border-[#e5e5e0]"
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  isAttivo
                    ? "bg-[#7CFC98]"
                    : isSalvataggio
                      ? "bg-[#d8a63e] animate-pulse"
                      : "bg-[#c7c7c0]"
                }`}
              />
              {isAttivo ? "Online" : isSalvataggio ? "Saving" : "Offline"}
            </div>
          </div>
        </header>

        {/* SEZIONE VISUALIZZATORE DATI */}
        {showViewer && (
          <div className="mb-6 bg-white rounded-[28px] p-7 border border-[#ececea] shadow-sm animate-fade-in">
            <SessionViewer />
          </div>
        )}

        {/* HERO / SLIDE CARD */}
        <div className="relative rounded-[28px] overflow-hidden mb-6 bg-gradient-to-br from-[#1a1d17] via-[#20241d] to-[#0f110d] p-10 min-h-[200px] flex flex-col justify-between shadow-[0_20px_60px_-20px_rgba(0,0,0,0.35)]">
          <div>
            <p className="text-xs font-semibold tracking-[0.2em] text-white/50 uppercase mb-3">
              Slide Monitoring
            </p>
            <h2 className="text-4xl font-black text-white leading-tight">
              Real-time marker synchronization
            </h2>
          </div>

          <div className="absolute bottom-6 right-6 bg-white/10 backdrop-blur-md border border-white/15 rounded-2xl px-5 py-4 flex items-center gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/50 mb-1">
                Current Slide
              </p>
              <p className="text-3xl font-black text-white leading-none">
                {slide}
              </p>
            </div>
            <div className="w-10 h-10 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-white/70 text-sm font-bold">
              #
            </div>
          </div>
        </div>

        {/* GRIGLIA CONTROLLI */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* CARD AVVIA */}
          <div className="bg-white rounded-3xl p-7 border border-[#ececea] flex flex-col justify-between">
            <div>
              <div className="w-9 h-9 rounded-full bg-[#eaf7ee] flex items-center justify-center text-[#1f8a3f] text-xs font-bold mb-5">
                ▶
              </div>
              <p className="text-xs font-semibold tracking-[0.15em] text-[#8a8a85] uppercase mb-1">
                Session
              </p>
              <h3 className="text-lg font-bold text-[#111111] mb-2">
                Recording
              </h3>
              <p className="text-sm text-[#6b6b66] leading-relaxed">
                Start signal acquisition and synchronization with the presentation.
              </p>

              <div className="mt-5">
                <label className="block text-xs font-semibold tracking-[0.12em] text-[#8a8a85] uppercase mb-2">
                  Session name
                </label>

                <input
                  type="text"
                  value={sessionName}
                  onChange={(e) => setSessionName(e.target.value)}
                  disabled={isAttivo || isSalvataggio}
                  maxLength={60}
                  placeholder="e.g. Visual Attention Test"
                  className="w-full rounded-2xl border border-[#e5e5e0] bg-[#fafaf8] px-4 py-3 text-sm text-[#111111] outline-none transition focus:border-[#111111] disabled:bg-[#f0f0ed] disabled:text-[#8a8a85]"
                />

                <p className="mt-2 text-xs text-[#8a8a85] break-all">
                  File: {sessionFilePreview}
                </p>
              </div>
            </div>

            <button
              onClick={() => inviaComando("avvia", { session_name: sessionName.trim() })}
              disabled={isAttivo || isSalvataggio || !safeSessionName}
              className="mt-6 w-full flex items-center justify-center gap-2 bg-[#1f8a3f] hover:bg-[#187233] text-white text-sm font-bold rounded-full py-3 transition-colors disabled:bg-[#e5e5e0] disabled:text-[#a3a39c] disabled:cursor-not-allowed"
            >
              Start recording
              <span aria-hidden>→</span>
            </button>
          </div>

          {/* CARD STOP */}
          <div className="bg-white rounded-3xl p-7 border border-[#ececea] flex flex-col justify-between">
            <div>
              <div className="w-9 h-9 rounded-full bg-[#fdeceb] flex items-center justify-center text-[#c23b32] text-xs font-bold mb-5">
                ■
              </div>
              <p className="text-xs font-semibold tracking-[0.15em] text-[#8a8a85] uppercase mb-1">
                Session
              </p>
              <h3 className="text-lg font-bold text-[#111111] mb-2">
                Stop Acquisition
              </h3>
              <p className="text-sm text-[#6b6b66] leading-relaxed">
                Stop recording and save the data collected so far.
              </p>
            </div>

            <button
              onClick={() => inviaComando("ferma")}
              disabled={!isAttivo}
              className="mt-6 w-full flex items-center justify-center gap-2 bg-[#c23b32] hover:bg-[#a52f28] text-white text-sm font-bold rounded-full py-3 transition-colors disabled:bg-[#e5e5e0] disabled:text-[#a3a39c] disabled:cursor-not-allowed"
            >
              Stop and save
              <span aria-hidden>→</span>
            </button>
          </div>
        </div>

        {/* SEZIONE STRUMENTI */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
          <button
            onClick={() => inviaComando("apri_dashboard")}
            disabled={isSalvataggio}
            className="group text-left bg-white hover:bg-[#fafaf8] rounded-3xl p-7 border border-[#ececea] transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white"
          >
            <p className="text-xs font-semibold tracking-[0.15em] text-[#8a8a85] uppercase mb-1">
              Tool
            </p>
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold text-[#111111]">EEG Live</h3>
              <span className="w-9 h-9 rounded-full border border-[#e5e5e0] flex items-center justify-center text-[#111111] group-hover:bg-[#111111] group-hover:text-white transition-colors">
                →
              </span>
            </div>
            <p className="text-sm text-[#6b6b66] mt-2">
              Real-time biometric signals and metrics.
            </p>
          </button>

          <button
            onClick={() => inviaComando("apri_eyetracker")}
            disabled={isSalvataggio}
            className="group text-left bg-white hover:bg-[#fafaf8] rounded-3xl p-7 border border-[#ececea] transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white"
          >
            <p className="text-xs font-semibold tracking-[0.15em] text-[#8a8a85] uppercase mb-1">
              Tool
            </p>
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold text-[#111111]">EyeTracker</h3>
              <span className="w-9 h-9 rounded-full border border-[#e5e5e0] flex items-center justify-center text-[#111111] group-hover:bg-[#111111] group-hover:text-white transition-colors">
                →
              </span>
            </div>
            <p className="text-sm text-[#6b6b66] mt-2">
              Gaze analysis synchronized with the slide.
            </p>
          </button>
        </div>

      </div>
    </div>
  );
}
