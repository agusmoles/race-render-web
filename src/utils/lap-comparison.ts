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

function getAltUnitMultiplier(telemetry: ParsedTelemetry): number {
  const mappedName = telemetry.channelMapping.altitude || "";
  const idx = telemetry.headers.indexOf(mappedName);
  const unit = idx !== -1 ? (telemetry.units[idx] || "").toLowerCase() : "";
  if (unit === "ft" || unit.includes("feet")) return 0.3048;
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
  const altMult = getAltUnitMultiplier(session.telemetry);
  const validGpsCount = rawRows.filter(
    (r) => Number.isFinite(r.lat) && Number.isFinite(r.lon) && r.lat !== 0 && r.lon !== 0,
  ).length;
  const hasGps = validGpsCount >= Math.min(5, rawRows.length) && origin !== null;

  const startTime = rawRows[0].time;
  const cosLat = origin ? Math.cos((origin.lat * Math.PI) / 180) : 1;

  const xs: number[] = new Array(rawRows.length);
  const ys: number[] = new Array(rawRows.length);
  const zs: number[] = new Array(rawRows.length);

  if (hasGps && origin) {
    for (let i = 0; i < rawRows.length; i++) {
      const r = rawRows[i];
      if (r.lat !== 0 && r.lon !== 0) {
        xs[i] = (r.lon - origin.lon) * EARTH_LON_METERS * cosLat;
        zs[i] = (r.lat - origin.lat) * EARTH_LAT_METERS;
      } else {
        xs[i] = i > 0 ? xs[i - 1] : 0;
        zs[i] = i > 0 ? zs[i - 1] : 0;
      }
      ys[i] = (r.altitude ?? origin.alt) * altMult - origin.alt;
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

    const slopeRad =
      typeof r.slope === "number" && Number.isFinite(r.slope)
        ? (r.slope * Math.PI) / 180
        : 0;

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

function alignVerticalElevation(
  lapAPoints: LapPoint3D[],
  lapBPoints: LapPoint3D[],
): LapPoint3D[] {
  if (lapAPoints.length === 0 || lapBPoints.length === 0) return lapBPoints;
  const medA = computeMedian(lapAPoints.map((p) => p.y));
  const medB = computeMedian(lapBPoints.map((p) => p.y));
  const shiftY = medA - medB;
  if (Math.abs(shiftY) < 0.05) return lapBPoints;
  return lapBPoints.map((p) => ({ ...p, y: p.y + shiftY }));
}

function findOriginFromRows(
  rows: TelemetryRow[],
  altMult: number,
): EnuOrigin | null {
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
        alt: (r.altitude ?? 0) * altMult,
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
    findOriginFromRows(rawA, getAltUnitMultiplier(sessionA.telemetry)) ||
    findOriginFromRows(rawB, getAltUnitMultiplier(sessionB.telemetry));

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
    pointsB = alignVerticalElevation(dataA.points, pointsB);
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

  // Right-hand perpendicular vector to Kart A heading (sin(h), cos(h)) is (cos(h), -sin(h))
  const rightX = Math.cos(pointA.headingRad);
  const rightZ = -Math.sin(pointA.headingRad);
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
