import test from "node:test";
import assert from "node:assert/strict";
import { processSessionData } from "./sessionDataUtils.js";
import { calculateAbsoluteScale, calculateElectrodeValues, getScalpPhases } from "./scalpMapUtils.js";

const markers = [
  { time: 10, label: "inizio slide1" },
  { time: 20, label: "inizio slide2" },
  { time: 30, label: "inizio slide3" },
  { time: 40, label: "stop" },
];
const samples = [9.9999, 10, 19.9999, 20, 29.9999, 30, 35, 40, 41].map((time) => ({
  time, foc: time, eng: time, "AF3/alpha": time >= 10 && time < 30 ? time / 10 : 900,
  Q0: 1, Q1: 0, Q2: 0, Q3: 0, ACCX: time,
}));

test("only monitored intervals feed analysis, with exact inclusive/exclusive boundaries", () => {
  const result = processSessionData(samples, samples, samples, markers);
  assert.equal(result.totalSlides, 2);
  assert.equal(result.duration, 20);
  for (const rows of [result.metricData, result.bandPowerData, result.motionData, result.mergedData]) {
    assert.equal(rows.length, 4);
    assert.deepEqual(rows.map((row) => row.activeSlide), [1, 1, 2, 2]);
    assert.equal(rows[0].timeRelativo, 0);
    assert.ok(rows.every((row) => row.timeRelativo >= 0 && row.timeRelativo < 20));
  }
  assert.deepEqual(result.changes.map((change) => change.time), [0, 10, 20]);
  assert.equal(result.changes.at(-1).phaseType, "boundary");
  const scale = calculateAbsoluteScale({ bandPowerData: result.bandPowerData,
    phases: getScalpPhases(result.totalSlides), selectedBand: "Alpha" });
  assert.ok(scale.min > 1 && scale.max < 3, "discarded outliers cannot expand the scale");
  assert.deepEqual(markers.map((marker) => marker.label),
    ["inizio slide1", "inizio slide2", "inizio slide3", "stop"]);
});

test("legacy Finish closes the final monitored slide without losing it", () => {
  const legacy = [{ time: 0, label: "start" }, ...markers.slice(0, 2), { time: 30, label: "finish" }];
  const { performanceTimeline: legacyTimeline, ...legacyAnalysis } = processSessionData(samples, samples, samples, legacy);
  const { performanceTimeline: currentTimeline, ...currentAnalysis } = processSessionData(samples, samples, samples, markers);
  assert.deepEqual(legacyAnalysis, currentAnalysis);
  assert.equal(legacyTimeline.data.length, samples.length);
  assert.deepEqual(legacyTimeline.excludedRanges, [{start: 0, end: 10}, {start: 30, end: 41}]);
  assert.equal(currentTimeline.data.length, samples.length - 1, "new files end at Stop");
  assert.deepEqual(legacyTimeline.changes.map((marker) => marker.displayLabel),
    ["Slide 1", "Slide 2", "Slide 3", "END"]);
  assert.equal(legacyTimeline.changes.at(-1).time, 41);
  assert.equal(legacyTimeline.endInferred, true);
  assert.equal(currentTimeline.endInferred, false);
});

test("Performance shows both gray margins without feeding them into summary averages", () => {
  const before = {time: 0, foc: 1000};
  const result = processSessionData([before, ...samples], samples, samples, markers);
  const timeline = result.performanceTimeline;
  assert.equal(timeline.duration, 40);
  assert.deepEqual(timeline.excludedRanges, [{start: 0, end: 10}, {start: 30, end: 40}]);
  assert.deepEqual(timeline.changes.map((marker) => marker.time), [10, 20, 30, 40]);
  assert.deepEqual(timeline.data.map((row) => row.excludedFromAnalysis),
    [true, true, false, false, false, false, true, true, true]);
  assert.equal(timeline.data[0].attention, 1000);
  assert.ok(result.metricData.every((row) => row.attention < 30));
  assert.equal(result.duration, 20);
});

