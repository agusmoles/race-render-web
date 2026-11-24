import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { parseTelemetryCSV, type TelemetryRow } from "./csv-helper";
import { drawCanvasHUD, type TrackMapProps } from "./hud-draw";
import {
  analyzeSessionLaps,
  areTracksCompatible,
  buildReferenceLapTarget,
  evaluateGhostPosition,
  evaluateReferenceAtProgress,
  extractRacerDisplayName,
  formatDeltaHudLabel,
  formatLapTime,
  PRIMARY_REFERENCE_ACCENT,
  PRIMARY_SESSION_ID,
  sanitizeDisplayLabel,
  shouldCompareCurrentLap,
} from "./telemetry-compare";

interface LapSpec {
  lap: number;
  samples: number;
  speed: number;
  dt?: number;
  latOffset?: number;
  lonOffset?: number;
}

function makeRows(lapSpecs: LapSpec[]): TelemetryRow[] {
  const rows: TelemetryRow[] = [];
  let t = 0;
  let dist = 0;

  for (const spec of lapSpecs) {
    const dt = spec.dt ?? 0.5;
    const latOffset = spec.latOffset ?? 0;
    const lonOffset = spec.lonOffset ?? 0;
    for (let s = 0; s < spec.samples; s++) {
      rows.push({
        time: parseFloat(t.toFixed(4)),
        speed: spec.speed,
        rpm: 8000,
        latAcc: 0.4,
        lonAcc: 0.15,
        gyro: 0,
        lat: -34.69 + s * 0.0001 + latOffset,
        lon: -58.46 + s * 0.0001 + lonOffset,
        lap: spec.lap,
        distance: parseFloat(dist.toFixed(4)),
        segmentTime: s * dt,
      });
      t += dt;
      dist += spec.speed * dt;
    }
  }
  return rows;
}

interface CanvasRecording {
  texts: string[];
  filledArcs: { x: number; y: number; r: number; fillStyle: string }[];
}

function createMockCanvasContext(): {
  ctx: CanvasRenderingContext2D;
  recording: CanvasRecording;
} {
  const recording: CanvasRecording = { texts: [], filledArcs: [] };
  let lastArc: { x: number; y: number; r: number } | null = null;
  let currentFillStyle = "#000000";

  const mock = {
    get fillStyle() {
      return currentFillStyle;
    },
    set fillStyle(val: string) {
      currentFillStyle = val;
    },
    strokeStyle: "#000000",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    shadowColor: "transparent",
    shadowBlur: 0,
    font: "10px sans-serif",
    textAlign: "left",
    textBaseline: "alphabetic",
    globalAlpha: 1,
    save() {},
    restore() {},
    beginPath() {
      lastArc = null;
    },
    closePath() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    clip() {},
    translate() {},
    scale() {},
    setLineDash() {},
    stroke() {},
    fillRect() {},
    arc(x: number, y: number, r: number) {
      lastArc = { x, y, r };
    },
    fill() {
      if (lastArc) {
        recording.filledArcs.push({
          ...lastArc,
          fillStyle: currentFillStyle,
        });
      }
    },
    fillText(text: string) {
      recording.texts.push(String(text));
    },
    measureText(text: string) {
      return { width: String(text).length * 6 };
    },
  };

  return {
    ctx: mock as unknown as CanvasRenderingContext2D,
    recording,
  };
}

describe("formatLapTime", () => {
  it("formats zero, invalid, normal, and minute-rollover lap times", () => {
    assert.equal(formatLapTime(0), "0:00.00");
    assert.equal(formatLapTime(-3.5), "0:00.00");
    assert.equal(formatLapTime(Number.NaN), "0:00.00");
    assert.equal(formatLapTime(50.144), "0:50.14");
    assert.equal(formatLapTime(125.25), "2:05.25");
  });
});

