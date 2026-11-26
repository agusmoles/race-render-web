import type { ParsedTelemetry, TelemetryRow } from "./csv-helper";

export interface LapSummary {
  lapNumber: number;
  lapTime: number;
  startTime: number;
  endTime: number;
  maxSpeed: number;
  minSpeed: number;
  avgSpeed: number;
  maxRpm: number;
  pointCount: number;
  isOutOrInLap: boolean;
  isBest: boolean;
}

export interface TelemetrySessionItem {
  id: string;
  fileName: string;
  racerName: string;
  sessionName: string;
  vehicleName: string;
  telemetry: ParsedTelemetry;
  laps: LapSummary[];
  bestLapNumber: number;
}

export interface LapPoint3D {
  elapsedTime: number;
  distanceMeters: number;
  normDist: number;
  x: number;
  y: number;
  z: number;
  lat: number;
  lon: number;
  speed: number;
  rpm: number;
  latAcc: number;
  lonAcc: number;
  headingRad: number;
  slopeRad: number;
  steeringDeg: number;
}

export interface ProcessedLap3D {
  sessionId: string;
  fileName: string;
  racerName: string;
  sessionName: string;
  lapNumber: number;
  lapTime: number;
  totalDistanceMeters: number;
  maxSpeed: number;
  minSpeed: number;
  avgSpeed: number;
  maxRpm: number;
  hasGps: boolean;
  points: LapPoint3D[];
}

export interface ComparisonSnapshot {
  pointA: LapPoint3D;
  pointB: LapPoint3D;
  timeDelta: number;
  speedDelta: number;
  rpmDelta: number;
  latAccDelta: number;
  distanceGapMeters: number;
  lateralOffsetMeters: number;
}

export interface EnuOrigin {
  lat: number;
  lon: number;
  alt: number;
}

export interface TrackCenterlinePoint {
  x: number;
  y: number;
  z: number;
  rightX: number;
  rightZ: number;
  curvature: number;
  normDist: number;
}

export interface CustomTrackGpsPoint {
  lat: number;
  lon: number;
  alt?: number;
}

export interface ParsedTrackFile {
  name: string;
  points: CustomTrackGpsPoint[];
  sourceFormat: "ztracks" | "tkk" | "kml" | "gpx" | "geojson";
}

const EARTH_LAT_METERS = 110540;
const EARTH_LON_METERS = 111320;
const MIN_VALID_LAP_SEC = 5;

