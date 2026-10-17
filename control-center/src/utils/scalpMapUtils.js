import { EPOC_X_ELECTRODES } from "../constants/eegConstants.js";

export const getScalpPhases = (totalSlides) => [
  ...Array.from({ length: totalSlides }, (_, i) => i + 1),
];

export const getPhaseName = (phase) => {
  return `Slide ${phase}`;
};

export const getPhaseRows = (bandPowerData, phase) =>
  (bandPowerData || []).filter((row) => row.activeSlide === phase);

export const calculatePhaseAverages = (bandPowerData, phase, band) => {
  const phaseRows = getPhaseRows(bandPowerData, phase);
  if (phaseRows.length === 0) return null;

  const averages = {};

  EPOC_X_ELECTRODES.forEach((electrode) => {
    const expectedKey = `${electrode.id}.${band}`.toLowerCase();
    const columnKey = Object.keys(phaseRows[0]).find(
      (key) => key.toLowerCase() === expectedKey
    );

    if (!columnKey) {
      averages[electrode.id] = null;
      return;
    }

    const values = phaseRows
      .filter((row) => row[columnKey] !== null && row[columnKey] !== undefined && row[columnKey] !== "")
      .map((row) => Number(row[columnKey]))
      .filter((value) => Number.isFinite(value));

    averages[electrode.id] =
      values.length > 0
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : null;
  });

  return averages;
};

export const calculateElectrodeValues = ({
  bandPowerData,
  selectedSlide,
  selectedBand,
  compareMode,
}) => {
  const current = calculatePhaseAverages(
    bandPowerData,
    selectedSlide,
    selectedBand
  );

  if (!current) return {};
  if (!compareMode || selectedSlide <= 1) return current;

  const previous = calculatePhaseAverages(
    bandPowerData,
    selectedSlide - 1,
    selectedBand
  );

  if (!previous) return current;

  const differences = {};

  EPOC_X_ELECTRODES.forEach((electrode) => {
    const currentValue = current[electrode.id];
    const previousValue = previous[electrode.id];

    differences[electrode.id] =
      Number.isFinite(currentValue) && Number.isFinite(previousValue)
        ? currentValue - previousValue
        : null;
  });

  return differences;
};

export const calculateAbsoluteScale = ({
  bandPowerData,
  phases,
  selectedBand,
}) => {
  const values = [];

  phases.forEach((phase) => {
    const averages = calculatePhaseAverages(
      bandPowerData,
      phase,
      selectedBand
    );

    if (!averages) return;

    Object.values(averages).forEach((value) => {
      if (Number.isFinite(value)) values.push(value);
    });
  });

  if (values.length === 0) return { min: 0, max: 1 };

  const min = Math.min(...values);
  const max = Math.max(...values);

  return max === min
    ? { min: min - 0.5, max: max + 0.5 }
    : { min, max };
};

export const calculateDeltaScale = (electrodeValues) => {
  const values = Object.values(electrodeValues).filter(Number.isFinite);
  const maxAbs =
    values.length > 0
      ? Math.max(...values.map((value) => Math.abs(value)))
      : 1;

  return { maxAbs: maxAbs === 0 ? 1 : maxAbs };
};

export const clamp01 = (value) => Math.max(0, Math.min(1, value));

export const mixRgb = (a, b, t) => {
  const factor = clamp01(t);
  return [
    Math.round(a[0] + (b[0] - a[0]) * factor),
    Math.round(a[1] + (b[1] - a[1]) * factor),
    Math.round(a[2] + (b[2] - a[2]) * factor),
  ];
};

export const sequentialRgb = (normalized) => {
  const t = clamp01(normalized);
  const stops = [
    { at: 0.0, rgb: [37, 99, 235] },
    { at: 0.33, rgb: [34, 211, 238] },
    { at: 0.66, rgb: [250, 204, 21] },
    { at: 1.0, rgb: [220, 38, 38] },
  ];

  for (let i = 0; i < stops.length - 1; i++) {
    const left = stops[i];
    const right = stops[i + 1];

    if (t <= right.at) {
      const localT = (t - left.at) / (right.at - left.at);
      return mixRgb(left.rgb, right.rgb, localT);
    }
  }

  return [220, 38, 38];
};

export const divergingRgb = (normalized) => {
  const t = Math.max(-1, Math.min(1, normalized));

  if (t < 0) {
    return mixRgb([37, 99, 235], [245, 245, 244], t + 1);
  }

  return mixRgb([245, 245, 244], [220, 38, 38], t);
};

export const getScalpRgb = ({
  value,
  compareMode,
  absoluteScale,
  deltaScale,
}) => {
  if (!Number.isFinite(value)) return [229, 229, 224];

  if (compareMode) {
    return divergingRgb(value / deltaScale.maxAbs);
  }

  const { min, max } = absoluteScale;
  const normalized = max === min ? 0.5 : (value - min) / (max - min);
  return sequentialRgb(normalized);
};

export const rgbToCss = ([r, g, b]) => `rgb(${r}, ${g}, ${b})`;

// Proiezione geometrica del layout 2D corrente su un ellissoide 3D.
// Non rappresenta coordinate anatomiche individuali: serve a mantenere
// coerente la posizione relativa dei 14 elettrodi tra vista 2D e vista 3D.
export const projectElectrodeToHead = (electrode) => {
  const nx = (electrode.x - 50) / 47;
  const nz = (50 - electrode.y) / 47;
  const radiusSquared = Math.min(0.985, nx * nx + nz * nz);
  const ny = Math.sqrt(Math.max(0.015, 1 - radiusSquared));

  const unitLength = Math.hypot(nx, ny, nz) || 1;
  const unit = {
    x: nx / unitLength,
    y: ny / unitLength,
    z: nz / unitLength,
  };

  return {
    unit,
    position: {
      x: unit.x * 1.02,
      y: unit.y * 1.18,
      z: unit.z * 1.08,
    },
  };
};