describe("sanitizeDisplayLabel & extractRacerDisplayName", () => {
  it("strips control characters, collapses whitespace, and caps length", () => {
    assert.equal(
      sanitizeDisplayLabel("  Evil\u0000\u001fRacer\n\tName\u007f  ", 10),
      "Evil Racer",
    );
    assert.equal(sanitizeDisplayLabel("", 20), "");
  });

  it("prefers Racer metadata, then Driver, then stripped CSV filename", () => {
    assert.equal(
      extractRacerDisplayName({ Racer: "Agustin Moles", Driver: "Other" }, "f.csv"),
      "Agustin Moles",
    );
    assert.equal(
      extractRacerDisplayName({ Driver: "  Franco\tColapinto " }, "f.csv"),
      "Franco Colapinto",
    );
    assert.equal(
      extractRacerDisplayName({}, "kart_session_12.CSV"),
      "kart_session_12",
    );
    assert.equal(extractRacerDisplayName({}, ".csv"), "Racer");
  });
});

describe("analyzeSessionLaps", () => {
  it("parses real AiM RS3 export metadata and laps", () => {
    const csvPath = path.resolve(process.cwd(), "docs/example-rs3-export.csv");
    const csvText = fs.readFileSync(csvPath, "utf8");
    const parsed = parseTelemetryCSV(csvText);
    const analysis = analyzeSessionLaps(parsed.rows);

    assert.equal(
      extractRacerDisplayName(parsed.metadata, "example-rs3-export.csv"),
      "Agustin Moles",
    );
    assert.ok(analysis.lapNumbers.length >= 1);
  });

  it("excludes final incomplete in-lap from best lap in multi-lap sessions", () => {
    const rows = makeRows([
      { lap: 0, samples: 12, speed: 50 },
      { lap: 1, samples: 40, speed: 75 },
      { lap: 2, samples: 30, speed: 100 },
      { lap: 3, samples: 36, speed: 83.3333 },
      { lap: 4, samples: 16, speed: 60 },
    ]);

    const analysis = analyzeSessionLaps(rows);
    assert.deepEqual(analysis.lapNumbers, [0, 1, 2, 3, 4]);
    assert.equal(analysis.bestLap.lap, 2);
    assert.equal(analysis.bestLap.time, 15);
    assert.deepEqual(analysis.selectableLaps, [1, 2, 3, 4]);
    assert.equal(analysis.laps[1], 20);
    assert.equal(analysis.laps[3], 18);
  });

  it("treats single-lap hotlap CSV as both best and selectable", () => {
    const rows = makeRows([{ lap: 1, samples: 24, speed: 90 }]);
    const analysis = analyzeSessionLaps(rows);

    assert.equal(analysis.bestLap.lap, 1);
    assert.ok(analysis.bestLap.time > 5);
    assert.deepEqual(analysis.selectableLaps, [1]);
  });

  it("falls back to laps > 0s when all laps are shorter than 5s", () => {
    const rows = makeRows([
      { lap: 1, samples: 6, speed: 50, dt: 0.5 },
      { lap: 2, samples: 5, speed: 60, dt: 0.5 },
    ]);
    const analysis = analyzeSessionLaps(rows);

    assert.equal(analysis.bestLap.lap, 0);
    assert.deepEqual(analysis.selectableLaps, [1, 2]);
  });
});

