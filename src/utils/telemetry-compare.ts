import type { ParsedTelemetry, TelemetryRow } from "./csv-helper";

export interface TelemetryPoint {
  time: number;
  speed: number;
  rpm: number;
  latAcc: number;
  lonAcc: number;
  lat: number;
  lon: number;
  lap: number;
  distance: number;
}

export interface GPSPoint {
  lat: number;
  lon: number;
}

export const PRIMARY_SESSION_ID = "primary";
export const MAX_COMPARISON_SESSIONS = 10;
export const MAX_CSV_BYTES = 50 * 1024 * 1024;
export const PRIMARY_REFERENCE_ACCENT = "#10b981";
export const COMPARISON_ACCENT_COLORS = [
  "#f59e0b",
  "#a78bfa",
  "#10b981",
  "#38bdf8",
  "#f472b6",
] as const;

export interface SessionLapAnalysis {
  laps: Record<number, number>;
  starts: Record<number, number>;
  ends: Record<number, number>;
  startDistances: Record<number, number>;
  lapDistances: Record<number, number>;
  lapNumbers: number[];
  selectableLaps: number[];
  bestLap: { lap: number; time: number };
}

export interface ComparisonSession {
  id: string;
  fileName: string;
  racerName: string;
  sessionName: string;
  vehicle: string;
  color: string;
  telemetry: ParsedTelemetry;
  analysis: SessionLapAnalysis;
  selectedLapNum: number | null;
  trackCompatible: boolean;
}

export interface ComparisonSelection {
  sourceId: string;
  lapNum: number | null;
}

export interface ReferenceLapTarget {
  sourceId: string;
  isPrimarySession: boolean;
  isBestOfSource: boolean;
  racerName: string;
  lapNum: number;
  lapTime: number;
  startTime: number;
  startDistance: number;
  totalDistance: number;
  hudLabel: string;
  accentColor: string;
  trackCompatible: boolean;
  rows: TelemetryPoint[];
}

export interface LiveComparisonMetric {
  active: boolean;
  delta: number;
  refSpeed: number | null;
}

export function formatLapTime(secs: number): string {
  if (isNaN(secs) || secs <= 0) return "0:00.00";
  const mins = Math.floor(secs / 60);
  const remainingSecs = Math.floor(secs % 60);
  const centiseconds = Math.floor((secs % 1) * 100);
  return `${mins}:${remainingSecs.toString().padStart(2, "0")}.${centiseconds.toString().padStart(2, "0")}`;
}

export function sanitizeDisplayLabel(raw: string, maxLen = 40): string {
  if (!raw) return "";
  return raw
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

export function extractRacerDisplayName(
  metadata: Record<string, string>,
  fileName: string,
): string {
  const fromMeta = sanitizeDisplayLabel(
    metadata["Racer"] || metadata["Driver"] || "",
    40,
  );
  if (fromMeta) return fromMeta;
  const baseName = fileName.replace(/\.csv$/i, "");
  const fromFile = sanitizeDisplayLabel(baseName, 40);
  return fromFile || "Racer";
}

export function analyzeSessionLaps(rows: TelemetryRow[]): SessionLapAnalysis {
  const laps: Record<number, number> = {};
  const starts: Record<number, number> = {};
  const ends: Record<number, number> = {};
  const startDistances: Record<number, number> = {};
  const lapDistances: Record<number, number> = {};
  const maxDistances: Record<number, number> = {};
  const allLapSet = new Set<number>();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.lap === undefined || !Number.isFinite(r.lap)) continue;
    if (r.lap >= 0) {
      allLapSet.add(r.lap);
    }
    if (r.lap < 1) continue;

    const dist = r.distance || 0;
    if (starts[r.lap] === undefined || r.time < starts[r.lap]) {
      starts[r.lap] = r.time;
      startDistances[r.lap] = dist;
    }
    if (ends[r.lap] === undefined || r.time > ends[r.lap]) {
      ends[r.lap] = r.time;
    }
    if (maxDistances[r.lap] === undefined || dist > maxDistances[r.lap]) {
      maxDistances[r.lap] = dist;
    }
  }

  const lapNumbers = Array.from(allLapSet).sort((a, b) => a - b);
  const lapKeys = Object.keys(starts)
    .map(Number)
    .sort((a, b) => a - b);

  for (let idx = 0; idx < lapKeys.length; idx++) {
    const k = lapKeys[idx];
    if (idx < lapKeys.length - 1) {
      const nextK = lapKeys[idx + 1];
      laps[k] = starts[nextK] - starts[k];
      lapDistances[k] = startDistances[nextK] - startDistances[k];
    } else {
      laps[k] = ends[k] - starts[k];
      lapDistances[k] = (maxDistances[k] ?? startDistances[k]) - startDistances[k];
    }
  }

  let bestLapNum = 0;
  let bestTime = Infinity;
  const lastLapKey = lapKeys[lapKeys.length - 1];

  for (let idx = 0; idx < lapKeys.length; idx++) {
    const lapNum = lapKeys[idx];
    if (lapKeys.length > 1 && lapNum === lastLapKey) continue;
    const duration = laps[lapNum];
    if (duration > 5 && duration < bestTime) {
      bestTime = duration;
      bestLapNum = lapNum;
    }
  }

  const selectableLong = lapKeys.filter((k) => laps[k] > 5);
  const selectableLaps =
    selectableLong.length > 0
      ? selectableLong
      : lapKeys.filter((k) => laps[k] > 0);

  return {
    laps,
    starts,
    ends,
    startDistances,
    lapDistances,
    lapNumbers,
    selectableLaps,
    bestLap:
      bestTime === Infinity
        ? { lap: 0, time: 0 }
        : { lap: bestLapNum, time: bestTime },
  };
}

