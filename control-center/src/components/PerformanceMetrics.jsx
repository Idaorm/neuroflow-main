import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
} from "recharts";

const METRICS_CONFIG = [
  { key: "attention", name: "Focus", color: "#1f8a3f" },
  { key: "eng", name: "Engagement", color: "#2563eb" },
  { key: "str", name: "Stress", color: "#c23b32" },
  { key: "exc", name: "Excitement", color: "#d8a63e" },
  { key: "rel", name: "Relaxation", color: "#8b5cf6" },
  { key: "int", name: "Interest", color: "#0ea5e9" },
];

const MetricDot = ({ cx, cy, stroke, payload }) => {
  if (payload?.isSyntheticBoundary) return null;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={3}
      fill="#ffffff"
      stroke={stroke}
      strokeWidth={2}
    />
  );
};

const PerformanceTooltip = ({ active, payload, label }) => {
  if (!active || !payload || payload.length === 0) return null;

  const data = payload[0].payload;

  return (
    <div className="bg-white border border-[#ececea] p-4 rounded-2xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.15)] min-w-[200px]">
      <div className="mb-3 border-b border-[#ececea] pb-3">
        <p className="text-[10px] text-[#8a8a85] uppercase tracking-widest font-bold mb-1">
          Time: {Number(label).toFixed(3)}s
        </p>

        <p className="text-sm font-black text-[#111111]">
          Phase:{" "}
          {data.activePhaseLabel || `Slide ${data.activeSlide}`}
        </p>
        {data.excludedFromAnalysis && <p className="text-xs text-[#6b6b66] mt-1">
          Excluded from analysis
        </p>}
        {data.isSyntheticBoundary && <p className="text-xs text-[#6b6b66] mt-1">
          Display extension of the nearest sample
        </p>}
      </div>

      <div className="flex flex-col gap-2">
        {payload.map((entry, index) => (
          <div
            key={index}
            className="flex items-center justify-between text-xs"
          >
            <div className="flex items-center gap-2">
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: entry.color }}
              />

              <span className="font-bold text-[#111111]">
                {entry.name}
              </span>
            </div>

            <span className="font-mono font-bold text-[#6b6b66]">
              {Number(entry.value).toFixed(2)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default function PerformanceMetrics({
  metricData,
  markerChanges,
  excludedRanges = [],
  recordingDuration = 0,
  endInferred = false,
}) {
  const [activeMetrics, setActiveMetrics] = useState({
    attention: true,
    eng: true,
    str: true,
    exc: false,
    rel: false,
    int: false,
  });

  const toggleMetric = (key) => {
    setActiveMetrics((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const chartMaxTime = Math.max(recordingDuration, 0.001);

  const formatMarkerLabel = (
    change,
    index
  ) => {
    if (change.phaseType === "stop") return "END";

    const labelText = String(
      change.slide || ""
    );

    const match =
      labelText.match(/slide\s*(\d+)/i);

    if (match) {
      return `S${match[1]}`;
    }

    return labelText || `M${index + 1}`;
  };

  const chartData = metricData;

  return (
    <div className="bg-[#fafaf8] border border-[#ececea] rounded-2xl p-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
        <h3 className="text-sm font-bold tracking-widest text-[#8a8a85] uppercase">
          Performance Metrics Trend
        </h3>

        <div className="flex flex-wrap items-center gap-2">
          {METRICS_CONFIG.map((metric) => (
            <button
              key={metric.key}
              onClick={() =>
                toggleMetric(metric.key)
              }
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all border cursor-pointer ${
                activeMetrics[metric.key]
                  ? "bg-white shadow-sm"
                  : "bg-transparent opacity-40 grayscale hover:opacity-70 hover:grayscale-0"
              }`}
              style={{
                borderColor:
                  activeMetrics[metric.key]
                    ? metric.color
                    : "#ececea",
                color:
                  activeMetrics[metric.key]
                    ? metric.color
                    : "#8a8a85",
              }}
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{
                  backgroundColor:
                    activeMetrics[metric.key]
                      ? metric.color
                      : "#8a8a85",
                }}
              />

              {metric.name}
            </button>
          ))}
        </div>
      </div>

      <p className="flex items-center gap-2 text-xs text-[#6b6b66] mb-3">
        <span className="inline-block w-4 h-3 rounded-sm bg-[#d4d4d0]" />
        Gray intervals: recorded data excluded from analysis. Time is relative to recording start.
      </p>
      {endInferred && <p className="text-xs text-[#6b6b66] mb-3">
        This file has no Stop marker. END uses the last recorded timestamp.
      </p>}

      <div className="w-full h-[400px]">
        <ResponsiveContainer
          width="100%"
          height="100%"
        >
          <LineChart
            data={chartData}
            margin={{
              top: 78,
              right: 35,
              bottom: 5,
              left: 0,
            }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#e5e5e0"
              vertical={false}
            />

            <XAxis
              dataKey="timeRelativo"
              type="number"
              domain={[0, chartMaxTime]}
              stroke="#a3a39c"
              fontSize={12}
              tickMargin={10}
              unit="s"
              tickFormatter={(value) => String(Number(Number(value).toFixed(1)))}
            />

            <YAxis
              stroke="#a3a39c"
              fontSize={12}
              domain={["auto", "auto"]}
            />

            <Tooltip
              content={
                <PerformanceTooltip />
              }
              cursor={{
                stroke: "#ececea",
                strokeWidth: 2,
              }}
            />

            {excludedRanges.map((range, index) => (
              <ReferenceArea
                key={`excluded-${index}`}
                x1={range.start}
                x2={range.end}
                fill="#d4d4d0"
                fillOpacity={0.55}
                strokeOpacity={0}
                ifOverflow="hidden"
              />
            ))}

            {markerChanges.map(
              (change, index) => (
                <ReferenceLine
                  key={`${change.time}-${index}`}
                  x={change.time}
                  stroke="#111111"
                  strokeDasharray="4 4"
                  strokeOpacity={0.45}
                  isFront={true}
                  ifOverflow="extendDomain"
                  label={{
                    position:
                      change.phaseType === "stop" ? "insideTopLeft" : "insideTop",
                    value:
                      formatMarkerLabel(
                        change,
                        index
                      ),
                    fill: "#111111",
                    fontSize: 10,
                    fontWeight: "bold",
                    dy:
                      4 +
                      (change.labelLane ||
                        0) *
                        16,
                  }}
                />
              )
            )}

            <Line
              hide={
                !activeMetrics.attention
              }
              type="monotone"
              dataKey="attention"
              dot={<MetricDot />}
              stroke="#1f8a3f"
              strokeWidth={2}
              activeDot={{ r: 6 }}
            />

            <Line
              hide={!activeMetrics.str}
              type="monotone"
              dataKey="str"
              dot={<MetricDot />}
              stroke="#c23b32"
              strokeWidth={2}
              activeDot={{ r: 6 }}
            />

            <Line
              hide={!activeMetrics.eng}
              type="monotone"
              dataKey="eng"
              dot={<MetricDot />}
              stroke="#2563eb"
              strokeWidth={2}
              activeDot={{ r: 6 }}
            />

            <Line
              hide={!activeMetrics.exc}
              type="monotone"
              dataKey="exc"
              dot={<MetricDot />}
              stroke="#d8a63e"
              strokeWidth={2}
              activeDot={{ r: 6 }}
            />

            <Line
              hide={!activeMetrics.rel}
              type="monotone"
              dataKey="rel"
              dot={<MetricDot />}
              stroke="#8b5cf6"
              strokeWidth={2}
              activeDot={{ r: 6 }}
            />

            <Line
              hide={!activeMetrics.int}
              type="monotone"
              dataKey="int"
              dot={<MetricDot />}
              stroke="#0ea5e9"
              strokeWidth={2}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