describe("buildReferenceLapTarget & formatDeltaHudLabel", () => {
  const rows = makeRows([
    { lap: 1, samples: 40, speed: 75 },
    { lap: 2, samples: 30, speed: 100 },
    { lap: 3, samples: 36, speed: 80 },
  ]);
  const analysis = analyzeSessionLaps(rows);

  it("builds primary best and primary non-best targets with distinct HUD labels", () => {
    const bestTarget = buildReferenceLapTarget({
      sourceId: PRIMARY_SESSION_ID,
      isPrimarySession: true,
      racerName: "You",
      accentColor: PRIMARY_REFERENCE_ACCENT,
      rows,
      analysis,
      requestedLapNum: null,
      trackCompatible: true,
    });
    assert.ok(bestTarget);
    assert.equal(bestTarget.lapNum, 2);
    assert.equal(bestTarget.isBestOfSource, true);
    assert.equal(bestTarget.hudLabel, "LAP DELTA VS BEST (L2)");

    const nonBestTarget = buildReferenceLapTarget({
      sourceId: PRIMARY_SESSION_ID,
      isPrimarySession: true,
      racerName: "You",
      accentColor: PRIMARY_REFERENCE_ACCENT,
      rows,
      analysis,
      requestedLapNum: 1,
      trackCompatible: true,
    });
    assert.ok(nonBestTarget);
    assert.equal(nonBestTarget.lapNum, 1);
    assert.equal(nonBestTarget.isBestOfSource, false);
    assert.equal(nonBestTarget.hudLabel, "LAP DELTA VS L1 (0:20.00)");
  });

  it("builds external racer target and truncates long racer names in HUD label", () => {
    const rivalTarget = buildReferenceLapTarget({
      sourceId: "cmp_0",
      isPrimarySession: false,
      racerName: "Max Verstappen Racing",
      accentColor: "#f59e0b",
      rows,
      analysis,
      requestedLapNum: 1,
      trackCompatible: true,
    });
    assert.ok(rivalTarget);
    assert.equal(rivalTarget.hudLabel, "VS MAX VERSTAPPEN · L1 (0:20.00)");

    const emptyLabel = formatDeltaHudLabel({
      isPrimarySession: true,
      isBestOfSource: true,
      racerName: "You",
      lapNum: 0,
      lapTime: 0,
    });
    assert.equal(emptyLabel, "LAP DELTA VS BEST");
  });

  it("returns null for empty rows or invalid requested lap without fallback", () => {
    const emptyAnalysis = analyzeSessionLaps([]);
    const target = buildReferenceLapTarget({
      sourceId: PRIMARY_SESSION_ID,
      isPrimarySession: true,
      racerName: "You",
      accentColor: PRIMARY_REFERENCE_ACCENT,
      rows: [],
      analysis: emptyAnalysis,
      requestedLapNum: null,
      trackCompatible: false,
    });
    assert.equal(target, null);
  });
});