function getSpeedUnitMultiplier(telemetry: ParsedTelemetry): number {
  const mappedName = telemetry.channelMapping.speed || "";
  const idx = telemetry.headers.indexOf(mappedName);
  const unit = idx !== -1 ? (telemetry.units[idx] || "").toLowerCase() : "";
  if (unit.includes("mph")) return 1.60934;
  if (unit.includes("m/s")) return 3.6;
  return 1;
}

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function normalizeAngleRad(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function lerpAngleRad(a: number, b: number, t: number): number {
  const diff = normalizeAngleRad(b - a);
  return normalizeAngleRad(a + diff * t);
}

function extractLapRawRows(
  rows: TelemetryRow[],
  lapNumber: number,
): TelemetryRow[] {
  const sliced: TelemetryRow[] = [];
  let lastMatchedIdx = -1;

  for (let i = 0; i < rows.length; i++) {
    if (rows[i].lap === lapNumber) {
      sliced.push(rows[i]);
      lastMatchedIdx = i;
    }
  }

  if (
    sliced.length > 1 &&
    lastMatchedIdx !== -1 &&
    lastMatchedIdx + 1 < rows.length
  ) {
    const nextRow = rows[lastMatchedIdx + 1];
    const dt = nextRow.time - rows[lastMatchedIdx].time;
    if (dt > 0 && dt < 1.0) {
      sliced.push(nextRow);
    }
  }

  return sliced;
}

export function createSessionItem(
  fileName: string,
  telemetry: ParsedTelemetry,
  id?: string,
): TelemetrySessionItem {
  const speedMult = getSpeedUnitMultiplier(telemetry);
  const lapNumbersSet = new Set<number>();
  for (const r of telemetry.rows) {
    if (Number.isFinite(r.lap) && r.lap >= 0) {
      lapNumbersSet.add(r.lap);
    }
  }
  const lapNumbers = Array.from(lapNumbersSet).sort((a, b) => a - b);

  const rawSummaries: LapSummary[] = [];
  for (const lapNumber of lapNumbers) {
    const lapRows = extractLapRawRows(telemetry.rows, lapNumber);
    if (lapRows.length < 2) continue;

    const startTime = lapRows[0].time;
    const endTime = lapRows[lapRows.length - 1].time;
    const lapTime = Math.max(0, endTime - startTime);
    if (lapTime <= 0.1) continue;

    let maxSpeed = 0;
    let minSpeed = Infinity;
    let sumSpeed = 0;
    let maxRpm = 0;
    for (const r of lapRows) {
      const spd = (Number(r.speed) || 0) * speedMult;
      const rpm = Number(r.rpm) || 0;
      if (spd > maxSpeed) maxSpeed = spd;
      if (spd < minSpeed) minSpeed = spd;
      sumSpeed += spd;
      if (rpm > maxRpm) maxRpm = rpm;
    }

    rawSummaries.push({
      lapNumber,
      lapTime,
      startTime,
      endTime,
      maxSpeed,
      minSpeed: minSpeed === Infinity ? 0 : minSpeed,
      avgSpeed: sumSpeed / lapRows.length,
      maxRpm,
      pointCount: lapRows.length,
      isOutOrInLap: lapNumber === 0,
      isBest: false,
    });
  }

  const positiveLaps = rawSummaries.filter(
    (l) => l.lapNumber >= 1 && l.lapTime > MIN_VALID_LAP_SEC,
  );
  const medianLapTime = computeMedian(positiveLaps.map((l) => l.lapTime));

  if (positiveLaps.length >= 2) {
    const lastPositive = positiveLaps[positiveLaps.length - 1];
    if (lastPositive.lapTime < medianLapTime * 0.85) {
      lastPositive.isOutOrInLap = true;
    }
  }

  const candidateLaps = positiveLaps.filter((l) => !l.isOutOrInLap);
  const pool =
    candidateLaps.length > 0
      ? candidateLaps
      : positiveLaps.length > 0
        ? positiveLaps
        : rawSummaries;

  let bestLapNumber = pool[0]?.lapNumber ?? 0;
  let bestLapTime = Infinity;
  for (const l of pool) {
    if (l.lapTime < bestLapTime) {
      bestLapTime = l.lapTime;
      bestLapNumber = l.lapNumber;
    }
  }

  const laps = rawSummaries.map((l) => ({
    ...l,
    isBest: l.lapNumber === bestLapNumber,
  }));

  const racerName =
    telemetry.metadata["Racer"] ||
    telemetry.metadata["Driver"] ||
    fileName.replace(/\.csv$/i, "");
  const sessionName =
    telemetry.metadata["Session"] ||
    telemetry.metadata["Track"] ||
    "Telemetry Session";
  const vehicleName = telemetry.metadata["Vehicle"] || "";

  return {
    id: id || `${fileName}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    fileName,
    racerName,
    sessionName,
    vehicleName,
    telemetry,
    laps,
    bestLapNumber,
  };
}

function projectRowsToPoints(
  session: TelemetrySessionItem,
  lapNumber: number,
  origin: EnuOrigin | null,
): {
  points: LapPoint3D[];
  hasGps: boolean;
  maxSpeed: number;
  minSpeed: number;
  avgSpeed: number;
  maxRpm: number;
  lapTime: number;
  totalDistanceMeters: number;
} {
  const rawRows = extractLapRawRows(session.telemetry.rows, lapNumber);
  if (rawRows.length < 2) {
    return {
      points: [],
      hasGps: false,
      maxSpeed: 0,
      minSpeed: 0,
      avgSpeed: 0,
      maxRpm: 0,
      lapTime: 0,
      totalDistanceMeters: 0,
    };
  }

  const speedMult = getSpeedUnitMultiplier(session.telemetry);
  const validGpsCount = rawRows.filter(
    (r) => Number.isFinite(r.lat) && Number.isFinite(r.lon) && r.lat !== 0 && r.lon !== 0,
  ).length;
  const hasGps = validGpsCount >= Math.min(5, rawRows.length) && origin !== null;

  const startTime = rawRows[0].time;
  const cosLat = origin ? Math.cos((origin.lat * Math.PI) / 180) : 1;

  const xs: number[] = new Array(rawRows.length);
  const ys: number[] = new Array(rawRows.length).fill(0);
  const zs: number[] = new Array(rawRows.length);

  if (hasGps && origin) {
    for (let i = 0; i < rawRows.length; i++) {
      const r = rawRows[i];
      if (r.lat !== 0 && r.lon !== 0) {
        xs[i] = (r.lon - origin.lon) * EARTH_LON_METERS * cosLat;
        // Negative lat delta maps North to -Z and South to +Z, matching TrackMap SVG orientation
        zs[i] = -(r.lat - origin.lat) * EARTH_LAT_METERS;
      } else {
        xs[i] = i > 0 ? xs[i - 1] : 0;
        zs[i] = i > 0 ? zs[i - 1] : 0;
      }
    }
  } else {
    // ponytail: dead-reckon planar track when CSV omits GPS lat/lon
    let x = 0;
    let z = 0;
    let theta = 0;
    for (let i = 0; i < rawRows.length; i++) {
      const r = rawRows[i];
      const dt = i > 0 ? Math.max(0, r.time - rawRows[i - 1].time) : 0;
      const speedMps = ((Number(r.speed) || 0) * speedMult) / 3.6;
      const yawRateRad =
        r.gyro && Math.abs(r.gyro) > 0.01
          ? (r.gyro * Math.PI) / 180
          : speedMps > 2
            ? ((Number(r.latAcc) || 0) * 9.81) / speedMps
            : 0;
      theta += yawRateRad * dt;
      x += speedMps * Math.sin(theta) * dt;
      z += speedMps * Math.cos(theta) * dt;
      xs[i] = x;
      zs[i] = z;
      ys[i] = 0;
    }
  }

  let maxSpeed = 0;
  let minSpeed = Infinity;
  let sumSpeed = 0;
  let maxRpm = 0;
  let totalDist = 0;
  const dists: number[] = new Array(rawRows.length);
  dists[0] = 0;

  for (let i = 0; i < rawRows.length; i++) {
    const r = rawRows[i];
    const spd = (Number(r.speed) || 0) * speedMult;
    const rpm = Number(r.rpm) || 0;
    if (spd > maxSpeed) maxSpeed = spd;
    if (spd < minSpeed) minSpeed = spd;
    sumSpeed += spd;
    if (rpm > maxRpm) maxRpm = rpm;

    if (i > 0) {
      const stepDist = Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
      const dt = Math.max(0, r.time - rawRows[i - 1].time);
      totalDist += stepDist > 0.005 ? stepDist : (spd / 3.6) * dt;
      dists[i] = totalDist;
    }
  }

  const points: LapPoint3D[] = new Array(rawRows.length);
  let lastHeading = 0;

  for (let i = 0; i < rawRows.length; i++) {
    const r = rawRows[i];
    const iPrev = Math.max(0, i - 2);
    const iNext = Math.min(rawRows.length - 1, i + 2);
    const dx = xs[iNext] - xs[iPrev];
    const dz = zs[iNext] - zs[iPrev];
    let headingRad = lastHeading;
    if (dx * dx + dz * dz > 0.04) {
      headingRad = Math.atan2(dx, dz);
      lastHeading = headingRad;
    } else if (typeof r.heading === "number" && Number.isFinite(r.heading)) {
      headingRad = (r.heading * Math.PI) / 180;
      lastHeading = headingRad;
    }

    const slopeRad = 0;

    points[i] = {
      elapsedTime: Math.max(0, r.time - startTime),
      distanceMeters: dists[i],
      normDist: totalDist > 0 ? dists[i] / totalDist : i / (rawRows.length - 1),
      x: xs[i],
      y: ys[i],
      z: zs[i],
      lat: Number(r.lat) || 0,
      lon: Number(r.lon) || 0,
      speed: (Number(r.speed) || 0) * speedMult,
      rpm: Number(r.rpm) || 0,
      latAcc: Number(r.latAcc) || 0,
      lonAcc: Number(r.lonAcc) || 0,
      headingRad,
      slopeRad,
      steeringDeg: Number(r.steering) || 0,
    };
  }

  return {
    points,
    hasGps,
    maxSpeed,
    minSpeed: minSpeed === Infinity ? 0 : minSpeed,
    avgSpeed: sumSpeed / rawRows.length,
    maxRpm,
    lapTime: points[points.length - 1].elapsedTime,
    totalDistanceMeters: totalDist,
  };
}

function rotateClosedLapToStartGate(
  points: LapPoint3D[],
  targetX: number,
  targetZ: number,
): LapPoint3D[] {
  if (points.length < 10) return points;

  const first = points[0];
  const last = points[points.length - 1];
  const closureGap = Math.hypot(last.x - first.x, last.z - first.z);
  const startGap = Math.hypot(first.x - targetX, first.z - targetZ);
  if (closureGap > 25 || startGap <= 3) return points;

  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < points.length; i++) {
    const d = Math.hypot(points[i].x - targetX, points[i].z - targetZ);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }

  if (bestIdx <= 1 || bestIdx >= points.length - 2 || bestDist >= 20) {
    return points;
  }

  const totalLapTime = last.elapsedTime;
  const totalDist = last.distanceMeters;
  const shiftTime = points[bestIdx].elapsedTime;
  const shiftDist = points[bestIdx].distanceMeters;

  const body = points.slice(0, points.length - 1);
  const rotated = [...body.slice(bestIdx), ...body.slice(0, bestIdx)];

  const result = rotated.map((pt, idx) => {
    const wrappedTime =
      pt.elapsedTime >= shiftTime
        ? pt.elapsedTime - shiftTime
        : totalLapTime - shiftTime + pt.elapsedTime;
    const wrappedDist =
      pt.distanceMeters >= shiftDist
        ? pt.distanceMeters - shiftDist
        : totalDist - shiftDist + pt.distanceMeters;
    const normDist =
      totalDist > 0 ? Math.min(1, Math.max(0, wrappedDist / totalDist)) : idx / rotated.length;
    return {
      ...pt,
      elapsedTime: wrappedTime,
      distanceMeters: wrappedDist,
      normDist,
    };
  });

  result.push({
    ...result[0],
    elapsedTime: totalLapTime,
    distanceMeters: totalDist,
    normDist: 1,
  });

  return result;
}

function findOriginFromRows(rows: TelemetryRow[]): EnuOrigin | null {
  for (const r of rows) {
    if (
      Number.isFinite(r.lat) &&
      Number.isFinite(r.lon) &&
      r.lat !== 0 &&
      r.lon !== 0
    ) {
      return {
        lat: r.lat,
        lon: r.lon,
        alt: 0,
      };
    }
  }
  return null;
}

export function buildAlignedLapPair(
  sessionA: TelemetrySessionItem,
  lapNumA: number,
  sessionB: TelemetrySessionItem,
  lapNumB: number,
): {
  lapA: ProcessedLap3D | null;
  lapB: ProcessedLap3D | null;
  origin: EnuOrigin | null;
} {
  const rawA = extractLapRawRows(sessionA.telemetry.rows, lapNumA);
  const rawB = extractLapRawRows(sessionB.telemetry.rows, lapNumB);

  const origin =
    findOriginFromRows(rawA) ||
    findOriginFromRows(rawB);

  const dataA = projectRowsToPoints(sessionA, lapNumA, origin);
  const dataB = projectRowsToPoints(sessionB, lapNumB, origin);

  let pointsB = dataB.points;
  if (dataA.points.length > 0 && pointsB.length > 0) {
    if (sessionA.id !== sessionB.id && dataA.hasGps && dataB.hasGps) {
      pointsB = rotateClosedLapToStartGate(
        pointsB,
        dataA.points[0].x,
        dataA.points[0].z,
      );
    }
  }

  const lapA: ProcessedLap3D | null =
    dataA.points.length >= 2
      ? {
          sessionId: sessionA.id,
          fileName: sessionA.fileName,
          racerName: sessionA.racerName,
          sessionName: sessionA.sessionName,
          lapNumber: lapNumA,
          lapTime: dataA.lapTime,
          totalDistanceMeters: dataA.totalDistanceMeters,
          maxSpeed: dataA.maxSpeed,
          minSpeed: dataA.minSpeed,
          avgSpeed: dataA.avgSpeed,
          maxRpm: dataA.maxRpm,
          hasGps: dataA.hasGps,
          points: dataA.points,
        }
      : null;

  const lapB: ProcessedLap3D | null =
    pointsB.length >= 2
      ? {
          sessionId: sessionB.id,
          fileName: sessionB.fileName,
          racerName: sessionB.racerName,
          sessionName: sessionB.sessionName,
          lapNumber: lapNumB,
          lapTime: dataB.lapTime,
          totalDistanceMeters: dataB.totalDistanceMeters,
          maxSpeed: dataB.maxSpeed,
          minSpeed: dataB.minSpeed,
          avgSpeed: dataB.avgSpeed,
          maxRpm: dataB.maxRpm,
          hasGps: dataB.hasGps,
          points: pointsB,
        }
      : null;

  return { lapA, lapB, origin };
}

function interpolateLapPoint(
  points: LapPoint3D[],
  targetVal: number,
  selector: (p: LapPoint3D) => number,
): LapPoint3D {
  const n = points.length;
  if (n === 0) {
    return {
      elapsedTime: 0,
      distanceMeters: 0,
      normDist: 0,
      x: 0,
      y: 0,
      z: 0,
      lat: 0,
      lon: 0,
      speed: 0,
      rpm: 0,
      latAcc: 0,
      lonAcc: 0,
      headingRad: 0,
      slopeRad: 0,
      steeringDeg: 0,
    };
  }
  if (targetVal <= selector(points[0])) return points[0];
  if (targetVal >= selector(points[n - 1])) return points[n - 1];

  let lo = 0;
  let hi = n - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const midVal = selector(points[mid]);
    if (midVal === targetVal) return points[mid];
    if (midVal < targetVal) lo = mid + 1;
    else hi = mid - 1;
  }

  const idxB = Math.min(n - 1, lo);
  const idxA = Math.max(0, idxB - 1);
  const a = points[idxA];
  const b = points[idxB];
  const valA = selector(a);
  const valB = selector(b);
  const span = valB - valA;
  const t = span > 1e-9 ? Math.max(0, Math.min(1, (targetVal - valA) / span)) : 0;

  return {
    elapsedTime: a.elapsedTime + (b.elapsedTime - a.elapsedTime) * t,
    distanceMeters: a.distanceMeters + (b.distanceMeters - a.distanceMeters) * t,
    normDist: a.normDist + (b.normDist - a.normDist) * t,
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
    lat: a.lat + (b.lat - a.lat) * t,
    lon: a.lon + (b.lon - a.lon) * t,
    speed: a.speed + (b.speed - a.speed) * t,
    rpm: a.rpm + (b.rpm - a.rpm) * t,
    latAcc: a.latAcc + (b.latAcc - a.latAcc) * t,
    lonAcc: a.lonAcc + (b.lonAcc - a.lonAcc) * t,
    headingRad: lerpAngleRad(a.headingRad, b.headingRad, t),
    slopeRad: a.slopeRad + (b.slopeRad - a.slopeRad) * t,
    steeringDeg: a.steeringDeg + (b.steeringDeg - a.steeringDeg) * t,
  };
}

export function sampleLapAtTime(
  lap: ProcessedLap3D,
  elapsedTime: number,
): LapPoint3D {
  return interpolateLapPoint(lap.points, elapsedTime, (p) => p.elapsedTime);
}

export function sampleLapAtNormDist(
  lap: ProcessedLap3D,
  normDist: number,
): LapPoint3D {
  return interpolateLapPoint(
    lap.points,
    Math.max(0, Math.min(1, normDist)),
    (p) => p.normDist,
  );
}

export function computeComparisonSnapshot(
  lapA: ProcessedLap3D,
  lapB: ProcessedLap3D,
  mode: "distance" | "time",
  progress: number,
): ComparisonSnapshot {
  const clamped = Math.max(0, Math.min(1, progress));
  let pointA: LapPoint3D;
  let pointB: LapPoint3D;
  let timeDelta: number;

  if (mode === "distance") {
    pointA = sampleLapAtNormDist(lapA, clamped);
    pointB = sampleLapAtNormDist(lapB, clamped);
    timeDelta = pointB.elapsedTime - pointA.elapsedTime;
  } else {
    const maxTime = Math.max(lapA.lapTime, lapB.lapTime);
    const t = clamped * maxTime;
    pointA = sampleLapAtTime(lapA, Math.min(t, lapA.lapTime));
    pointB = sampleLapAtTime(lapB, Math.min(t, lapB.lapTime));
    const bAtSameDist = sampleLapAtNormDist(lapB, pointA.normDist);
    timeDelta = bAtSameDist.elapsedTime - pointA.elapsedTime;
  }

  const dx = pointB.x - pointA.x;
  const dz = pointB.z - pointA.z;
  const distanceGapMeters = Math.hypot(dx, dz);

  // Right-hand perpendicular to forward (sin h, 0, cos h) in +X East / +Z South is (-cos h, 0, sin h)
  const rightX = -Math.cos(pointA.headingRad);
  const rightZ = Math.sin(pointA.headingRad);
  const lateralOffsetMeters = dx * rightX + dz * rightZ;

  return {
    pointA,
    pointB,
    timeDelta,
    speedDelta: pointB.speed - pointA.speed,
    rpmDelta: pointB.rpm - pointA.rpm,
    latAccDelta: pointB.latAcc - pointA.latAcc,
    distanceGapMeters,
    lateralOffsetMeters,
  };
}

export function formatCompareLapTime(secs: number): string {
  if (!Number.isFinite(secs) || secs <= 0) return "0:00.000";
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  const whole = Math.floor(rem);
  const ms = Math.round((rem - whole) * 1000);
  if (ms === 1000) {
    return `${mins}:${String(whole + 1).padStart(2, "0")}.000`;
  }
  return `${mins}:${String(whole).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

function applyLightSmoothPass(
  xs: number[],
  zs: number[],
  closed: boolean,
) {
  const n = xs.length;
  if (n < 3) return;
  const nextX = new Array<number>(n);
  const nextZ = new Array<number>(n);

  for (let i = 0; i < n; i++) {
    if (!closed && (i === 0 || i === n - 1)) {
      nextX[i] = xs[i];
      nextZ[i] = zs[i];
      continue;
    }
    const prev = (i - 1 + n) % n;
    const next = (i + 1) % n;
    nextX[i] = 0.2 * xs[prev] + 0.6 * xs[i] + 0.2 * xs[next];
    nextZ[i] = 0.2 * zs[prev] + 0.6 * zs[i] + 0.2 * zs[next];
  }

  for (let i = 0; i < n; i++) {
    xs[i] = nextX[i];
    zs[i] = nextZ[i];
  }
}

function finalizeCenterlineStations(
  xs: number[],
  zs: number[],
  closed: boolean,
): TrackCenterlinePoint[] {
  const n = xs.length;
  if (n < 4) return [];

  const headings = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const prev = closed ? (i - 1 + n) % n : Math.max(0, i - 1);
    const next = closed ? (i + 1) % n : Math.min(n - 1, i + 1);
    const dx = xs[next] - xs[prev];
    const dz = zs[next] - zs[prev];
    headings[i] = Math.atan2(dx, dz);
  }

  const stations: TrackCenterlinePoint[] = [];
  for (let i = 0; i < n; i++) {
    const iPrev = closed ? (i - 2 + n) % n : Math.max(0, i - 2);
    const iNext = closed ? (i + 2) % n : Math.min(n - 1, i + 2);
    const dH = normalizeAngleRad(headings[iNext] - headings[iPrev]);
    const ds = Math.max(1, Math.hypot(xs[iNext] - xs[iPrev], zs[iNext] - zs[iPrev]));
    const h = headings[i];
    stations.push({
      x: xs[i],
      y: 0,
      z: zs[i],
      rightX: -Math.cos(h),
      rightZ: Math.sin(h),
      curvature: Math.abs(dH) / ds,
      normDist: i / (closed ? n : n - 1),
    });
  }

  if (closed) {
    stations.push({
      ...stations[0],
      normDist: 1,
    });
  }

  return stations;
}

export function buildNeutralTrackCenterline(
  _sessions: TelemetrySessionItem[],
  lapA: ProcessedLap3D,
  _lapB: ProcessedLap3D,
  origin: EnuOrigin | null,
  customTrackGps?: CustomTrackGpsPoint[] | null,
): TrackCenterlinePoint[] {
  const N = 320;

  if (customTrackGps && customTrackGps.length >= 10 && origin) {
    const cosLat = Math.cos((origin.lat * Math.PI) / 180);
    const rawPts: { x: number; z: number; dist: number }[] = [];
    let cumDist = 0;

    for (let i = 0; i < customTrackGps.length; i++) {
      const g = customTrackGps[i];
      if (!Number.isFinite(g.lat) || !Number.isFinite(g.lon)) continue;
      const x = (g.lon - origin.lon) * EARTH_LON_METERS * cosLat;
      const z = -(g.lat - origin.lat) * EARTH_LAT_METERS;
      if (rawPts.length > 0) {
        const prev = rawPts[rawPts.length - 1];
        cumDist += Math.hypot(x - prev.x, z - prev.z);
      }
      rawPts.push({ x, z, dist: cumDist });
    }

    if (rawPts.length >= 10 && cumDist > 10) {
      const first = rawPts[0];
      const last = rawPts[rawPts.length - 1];
      const closeDist = Math.hypot(last.x - first.x, last.z - first.z);
      const closed = closeDist < 35;
      if (closed && closeDist > 0.5) {
        cumDist += closeDist;
        rawPts.push({ x: first.x, z: first.z, dist: cumDist });
      }

      const xs = new Array<number>(N);
      const zs = new Array<number>(N);
      let cursor = 0;
      const denom = closed ? N : N - 1;
      for (let i = 0; i < N; i++) {
        const targetD = (i / denom) * cumDist;
        while (cursor + 1 < rawPts.length && rawPts[cursor + 1].dist < targetD) {
          cursor++;
        }
        const a = rawPts[cursor];
        const b = rawPts[Math.min(rawPts.length - 1, cursor + 1)];
        const span = b.dist - a.dist;
        const t = span > 1e-6 ? Math.max(0, Math.min(1, (targetD - a.dist) / span)) : 0;
        xs[i] = a.x + (b.x - a.x) * t;
        zs[i] = a.z + (b.z - a.z) * t;
      }

      applyLightSmoothPass(xs, zs, closed);
      return finalizeCenterlineStations(xs, zs, closed);
    }
  }

  const pts = lapA.points;
  if (pts.length < 4) return [];
  const first = pts[0];
  const last = pts[pts.length - 1];
  const closed = Math.hypot(last.x - first.x, last.z - first.z) < 35;

  const xs = new Array<number>(N);
  const zs = new Array<number>(N);
  const denom = closed ? N : N - 1;
  for (let i = 0; i < N; i++) {
    const sample = interpolateLapPoint(pts, i / denom, (p) => p.normDist);
    xs[i] = sample.x;
    zs[i] = sample.z;
  }

  applyLightSmoothPass(xs, zs, closed);
  return finalizeCenterlineStations(xs, zs, closed);
}

const MAX_TRACK_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TRACK_POINTS = 50_000;
const MAX_ZIP_ENTRIES = 64;
const MAX_ZIP_TOTAL_BYTES = 32 * 1024 * 1024;

function isValidLatLon(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -85 &&
    lat <= 85 &&
    lon >= -180 &&
    lon <= 180 &&
    (Math.abs(lat) > 0.01 || Math.abs(lon) > 0.01)
  );
}

function extractTrackRun(
  readPoint: (byteOffset: number) => { lat: number; lon: number } | null,
  startOffset: number,
  stride: number,
  byteLength: number,
): CustomTrackGpsPoint[] {
  const run: CustomTrackGpsPoint[] = [];
  for (let off = startOffset; off + stride <= byteLength && run.length < 10_000; off += stride) {
    const pt = readPoint(off);
    if (!pt || !isValidLatLon(pt.lat, pt.lon)) break;
    if (run.length > 0) {
      const prev = run[run.length - 1];
      if (
        Math.abs(pt.lat - prev.lat) > 0.015 ||
        Math.abs(pt.lon - prev.lon) > 0.015
      ) {
        break;
      }
    }
    run.push(pt);
  }
  return run;
}

function scoreTrackRun(
  run: CustomTrackGpsPoint[],
  hintOrigin?: EnuOrigin | null,
): number {
  if (run.length < 15) return -1;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const p of run) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }
  const span = Math.hypot(maxLat - minLat, maxLon - minLon);
  if (span < 0.0003 || span > 0.25) return -1;

  let score = run.length;
  if (hintOrigin) {
    const midLat = (minLat + maxLat) * 0.5;
    const midLon = (minLon + maxLon) * 0.5;
    if (
      Math.abs(midLat - hintOrigin.lat) < 0.25 &&
      Math.abs(midLon - hintOrigin.lon) < 0.25
    ) {
      score += 100_000;
    }
  }
  return score;
}

