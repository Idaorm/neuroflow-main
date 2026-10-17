// Analysis includes [first slide, final slide). Performance also exposes a
// separate full recording timeline whose margins are marked as excluded.
// Legacy exports renamed the final slide marker to "finish"; new exports
// preserve that slide marker and append a separate "stop" event.
export const parseTimeSafely = (value) => {
  if (value === undefined || value === null || value === "") return NaN;
  if (typeof value === "string" && value.includes(":")) {
    const [hours, minutes, seconds] = value.split(":").map(Number);
    return hours * 3600 + minutes * 60 + seconds;
  }
  return Number(value);
};

const numeric = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const metricValues = (row) => ({
  attention: numeric(row.foc ?? row.attention),
  eng: numeric(row.eng), str: numeric(row.str ?? row.exc),
  exc: numeric(row.exc), rel: numeric(row.rel), int: numeric(row.int),
});

const buildPerformanceTimeline = (perfData, powData, motData, markers, monitored = [], changes = []) => {
  const stop = markers.find((marker) => /^stop$/i.test(marker.label));
  let recordingStart = Infinity;
  let recordingEnd = -Infinity;
  // Older files contain a start marker. Otherwise the earliest recorded
  // sample is the best available origin; do not invent an acquisition time.
  for (const rows of [perfData, powData, motData, markers]) {
    for (const row of rows) {
      const time = parseTimeSafely(row.time);
      if (!Number.isFinite(time) || (stop && time > stop.time)) continue;
      recordingStart = Math.min(recordingStart, time);
      recordingEnd = Math.max(recordingEnd, time);
    }
  }
  if (!Number.isFinite(recordingStart)) return { data: [], chartData: [], changes: [], excludedRanges: [], duration: 0 };
  const duration = recordingEnd - recordingStart;
  const slideStart = monitored[0]?.time;
  const slideEnd = changes.length ? slideStart + changes.at(-1).time : null;
  const data = perfData.filter((row) => {
    const time = parseTimeSafely(row.time);
    return Number.isFinite(time) && time >= recordingStart && time <= recordingEnd;
  }).map((row) => {
    const time = parseTimeSafely(row.time);
    const included = monitored.length > 0 && time >= slideStart && time < slideEnd;
    const phase = included ? monitored.findLast((marker) => time >= marker.time) : null;
    return {
      ...metricValues(row), timeRelativo: time - recordingStart,
      excludedFromAnalysis: !included,
      activeSlide: phase?.slideNumber ?? null,
      activePhaseLabel: phase ? `Slide ${phase.slideNumber}` :
        !monitored.length ? "Outside monitored slides" :
          time < slideStart ? "Before first slide" : "Final slide / post-presentation",
    };
  }).sort((a, b) => a.timeRelativo - b.timeRelativo);

  const excludedRanges = monitored.length ? [
    { start: 0, end: slideStart - recordingStart },
    { start: slideEnd - recordingStart, end: duration },
  ].filter((range) => range.end > range.start) : [{ start: 0, end: duration }];
  const chartChanges = changes.map((change) => {
    if (change.phaseType !== "boundary") {
      return { ...change, time: change.time + slideStart - recordingStart };
    }
    // Legacy "finish" replaced the final slide marker. Reconstruct its
    // display number without treating it as the recording stop.
    const finalSlide = markers.find((marker) => marker.time === slideEnd && marker.slideNumber > 0);
    const slideNumber = finalSlide?.slideNumber ?? monitored.at(-1).slideNumber + 1;
    return { ...change, time: slideEnd - recordingStart,
      phaseType: "slide", slideNumber, slide: `Slide ${slideNumber}`,
      displayLabel: `Slide ${slideNumber}`, excludedFromAnalysis: true };
  });
  chartChanges.push({ time: duration, phaseType: "stop", displayLabel: "END",
    labelLane: 1, isInferred: !stop });

  // Display-only endpoint holds: do not move measured timestamps or add
  // these points to data / metricData, which feed counts and analysis.
  const chartData = [...data];
  if (data.length && data[0].timeRelativo > 0) {
    chartData.unshift({ ...data[0], timeRelativo: 0, isSyntheticBoundary: true,
      excludedFromAnalysis: true, activeSlide: null,
      activePhaseLabel: "Recording start" });
  }
  if (data.length && data.at(-1).timeRelativo < duration) {
    chartData.push({ ...data.at(-1), timeRelativo: duration, isSyntheticBoundary: true,
      excludedFromAnalysis: true, activeSlide: null,
      activePhaseLabel: "Recording end" });
  }
  return { data, chartData, changes: chartChanges, excludedRanges, duration, endInferred: !stop };
};

