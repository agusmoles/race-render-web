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

export interface LayoutConfig {
  x: number;
  y: number;
  w: number;
  h: number;
  visible: boolean;
}

export interface TrackPathData {
  cachedPath2D: Path2D | null;
  trackScale: number;
  trackMinLon: number;
  trackMaxLat: number;
  trackHasGPS: boolean;
  tSvgW: number;
  tSvgH: number;
  tPadding: number;
  trackLonSpan: number;
  trackLatSpan: number;
  firstValidPoint: GPSPoint | null;
}

export interface TrackMapProps extends TrackPathData {
  telemetryTime: number;
  lapTimesStarts: Record<number, number>;
  lapTimesLaps: Record<number, number>;
  lapTimesStartDistances: Record<number, number>;
  lapTimesDistances: Record<number, number>;
  formatLapTime: (secs: number) => string;
  bestLapTimeStr: string;
  bestLapNum: number;
  bestLapRows: TelemetryPoint[];
  startFinishCoord?: GPSPoint | null;
  maxSpeed?: number;
  maxRpm?: number;
  telemetryLaps?: number[];
}

export interface HUDLayoutConfig {
  speedometer?: LayoutConfig;
  rpmGauge?: LayoutConfig;
  gForceRadar?: LayoutConfig;
  trackMap?: LayoutConfig;
  lapTimer?: LayoutConfig;
  deltaBar?: LayoutConfig;
}

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const FONT_SANS = '"Inter", system-ui, -apple-system, sans-serif';
const FONT_MONO = '"Orbitron", ui-monospace, monospace';

function projectTrackPoint(lat: number, lon: number, track: Pick<TrackPathData, "tPadding" | "tSvgW" | "tSvgH" | "trackMinLon" | "trackMaxLat" | "trackScale" | "trackLonSpan" | "trackLatSpan">) {
  const x =
    track.tPadding +
    (lon - track.trackMinLon) * track.trackScale +
    (track.tSvgW - track.tPadding * 2 - track.trackLonSpan * track.trackScale) / 2;
  const y =
    track.tPadding +
    (track.trackMaxLat - lat) * track.trackScale +
    (track.tSvgH - track.tPadding * 2 - track.trackLatSpan * track.trackScale) / 2;
  return { x, y };
}

export function buildTrackPath(points: GPSPoint[]): TrackPathData {
  const tPadding = 20;
  const tSvgW = 200;
  const tSvgH = 200;

  const validPoints = points.filter((p) => p.lat !== 0 && p.lon !== 0);
  if (validPoints.length < 5) {
    return {
      cachedPath2D: null,
      trackScale: 1,
      trackMinLon: 0,
      trackMaxLat: 0,
      trackHasGPS: false,
      tSvgW,
      tSvgH,
      tPadding,
      trackLonSpan: 0,
      trackLatSpan: 0,
      firstValidPoint: validPoints[0] ?? null,
    };
  }

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;

  for (const p of validPoints) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }

  const trackLatSpan = maxLat - minLat;
  const trackLonSpan = maxLon - minLon;

  if (trackLatSpan <= 0 || trackLonSpan <= 0) {
    return {
      cachedPath2D: null,
      trackScale: 1,
      trackMinLon: 0,
      trackMaxLat: 0,
      trackHasGPS: false,
      tSvgW,
      tSvgH,
      tPadding,
      trackLonSpan,
      trackLatSpan,
      firstValidPoint: validPoints[0] ?? null,
    };
  }

  const scaleX = (tSvgW - tPadding * 2) / trackLonSpan;
  const scaleY = (tSvgH - tPadding * 2) / trackLatSpan;
  const trackScale = Math.min(scaleX, scaleY);

  const projMeta = {
    tPadding,
    tSvgW,
    tSvgH,
    trackMinLon: minLon,
    trackMaxLat: maxLat,
    trackScale,
    trackLonSpan,
    trackLatSpan,
  };

  let trackPath = "";
  validPoints.forEach((p, idx) => {
    const { x, y } = projectTrackPoint(p.lat, p.lon, projMeta);
    trackPath += idx === 0 ? `M ${x.toFixed(2)} ${y.toFixed(2)}` : ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
  });
  trackPath += " Z";

  return {
    cachedPath2D: new Path2D(trackPath),
    trackScale,
    trackMinLon: minLon,
    trackMaxLat: maxLat,
    trackHasGPS: true,
    tSvgW,
    tSvgH,
    tPadding,
    trackLonSpan,
    trackLatSpan,
    firstValidPoint: validPoints[0] ?? null,
  };
}