function tryDecodeTkkBinary(
  buffer: ArrayBuffer,
  hintOrigin?: EnuOrigin | null,
): CustomTrackGpsPoint[] {
  const scanLimit = Math.min(buffer.byteLength, 4 * 1024 * 1024);
  const view = new DataView(buffer, 0, scanLimit);
  let bestRun: CustomTrackGpsPoint[] = [];
  let bestScore = -1;

  const radToDeg = 180 / Math.PI;
  const candidateReadModes: {
    stride: number;
    minBytes: number;
    read: (off: number) => { lat: number; lon: number } | null;
  }[] = [
    {
      stride: 16,
      minBytes: 16,
      read: (off) => ({
        lat: view.getFloat64(off, true),
        lon: view.getFloat64(off + 8, true),
      }),
    },
    {
      stride: 24,
      minBytes: 16,
      read: (off) => ({
        lat: view.getFloat64(off, true),
        lon: view.getFloat64(off + 8, true),
      }),
    },
    {
      stride: 32,
      minBytes: 16,
      read: (off) => ({
        lat: view.getFloat64(off, true),
        lon: view.getFloat64(off + 8, true),
      }),
    },
    {
      stride: 16,
      minBytes: 16,
      read: (off) => ({
        lat: view.getFloat64(off + 8, true),
        lon: view.getFloat64(off, true),
      }),
    },
    {
      stride: 24,
      minBytes: 16,
      read: (off) => ({
        lat: view.getFloat64(off + 8, true),
        lon: view.getFloat64(off, true),
      }),
    },
    {
      stride: 16,
      minBytes: 16,
      read: (off) => ({
        lat: view.getFloat64(off, true) * radToDeg,
        lon: view.getFloat64(off + 8, true) * radToDeg,
      }),
    },
    {
      stride: 8,
      minBytes: 8,
      read: (off) => ({
        lat: view.getFloat32(off, true),
        lon: view.getFloat32(off + 4, true),
      }),
    },
    {
      stride: 12,
      minBytes: 8,
      read: (off) => ({
        lat: view.getFloat32(off, true),
        lon: view.getFloat32(off + 4, true),
      }),
    },
    {
      stride: 16,
      minBytes: 8,
      read: (off) => ({
        lat: view.getFloat32(off, true),
        lon: view.getFloat32(off + 4, true),
      }),
    },
    {
      stride: 8,
      minBytes: 8,
      read: (off) => ({
        lat: view.getInt32(off, true) * 1e-7,
        lon: view.getInt32(off + 4, true) * 1e-7,
      }),
    },
    {
      stride: 12,
      minBytes: 8,
      read: (off) => ({
        lat: view.getInt32(off, true) * 1e-7,
        lon: view.getInt32(off + 4, true) * 1e-7,
      }),
    },
    {
      stride: 16,
      minBytes: 8,
      read: (off) => ({
        lat: view.getInt32(off, true) * 1e-7,
        lon: view.getInt32(off + 4, true) * 1e-7,
      }),
    },
  ];

  for (const mode of candidateReadModes) {
    for (let off = 0; off + mode.minBytes <= scanLimit; off += 4) {
      const first = mode.read(off);
      if (!first || !isValidLatLon(first.lat, first.lon)) continue;
      const run = extractTrackRun(mode.read, off, mode.stride, scanLimit);
      const score = scoreTrackRun(run, hintOrigin);
      if (score > bestScore) {
        bestScore = score;
        bestRun = run;
      }
      if (run.length >= 4) {
        off += (run.length - 1) * mode.stride;
      }
    }
  }

  return bestRun;
}

