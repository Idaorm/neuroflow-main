import { useEffect, useMemo, useState } from "react";
import { BANDS } from "../constants/eegConstants";
import {
  calculateAbsoluteScale,
  calculateDeltaScale,
  calculateElectrodeValues,
  getPhaseName,
  getPhaseRows,
  getScalpPhases,
} from "../utils/scalpMapUtils";
import ScalpMap2D from "./ScalpMap2D";
import ScalpMap3D from "./ScalpMap3D";

export default function ScalpMapSection({ bandPowerData, totalSlides }) {
  const [selectedBand, setSelectedBand] = useState("Alpha");
  const [selectedSlide, setSelectedSlide] = useState(1);
  const [compareMode, setCompareMode] = useState(false);
  const [viewMode, setViewMode] = useState("2d");

  const phases = useMemo(
    () => getScalpPhases(totalSlides),
    [totalSlides]
  );

  useEffect(() => {
    if (!phases.includes(selectedSlide)) {
      setSelectedSlide(1);
      setCompareMode(false);
    }
  }, [phases, selectedSlide]);

  const phaseName = getPhaseName;

  const selectedSampleCount = useMemo(
    () => getPhaseRows(bandPowerData, selectedSlide).length,
    [bandPowerData, selectedSlide]
  );

  const previousSampleCount = useMemo(
    () =>
      selectedSlide > 1
        ? getPhaseRows(bandPowerData, selectedSlide - 1).length
        : 0,
    [bandPowerData, selectedSlide]
  );

  const electrodeValues = useMemo(
    () =>
      calculateElectrodeValues({
        bandPowerData,
        selectedSlide,
        selectedBand,
        compareMode,
      }),
    [bandPowerData, selectedSlide, selectedBand, compareMode]
  );

  const absoluteScale = useMemo(
    () =>
      calculateAbsoluteScale({
        bandPowerData,
        phases,
        selectedBand,
      }),
    [bandPowerData, phases, selectedBand]
  );

  const deltaScale = useMemo(
    () => calculateDeltaScale(electrodeValues),
    [electrodeValues]
  );

  const validElectrodes = Object.values(electrodeValues).filter(Number.isFinite).length;
  const legendMin = compareMode ? -deltaScale.maxAbs : absoluteScale.min;
  const legendMax = compareMode ? deltaScale.maxAbs : absoluteScale.max;

  return (
    <div className="bg-white rounded-[28px] p-7 border border-[#ececea] shadow-sm flex flex-col items-center w-full">
      <div className="w-full flex flex-col xl:flex-row justify-between items-start xl:items-center mb-7 gap-5 border-b border-[#ececea] pb-6">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h3 className="text-xl font-bold text-[#111111]">Scalp Map</h3>

            <div className="inline-flex rounded-full border border-[#ececea] bg-[#fafaf8] p-1">
              <button
                type="button"
                onClick={() => setViewMode("2d")}
                className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider transition-colors ${
                  viewMode === "2d"
                    ? "bg-[#111111] text-white"
                    : "text-[#6b6b66] hover:bg-white"
                }`}
              >
                2D
              </button>
              <button
                type="button"
                onClick={() => setViewMode("3d")}
                className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider transition-colors ${
                  viewMode === "3d"
                    ? "bg-[#111111] text-white"
                    : "text-[#6b6b66] hover:bg-white"
                }`}
              >
                3D
              </button>
            </div>
          </div>

          <p className="text-sm text-[#6b6b66] mt-1">
            {compareMode && selectedSlide > 1
              ? `${selectedBand} Delta: ${phaseName(selectedSlide - 1)} ➔ ${phaseName(selectedSlide)}`
              : `${selectedBand} Avg Power: ${phaseName(selectedSlide)}`}
          </p>

          <p className="text-[10px] text-[#8a8a85] mt-1 uppercase tracking-wider font-bold">
            {compareMode
              ? `${previousSampleCount} → ${selectedSampleCount} BandPower samples`
              : `${selectedSampleCount} BandPower samples`}
            {" · "}
            {validElectrodes}/14 electrodes
          </p>
        </div>

        <div className="flex flex-wrap gap-3 items-center">
          <select
            className="px-4 py-2 border border-[#ececea] rounded-full text-xs font-bold bg-[#fafaf8] uppercase cursor-pointer outline-none"
            value={selectedBand}
            onChange={(event) => setSelectedBand(event.target.value)}
          >
            {BANDS.map((band) => (
              <option key={band} value={band}>
                {band === "BetaL" ? "Beta Low" : band === "BetaH" ? "Beta High" : band} Band
              </option>
            ))}
          </select>

          <select
            className="px-4 py-2 border border-[#ececea] rounded-full text-xs font-bold bg-[#fafaf8] uppercase cursor-pointer outline-none"
            value={selectedSlide}
            onChange={(event) => {
              const nextSlide = Number(event.target.value);
              setSelectedSlide(nextSlide);
              if (nextSlide === 1) setCompareMode(false);
            }}
          >
            {phases.map((phase) => (
              <option key={phase} value={phase}>
                {phaseName(phase)}
              </option>
            ))}
          </select>

          <div className="relative group">
            <button
              type="button"
              onClick={() => setCompareMode((current) => !current)}
              disabled={selectedSlide === 1 && !compareMode}
              className={`px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest transition-colors ${
                compareMode
                  ? "bg-[#111111] text-white shadow-md"
                  : "bg-white text-[#111111] border border-[#ececea] hover:bg-[#fafaf8]"
              } disabled:opacity-30 disabled:cursor-not-allowed`}
            >
              Delta Compare
            </button>

            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 w-60 p-3 bg-[#111111] text-white text-xs text-center rounded-lg opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-10 shadow-lg leading-relaxed">
              Difference between the current phase and the immediately previous phase.
              <br /><br />
              <span className="text-red-400 font-bold">Red</span> = Increase
              <br />
              <span className="text-blue-400 font-bold">Blue</span> = Decrease
              <div className="absolute top-full left-1/2 -translate-x-1/2 border-[6px] border-transparent border-t-[#111111]"></div>
            </div>
          </div>
        </div>
      </div>

      {viewMode === "2d" ? (
        <ScalpMap2D
          electrodeValues={electrodeValues}
          selectedBand={selectedBand}
          compareMode={compareMode}
          absoluteScale={absoluteScale}
          deltaScale={deltaScale}
        />
      ) : (
        <ScalpMap3D
          electrodeValues={electrodeValues}
          selectedBand={selectedBand}
          compareMode={compareMode}
          absoluteScale={absoluteScale}
          deltaScale={deltaScale}
        />
      )}

      <div className="mt-7 flex flex-col items-center w-full max-w-[420px]">
        <div
          className="w-full h-3 rounded-full mb-2 border border-[#ececea]"
          style={{
            background: compareMode
              ? "linear-gradient(to right, rgb(37, 99, 235), rgb(245, 245, 244), rgb(220, 38, 38))"
              : "linear-gradient(to right, rgb(37, 99, 235), rgb(34, 211, 238), rgb(250, 204, 21), rgb(220, 38, 38))",
          }}
        />

        <div className="w-full flex justify-between text-[10px] font-bold text-[#6b6b66] uppercase tracking-wider">
          <span>{legendMin.toFixed(3)}</span>
          {compareMode && <span>0</span>}
          <span>{legendMax.toFixed(3)}</span>
        </div>
      </div>
    </div>
  );
}