export function drawRoundedRect(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export function drawCanvasHUD(
  ctx: Ctx2D,
  width: number,
  height: number,
  tel: TelemetryPoint,
  gHistory: { x: number; y: number }[],
  trackMapProps: TrackMapProps,
  layoutConfig: HUDLayoutConfig,
) {
  ctx.save();
  const pxScale = width / 1280;

  if (layoutConfig.speedometer?.visible) {
    const wX = (layoutConfig.speedometer.x / 100) * width;
    const wY = (layoutConfig.speedometer.y / 100) * height;
    const wW = (layoutConfig.speedometer.w / 100) * width;
    const wH = (layoutConfig.speedometer.h / 100) * height;
    const unit = Math.min(wW, wH) / 200;
    const cx = wX + wW / 2;
    const cy = wY + wH / 2;
    const r = 80 * unit;
    const strokeW = 10 * unit;

    ctx.beginPath();
    ctx.arc(cx, cy, r, (135 * Math.PI) / 180, (405 * Math.PI) / 180);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.lineWidth = strokeW;
    ctx.lineCap = "round";
    ctx.stroke();

    const maxSpeed = trackMapProps.maxSpeed || 260;
    const clampedSpeed = Math.max(0, Math.min(tel.speed, maxSpeed));
    const clampedPct = clampedSpeed / maxSpeed;
    if (clampedPct > 0) {
      const endAngle = 135 + clampedPct * 270;
      ctx.beginPath();
      ctx.arc(cx, cy, r, (135 * Math.PI) / 180, (endAngle * Math.PI) / 180);
      ctx.strokeStyle = "#22d3ee";
      ctx.lineWidth = strokeW;
      ctx.lineCap = "round";
      ctx.shadowColor = "rgba(34, 211, 238, 0.5)";
      ctx.shadowBlur = 8 * unit;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    ctx.fillStyle = "#ffffff";
    ctx.font = `800 ${42 * unit}px ${FONT_MONO}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(Math.round(clampedSpeed).toString(), cx, cy);

    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.font = `700 ${12 * unit}px ${FONT_SANS}`;
    ctx.fillText("KM/H", cx, cy + 25 * unit);
  }

  if (layoutConfig.rpmGauge?.visible) {
    const wX = (layoutConfig.rpmGauge.x / 100) * width;
    const wY = (layoutConfig.rpmGauge.y / 100) * height;
    const wW = (layoutConfig.rpmGauge.w / 100) * width;
    const wH = (layoutConfig.rpmGauge.h / 100) * height;
    const unit = Math.min(wW, wH) / 160;
    const cx = wX + wW / 2;
    const cy = wY + wH / 2;
    const r = 60 * unit;
    const strokeW = 8 * unit;
    const maxRpm = trackMapProps.maxRpm || 15000;
    const clampedRpm = Math.max(0, Math.min(tel.rpm, maxRpm));
    const clampedPct = clampedRpm / maxRpm;

    let arcColor = "#10b981";
    if (clampedPct > 0.85) arcColor = "#f43f5e";
    else if (clampedPct > 0.65) arcColor = "#fb923c";
    else if (clampedPct > 0.45) arcColor = "#fbbf24";

    ctx.beginPath();
    ctx.arc(cx, cy, r, (135 * Math.PI) / 180, (405 * Math.PI) / 180);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.lineWidth = strokeW;
    ctx.lineCap = "round";
    ctx.stroke();

    if (clampedPct > 0) {
      const endAngle = 135 + clampedPct * 270;
      ctx.beginPath();
      ctx.arc(cx, cy, r, (135 * Math.PI) / 180, (endAngle * Math.PI) / 180);
      ctx.strokeStyle = arcColor;
      ctx.lineWidth = strokeW;
      ctx.lineCap = "round";
      ctx.shadowColor = arcColor;
      ctx.shadowBlur = 8 * unit;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    ctx.fillStyle = "#ffffff";
    ctx.font = `800 ${28 * unit}px ${FONT_MONO}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(Math.round(clampedRpm).toString(), cx, cy);

    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.font = `700 ${10 * unit}px ${FONT_SANS}`;
    ctx.fillText("RPM", cx, cy + 20 * unit);
  }

  if (layoutConfig.gForceRadar?.visible) {
    const wX = (layoutConfig.gForceRadar.x / 100) * width;
    const wY = (layoutConfig.gForceRadar.y / 100) * height;
    const wW = (layoutConfig.gForceRadar.w / 100) * width;
    const wH = (layoutConfig.gForceRadar.h / 100) * height;
    const cqw = wW / 100;

    const labelFont = `450 ${6.5 * cqw}px ${FONT_MONO}`;
    const valueFont = `700 ${6.5 * cqw}px ${FONT_MONO}`;
    const latLabel = "LAT: ";
    const latVal = `${tel.latAcc.toFixed(2)}G`;
    const lonLabel = "LON: ";
    const lonVal = `${tel.lonAcc.toFixed(2)}G`;

    ctx.font = labelFont;
    const latLabelW = ctx.measureText(latLabel).width;
    const lonLabelW = ctx.measureText(lonLabel).width;
    ctx.font = valueFont;
    const latValW = ctx.measureText(latVal).width;
    const lonValW = ctx.measureText(lonVal).width;

    const gap = 8 * cqw;
    const totalHeaderW = latLabelW + latValW + gap + lonLabelW + lonValW;
    let cursorX = wX + (wW - totalHeaderW) / 2;
    const headerY = wY + 4.5 * cqw;

    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    ctx.font = labelFont;
    ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
    ctx.fillText(latLabel, cursorX, headerY);
    cursorX += latLabelW;

    ctx.font = valueFont;
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.fillText(latVal, cursorX, headerY);
    cursorX += latValW + gap;

    ctx.font = labelFont;
    ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
    ctx.fillText(lonLabel, cursorX, headerY);
    cursorX += lonLabelW;

    ctx.font = valueFont;
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.fillText(lonVal, cursorX, headerY);

    const svgTop = wY + 10.5 * cqw;
    const svgH = Math.max(10, wH - 10.5 * cqw);
    const unit = Math.min(wW, svgH) / 200;
    const cx = wX + wW / 2;
    const cy = svgTop + svgH / 2;
    const r = 80 * unit;
    const maxG = 1.6;

    ctx.lineWidth = Math.max(1, 1 * unit);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
    ctx.setLineDash([4 * unit, 4 * unit]);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 2 * Math.PI);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
    ctx.beginPath();
    ctx.arc(cx, cy, r * (1.0 / maxG), 0, 2 * Math.PI);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
    ctx.setLineDash([2 * unit, 2 * unit]);
    ctx.beginPath();
    ctx.arc(cx, cy, r * (0.5 / maxG), 0, 2 * Math.PI);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
    ctx.beginPath();
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy + r);
    ctx.stroke();

    const getGCoords = (gX: number, gY: number) => {
      const x = cx - (gX / maxG) * r;
      const y = cy + (gY / maxG) * r;
      return {
        x: Math.max(cx - r, Math.min(cx + r, x)),
        y: Math.max(cy - r, Math.min(cy + r, y)),
      };
    };

    gHistory.slice(0, -1).forEach((gPoint, index) => {
      const coords = getGCoords(gPoint.x, gPoint.y);
      const opacity = (index + 1) / gHistory.length;
      const size = (3 + opacity * 3) * unit;
      ctx.beginPath();
      ctx.arc(coords.x, coords.y, size, 0, 2 * Math.PI);
      ctx.fillStyle = `rgba(244, 63, 94, ${opacity * 0.4})`;
      ctx.fill();
    });

    const currentCoords = getGCoords(tel.latAcc, tel.lonAcc);
    ctx.beginPath();
    ctx.arc(currentCoords.x, currentCoords.y, 7 * unit, 0, 2 * Math.PI);
    ctx.fillStyle = "#f43f5e";
    ctx.shadowColor = "rgba(244, 63, 94, 0.8)";
    ctx.shadowBlur = 8 * unit;
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.beginPath();
    ctx.arc(currentCoords.x, currentCoords.y, 2 * unit, 0, 2 * Math.PI);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
  }

  if (layoutConfig.trackMap?.visible && trackMapProps.trackHasGPS) {
    const wX = (layoutConfig.trackMap.x / 100) * width;
    const wY = (layoutConfig.trackMap.y / 100) * height;
    const wW = (layoutConfig.trackMap.w / 100) * width;
    const wH = (layoutConfig.trackMap.h / 100) * height;

    const scaleToFit = Math.min(wW / trackMapProps.tSvgW, wH / trackMapProps.tSvgH);
    const cx = wX + (wW - trackMapProps.tSvgW * scaleToFit) / 2;
    const cy = wY + (wH - trackMapProps.tSvgH * scaleToFit) / 2;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scaleToFit, scaleToFit);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (trackMapProps.cachedPath2D) {
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 5;
      ctx.stroke(trackMapProps.cachedPath2D);

      ctx.strokeStyle = "rgba(255,255,255,0.75)";
      ctx.lineWidth = 2;
      ctx.stroke(trackMapProps.cachedPath2D);
    }

    const sf = trackMapProps.startFinishCoord;
    if (sf && sf.lat !== 0 && sf.lon !== 0) {
      const { x: sfX, y: sfY } = projectTrackPoint(sf.lat, sf.lon, trackMapProps);
      ctx.beginPath();
      ctx.moveTo(sfX, sfY - 5);
      ctx.lineTo(sfX + 4, sfY);
      ctx.lineTo(sfX, sfY + 5);
      ctx.lineTo(sfX - 4, sfY);
      ctx.closePath();
      ctx.fillStyle = "#f43f5e";
      ctx.shadowColor = "#f43f5e";
      ctx.shadowBlur = 6;
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    const activeLat = tel.lat !== 0 && tel.lon !== 0 ? tel.lat : trackMapProps.firstValidPoint?.lat ?? 0;
    const activeLon = tel.lat !== 0 && tel.lon !== 0 ? tel.lon : trackMapProps.firstValidPoint?.lon ?? 0;
    if (activeLat !== 0 && activeLon !== 0) {
      const { x: ptX, y: ptY } = projectTrackPoint(activeLat, activeLon, trackMapProps);

      ctx.beginPath();
      ctx.arc(ptX, ptY, 5, 0, 2 * Math.PI);
      ctx.fillStyle = "#22d3ee";
      ctx.shadowColor = "#22d3ee";
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.beginPath();
      ctx.arc(ptX, ptY, 1.5, 0, 2 * Math.PI);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
    }
    ctx.restore();
  }

  if (layoutConfig.lapTimer?.visible) {
    const wX = (layoutConfig.lapTimer.x / 100) * width;
    const wY = (layoutConfig.lapTimer.y / 100) * height;
    const wW = (layoutConfig.lapTimer.w / 100) * width;
    const cqw = wW / 100;

    const elapsed = Math.max(0, (trackMapProps.telemetryTime || 0) - (trackMapProps.lapTimesStarts?.[tel.lap] || 0));
    const curTimeStr = trackMapProps.formatLapTime(elapsed);
    const bestTimeStr = trackMapProps.bestLapTimeStr || "0:00.00";
    const hasBest = bestTimeStr !== "0:00.00";
    const prevDuration = trackMapProps.lapTimesLaps?.[tel.lap - 1] || 0;
    const hasPrev = prevDuration > 0;

    const topRowH = hasBest && hasPrev ? 9.5 * cqw : 4.5 * cqw;
    const wH = 5 * cqw + topRowH + 2.5 * cqw + 3.5 * cqw + 0.5 * cqw + 12 * cqw + 6 * cqw;

    ctx.save();

    const blurPx = Math.max(4, Math.round(12 * pxScale));
    if ("filter" in ctx) {
      const sx = Math.max(0, Math.floor(wX));
      const sy = Math.max(0, Math.floor(wY));
      const sw = Math.min(width - sx, Math.ceil(wW));
      const sh = Math.min(height - sy, Math.ceil(wH));
      if (sw > 0 && sh > 0) {
        ctx.save();
        drawRoundedRect(ctx, wX, wY, wW, wH, 6 * cqw);
        ctx.clip();
        ctx.filter = `blur(${blurPx}px)`;
        ctx.drawImage(ctx.canvas, sx, sy, sw, sh, sx, sy, sw, sh);
        ctx.restore();
      }
    }

    drawRoundedRect(ctx, wX, wY, wW, wH, 6 * cqw);
    ctx.fillStyle = "rgba(9, 9, 11, 0.7)";
    ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
    ctx.shadowBlur = 16 * pxScale;
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.save();
    drawRoundedRect(ctx, wX, wY, wW, wH, 6 * cqw);
    ctx.clip();
    ctx.fillStyle = "#22d3ee";
    ctx.fillRect(wX, wY, 1.5 * cqw, wH);
    ctx.restore();

    ctx.strokeStyle = "rgba(39, 39, 42, 0.8)";
    ctx.lineWidth = Math.max(1, pxScale);
    drawRoundedRect(ctx, wX, wY, wW, wH, 6 * cqw);
    ctx.stroke();

    ctx.textBaseline = "top";

    ctx.fillStyle = "#22d3ee";
    ctx.font = `900 ${4.5 * cqw}px ${FONT_SANS}`;
    ctx.textAlign = "left";
    ctx.fillText(`LAP ${tel.lap}`, wX + 5 * cqw, wY + 5 * cqw);

    let rightY = wY + 5 * cqw;

    if (hasBest) {
      ctx.textAlign = "right";
      const bestLabel = trackMapProps.bestLapNum > 0 ? `BEST (L${trackMapProps.bestLapNum}):` : "BEST:";

      ctx.fillStyle = "#10b981";
      ctx.font = `900 ${4.5 * cqw}px ${FONT_MONO}`;
      const timeWidth = ctx.measureText(bestTimeStr).width;
      ctx.shadowColor = "rgba(16, 185, 129, 0.3)";
      ctx.shadowBlur = 3 * cqw;
      ctx.fillText(bestTimeStr, wX + wW - 5 * cqw, rightY);
      ctx.shadowBlur = 0;

      ctx.fillStyle = "#71717a";
      ctx.font = `900 ${3.5 * cqw}px ${FONT_SANS}`;
      ctx.fillText(bestLabel, wX + wW - 5 * cqw - timeWidth - 1.5 * cqw, rightY + 0.5 * cqw);

      rightY += 5 * cqw;
    }

    if (hasPrev) {
      const lastTimeStr = trackMapProps.formatLapTime(prevDuration);
      ctx.textAlign = "right";

      ctx.fillStyle = "#d4d4d8";
      ctx.font = `700 ${4.5 * cqw}px ${FONT_MONO}`;
      const timeWidth = ctx.measureText(lastTimeStr).width;
      ctx.fillText(lastTimeStr, wX + wW - 5 * cqw, rightY);

      ctx.fillStyle = "#71717a";
      ctx.font = `900 ${3.5 * cqw}px ${FONT_SANS}`;
      ctx.fillText("LAST:", wX + wW - 5 * cqw - timeWidth - 1.5 * cqw, rightY + 0.5 * cqw);
    }

    const labelY = wY + 5 * cqw + topRowH + 2.5 * cqw;
    ctx.fillStyle = "#a1a1aa";
    ctx.font = `700 ${3.5 * cqw}px ${FONT_SANS}`;
    ctx.textAlign = "left";
    ctx.fillText("CURRENT TIME", wX + 5 * cqw, labelY);

    const valueY = labelY + 3.5 * cqw + 0.5 * cqw;
    ctx.fillStyle = "#f4f4f5";
    ctx.font = `900 ${12 * cqw}px ${FONT_MONO}`;
    ctx.shadowColor = "rgba(244, 244, 245, 0.2)";
    ctx.shadowBlur = 4 * cqw;
    ctx.fillText(curTimeStr, wX + 5 * cqw, valueY);
    ctx.shadowBlur = 0;

    ctx.restore();
  }

  if (layoutConfig.deltaBar?.visible) {
    const wX = (layoutConfig.deltaBar.x / 100) * width;
    const wY = (layoutConfig.deltaBar.y / 100) * height;
    const wW = (layoutConfig.deltaBar.w / 100) * width;
    const cqw = wW / 100;

    ctx.save();

    const bestLapNum = trackMapProps.bestLapNum || 0;
    const bestLapRows = trackMapProps.bestLapRows || [];
    const hasBestLap = bestLapNum > 0 && bestLapRows.length > 0;
    const tLaps = trackMapProps.telemetryLaps || [];
    const isOutLap = tLaps.length > 0 && tel.lap === tLaps[0];
    const isInLap = tLaps.length > 1 && tel.lap === tLaps[tLaps.length - 1];

    let delta = 0;
    if (hasBestLap && tel.lap !== bestLapNum && !isOutLap && !isInLap) {
      const startDistances = trackMapProps.lapTimesStartDistances || {};
      const starts = trackMapProps.lapTimesStarts || {};
      const lapDistances = trackMapProps.lapTimesDistances || {};

      const curStartDist = startDistances[tel.lap] || 0;
      const curStartTime = starts[tel.lap] || 0;

      const elapsedDist = tel.distance - curStartDist;
      const elapsedTime = (trackMapProps.telemetryTime || 0) - curStartTime;

      const bestStartDist = startDistances[bestLapNum] || 0;
      const bestStartTime = starts[bestLapNum] || 0;

      const bestLapTotalDist = lapDistances[bestLapNum] || 0;
      const currentLapTotalDist = lapDistances[tel.lap] || 0;

      let scaledElapsedDist = elapsedDist;
      if (bestLapTotalDist > 0 && currentLapTotalDist > 0) {
        scaledElapsedDist = elapsedDist * (bestLapTotalDist / currentLapTotalDist);
        scaledElapsedDist = Math.max(0, Math.min(bestLapTotalDist, scaledElapsedDist));
      }

      let low = 0;
      let high = bestLapRows.length - 1;
      let matchIdx = -1;

      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const midDist = bestLapRows[mid].distance - bestStartDist;
        if (midDist === scaledElapsedDist) {
          matchIdx = mid;
          break;
        } else if (midDist < scaledElapsedDist) {
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }

      let bestLapTime = 0;
      if (matchIdx !== -1) {
        bestLapTime = bestLapRows[matchIdx].time - bestStartTime;
      } else {
        const idxB = Math.min(low, bestLapRows.length - 1);
        const idxA = Math.max(0, idxB - 1);
        const rowA = bestLapRows[idxA];
        const rowB = bestLapRows[idxB];

        const distA = rowA.distance - bestStartDist;
        const distB = rowB.distance - bestStartDist;

        let fraction = 0;
        if (distB !== distA) {
          fraction = Math.max(0, Math.min(1, (scaledElapsedDist - distA) / (distB - distA)));
        }

        const timeA = rowA.time - bestStartTime;
        const timeB = rowB.time - bestStartTime;
        bestLapTime = timeA + fraction * (timeB - timeA);
      }

      delta = elapsedTime - bestLapTime;
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#71717a";
    ctx.font = `900 ${3 * cqw}px ${FONT_SANS}`;
    ctx.fillText("LAP DELTA VS BEST", wX + wW / 2, wY);

    let valueStr = "0.00";
    let valColor = "#a1a1aa";
    let valGlow = "rgba(161, 161, 170, 0.2)";
    if (!hasBestLap) {
      valueStr = "--.--";
      valColor = "#71717a";
      valGlow = "transparent";
    } else if (delta < 0) {
      valueStr = delta.toFixed(2);
      valColor = "#22d3ee";
      valGlow = "rgba(34, 211, 238, 0.4)";
    } else if (delta > 0) {
      valueStr = "+" + delta.toFixed(2);
      valColor = "#f43f5e";
      valGlow = "rgba(244, 63, 94, 0.4)";
    }

    ctx.fillStyle = valColor;
    ctx.font = `900 ${9 * cqw}px ${FONT_MONO}`;
    if (valGlow !== "transparent") {
      ctx.shadowColor = valGlow;
      ctx.shadowBlur = 6 * cqw;
    }
    ctx.fillText(valueStr, wX + wW / 2, wY + 3.5 * cqw);
    ctx.shadowBlur = 0;

    const barY = wY + 15.5 * cqw;
    const barH = 3.5 * cqw;
    const barW = wW;
    const barX = wX;
    const barR = 1.75 * cqw;

    drawRoundedRect(ctx, barX, barY, barW, barH, barR);
    ctx.fillStyle = "#18181b";
    ctx.fill();
    ctx.strokeStyle = "rgba(39, 39, 42, 0.6)";
    ctx.lineWidth = Math.max(1, pxScale);
    ctx.stroke();

    ctx.fillStyle = "rgba(39, 39, 42, 0.5)";
    ctx.fillRect(barX + barW * 0.25 - 0.125 * cqw, barY, 0.25 * cqw, barH);
    ctx.fillRect(barX + barW * 0.75 - 0.125 * cqw, barY, 0.25 * cqw, barH);

    ctx.fillStyle = "rgba(63, 63, 70, 0.85)";
    ctx.fillRect(barX + barW / 2 - 0.25 * cqw, barY, 0.5 * cqw, barH);

    if (hasBestLap && delta !== 0) {
      const clampLimit = 2.0;
      const clampedDelta = Math.max(-clampLimit, Math.min(clampLimit, delta));
      const barPercent = Math.abs(clampedDelta) / clampLimit;
      const fillW = barPercent * (barW / 2);

      ctx.save();
      drawRoundedRect(ctx, barX, barY, barW, barH, barR);
      ctx.clip();

      if (delta < 0) {
        ctx.fillStyle = "#22d3ee";
        ctx.shadowColor = "#22d3ee";
        ctx.shadowBlur = 8 * pxScale;
        ctx.fillRect(barX + barW / 2 - fillW, barY, fillW, barH);
      } else {
        ctx.fillStyle = "#f43f5e";
        ctx.shadowColor = "#f43f5e";
        ctx.shadowBlur = 8 * pxScale;
        ctx.fillRect(barX + barW / 2, barY, fillW, barH);
      }
      ctx.restore();
    }

    ctx.restore();
  }

  ctx.save();
  ctx.font = `500 ${Math.round(height * 0.018)}px ${FONT_SANS}`;
  ctx.fillStyle = "rgba(255, 255, 255, 0.2)";
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  ctx.fillText("OpenRaceRender.com", width * 0.985, height * 0.02);
  ctx.restore();

  ctx.restore();
}