async function inflateRawBytes(compressed: Uint8Array): Promise<ArrayBuffer> {
  const copy = new Uint8Array(compressed.byteLength);
  copy.set(compressed);
  const stream = new Blob([copy]).stream().pipeThrough(
    new DecompressionStream("deflate-raw"),
  );
  return await new Response(stream).arrayBuffer();
}

async function unpackZipEntries(
  buffer: ArrayBuffer,
): Promise<{ name: string; buffer: ArrayBuffer }[]> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const entries: { name: string; buffer: ArrayBuffer }[] = [];
  let totalUncompressed = 0;

  let eocdOffset = -1;
  const minSearch = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= minSearch; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset !== -1) {
    const entryCount = Math.min(MAX_ZIP_ENTRIES, view.getUint16(eocdOffset + 10, true));
    let cdOffset = view.getUint32(eocdOffset + 16, true);

    for (let i = 0; i < entryCount && cdOffset + 46 <= bytes.length; i++) {
      if (view.getUint32(cdOffset, true) !== 0x02014b50) break;
      const method = view.getUint16(cdOffset + 10, true);
      const compSize = view.getUint32(cdOffset + 20, true);
      const uncompSize = view.getUint32(cdOffset + 24, true);
      const nameLen = view.getUint16(cdOffset + 28, true);
      const extraLen = view.getUint16(cdOffset + 30, true);
      const commentLen = view.getUint16(cdOffset + 32, true);
      const localOffset = view.getUint32(cdOffset + 42, true);

      const rawName = new TextDecoder("utf-8", { fatal: false }).decode(
        bytes.subarray(cdOffset + 46, cdOffset + 46 + nameLen),
      );
      const safeName = rawName.split(/[\\/]/).pop() || `entry_${i}`;
      cdOffset += 46 + nameLen + extraLen + commentLen;

      if (
        rawName.endsWith("/") ||
        uncompSize > MAX_TRACK_FILE_BYTES ||
        totalUncompressed + uncompSize > MAX_ZIP_TOTAL_BYTES ||
        localOffset + 30 > bytes.length ||
        view.getUint32(localOffset, true) !== 0x04034b50
      ) {
        continue;
      }

      const lfhNameLen = view.getUint16(localOffset + 26, true);
      const lfhExtraLen = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + lfhNameLen + lfhExtraLen;
      const dataEnd = dataStart + compSize;
      if (dataEnd > bytes.length) continue;

      const slice = bytes.subarray(dataStart, dataEnd);
      if (method === 0) {
        const out = slice.slice().buffer;
        totalUncompressed += out.byteLength;
        entries.push({ name: safeName, buffer: out });
      } else if (method === 8) {
        const out = await inflateRawBytes(slice);
        if (out.byteLength <= MAX_TRACK_FILE_BYTES) {
          totalUncompressed += out.byteLength;
          entries.push({ name: safeName, buffer: out });
        }
      }
    }
  }

  return entries;
}