test("recording origin uses the earliest stream even when Performance arrives later", () => {
  const result = processSessionData(samples, [{time: 0}], [], markers);
  assert.equal(result.performanceTimeline.data[0].timeRelativo, 9.9999);
  assert.equal(result.performanceTimeline.excludedRanges[0].end, 10);
  assert.equal(result.metricData[0].timeRelativo, 0, "analysis retains slide-relative time");
});

test("a recording without monitored slides is entirely gray, not included in analysis", () => {
  const result = processSessionData(samples, [], [], []);
  assert.equal(result.performanceTimeline.data.length, samples.length);
  assert.ok(result.performanceTimeline.data.every((row) => row.excludedFromAnalysis));
  assert.equal(result.performanceTimeline.excludedRanges.length, 1);
  assert.equal(result.metricData.length, 0);
});

test("empty or unbounded sessions never fall back to unfiltered recordings", () => {
  for (const events of [[], [markers[3]], [markers[0], markers[3]], [{time: 0, label: "start"}]]) {
    const result = processSessionData(samples, samples, samples, events);
    assert.equal(result.totalSlides, 0);
    assert.equal(result.metricData.length + result.bandPowerData.length + result.motionData.length, 0);
  }
});

test("BandPower and Motion can be analysed without Performance samples", () => {
  const result = processSessionData([], samples, samples, markers);
  assert.equal(result.totalSlides, 2);
  assert.equal(result.bandPowerData.length, 4);
  assert.equal(result.motionData.length, 4);
  assert.deepEqual(result.metricData, []);
});

test("first slide has no baseline delta and missing readings do not become zero", () => {
  const result = processSessionData([], [{time: 10, "AF3/alpha": null},
    {time: 11, "AF3/alpha": 2}, {time: 20, "AF3/alpha": 5}], [], markers);
  const options = {bandPowerData: result.bandPowerData, selectedBand: "Alpha", compareMode: true};
  assert.equal(calculateElectrodeValues({...options, selectedSlide: 1}).AF3, 2);
  assert.equal(calculateElectrodeValues({...options, selectedSlide: 2}).AF3, 3);
});

test("display lines reach zero and END without altering samples or analysis", () => {
  const perf = [{time: 5, foc: 0.2}, {time: 15, foc: 0.4}, {time: 35, foc: 0.6},
    {time: 41, foc: 999}];
  const result = processSessionData(perf, [{time: 0}], [], markers);
  const timeline = result.performanceTimeline;
  assert.deepEqual(timeline.data.map((row) => row.timeRelativo), [5, 15, 35]);
  assert.deepEqual(timeline.chartData.map((row) => row.timeRelativo), [0, 5, 15, 35, 40]);
  assert.equal(timeline.chartData[0].attention, 0.2);
  assert.equal(timeline.chartData.at(-1).attention, 0.6);
  assert.ok(timeline.chartData[0].isSyntheticBoundary);
  assert.ok(timeline.chartData.at(-1).isSyntheticBoundary);
  assert.ok(timeline.chartData.filter((row) => row.isSyntheticBoundary).every((row) => row.excludedFromAnalysis));
  assert.equal(timeline.chartData[0].eng, null, "missing metrics are not invented");
  assert.equal(result.metricData.length, 1);
  assert.equal(result.metricData[0].attention, 0.4);
  assert.deepEqual(timeline.changes.map((marker) => [marker.displayLabel, marker.time]),
    [["Slide 1", 10], ["Slide 2", 20], ["Slide 3", 30], ["END", 40]]);
  assert.deepEqual(timeline.excludedRanges.at(-1), {start: 30, end: 40});
});

test("samples already at the endpoints are not duplicated", () => {
  const result = processSessionData([{time: 0, foc: 0.1}, {time: 40, foc: 0.2}], [], [], markers);
  assert.deepEqual(result.performanceTimeline.chartData, result.performanceTimeline.data);
  assert.ok(result.performanceTimeline.chartData.every((row) => !row.isSyntheticBoundary));
});

test("no Performance samples means no invented endpoint values", () => {
  const result = processSessionData([], [{time: 0}], [], markers);
  assert.deepEqual(result.performanceTimeline.chartData, []);
  assert.equal(result.performanceTimeline.changes.at(-1).time, 40);
});
