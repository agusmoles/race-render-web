import type { TelemetryRow } from "./csv-helper";

export interface AutoSyncResult {
  status: "matched" | "low-confidence" | "no-gpmd" | "no-signal";
  syncOffset: number;
  speedScale: number;
  confidence: number;
  method: "gopro-gps-speed" | "gopro-gyro" | "gopro-accl" | null;
  reason?: string;
}

interface TimeValueSample {
  t: number;
  v: number;
}

interface AccelVecSample {
  t: number;
  x: number;
  y: number;
  z: number;
}

interface ExtractedGpmdSignals {
  foundGpmdTrack: boolean;
  gpsSpeed: TimeValueSample[];
  gyroMag: TimeValueSample[];
  acclVecs: AccelVecSample[];
}

interface SttsEntry {
  count: number;
  delta: number;
}

interface StscEntry {
  firstChunk: number;
  samplesPerChunk: number;
}

interface ChunkGroup {
  chunkOffset: number;
  chunkSize: number;
  samples: { relOffset: number; size: number; startSec: number; durationSec: number }[];
}

interface GpmfScope {
  scal: number[];
  gpsFix: number | null;
  gpsDop: number | null;
  complexType: string;
}

const MAX_TOP_LEVEL_BOXES = 1024;
const MAX_CHILD_BOXES = 4096;
const MAX_MOOV_BYTES = 64 * 1024 * 1024;
const MAX_GPMD_BYTES = 64 * 1024 * 1024;
const MAX_SAMPLES = 100_000;
const MAX_KLV_DEPTH = 8;
const SAMPLE_RATE_HZ = 10;