function parseKmlText(text: string, fallbackName: string): ParsedTrackFile {
  const nameMatch = text.match(/<name>\s*([^<]{1,120})\s*<\/name>/i);
  const coordBlocks = Array.from(
    text.matchAll(/<coordinates[^>]*>([\s\S]*?)<\/coordinates>/gi),
  );
  let bestPts: CustomTrackGpsPoint[] = [];

  for (const match of coordBlocks) {
    const tokens = match[1].trim().split(/\s+/);
    const pts: CustomTrackGpsPoint[] = [];
    for (const tok of tokens) {
      if (pts.length >= MAX_TRACK_POINTS) break;
      const parts = tok.split(",");
      if (parts.length < 2) continue;
      const lon = parseFloat(parts[0]);
      const lat = parseFloat(parts[1]);
      const alt = parts.length >= 3 ? parseFloat(parts[2]) : undefined;
      if (isValidLatLon(lat, lon)) {
        pts.push({
          lat,
          lon,
          alt: alt !== undefined && Number.isFinite(alt) ? alt : undefined,
        });
      }
    }
    if (pts.length > bestPts.length) bestPts = pts;
  }

  if (bestPts.length < 10) {
    throw new Error(
      "Could not find at least 10 GPS track coordinates in this KML file.",
    );
  }

  return {
    name: nameMatch ? nameMatch[1].trim() : fallbackName,
    points: bestPts,
    sourceFormat: "kml",
  };
}