describe("evaluateReferenceAtProgress & shouldCompareCurrentLap", () => {
  const primaryRows = makeRows([
    { lap: 0, samples: 12, speed: 50 },
    { lap: 1, samples: 40, speed: 75 },
    { lap: 2, samples: 30, speed: 100 },
    { lap: 3, samples: 36, speed: 83.3333 },
    { lap: 4, samples: 20, speed: 60 },
  ]);
  const primaryAnalysis = analyzeSessionLaps(primaryRows);

  const rivalRows = makeRows([
    { lap: 1, samples: 32, speed: 95 },
    { lap: 2, samples: 26, speed: 115 },
  ]);
  const rivalAnalysis = analyzeSessionLaps(rivalRows);

  it("returns inactive on primary self-lap, out-lap, and final in-lap", () => {
    const bestTarget = buildReferenceLapTarget({
      sourceId: PRIMARY_SESSION_ID,
      isPrimarySession: true,
      racerName: "You",
      accentColor: PRIMARY_REFERENCE_ACCENT,
      rows: primaryRows,
      analysis: primaryAnalysis,
      requestedLapNum: 2,
      trackCompatible: true,
    });

    assert.equal(
      shouldCompareCurrentLap(2, primaryAnalysis.lapNumbers, bestTarget),
      false,
    );
    assert.equal(
      shouldCompareCurrentLap(0, primaryAnalysis.lapNumbers, bestTarget),
      false,
    );
    assert.equal(
      shouldCompareCurrentLap(4, primaryAnalysis.lapNumbers, bestTarget),
      false,
    );

    const selfMetric = evaluateReferenceAtProgress(
      bestTarget,
      2,
      primaryAnalysis.lapNumbers,
      7.5,
      primaryAnalysis.lapDistances[2] * 0.5,
      primaryAnalysis.lapDistances[2],
    );
    assert.deepEqual(selfMetric, { active: false, delta: 0, refSpeed: null });
  });

  it("computes accurate signed delta and refSpeed against non-best primary lap", () => {
    const lap1Target = buildReferenceLapTarget({
      sourceId: PRIMARY_SESSION_ID,
      isPrimarySession: true,
      racerName: "You",
      accentColor: PRIMARY_REFERENCE_ACCENT,
      rows: primaryRows,
      analysis: primaryAnalysis,
      requestedLapNum: 1,
      trackCompatible: true,
    });

    const metric = evaluateReferenceAtProgress(
      lap1Target,
      3,
      primaryAnalysis.lapNumbers,
      9.0,
      primaryAnalysis.lapDistances[3] * 0.5,
      primaryAnalysis.lapDistances[3],
    );
    assert.equal(metric.active, true);
    assert.ok(Math.abs(metric.delta - -1.0) < 0.05);
    assert.ok(Math.abs((metric.refSpeed ?? 0) - 75) < 1e-6);
  });

  it("compares across racers even when both are on the same lap number", () => {
    const rivalLap2 = buildReferenceLapTarget({
      sourceId: "cmp_0",
      isPrimarySession: false,
      racerName: "Rival",
      accentColor: "#f59e0b",
      rows: rivalRows,
      analysis: rivalAnalysis,
      requestedLapNum: 2,
      trackCompatible: true,
    });

    assert.equal(
      shouldCompareCurrentLap(2, primaryAnalysis.lapNumbers, rivalLap2),
      true,
    );

    const metric = evaluateReferenceAtProgress(
      rivalLap2,
      2,
      primaryAnalysis.lapNumbers,
      7.5,
      primaryAnalysis.lapDistances[2] * 0.5,
      primaryAnalysis.lapDistances[2],
    );
    assert.equal(metric.active, true);
    assert.ok(metric.delta > 0);
    assert.ok(Math.abs((metric.refSpeed ?? 0) - 115) < 1e-6);
  });

  it("normalizes distance across speed unit differences (km/h vs mph)", () => {
    const mphRivalRows = makeRows([{ lap: 1, samples: 21, speed: 62.1371 }]);
    const mphAnalysis = analyzeSessionLaps(mphRivalRows);
    const mphTarget = buildReferenceLapTarget({
      sourceId: "cmp_mph",
      isPrimarySession: false,
      racerName: "USA Driver",
      accentColor: "#a78bfa",
      rows: mphRivalRows,
      analysis: mphAnalysis,
      requestedLapNum: 1,
      trackCompatible: true,
    });

    const metric = evaluateReferenceAtProgress(
      mphTarget,
      2,
      primaryAnalysis.lapNumbers,
      6.0,
      primaryAnalysis.lapDistances[2] * 0.5,
      primaryAnalysis.lapDistances[2],
    );
    assert.equal(metric.active, true);
    assert.ok(Math.abs(metric.delta - 1.0) < 0.05);
  });

  it("supports single-lap primary vs single-lap comparison session", () => {
    const singlePrimary = makeRows([{ lap: 1, samples: 20, speed: 100 }]);
    const singleRival = makeRows([{ lap: 1, samples: 16, speed: 120 }]);
    const singlePAnalysis = analyzeSessionLaps(singlePrimary);
    const singleRAnalysis = analyzeSessionLaps(singleRival);

    const rivalTarget = buildReferenceLapTarget({
      sourceId: "cmp_single",
      isPrimarySession: false,
      racerName: "Hotlapper",
      accentColor: "#38bdf8",
      rows: singleRival,
      analysis: singleRAnalysis,
      requestedLapNum: null,
      trackCompatible: true,
    });

    const metric = evaluateReferenceAtProgress(
      rivalTarget,
      1,
      singlePAnalysis.lapNumbers,
      5.0,
      singlePAnalysis.lapDistances[1] * 0.5,
      singlePAnalysis.lapDistances[1],
    );
    assert.equal(metric.active, true);
    assert.ok(metric.delta > 0);
  });
});