function readFourCC(view: DataView, offset: number): string {
  if (offset + 4 > view.byteLength) return "";
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

function readUint64AsSafeNumber(view: DataView, offset: number): number | null {
  if (offset + 8 > view.byteLength) return null;
  const high = view.getUint32(offset, false);
  const low = view.getUint32(offset + 4, false);
  const val = high * 4294967296 + low;
  return Number.isSafeInteger(val) ? val : null;
}

function iterChildBoxes(
  view: DataView,
  start: number,
  end: number,
  onBox: (type: string, payloadStart: number, payloadEnd: number) => void,
) {
  let pos = start;
  for (let count = 0; count < MAX_CHILD_BOXES && pos + 8 <= end; count++) {
    const size32 = view.getUint32(pos, false);
    const type = readFourCC(view, pos + 4);
    let headerSize = 8;
    let boxSize = size32;

    if (size32 === 1) {
      if (pos + 16 > end) break;
      const large = readUint64AsSafeNumber(view, pos + 8);
      if (large === null || large < 16) break;
      boxSize = large;
      headerSize = 16;
    } else if (size32 === 0) {
      boxSize = end - pos;
    }

    if (boxSize < headerSize || pos + boxSize > end) break;

    onBox(type, pos + headerSize, pos + boxSize);
    pos += boxSize;
  }
}

async function readMoovBuffer(file: File): Promise<ArrayBuffer | null> {
  let offset = 0;
  for (let i = 0; i < MAX_TOP_LEVEL_BOXES && offset + 8 <= file.size; i++) {
    const headerLen = Math.min(16, file.size - offset);
    const headerBuf = await file.slice(offset, offset + headerLen).arrayBuffer();
    if (headerBuf.byteLength < 8) break;

    const view = new DataView(headerBuf);
    const size32 = view.getUint32(0, false);
    const type = readFourCC(view, 4);

    let headerSize = 8;
    let boxSize = size32;

    if (size32 === 1) {
      if (headerBuf.byteLength < 16) break;
      const large = readUint64AsSafeNumber(view, 8);
      if (large === null || large < 16) break;
      boxSize = large;
      headerSize = 16;
    } else if (size32 === 0) {
      boxSize = file.size - offset;
    }

    if (boxSize < headerSize || offset + boxSize > file.size) break;

    if (type === "moov") {
      if (boxSize > MAX_MOOV_BYTES) return null;
      return await file.slice(offset + headerSize, offset + boxSize).arrayBuffer();
    }

    offset += boxSize;
  }
  return null;
}

function parseGpmdSampleTable(
  moovView: DataView,
  moovEnd: number,
  fileSize: number,
): { chunkGroups: ChunkGroup[]; clipDurationSec: number; foundGpmdTrack: boolean } {
  let foundGpmdTrack = false;
  let bestGroups: ChunkGroup[] = [];
  let bestDuration = 0;

  iterChildBoxes(moovView, 0, moovEnd, (trakType, trakStart, trakEnd) => {
    if (trakType !== "trak" || bestGroups.length > 0) return;

    let timescale = 0;
    let mdhdDuration = 0;
    let isGpmd = false;
    const sttsEntries: SttsEntry[] = [];
    const stscEntries: StscEntry[] = [];
    const sampleSizes: number[] = [];
    let constantSampleSize = 0;
    let sampleCount = 0;
    const chunkOffsets: number[] = [];

    iterChildBoxes(moovView, trakStart, trakEnd, (mdiaType, mdiaStart, mdiaEnd) => {
      if (mdiaType !== "mdia") return;

      iterChildBoxes(moovView, mdiaStart, mdiaEnd, (childType, childStart, childEnd) => {
        if (childType === "mdhd") {
          if (childStart + 4 > childEnd) return;
          const version = moovView.getUint8(childStart);
          if (version === 0 && childStart + 20 <= childEnd) {
            timescale = moovView.getUint32(childStart + 12, false);
            mdhdDuration = moovView.getUint32(childStart + 16, false);
          } else if (version === 1 && childStart + 32 <= childEnd) {
            timescale = moovView.getUint32(childStart + 20, false);
            const dur = readUint64AsSafeNumber(moovView, childStart + 24);
            mdhdDuration = dur ?? 0;
          }
        } else if (childType === "minf") {
          iterChildBoxes(moovView, childStart, childEnd, (minfType, minfStart, minfEnd) => {
            if (minfType !== "stbl") return;

            iterChildBoxes(moovView, minfStart, minfEnd, (stblType, stblStart, stblEnd) => {
              if (stblType === "stsd") {
                if (stblStart + 16 <= stblEnd) {
                  const entryCount = moovView.getUint32(stblStart + 4, false);
                  if (entryCount >= 1) {
                    const format = readFourCC(moovView, stblStart + 12);
                    if (format === "gpmd") {
                      isGpmd = true;
                      foundGpmdTrack = true;
                    }
                  }
                }
              } else if (stblType === "stts") {
                if (stblStart + 8 > stblEnd) return;
                const entryCount = moovView.getUint32(stblStart + 4, false);
                if (entryCount > MAX_SAMPLES || stblStart + 8 + entryCount * 8 > stblEnd) return;
                for (let i = 0; i < entryCount; i++) {
                  const p = stblStart + 8 + i * 8;
                  sttsEntries.push({
                    count: moovView.getUint32(p, false),
                    delta: moovView.getUint32(p + 4, false),
                  });
                }
              } else if (stblType === "stsc") {
                if (stblStart + 8 > stblEnd) return;
                const entryCount = moovView.getUint32(stblStart + 4, false);
                if (entryCount > MAX_SAMPLES || stblStart + 8 + entryCount * 12 > stblEnd) return;
                for (let i = 0; i < entryCount; i++) {
                  const p = stblStart + 8 + i * 12;
                  stscEntries.push({
                    firstChunk: moovView.getUint32(p, false),
                    samplesPerChunk: moovView.getUint32(p + 4, false),
                  });
                }
              } else if (stblType === "stsz") {
                if (stblStart + 12 > stblEnd) return;
                constantSampleSize = moovView.getUint32(stblStart + 4, false);
                const count = moovView.getUint32(stblStart + 8, false);
                if (count > MAX_SAMPLES) return;
                sampleCount = count;
                if (constantSampleSize === 0) {
                  if (stblStart + 12 + count * 4 > stblEnd) {
                    sampleCount = 0;
                    return;
                  }
                  for (let i = 0; i < count; i++) {
                    sampleSizes.push(moovView.getUint32(stblStart + 12 + i * 4, false));
                  }
                }
              } else if (stblType === "stco") {
                if (stblStart + 8 > stblEnd) return;
                const count = moovView.getUint32(stblStart + 4, false);
                if (count > MAX_SAMPLES || stblStart + 8 + count * 4 > stblEnd) return;
                for (let i = 0; i < count; i++) {
                  chunkOffsets.push(moovView.getUint32(stblStart + 8 + i * 4, false));
                }
              } else if (stblType === "co64") {
                if (stblStart + 8 > stblEnd) return;
                const count = moovView.getUint32(stblStart + 4, false);
                if (count > MAX_SAMPLES || stblStart + 8 + count * 8 > stblEnd) return;
                for (let i = 0; i < count; i++) {
                  const off = readUint64AsSafeNumber(moovView, stblStart + 8 + i * 8);
                  if (off === null) return;
                  chunkOffsets.push(off);
                }
              }
            });
          });
        }
      });
    });

    if (!isGpmd || timescale <= 0 || sampleCount === 0 || chunkOffsets.length === 0 || stscEntries.length === 0) {
      return;
    }

    const startTimes = new Float64Array(sampleCount);
    const durations = new Float64Array(sampleCount);
    let sIdx = 0;
    let curTicks = 0;
    for (const entry of sttsEntries) {
      const durSec = entry.delta / timescale;
      for (let k = 0; k < entry.count && sIdx < sampleCount; k++) {
        startTimes[sIdx] = curTicks / timescale;
        durations[sIdx] = durSec;
        curTicks += entry.delta;
        sIdx++;
      }
      if (sIdx >= sampleCount) break;
    }

    const totalClipDuration =
      sIdx > 0
        ? startTimes[sIdx - 1] + durations[sIdx - 1]
        : mdhdDuration > 0
          ? mdhdDuration / timescale
          : 0;

    const groups: ChunkGroup[] = [];
    let totalBytes = 0;
    let sampleIdx = 0;
    let stscPtr = 0;

    for (let chunkIdx = 0; chunkIdx < chunkOffsets.length && sampleIdx < sIdx; chunkIdx++) {
      const chunkNum = chunkIdx + 1;
      while (stscPtr + 1 < stscEntries.length && chunkNum >= stscEntries[stscPtr + 1].firstChunk) {
        stscPtr++;
      }

      const samplesInChunk = Math.min(stscEntries[stscPtr].samplesPerChunk, sIdx - sampleIdx);
      if (samplesInChunk <= 0) continue;

      const chunkOffset = chunkOffsets[chunkIdx];
      let chunkSize = 0;
      const chunkSamples: ChunkGroup["samples"] = [];

      for (let j = 0; j < samplesInChunk; j++) {
        const size = constantSampleSize > 0 ? constantSampleSize : sampleSizes[sampleIdx];
        if (size > 0) {
          chunkSamples.push({
            relOffset: chunkSize,
            size,
            startSec: startTimes[sampleIdx],
            durationSec: durations[sampleIdx],
          });
        }
        chunkSize += size;
        sampleIdx++;
      }

      if (
        chunkSize > 0 &&
        chunkOffset >= 0 &&
        chunkOffset + chunkSize <= fileSize &&
        totalBytes + chunkSize <= MAX_GPMD_BYTES
      ) {
        totalBytes += chunkSize;
        groups.push({ chunkOffset, chunkSize, samples: chunkSamples });
      }
    }

    if (groups.length > 0) {
      bestGroups = groups;
      bestDuration = totalClipDuration;
    }
  });

  return { chunkGroups: bestGroups, clipDurationSec: bestDuration, foundGpmdTrack };
}

function readScalValues(view: DataView, start: number, rawLen: number, typeChar: string): number[] {
  const out: number[] = [];
  let step = 0;
  if (typeChar === "b" || typeChar === "B") step = 1;
  else if (typeChar === "s" || typeChar === "S") step = 2;
  else if (typeChar === "l" || typeChar === "L" || typeChar === "f") step = 4;
  else return out;

  const count = Math.floor(rawLen / step);
  for (let i = 0; i < count; i++) {
    const p = start + i * step;
    if (p + step > view.byteLength) break;
    if (typeChar === "s") out.push(view.getInt16(p, false));
    else if (typeChar === "S") out.push(view.getUint16(p, false));
    else if (typeChar === "l") out.push(view.getInt32(p, false));
    else if (typeChar === "L") out.push(view.getUint32(p, false));
    else if (typeChar === "f") out.push(view.getFloat32(p, false));
    else if (typeChar === "b") out.push(view.getInt8(p));
    else if (typeChar === "B") out.push(view.getUint8(p));
  }
  return out;
}

function parseGpmdSample(
  view: DataView,
  start: number,
  end: number,
  startSec: number,
  durationSec: number,
  scope: GpmfScope,
  depth: number,
  out: ExtractedGpmdSignals,
) {
  if (depth > MAX_KLV_DEPTH) return;

  let pos = start;
  const effectiveDuration = durationSec > 0 ? durationSec : 1.0;

  while (pos + 8 <= end) {
    const key = readFourCC(view, pos);
    const typeCode = view.getUint8(pos + 4);
    const typeChar = String.fromCharCode(typeCode);
    const structSize = view.getUint8(pos + 5);
    const repeat = view.getUint16(pos + 6, false);

    const rawLen = structSize * repeat;
    const paddedLen = (rawLen + 3) & ~3;
    const payloadStart = pos + 8;
    const payloadEnd = payloadStart + rawLen;

    if (payloadEnd > end) break;

    if (typeCode === 0) {
      const childScope: GpmfScope =
        key === "STRM" || key === "DEVC"
          ? { scal: [], gpsFix: null, gpsDop: null, complexType: "" }
          : scope;
      parseGpmdSample(view, payloadStart, payloadEnd, startSec, effectiveDuration, childScope, depth + 1, out);
    } else if (key === "SCAL") {
      scope.scal = readScalValues(view, payloadStart, rawLen, typeChar);
    } else if (key === "GPSF") {
      if (rawLen >= 4) {
        scope.gpsFix = typeChar === "l" ? view.getInt32(payloadStart, false) : view.getUint32(payloadStart, false);
      } else if (rawLen >= 2) {
        scope.gpsFix = view.getUint16(payloadStart, false);
      } else if (rawLen >= 1) {
        scope.gpsFix = view.getUint8(payloadStart);
      }
    } else if (key === "GPSP") {
      if (rawLen >= 2) {
        scope.gpsDop = typeChar === "s" ? view.getInt16(payloadStart, false) : view.getUint16(payloadStart, false);
      }
    } else if (key === "TYPE" && typeChar === "c") {
      let s = "";
      for (let i = 0; i < rawLen; i++) {
        const ch = view.getUint8(payloadStart + i);
        if (ch !== 0) s += String.fromCharCode(ch);
      }
      scope.complexType = s;
    } else if (key === "GPS5" && typeChar === "l" && structSize === 20 && repeat > 0) {
      const fixOk = scope.gpsFix === null || scope.gpsFix >= 2;
      const dopOk = scope.gpsDop === null || scope.gpsDop <= 2000;
      if (fixOk && dopOk) {
        const rawScale = scope.scal[3] ?? scope.scal[0] ?? 1;
        const denom = rawScale !== 0 ? rawScale : 1;
        for (let i = 0; i < repeat; i++) {
          const itemOff = payloadStart + i * 20;
          if (itemOff + 16 > payloadEnd) break;
          const speed2dMs = view.getInt32(itemOff + 12, false) / denom;
          const speedKmh = speed2dMs * 3.6;
          if (Number.isFinite(speedKmh) && speedKmh >= 0 && speedKmh <= 500) {
            out.gpsSpeed.push({
              t: startSec + (i / repeat) * effectiveDuration,
              v: speedKmh,
            });
          }
        }
      }
    } else if (key === "GPS9" && typeChar === "?" && structSize >= 32 && repeat > 0) {
      const rawScale = scope.scal[3] ?? 1;
      const denom = rawScale !== 0 ? rawScale : 1;
      for (let i = 0; i < repeat; i++) {
        const itemOff = payloadStart + i * structSize;
        if (itemOff + 32 > payloadEnd) break;
        const fix = view.getUint16(itemOff + 30, false);
        if (fix >= 2) {
          const speed2dMs = view.getInt32(itemOff + 12, false) / denom;
          const speedKmh = speed2dMs * 3.6;
          if (Number.isFinite(speedKmh) && speedKmh >= 0 && speedKmh <= 500) {
            out.gpsSpeed.push({
              t: startSec + (i / repeat) * effectiveDuration,
              v: speedKmh,
            });
          }
        }
      }
    } else if (key === "GYRO" && typeChar === "s" && structSize === 6 && repeat > 0) {
      const s0 = scope.scal[0] || 1;
      const s1 = scope.scal[1] ?? s0;
      const s2 = scope.scal[2] ?? s0;
      const radToDeg = 180 / Math.PI;
      const groupSize = Math.max(1, Math.floor(repeat / 20));
      for (let i = 0; i < repeat; i += groupSize) {
        const endIdx = Math.min(repeat, i + groupSize);
        let sumMag = 0;
        let cnt = 0;
        for (let k = i; k < endIdx; k++) {
          const itemOff = payloadStart + k * 6;
          if (itemOff + 6 > payloadEnd) break;
          const gx = (view.getInt16(itemOff, false) / s0) * radToDeg;
          const gy = (view.getInt16(itemOff + 2, false) / s1) * radToDeg;
          const gz = (view.getInt16(itemOff + 4, false) / s2) * radToDeg;
          const mag = Math.hypot(gx, gy, gz);
          if (Number.isFinite(mag)) {
            sumMag += mag;
            cnt++;
          }
        }
        if (cnt > 0) {
          const midIdx = i + (cnt - 1) / 2;
          out.gyroMag.push({
            t: startSec + (midIdx / repeat) * effectiveDuration,
            v: sumMag / cnt,
          });
        }
      }
    } else if (key === "ACCL" && typeChar === "s" && structSize === 6 && repeat > 0) {
      const s0 = scope.scal[0] || 1;
      const s1 = scope.scal[1] ?? s0;
      const s2 = scope.scal[2] ?? s0;
      const groupSize = Math.max(1, Math.floor(repeat / 20));
      for (let i = 0; i < repeat; i += groupSize) {
        const endIdx = Math.min(repeat, i + groupSize);
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let cnt = 0;
        for (let k = i; k < endIdx; k++) {
          const itemOff = payloadStart + k * 6;
          if (itemOff + 6 > payloadEnd) break;
          const ax = view.getInt16(itemOff, false) / s0;
          const ay = view.getInt16(itemOff + 2, false) / s1;
          const az = view.getInt16(itemOff + 4, false) / s2;
          if (Number.isFinite(ax) && Number.isFinite(ay) && Number.isFinite(az)) {
            sx += ax;
            sy += ay;
            sz += az;
            cnt++;
          }
        }
        if (cnt > 0) {
          const midIdx = i + (cnt - 1) / 2;
          out.acclVecs.push({
            t: startSec + (midIdx / repeat) * effectiveDuration,
            x: sx / cnt,
            y: sy / cnt,
            z: sz / cnt,
          });
        }
      }
    }

    pos += 8 + paddedLen;
  }
}

async function extractGpmdSamplesFromFile(
  file: File,
  globalTimeOffset: number,
  out: ExtractedGpmdSignals,
): Promise<number> {
  const moovBuf = await readMoovBuffer(file);
  if (!moovBuf) return 0;

  const moovView = new DataView(moovBuf);
  const { chunkGroups, clipDurationSec, foundGpmdTrack } = parseGpmdSampleTable(
    moovView,
    moovBuf.byteLength,
    file.size,
  );

  if (foundGpmdTrack) {
    out.foundGpmdTrack = true;
  }

  for (const group of chunkGroups) {
    const chunkBuf = await file
      .slice(group.chunkOffset, group.chunkOffset + group.chunkSize)
      .arrayBuffer();
    const chunkView = new DataView(chunkBuf);

    for (const sample of group.samples) {
      if (sample.relOffset + sample.size > chunkBuf.byteLength) continue;
      const scope: GpmfScope = { scal: [], gpsFix: null, gpsDop: null, complexType: "" };
      parseGpmdSample(
        chunkView,
        sample.relOffset,
        sample.relOffset + sample.size,
        globalTimeOffset + sample.startSec,
        sample.durationSec,
        scope,
        0,
        out,
      );
    }
  }

  return clipDurationSec;
}

function resampleIrregularToUniform(samples: TimeValueSample[], fs: number): Float64Array {
  if (samples.length < 2) return new Float64Array(0);
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const maxT = sorted[sorted.length - 1].t;
  if (maxT <= 0) return new Float64Array(0);

  const length = Math.ceil(maxT * fs) + 1;
  const sums = new Float64Array(length);
  const counts = new Uint32Array(length);

  for (const s of sorted) {
    if (s.t < 0 || !Number.isFinite(s.v)) continue;
    const idx = Math.min(length - 1, Math.max(0, Math.round(s.t * fs)));
    sums[idx] += s.v;
    counts[idx]++;
  }

  const out = new Float64Array(length);
  const validIndices: number[] = [];
  for (let i = 0; i < length; i++) {
    if (counts[i] > 0) {
      out[i] = sums[i] / counts[i];
      validIndices.push(i);
    }
  }

  if (validIndices.length < 2) return new Float64Array(0);

  for (let i = 0; i < validIndices[0]; i++) {
    out[i] = out[validIndices[0]];
  }
  const lastValid = validIndices[validIndices.length - 1];
  for (let i = lastValid + 1; i < length; i++) {
    out[i] = out[lastValid];
  }

  const maxGapSamples = Math.round(1.0 * fs);
  for (let k = 0; k < validIndices.length - 1; k++) {
    const a = validIndices[k];
    const b = validIndices[k + 1];
    const gap = b - a;
    if (gap > 1) {
      const va = out[a];
      const vb = out[b];
      if (gap <= maxGapSamples) {
        for (let i = a + 1; i < b; i++) {
          out[i] = va + ((i - a) / gap) * (vb - va);
        }
      } else {
        for (let i = a + 1; i < b; i++) {
          out[i] = va;
        }
      }
    }
  }

  return out;
}

function resampleTelemetryRows(
  rows: TelemetryRow[],
  fs: number,
  extractor: (r: TelemetryRow) => number,
): Float64Array {
  if (rows.length < 2) return new Float64Array(0);
  const maxT = rows[rows.length - 1].time;
  if (maxT <= 0) return new Float64Array(0);

  const length = Math.ceil(maxT * fs) + 1;
  const out = new Float64Array(length);
  let rowPtr = 0;

  for (let i = 0; i < length; i++) {
    const targetT = i / fs;
    while (rowPtr + 1 < rows.length && rows[rowPtr + 1].time < targetT) {
      rowPtr++;
    }
    const rA = rows[rowPtr];
    const rB = rows[Math.min(rows.length - 1, rowPtr + 1)];
    const vA = extractor(rA);
    const vB = extractor(rB);
    if (rB.time > rA.time) {
      const frac = Math.max(0, Math.min(1, (targetT - rA.time) / (rB.time - rA.time)));
      out[i] = vA + frac * (vB - vA);
    } else {
      out[i] = vA;
    }
  }

  return out;
}

function movingAverage(arr: Float64Array, windowSize: number): Float64Array {
  if (arr.length === 0 || windowSize <= 1) return arr;
  const out = new Float64Array(arr.length);
  const half = Math.floor(windowSize / 2);
  const prefix = new Float64Array(arr.length + 1);
  for (let i = 0; i < arr.length; i++) {
    prefix[i + 1] = prefix[i] + arr[i];
  }
  for (let i = 0; i < arr.length; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(arr.length, i + half + 1);
    out[i] = (prefix[hi] - prefix[lo]) / (hi - lo);
  }
  return out;
}

function fft(re: Float64Array, im: Float64Array, invert: boolean) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      const tmpRe = re[i];
      re[i] = re[j];
      re[j] = tmpRe;
      const tmpIm = im[i];
      im[i] = im[j];
      im[j] = tmpIm;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((2 * Math.PI) / len) * (invert ? 1 : -1);
    const wlenRe = Math.cos(ang);
    const wlenIm = Math.sin(ang);
    const half = len >> 1;

    for (let i = 0; i < n; i += len) {
      let wRe = 1;
      let wIm = 0;
      for (let j = 0; j < half; j++) {
        const uRe = re[i + j];
        const uIm = im[i + j];
        const vRe = re[i + j + half] * wRe - im[i + j + half] * wIm;
        const vIm = re[i + j + half] * wIm + im[i + j + half] * wRe;

        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + half] = uRe - vRe;
        im[i + j + half] = uIm - vIm;

        const nextWRe = wRe * wlenRe - wIm * wlenIm;
        wIm = wRe * wlenIm + wIm * wlenRe;
        wRe = nextWRe;
      }
    }
  }

  if (invert) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