export const processSessionData = (perfData, powData, motData, markersSheet) => {
  const empty = {
    mergedData: [], metricData: [], bandPowerData: [], motionData: [],
    changes: [], totalSlides: 0, duration: 0,
  };
  const markers = markersSheet.map((row) => {
    const key = Object.keys(row).find((key) => /time|offset/i.test(key));
    const label = String(row.label || "").trim();
    const slide = label.match(/slide\s*(\d+)/i);
    return {
      time: parseTimeSafely(row[key]),
      label,
      slideNumber: slide ? Number(slide[1]) : null,
    };
  }).filter((marker) => Number.isFinite(marker.time))
    .sort((a, b) => a.time - b.time);

  const stop = markers.find((marker) => /^stop$/i.test(marker.label));
  const slides = markers.filter((marker) => marker.slideNumber > 0 &&
    (!stop || marker.time < stop.time));
  const emptyAnalysis = () => ({ ...empty,
    performanceTimeline: buildPerformanceTimeline(perfData, powData, motData, markers),
  });
  if (!slides.length) return emptyAnalysis();

  const legacyFinish = markers.find((marker) => /^(finish|end)$/i.test(marker.label) &&
    marker.time > slides[slides.length - 1].time);
  const end = legacyFinish || slides[slides.length - 1];
  const startSec = slides[0].time;
  const endSec = stop ? Math.min(stop.time, end.time) : end.time;
  const monitored = slides.filter((marker) => marker.time < endSec);
  if (!monitored.length || endSec <= startSec) return emptyAnalysis();

  const phaseFor = (time) => monitored.findLast((marker) => time >= marker.time);
  const inWindow = (row) => {
    const time = parseTimeSafely(row.time);
    return Number.isFinite(time) && time >= startSec && time < endSec;
  };
  const phaseFields = (row) => {
    const time = parseTimeSafely(row.time);
    const phase = phaseFor(time);
    return {
      timeRelativo: time - startSec,
      activeSlide: phase.slideNumber,
      activePhaseLabel: `Slide ${phase.slideNumber}`,
    };
  };
  const metricData = perfData.filter(inWindow).map((row) => ({
    ...phaseFields(row),
    ...metricValues(row),
  })).sort((a, b) => a.timeRelativo - b.timeRelativo);

  const bandPowerData = powData.filter(inWindow).map((row) => {
    const values = {};
    Object.entries(row).forEach(([key, value]) => {
      if (key.includes("/") || key.includes(".")) {
        values[key.replace("/", ".")] = numeric(value);
      }
    });
    return { ...values, ...phaseFields(row) };
  });

  const motionData = motData.filter(inWindow).map((row) => {
    const values = Object.fromEntries(Object.entries(row).map(([key, value]) =>
      [key.toLowerCase(), value]));
    return {
      ...phaseFields(row),
      q0: numeric(values.q0), q1: numeric(values.q1),
      q2: numeric(values.q2), q3: numeric(values.q3),
      accX: numeric(values.accx), accY: numeric(values.accy), accZ: numeric(values.accz),
    };
  }).sort((a, b) => a.timeRelativo - b.timeRelativo);

  const duration = endSec - startSec;
  const changes = monitored.map((marker) => ({
    time: marker.time - startSec,
    slide: marker.label,
    phaseType: "slide",
    slideNumber: marker.slideNumber,
    displayLabel: `Slide ${marker.slideNumber}`,
  }));
  changes.push({ time: duration, slide: "End of monitored slides",
    phaseType: "boundary", slideNumber: null, displayLabel: "End of monitored slides" });
  const lanes = [-Infinity, -Infinity, -Infinity, -Infinity];
  changes.forEach((change) => {
    let lane = lanes.findIndex((last) => change.time - last >= Math.max(0.8, duration * 0.025));
    if (lane < 0) lane = lanes.indexOf(Math.min(...lanes));
    lanes[lane] = change.time;
    change.labelLane = lane;
  });

  return {
    mergedData: metricData, metricData, bandPowerData, motionData, changes,
    totalSlides: monitored.length, duration,
    performanceTimeline: buildPerformanceTimeline(perfData, powData, motData, markers, monitored, changes),
  };
};