export function areTracksCompatible(
  primaryPoints: GPSPoint[],
  refRows: Pick<TelemetryPoint, "lat" | "lon">[],
): boolean {
  let pMinLat = Infinity;
  let pMaxLat = -Infinity;
  let pMinLon = Infinity;
  let pMaxLon = -Infinity;
  let pCount = 0;

  for (let i = 0; i < primaryPoints.length; i++) {
    const p = primaryPoints[i];
    if (p.lat === 0 || p.lon === 0) continue;
    if (p.lat < pMinLat) pMinLat = p.lat;
    if (p.lat > pMaxLat) pMaxLat = p.lat;
    if (p.lon < pMinLon) pMinLon = p.lon;
    if (p.lon > pMaxLon) pMaxLon = p.lon;
    pCount++;
  }

  let rMinLat = Infinity;
  let rMaxLat = -Infinity;
  let rMinLon = Infinity;
  let rMaxLon = -Infinity;
  let rCount = 0;

  for (let i = 0; i < refRows.length; i++) {
    const r = refRows[i];
    if (r.lat === 0 || r.lon === 0) continue;
    if (r.lat < rMinLat) rMinLat = r.lat;
    if (r.lat > rMaxLat) rMaxLat = r.lat;
    if (r.lon < rMinLon) rMinLon = r.lon;
    if (r.lon > rMaxLon) rMaxLon = r.lon;
    rCount++;
  }

  if (pCount < 5 || rCount < 5) return false;

  const pLat = (pMinLat + pMaxLat) / 2;
  const pLon = (pMinLon + pMaxLon) / 2;
  const rLat = (rMinLat + rMaxLat) / 2;
  const rLon = (rMinLon + rMaxLon) / 2;
  const span = Math.max(pMaxLat - pMinLat, pMaxLon - pMinLon, 0.002);
  const threshold = Math.max(span * 1.5, 0.02);

  return (
    Math.abs(pLat - rLat) <= threshold && Math.abs(pLon - rLon) <= threshold
  );
}

export function formatDeltaHudLabel(
  target: Pick<
    ReferenceLapTarget,
    "isPrimarySession" | "isBestOfSource" | "racerName" | "lapNum" | "lapTime"
  >,
): string {
  if (target.isPrimarySession) {
    if (target.isBestOfSource) {
      return target.lapNum > 0
        ? `LAP DELTA VS BEST (L${target.lapNum})`
        : "LAP DELTA VS BEST";
    }
    return `LAP DELTA VS L${target.lapNum} (${formatLapTime(target.lapTime)})`;
  }

  const shortName =
    sanitizeDisplayLabel(target.racerName, 14).toUpperCase() || "RACER";
  const lapTag = target.isBestOfSource
    ? `BEST L${target.lapNum}`
    : `L${target.lapNum}`;
  return `VS ${shortName} · ${lapTag} (${formatLapTime(target.lapTime)})`;
}

export function buildReferenceLapTarget(params: {
  sourceId: string;
  isPrimarySession: boolean;
  racerName: string;
  accentColor: string;
  rows: TelemetryRow[];
  analysis: SessionLapAnalysis;
  requestedLapNum: number | null;
  trackCompatible: boolean;
}): ReferenceLapTarget | null {
  const {
    sourceId,
    isPrimarySession,
    racerName,
    accentColor,
    rows,
    analysis,
    requestedLapNum,
    trackCompatible,
  } = params;

  const lapNum =
    requestedLapNum !== null && (analysis.laps[requestedLapNum] ?? 0) > 0
      ? requestedLapNum
      : analysis.bestLap.lap || analysis.selectableLaps[0] || 0;

  if (lapNum <= 0) return null;

  const lapRows: TelemetryPoint[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.lap !== lapNum) continue;
    lapRows.push({
      time: r.time,
      speed: r.speed,
      rpm: r.rpm,
      latAcc: r.latAcc,
      lonAcc: r.lonAcc,
      lat: r.lat,
      lon: r.lon,
      lap: r.lap,
      distance: r.distance,
    });
  }

  if (lapRows.length === 0) return null;

  const lapTime = analysis.laps[lapNum] ?? 0;
  const startTime = analysis.starts[lapNum] ?? lapRows[0].time;
  const startDistance =
    analysis.startDistances[lapNum] ?? lapRows[0].distance ?? 0;
  const totalDistance = analysis.lapDistances[lapNum] ?? 0;
  const isBestOfSource =
    analysis.bestLap.lap > 0 && lapNum === analysis.bestLap.lap;

  const hudLabel = formatDeltaHudLabel({
    isPrimarySession,
    isBestOfSource,
    racerName,
    lapNum,
    lapTime,
  });

  return {
    sourceId,
    isPrimarySession,
    isBestOfSource,
    racerName,
    lapNum,
    lapTime,
    startTime,
    startDistance,
    totalDistance,
    hudLabel,
    accentColor,
    trackCompatible,
    rows: lapRows,
  };
}