function buildPrefixSums(arr: Float64Array): { sum: Float64Array; sumSq: Float64Array } {
  const n = arr.length;
  const sum = new Float64Array(n + 1);
  const sumSq = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const v = arr[i];
    sum[i + 1] = sum[i] + v;
    sumSq[i + 1] = sumSq[i] + v * v;
  }
  return { sum, sumSq };
}

function parabolicPeakOffset(left: number, center: number, right: number): number {
  const denom = left - 2 * center + right;
  if (denom >= -1e-9) return 0;
  const delta = (0.5 * (left - right)) / denom;
  return Math.max(-0.5, Math.min(0.5, delta));
}

function windowPearsonCorrelation(
  x: Float64Array,
  y: Float64Array,
  xStart: number,
  xEnd: number,
  lag: number,
  minStdX: number,
  minStdY: number,
): number {
  const aX = Math.max(xStart, lag);
  const bX = Math.min(xEnd, y.length + lag);
  const len = bX - aX;
  if (len < 30) return -1;

  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;

  for (let i = aX; i < bX; i++) {
    const vx = x[i];
    const vy = y[i - lag];
    sx += vx;
    sy += vy;
    sxx += vx * vx;
    syy += vy * vy;
    sxy += vx * vy;
  }

  const denX = len * sxx - sx * sx;
  const denY = len * syy - sy * sy;
  if (denX <= 0 || denY <= 0) return -1;

  const stdX = Math.sqrt(denX) / len;
  const stdY = Math.sqrt(denY) / len;
  if (stdX < minStdX || stdY < minStdY) return -1;

  return (len * sxy - sx * sy) / Math.sqrt(denX * denY);
}