function parseGpxText(text: string, fallbackName: string): ParsedTrackFile {
  const nameMatch = text.match(/<name>\s*([^<]{1,120})\s*<\/name>/i);
  const pts: CustomTrackGpsPoint[] = [];
  const ptRegex =
    /<(?:trkpt|rtept)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:trkpt|rtept)>)/gi;

  for (const match of text.matchAll(ptRegex)) {
    if (pts.length >= MAX_TRACK_POINTS) break;
    const attrs = match[1] || "";
    const body = match[2] || "";
    const latM = attrs.match(/\blat\s*=\s*["']([^"']+)["']/i);
    const lonM = attrs.match(/\blon\s*=\s*["']([^"']+)["']/i);
    if (!latM || !lonM) continue;
    const lat = parseFloat(latM[1]);
    const lon = parseFloat(lonM[1]);
    if (!isValidLatLon(lat, lon)) continue;
    const eleM = body.match(/<ele>\s*([^<]+)\s*<\/ele>/i);
    const alt = eleM ? parseFloat(eleM[1]) : undefined;
    pts.push({
      lat,
      lon,
      alt: alt !== undefined && Number.isFinite(alt) ? alt : undefined,
    });
  }

  if (pts.length < 10) {
    throw new Error(
      "Could not find at least 10 GPS trackpoints in this GPX file.",
    );
  }

  return {
    name: nameMatch ? nameMatch[1].trim() : fallbackName,
    points: pts,
    sourceFormat: "gpx",
  };
}