export function shouldCompareCurrentLap(
  currentLap: number,
  telemetryLaps: number[],
  refTarget: Pick<
    ReferenceLapTarget,
    "isPrimarySession" | "lapNum" | "rows"
  > | null,
): boolean {
  if (!refTarget || refTarget.lapNum <= 0 || refTarget.rows.length === 0) {
    return false;
  }
  if (refTarget.isPrimarySession && currentLap === refTarget.lapNum) {
    return false;
  }
  if (currentLap <= 0) {
    return false;
  }
  if (
    telemetryLaps.length >= 3 &&
    (currentLap === telemetryLaps[0] ||
      currentLap === telemetryLaps[telemetryLaps.length - 1])
  ) {
    return false;
  }
  return true;
}

export function evaluateReferenceAtProgress(
  refTarget: ReferenceLapTarget | null,
  currentLap: number,
  telemetryLaps: number[],
  currentLapElapsed: number,
  elapsedDist: number,
  currentLapTotalDist: number,
): LiveComparisonMetric {
  if (!refTarget || !shouldCompareCurrentLap(currentLap, telemetryLaps, refTarget)) {
    return { active: false, delta: 0, refSpeed: null };
  }

  const rows = refTarget.rows;
  let scaledDist = Math.max(0, elapsedDist);
  if (refTarget.totalDistance > 0 && currentLapTotalDist > 0) {
    scaledDist = Math.max(
      0,
      Math.min(
        refTarget.totalDistance,
        elapsedDist * (refTarget.totalDistance / currentLapTotalDist),
      ),
    );
  }

  let low = 0;
  let high = rows.length - 1;
  let matchIdx = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const midDist = rows[mid].distance - refTarget.startDistance;
    if (midDist === scaledDist) {
      matchIdx = mid;
      break;
    } else if (midDist < scaledDist) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  let refTime = 0;
  let refSpeed = 0;

  if (matchIdx !== -1) {
    refTime = rows[matchIdx].time - refTarget.startTime;
    refSpeed = rows[matchIdx].speed;
  } else {
    const idxB = Math.min(low, rows.length - 1);
    const idxA = Math.max(0, idxB - 1);
    const rowA = rows[idxA];
    const rowB = rows[idxB];

    const distA = rowA.distance - refTarget.startDistance;
    const distB = rowB.distance - refTarget.startDistance;

    let fraction = 0;
    if (distB !== distA) {
      fraction = Math.max(
        0,
        Math.min(1, (scaledDist - distA) / (distB - distA)),
      );
    }

    const timeA = rowA.time - refTarget.startTime;
    const timeB = rowB.time - refTarget.startTime;
    refTime = timeA + fraction * (timeB - timeA);
    refSpeed = rowA.speed + fraction * (rowB.speed - rowA.speed);
  }

  return {
    active: true,
    delta: currentLapElapsed - refTime,
    refSpeed,
  };
}

export function evaluateGhostPosition(
  refTarget: ReferenceLapTarget | null,
  currentLap: number,
  telemetryLaps: number[],
  currentLapElapsed: number,
): GPSPoint | null {
  if (
    !refTarget ||
    !refTarget.trackCompatible ||
    !shouldCompareCurrentLap(currentLap, telemetryLaps, refTarget)
  ) {
    return null;
  }

  const rows = refTarget.rows;
  const clampedElapsed = Math.max(
    0,
    Math.min(refTarget.lapTime > 0 ? refTarget.lapTime : currentLapElapsed, currentLapElapsed),
  );
  const targetTime = refTarget.startTime + clampedElapsed;

  let low = 0;
  let high = rows.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (rows[mid].time === targetTime) {
      const m = rows[mid];
      return m.lat !== 0 && m.lon !== 0 ? { lat: m.lat, lon: m.lon } : null;
    } else if (rows[mid].time < targetTime) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const idxB = Math.min(low, rows.length - 1);
  const idxA = Math.max(0, idxB - 1);
  const rowA = rows[idxA];
  const rowB = rows[idxB];

  const validA = rowA && rowA.lat !== 0 && rowA.lon !== 0;
  const validB = rowB && rowB.lat !== 0 && rowB.lon !== 0;

  if (validA && validB) {
    const frac =
      rowB.time !== rowA.time
        ? Math.max(0, Math.min(1, (targetTime - rowA.time) / (rowB.time - rowA.time)))
        : 0;
    return {
      lat: rowA.lat + frac * (rowB.lat - rowA.lat),
      lon: rowA.lon + frac * (rowB.lon - rowA.lon),
    };
  }
  if (validA) return { lat: rowA.lat, lon: rowA.lon };
  if (validB) return { lat: rowB.lat, lon: rowB.lon };
  return null;
}