describe("areTracksCompatible & evaluateGhostPosition", () => {
  const baseRows = makeRows([
    { lap: 1, samples: 20, speed: 80 },
    { lap: 2, samples: 20, speed: 90 },
  ]);
  const baseAnalysis = analyzeSessionLaps(baseRows);

  it("detects compatible and incompatible GPS tracks", () => {
    const nearbyRows = makeRows([
      { lap: 1, samples: 20, speed: 85, latOffset: 0.0005, lonOffset: -0.0005 },
    ]);
    const distantRows = makeRows([
      { lap: 1, samples: 20, speed: 85, latOffset: 2.0, lonOffset: 2.0 },
    ]);
    const tooFewRows = makeRows([{ lap: 1, samples: 3, speed: 85 }]);

    assert.equal(areTracksCompatible(baseRows, nearbyRows), true);
    assert.equal(areTracksCompatible(baseRows, distantRows), false);
    assert.equal(areTracksCompatible(baseRows, tooFewRows), false);
  });

  it("interpolates ghost coordinates and suppresses when incompatible or self-lap", () => {
    const rivalTarget = buildReferenceLapTarget({
      sourceId: "cmp_ghost",
      isPrimarySession: false,
      racerName: "Ghost",
      accentColor: "#f59e0b",
      rows: baseRows,
      analysis: baseAnalysis,
      requestedLapNum: 2,
      trackCompatible: true,
    });

    const ghostMid = evaluateGhostPosition(
      rivalTarget,
      1,
      baseAnalysis.lapNumbers,
      2.25,
    );
    assert.ok(ghostMid);
    assert.ok(ghostMid.lat > -34.69 && ghostMid.lon > -58.46);

    const incompatible = rivalTarget
      ? { ...rivalTarget, trackCompatible: false }
      : null;
    assert.equal(
      evaluateGhostPosition(incompatible, 1, baseAnalysis.lapNumbers, 2.25),
      null,
    );

    const primarySelf = buildReferenceLapTarget({
      sourceId: PRIMARY_SESSION_ID,
      isPrimarySession: true,
      racerName: "You",
      accentColor: PRIMARY_REFERENCE_ACCENT,
      rows: baseRows,
      analysis: baseAnalysis,
      requestedLapNum: 2,
      trackCompatible: true,
    });
    assert.equal(
      evaluateGhostPosition(primarySelf, 2, baseAnalysis.lapNumbers, 2.25),
      null,
    );
  });
});

describe("drawCanvasHUD export parity", () => {
  const rows = makeRows([
    { lap: 1, samples: 20, speed: 75 },
    { lap: 2, samples: 16, speed: 100 },
  ]);
  const analysis = analyzeSessionLaps(rows);
  const rivalTarget = buildReferenceLapTarget({
    sourceId: "cmp_hud",
    isPrimarySession: false,
    racerName: "Senna",
    accentColor: "#f59e0b",
    rows,
    analysis,
    requestedLapNum: 2,
    trackCompatible: true,
  });

  const baseTrackMapProps: TrackMapProps = {
    cachedPath2D: null,
    trackScale: 10000,
    trackMinLon: -58.46,
    trackMaxLat: -34.688,
    trackHasGPS: true,
    tSvgW: 200,
    tSvgH: 200,
    tPadding: 20,
    trackLonSpan: 0.002,
    trackLatSpan: 0.002,
    firstValidPoint: { lat: -34.69, lon: -58.46 },
    telemetryTime: analysis.starts[1] + 5.0,
    lapTimesStarts: analysis.starts,
    lapTimesLaps: analysis.laps,
    lapTimesStartDistances: analysis.startDistances,
    lapTimesDistances: analysis.lapDistances,
    formatLapTime,
    bestLapTimeStr: "0:08.00",
    bestLapNum: 2,
    bestLapRows: rows.filter((r) => r.lap === 2),
    telemetryLaps: analysis.lapNumbers,
    referenceLap: rivalTarget,
    showGhostOnMap: true,
  };

  const layout = {
    trackMap: { x: 70, y: 2, w: 28, h: 38, visible: true },
    deltaBar: { x: 35, y: 3, w: 30, h: 8, visible: true },
  };

  it("renders custom reference label, signed delta, and ghost dot when enabled", () => {
    const { ctx, recording } = createMockCanvasContext();
    const curRow = rows[10];
    drawCanvasHUD(ctx, 1280, 720, curRow, [], baseTrackMapProps, layout);

    assert.ok(recording.texts.includes(rivalTarget!.hudLabel));
    assert.ok(recording.texts.some((t) => /^\+\d+\.\d{2}$/.test(t)));

    const ghostCircle = recording.filledArcs.find(
      (a) => a.r === 4.5 && a.fillStyle === "#f59e0b",
    );
    assert.ok(ghostCircle, "expected ghost circle to be drawn on canvas");
  });

  it("omits ghost dot when showGhostOnMap is false", () => {
    const { ctx, recording } = createMockCanvasContext();
    const curRow = rows[10];
    drawCanvasHUD(
      ctx,
      1280,
      720,
      curRow,
      [],
      { ...baseTrackMapProps, showGhostOnMap: false },
      layout,
    );

    const ghostCircle = recording.filledArcs.find(
      (a) => a.r === 4.5 && a.fillStyle === "#f59e0b",
    );
    assert.equal(ghostCircle, undefined);
  });
});