function parseGeoJsonText(text: string, fallbackName: string): ParsedTrackFile {
  const json: unknown = JSON.parse(text);
  const candidateLines: CustomTrackGpsPoint[][] = [];

  const visitCoords = (coords: unknown) => {
    if (!Array.isArray(coords) || coords.length === 0) return;
    if (typeof coords[0] === "number" && coords.length >= 2) return;
    if (Array.isArray(coords[0]) && typeof coords[0][0] === "number") {
      const line: CustomTrackGpsPoint[] = [];
      for (const item of coords) {
        if (line.length >= MAX_TRACK_POINTS) break;
        if (!Array.isArray(item) || item.length < 2) continue;
        const lon = Number(item[0]);
        const lat = Number(item[1]);
        const alt = item.length >= 3 ? Number(item[2]) : undefined;
        if (isValidLatLon(lat, lon)) {
          line.push({
            lat,
            lon,
            alt: alt !== undefined && Number.isFinite(alt) ? alt : undefined,
          });
        }
      }
      if (line.length > 0) candidateLines.push(line);
      return;
    }
    for (const child of coords) visitCoords(child);
  };

  const visitGeo = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const rec = node as Record<string, unknown>;
    if (Array.isArray(rec.coordinates)) visitCoords(rec.coordinates);
    if (rec.geometry) visitGeo(rec.geometry);
    if (Array.isArray(rec.geometries)) rec.geometries.forEach(visitGeo);
    if (Array.isArray(rec.features)) rec.features.forEach(visitGeo);
  };

  visitGeo(json);
  const bestPts = candidateLines.sort((a, b) => b.length - a.length)[0] || [];
  if (bestPts.length < 10) {
    throw new Error(
      "Could not find a LineString/Polygon with at least 10 coordinates in GeoJSON.",
    );
  }

  return {
    name: fallbackName,
    points: bestPts,
    sourceFormat: "geojson",
  };
}