function findLocalPeakOffset(
  x: Float64Array,
  y: Float64Array,
  wxStart: number,
  wxEnd: number,
  baseLag: number,
  searchRadiusSamples: number,
  fs: number,
  minStdX: number,
  minStdY: number,
): { offset: number; r: number } {
  let bestLag = baseLag;
  let bestR = -Infinity;
  const scores = new Map<number, number>();

  for (let dk = -searchRadiusSamples; dk <= searchRadiusSamples; dk++) {
    const lag = baseLag + dk;
    const r = windowPearsonCorrelation(x, y, wxStart, wxEnd, lag, minStdX, minStdY);
    scores.set(lag, r);
    if (r > bestR) {
      bestR = r;
      bestLag = lag;
    }
  }

  const left = scores.get(bestLag - 1) ?? bestR;
  const right = scores.get(bestLag + 1) ?? bestR;
  const sub = parabolicPeakOffset(left, bestR, right);
  return { offset: (bestLag + sub) / fs, r: bestR };
}

function correlateSignals(
  x: Float64Array,
  y: Float64Array,
  fs: number,
  minStdX: number,
  minStdY: number = minStdX,
): { syncOffset: number; speedScale: number; confidence: number } | null {
  const nx = x.length;
  const ny = y.length;
  if (nx < 30 || ny < 30) return null;

  const minOverlap = Math.max(30, Math.min(150, Math.floor(0.5 * Math.min(nx, ny))));
  if (nx < minOverlap || ny < minOverlap) return null;

  let m = 1;
  while (m < nx + ny) m <<= 1;

  const xRe = new Float64Array(m);
  const xIm = new Float64Array(m);
  const yRe = new Float64Array(m);
  const yIm = new Float64Array(m);

  xRe.set(x);
  yRe.set(y);

  fft(xRe, xIm, false);
  fft(yRe, yIm, false);

  const cRe = new Float64Array(m);
  const cIm = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    cRe[i] = xRe[i] * yRe[i] + xIm[i] * yIm[i];
    cIm[i] = xIm[i] * yRe[i] - xRe[i] * yIm[i];
  }

  fft(cRe, cIm, true);

  const px = buildPrefixSums(x);
  const py = buildPrefixSums(y);

  const kMin = -(ny - minOverlap);
  const kMax = nx - minOverlap;
  const totalLags = kMax - kMin + 1;
  if (totalLags <= 0) return null;

  const rValues = new Float64Array(totalLags);
  rValues.fill(-1);

  let bestIdx = -1;
  let bestR = -1;
  let bestLag = 0;

  for (let idx = 0; idx < totalLags; idx++) {
    const k = kMin + idx;
    const aX = Math.max(0, k);
    const bX = Math.min(nx, ny + k);
    const len = bX - aX;
    if (len < minOverlap) continue;

    const aY = aX - k;
    const bY = bX - k;

    const sx = px.sum[bX] - px.sum[aX];
    const sxx = px.sumSq[bX] - px.sumSq[aX];
    const sy = py.sum[bY] - py.sum[aY];
    const syy = py.sumSq[bY] - py.sumSq[aY];

    const denX = len * sxx - sx * sx;
    const denY = len * syy - sy * sy;
    if (denX <= 0 || denY <= 0) continue;

    const stdX = Math.sqrt(denX) / len;
    const stdY = Math.sqrt(denY) / len;
    if (stdX < minStdX || stdY < minStdY) continue;

    const cIdx = k >= 0 ? k : m + k;
    const sxy = cRe[cIdx];
    const r = (len * sxy - sx * sy) / Math.sqrt(denX * denY);
    rValues[idx] = r;

    if (r > bestR) {
      bestR = r;
      bestIdx = idx;
      bestLag = k;
    }
  }

  if (bestIdx === -1 || !Number.isFinite(bestR)) return null;

  const leftR = bestIdx > 0 ? rValues[bestIdx - 1] : bestR;
  const rightR = bestIdx + 1 < totalLags ? rValues[bestIdx + 1] : bestR;
  const subLag = parabolicPeakOffset(leftR, bestR, rightR);

  let finalOffset = (bestLag + subLag) / fs;
  let finalScale = 1.0;

  const bestAx = Math.max(0, bestLag);
  const bestBx = Math.min(nx, ny + bestLag);
  const bestOverlap = bestBx - bestAx;

  if (bestOverlap >= 120 * fs && bestR >= 0.8) {
    const winLen = Math.floor(0.35 * bestOverlap);
    const w1Start = bestAx;
    const w1End = bestAx + winLen;
    const w2Start = bestBx - winLen;
    const w2End = bestBx;

    const p1 = findLocalPeakOffset(x, y, w1Start, w1End, bestLag, 2 * fs, fs, minStdX, minStdY);
    const p2 = findLocalPeakOffset(x, y, w2Start, w2End, bestLag, 2 * fs, fs, minStdX, minStdY);

    if (p1.r >= 0.8 && p2.r >= 0.8) {
      const vid1 = (w1Start + w1End - 1) / 2 / fs;
      const vid2 = (w2Start + w2End - 1) / 2 / fs;
      const tel1 = vid1 - p1.offset;
      const tel2 = vid2 - p2.offset;
      if (vid2 > vid1) {
        const derivedScale = (tel2 - tel1) / (vid2 - vid1);
        if (derivedScale >= 0.995 && derivedScale <= 1.005) {
          finalScale = parseFloat(derivedScale.toFixed(5));
          finalOffset = vid1 - tel1 / finalScale;
        }
      }
    }
  }

  return {
    syncOffset: parseFloat(finalOffset.toFixed(4)),
    speedScale: finalScale,
    confidence: Math.max(0, Math.min(1, bestR)),
  };
}

