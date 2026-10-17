import { useMemo } from "react";
import { EPOC_X_ELECTRODES } from "../constants/eegConstants";
import { getScalpRgb, rgbToCss } from "../utils/scalpMapUtils";

export default function ScalpMap2D({
  electrodeValues,
  selectedBand,
  compareMode,
  absoluteScale,
  deltaScale,
}) {
  const colorForValue = (value) =>
    rgbToCss(
      getScalpRgb({
        value,
        compareMode,
        absoluteScale,
        deltaScale,
      })
    );

  const interpolatedCells = useMemo(() => {
    const sensors = EPOC_X_ELECTRODES
      .map((electrode) => ({
        x: electrode.x,
        y: electrode.y,
        value: electrodeValues[electrode.id],
      }))
      .filter((sensor) => Number.isFinite(sensor.value));

    if (sensors.length < 2) return [];

    const cells = [];
    const centerX = 50;
    const centerY = 50;
    const scalpRadius = 47;
    const step = 2;
    const idwPower = 2.2;
    const epsilon = 1.25;

    for (let y = 3; y <= 97; y += step) {
      for (let x = 3; x <= 97; x += step) {
        if (Math.hypot(x - centerX, y - centerY) > scalpRadius) continue;

        let numerator = 0;
        let denominator = 0;
        let exactValue = null;

        for (const sensor of sensors) {
          const distance = Math.hypot(x - sensor.x, y - sensor.y);

          if (distance < 0.75) {
            exactValue = sensor.value;
            break;
          }

          const weight = 1 / Math.pow(distance + epsilon, idwPower);
          numerator += weight * sensor.value;
          denominator += weight;
        }

        const value =
          exactValue !== null
            ? exactValue
            : denominator > 0
              ? numerator / denominator
              : null;

        if (Number.isFinite(value)) {
          cells.push({ x, y, value });
        }
      }
    }

    return cells;
  }, [electrodeValues]);

  return (
    <div className="flex flex-col items-center w-full">
      <div className="relative w-[360px] h-[360px] max-w-full">
        <svg viewBox="-10 -10 120 120" className="w-full h-full overflow-visible">
          <defs>
            <clipPath id="scalp-map-clip">
              <circle cx="50" cy="50" r="47" />
            </clipPath>
            <filter id="scalp-map-soften" x="-10%" y="-10%" width="120%" height="120%">
              <feGaussianBlur stdDeviation="0.75" />
            </filter>
          </defs>

          <g clipPath="url(#scalp-map-clip)" filter="url(#scalp-map-soften)" opacity="0.96">
            {interpolatedCells.map((cell, index) => {
              const color = colorForValue(cell.value);
              return (
                <rect
                  key={`heat-${index}`}
                  x={cell.x - 1.15}
                  y={cell.y - 1.15}
                  width="2.3"
                  height="2.3"
                  fill={color}
                  stroke={color}
                  strokeWidth="0.25"
                />
              );
            })}
          </g>

          <circle cx="50" cy="50" r="48" fill="none" stroke="#111111" strokeWidth="1.6" />
          <path d="M 44 2 L 50 -6 L 56 2" fill="white" stroke="#111111" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M 2 35 C -6 40 -6 60 2 65" fill="white" stroke="#111111" strokeWidth="1.6" />
          <path d="M 98 35 C 106 40 106 60 98 65" fill="white" stroke="#111111" strokeWidth="1.6" />

          {EPOC_X_ELECTRODES.map((electrode) => {
            const value = electrodeValues[electrode.id];

            return (
              <g key={electrode.id} transform={`translate(${electrode.x}, ${electrode.y})`}>
                <title>
                  {`${electrode.id} · ${selectedBand}: ${
                    Number.isFinite(value) ? value.toFixed(4) : "N/A"
                  }`}
                </title>

                <circle
                  cx="0"
                  cy="0"
                  r="3.2"
                  fill={Number.isFinite(value) ? colorForValue(value) : "#e5e5e0"}
                  stroke="#111111"
                  strokeWidth="1.1"
                />

                <text
                  x={electrode.tx}
                  y={electrode.ty}
                  fontSize="3.8"
                  fontWeight="900"
                  fill="#111111"
                  textAnchor="middle"
                  alignmentBaseline="middle"
                  paintOrder="stroke"
                  stroke="white"
                  strokeWidth="1.3"
                  strokeLinejoin="round"
                >
                  {electrode.id}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <p className="text-[10px] text-[#8a8a85] text-center mt-3 leading-relaxed max-w-[520px]">
        2D IDW interpolation from the 14 measured EPOC X electrodes. Colors between sensors are estimated; electrode circles are measured locations.
      </p>
    </div>
  );
}