function parseXmlOrTextLatLon(text: string): CustomTrackGpsPoint[] {
  const pts: CustomTrackGpsPoint[] = [];
  const attrRegex = /\blat\s*=\s*["']([-+]?\d+\.?\d*)["'][^>]*\blon\s*=\s*["']([-+]?\d+\.?\d*)["']/gi;
  for (const m of text.matchAll(attrRegex)) {
    if (pts.length >= MAX_TRACK_POINTS) break;
    const lat = parseFloat(m[1]);
    const lon = parseFloat(m[2]);
    if (isValidLatLon(lat, lon)) pts.push({ lat, lon });
  }
  return pts;
}

export async function parseCustomTrackFile(
  fileName: string,
  buffer: ArrayBuffer,
  hintOrigin?: EnuOrigin | null,
): Promise<ParsedTrackFile> {
  if (buffer.byteLength > MAX_TRACK_FILE_BYTES) {
    throw new Error("Track file exceeds the 20 MB client limit.");
  }

  const lower = fileName.toLowerCase();
  const baseName = fileName.replace(/\.[^.]+$/, "");

  if (lower.endsWith(".ztracks") || lower.endsWith(".zip")) {
    const view = new DataView(buffer);
    if (buffer.byteLength >= 4 && view.getUint32(0, true) === 0x04034b50) {
      const entries = await unpackZipEntries(buffer);
      let bestPts: CustomTrackGpsPoint[] = [];
      let bestScore = -1;
      let bestName = baseName;

      for (const entry of entries) {
        const eLower = entry.name.toLowerCase();
        try {
          if (eLower.endsWith(".kml")) {
            const parsed = parseKmlText(
              new TextDecoder("utf-8", { fatal: false }).decode(entry.buffer),
              entry.name.replace(/\.[^.]+$/, ""),
            );
            const score = scoreTrackRun(parsed.points, hintOrigin);
            if (score > bestScore) {
              bestScore = score;
              bestPts = parsed.points;
              bestName = parsed.name;
            }
            continue;
          }
          if (eLower.endsWith(".gpx")) {
            const parsed = parseGpxText(
              new TextDecoder("utf-8", { fatal: false }).decode(entry.buffer),
              entry.name.replace(/\.[^.]+$/, ""),
            );
            const score = scoreTrackRun(parsed.points, hintOrigin);
            if (score > bestScore) {
              bestScore = score;
              bestPts = parsed.points;
              bestName = parsed.name;
            }
            continue;
          }
          if (eLower.endsWith(".geojson") || eLower.endsWith(".json")) {
            const parsed = parseGeoJsonText(
              new TextDecoder("utf-8", { fatal: false }).decode(entry.buffer),
              entry.name.replace(/\.[^.]+$/, ""),
            );
            const score = scoreTrackRun(parsed.points, hintOrigin);
            if (score > bestScore) {
              bestScore = score;
              bestPts = parsed.points;
              bestName = parsed.name;
            }
            continue;
          }
        } catch {
          // continue scanning remaining entries
        }

        const binPts = tryDecodeTkkBinary(entry.buffer, hintOrigin);
        const binScore = scoreTrackRun(binPts, hintOrigin);
        if (binScore > bestScore) {
          bestScore = binScore;
          bestPts = binPts;
          bestName = entry.name.replace(/\.[^.]+$/, "") || baseName;
        }

        if (binPts.length < 15) {
          const textGuess = new TextDecoder("utf-8", { fatal: false }).decode(
            entry.buffer.slice(0, Math.min(entry.buffer.byteLength, 2 * 1024 * 1024)),
          );
          const xmlPts = parseXmlOrTextLatLon(textGuess);
          const xmlScore = scoreTrackRun(xmlPts, hintOrigin);
          if (xmlScore > bestScore) {
            bestScore = xmlScore;
            bestPts = xmlPts;
            bestName = entry.name.replace(/\.[^.]+$/, "") || baseName;
          }
        }
      }

      if (bestPts.length >= 15) {
        return {
          name: bestName,
          points: bestPts,
          sourceFormat: "ztracks",
        };
      }
    }

    const fallbackPts = tryDecodeTkkBinary(buffer, hintOrigin);
    if (fallbackPts.length >= 15) {
      return {
        name: baseName,
        points: fallbackPts,
        sourceFormat: "ztracks",
      };
    }

    throw new Error(
      "Could not extract unencrypted GPS track geometry from this .ztracks archive (AiM .tkk entries use a proprietary binary/compressed schema). Your CSV GPS laps are already used directly for the exact circuit path; or export a .kml track shape if available.",
    );
  }

  if (lower.endsWith(".kml")) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
    return parseKmlText(text, baseName);
  }

  if (lower.endsWith(".gpx")) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
    return parseGpxText(text, baseName);
  }

  if (lower.endsWith(".geojson") || lower.endsWith(".json")) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
    return parseGeoJsonText(text, baseName);
  }

  if (lower.endsWith(".tkk")) {
    const pts = tryDecodeTkkBinary(buffer, hintOrigin);
    if (pts.length >= 15) {
      return {
        name: baseName,
        points: pts,
        sourceFormat: "tkk",
      };
    }
    throw new Error(
      "This proprietary binary .tkk file has no unencrypted coordinate array. Your CSV GPS laps already render the circuit accurately, or upload a .kml / .gpx file.",
    );
  }

  throw new Error(
    "Unsupported track file format. Please upload a .ztracks, .tkk, .kml, .gpx, or .geojson file.",
  );
}