export async function autoSyncWithGpmf(
  videoFiles: File[],
  videoDurations: number[],
  telemetryRows: TelemetryRow[],
): Promise<AutoSyncResult> {
  if (videoFiles.length === 0 || telemetryRows.length < 10) {
    return {
      status: "no-signal",
      syncOffset: 0,
      speedScale: 1.0,
      confidence: 0,
      method: null,
      reason: "Missing video files or telemetry rows",
    };
  }

  const extracted: ExtractedGpmdSignals = {
    foundGpmdTrack: false,
    gpsSpeed: [],
    gyroMag: [],
    acclVecs: [],
  };

  let cumulativeOffset = 0;
  for (let i = 0; i < videoFiles.length; i++) {
    const file = videoFiles[i];
    let sttsDuration = 0;
    try {
      sttsDuration = await extractGpmdSamplesFromFile(file, cumulativeOffset, extracted);
    } catch {
      sttsDuration = 0;
    }
    const providedDur = videoDurations[i];
    const step = Number.isFinite(providedDur) && providedDur > 0 ? providedDur : sttsDuration;
    cumulativeOffset += step;
  }

  if (!extracted.foundGpmdTrack) {
    return {
      status: "no-gpmd",
      syncOffset: 0,
      speedScale: 1.0,
      confidence: 0,
      method: null,
      reason: "No GoPro GPMF telemetry track found in video",
    };
  }

  const candidates: AutoSyncResult[] = [];

  if (extracted.gpsSpeed.length >= 10) {
    const camSpeed = resampleIrregularToUniform(extracted.gpsSpeed, SAMPLE_RATE_HZ);
    const telSpeed = resampleTelemetryRows(telemetryRows, SAMPLE_RATE_HZ, (r) => r.speed || 0);
    const res = correlateSignals(camSpeed, telSpeed, SAMPLE_RATE_HZ, 1.0, 1.0);
    if (res) {
      const status =
        res.confidence >= 0.72
          ? "matched"
          : res.confidence >= 0.45
            ? "low-confidence"
            : "no-signal";
      const result: AutoSyncResult = {
        status,
        syncOffset: res.syncOffset,
        speedScale: res.speedScale,
        confidence: res.confidence,
        method: "gopro-gps-speed",
      };
      if (status === "matched") return result;
      candidates.push(result);
    }
  }

  if (extracted.gyroMag.length >= 20) {
    const camGyro = movingAverage(
      resampleIrregularToUniform(extracted.gyroMag, SAMPLE_RATE_HZ),
      5,
    );
    const hasAiMGyro = telemetryRows.some((r) => Math.abs(r.gyro) > 5);
    const telYaw = movingAverage(
      resampleTelemetryRows(telemetryRows, SAMPLE_RATE_HZ, (r) =>
        hasAiMGyro ? Math.abs(r.gyro) : Math.abs(r.latAcc),
      ),
      5,
    );
    const minTelStd = hasAiMGyro ? 1.0 : 0.05;
    const res = correlateSignals(camGyro, telYaw, SAMPLE_RATE_HZ, 1.0, minTelStd);
    if (res) {
      const status =
        res.confidence >= 0.65
          ? "matched"
          : res.confidence >= 0.45
            ? "low-confidence"
            : "no-signal";
      const result: AutoSyncResult = {
        status,
        syncOffset: res.syncOffset,
        speedScale: res.speedScale,
        confidence: res.confidence,
        method: "gopro-gyro",
      };
      if (status === "matched") return result;
      candidates.push(result);
    }
  }

  if (extracted.acclVecs.length >= 20) {
    let meanX = 0;
    let meanY = 0;
    let meanZ = 0;
    for (const v of extracted.acclVecs) {
      meanX += v.x;
      meanY += v.y;
      meanZ += v.z;
    }
    const n = extracted.acclVecs.length;
    meanX /= n;
    meanY /= n;
    meanZ /= n;

    const acclMagSamples: TimeValueSample[] = extracted.acclVecs.map((v) => ({
      t: v.t,
      v: Math.hypot(v.x - meanX, v.y - meanY, v.z - meanZ) / 9.80665,
    }));

    const camAcc = movingAverage(
      resampleIrregularToUniform(acclMagSamples, SAMPLE_RATE_HZ),
      5,
    );
    const telAcc = movingAverage(
      resampleTelemetryRows(telemetryRows, SAMPLE_RATE_HZ, (r) => Math.hypot(r.latAcc, r.lonAcc)),
      5,
    );
    const res = correlateSignals(camAcc, telAcc, SAMPLE_RATE_HZ, 0.02);
    if (res) {
      const status =
        res.confidence >= 0.65
          ? "matched"
          : res.confidence >= 0.45
            ? "low-confidence"
            : "no-signal";
      const result: AutoSyncResult = {
        status,
        syncOffset: res.syncOffset,
        speedScale: res.speedScale,
        confidence: res.confidence,
        method: "gopro-accl",
      };
      if (status === "matched") return result;
      candidates.push(result);
    }
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => b.confidence - a.confidence);
    return candidates[0];
  }

  return {
    status: "no-signal",
    syncOffset: 0,
    speedScale: 1.0,
    confidence: 0,
    method: null,
    reason: "Insufficient overlapping motion signal in GoPro telemetry",
  };
}
