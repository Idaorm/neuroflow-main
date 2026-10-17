import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import * as XLSX from "xlsx";

import PerformanceMetrics from "./PerformanceMetrics";
import ScalpMapSection from "./ScalpMapSection";
import BandPowerMatrix from "./BandPowerMatrix";
import HeadMovement from "./HeadMovement";
import SessionSummary from "./SessionSummary";
import { processSessionData } from "../utils/sessionDataUtils";

export default function SessionViewer() {
  const [performanceTimeline, setPerformanceTimeline] = useState(null);
  const [bandPowerData, setBandPowerData] = useState([]);
  const [motionData, setMotionData] = useState([]);
  const [markerChanges, setMarkerChanges] = useState([]);
  const [fileName, setFileName] = useState("");
  const [summaryStats, setSummaryStats] = useState(null);

  const handleLoadExcel = async () => {
    try {
      const selectedPath = await open({
        multiple: false,
        filters: [{ name: "Excel", extensions: ["xlsx", "csv"] }],
      });

      if (!selectedPath) return;

      const fileData = await readFile(selectedPath);
      const workbook = XLSX.read(fileData, { type: "array" });

      const readSheet = (name) => workbook.Sheets[name]
        ? XLSX.utils.sheet_to_json(workbook.Sheets[name]) : [];
      let perfData = readSheet("Performance");
      if (!workbook.Sheets.Performance) {
        perfData = workbook.SheetNames.map(readSheet).find((rows) =>
          rows.length && Object.keys(rows[0]).some((key) => /^(attention|foc|eng|str)$/i.test(key))
        ) || [];
      }
      const { mergedData, metricData, bandPowerData, motionData, changes, totalSlides, duration, performanceTimeline } =
        processSessionData(perfData, readSheet("BandPower"), readSheet("Motion"), readSheet("Markers"));
      setPerformanceTimeline(performanceTimeline);

      if (totalSlides > 0) {

        let sumAtt = 0, sumEng = 0, countAtt = 0, countEng = 0;
        const summarySource = metricData.length > 0 ? metricData : mergedData;
        summarySource.forEach(row => {
          if (typeof row.attention === 'number') { sumAtt += row.attention; countAtt++; }
          if (typeof row.eng === 'number') { sumEng += row.eng; countEng++; }
        });

        setSummaryStats({
          duration: duration.toFixed(1),
          totalSlides,
          avgAttention: countAtt > 0 ? (sumAtt / countAtt).toFixed(2) : "N/A",
          avgEngagement: countEng > 0 ? (sumEng / countEng).toFixed(2) : "N/A"
        });

        setMarkerChanges(changes);
        setFileName(selectedPath.split(/[/\\]/).pop());
        setBandPowerData(bandPowerData);
        setMotionData(motionData);
      } else {
        setSummaryStats(null);
        setMarkerChanges([]);
        setBandPowerData([]);
        setMotionData([]);
        setFileName(selectedPath.split(/[/\\]/).pop());
      }

    } catch (error) {
      console.error("Error loading file:", error);
      alert(`Si è verificato un errore durante il caricamento del file:\n\n${error.message}`);
    }
  };

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-[#111111]">Session Analysis</h2>
          <p className="text-sm text-[#6b6b66]">{fileName ? `Loaded file: ${fileName}` : "No data loaded"}</p>
        </div>
        <button onClick={handleLoadExcel} className="bg-[#111111] hover:bg-[#222222] text-white px-5 py-2 rounded-full text-xs font-bold tracking-widest uppercase transition-colors">
          Load Excel File
        </button>
      </div>

      {fileName && !summaryStats && (
        <p className="text-sm text-[#6b6b66]">
          No monitored slide intervals found. Analysis requires slide markers and a final slide boundary.
        </p>
      )}

      {fileName && (
        <div className="flex flex-col gap-6 animate-fade-in">

          <SessionSummary summaryStats={summaryStats} />
          {summaryStats && <p className="text-sm text-[#6b6b66]">
            Averages, scalp maps and head movement include monitored slides only.
            Performance Metrics also shows the excluded recording intervals in gray.
          </p>}

          {performanceTimeline?.data.length > 0 && <PerformanceMetrics
            metricData={performanceTimeline.chartData}
            markerChanges={performanceTimeline.changes}
            excludedRanges={performanceTimeline.excludedRanges}
            recordingDuration={performanceTimeline.duration}
            endInferred={performanceTimeline.endInferred}
          />}

          {summaryStats && (
            <>
              <ScalpMapSection
                bandPowerData={bandPowerData}
                totalSlides={summaryStats.totalSlides}
              />
              <BandPowerMatrix
                bandPowerData={bandPowerData}
                totalSlides={summaryStats.totalSlides}
              />
              <HeadMovement
                motionData={motionData}
                markerChanges={markerChanges}
              />
            </>
          )}

        </div>
      )}
    </div>
  );
}
