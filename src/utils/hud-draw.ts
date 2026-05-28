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

export interface LayoutConfig {
  x: number;
  y: number;
  w: number;
  h: number;
  visible: boolean;
}

export interface TrackMapProps {
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
  telemetryTime: number;
  lapTimesStarts: Record<number, number>;
  lapTimesLaps: Record<number, number>;
  lapTimesStartDistances: Record<number, number>;
  lapTimesDistances: Record<number, number>;
  formatLapTime: (secs: number) => string;
  bestLapTimeStr: string;
  bestLapNum: number;
  bestLapRows: TelemetryPoint[];
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

  if (layoutConfig.speedometer?.visible) {
    const wX = (layoutConfig.speedometer.x / 100) * width;
    const wY = (layoutConfig.speedometer.y / 100) * height;
    const wW = (layoutConfig.speedometer.w / 100) * width;
    const wH = (layoutConfig.speedometer.h / 100) * height;
    const cx = wX + wW / 2;
    const cy = wY + wH / 2;
    const r = Math.min(wW, wH) * 0.35;

    ctx.beginPath();
    ctx.arc(cx, cy, r, (135 * Math.PI) / 180, (405 * Math.PI) / 180);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.lineWidth = r * 0.15;
    ctx.lineCap = "round";
    ctx.stroke();

    const clampedPct = Math.min(1, Math.max(0, tel.speed / 260));
    if (clampedPct > 0) {
      const endAngle = 135 + clampedPct * 270;
      ctx.beginPath();
      ctx.arc(cx, cy, r, (135 * Math.PI) / 180, (endAngle * Math.PI) / 180);
      ctx.strokeStyle = "#22d3ee";
      ctx.lineWidth = r * 0.15;
      ctx.lineCap = "round";
      ctx.shadowColor = "rgba(34,211,238,0.5)";
      ctx.shadowBlur = r * 0.1;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${r * 0.55}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(Math.round(tel.speed).toString(), cx, cy);

    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.font = `bold ${r * 0.15}px sans-serif`;
    ctx.fillText("KM/H", cx, cy + r * 0.35);
  }

  if (layoutConfig.rpmGauge?.visible) {
    const wX = (layoutConfig.rpmGauge.x / 100) * width;
    const wY = (layoutConfig.rpmGauge.y / 100) * height;
    const wW = (layoutConfig.rpmGauge.w / 100) * width;
    const wH = (layoutConfig.rpmGauge.h / 100) * height;
    const cx = wX + wW / 2;
    const cy = wY + wH / 2;
    const r = Math.min(wW, wH) * 0.3;
    const maxRpm = 15000;
    const clampedPct = Math.min(1, Math.max(0, tel.rpm / maxRpm));

    let arcColor = "#10b981";
    if (clampedPct > 0.85) arcColor = "#f43f5e";
    else if (clampedPct > 0.65) arcColor = "#fb923c";
    else if (clampedPct > 0.45) arcColor = "#fbbf24";

    ctx.beginPath();
    ctx.arc(cx, cy, r, (135 * Math.PI) / 180, (405 * Math.PI) / 180);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.lineWidth = r * 0.15;
    ctx.lineCap = "round";
    ctx.stroke();

    if (clampedPct > 0) {
      const endAngle = 135 + clampedPct * 270;
      ctx.beginPath();
      ctx.arc(cx, cy, r, (135 * Math.PI) / 180, (endAngle * Math.PI) / 180);
      ctx.strokeStyle = arcColor;
      ctx.lineWidth = r * 0.15;
      ctx.lineCap = "round";
      ctx.shadowColor = arcColor;
      ctx.shadowBlur = r * 0.1;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${r * 0.4}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(Math.round(tel.rpm).toString(), cx, cy);

    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.font = `bold ${r * 0.15}px sans-serif`;
    ctx.fillText("RPM", cx, cy + r * 0.3);
  }

  if (layoutConfig.gForceRadar?.visible) {
    const wX = (layoutConfig.gForceRadar.x / 100) * width;
    const wY = (layoutConfig.gForceRadar.y / 100) * height;
    const wW = (layoutConfig.gForceRadar.w / 100) * width;
    const wH = (layoutConfig.gForceRadar.h / 100) * height;
    const cx = wX + wW / 2;
    const cy = wY + wH / 2;
    const r = Math.min(wW, wH) * 0.35;
    const maxG = 1.6;

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `bold ${r * 0.15}px monospace`;
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillText("LAT: ", cx - r * 0.4, cy - r - r * 0.2);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillText(`${tel.latAcc.toFixed(2)}G`, cx - r * 0.1, cy - r - r * 0.2);

    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillText("LON: ", cx + r * 0.4, cy - r - r * 0.2);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillText(`${tel.lonAcc.toFixed(2)}G`, cx + r * 0.7, cy - r - r * 0.2);

    ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
    ctx.lineWidth = Math.max(1, r * 0.015);
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 2 * Math.PI);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
    ctx.beginPath();
    ctx.arc(cx, cy, r * (1.0 / maxG), 0, 2 * Math.PI);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
    ctx.setLineDash([2, 2]);
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
      const size = r * 0.03 + opacity * (r * 0.05);
      ctx.beginPath();
      ctx.arc(coords.x, coords.y, size, 0, 2 * Math.PI);
      ctx.fillStyle = `rgba(244, 63, 94, ${opacity * 0.4})`;
      ctx.fill();
    });

    const currentCoords = getGCoords(tel.latAcc, tel.lonAcc);
    ctx.beginPath();
    ctx.arc(currentCoords.x, currentCoords.y, r * 0.1, 0, 2 * Math.PI);
    ctx.fillStyle = "#f43f5e";
    ctx.shadowColor = "rgba(244, 63, 94, 0.8)";
    ctx.shadowBlur = r * 0.1;
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.beginPath();
    ctx.arc(currentCoords.x, currentCoords.y, r * 0.03, 0, 2 * Math.PI);
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

    if (tel.lat !== 0 && tel.lon !== 0) {
      const ptX =
        trackMapProps.tPadding +
        (tel.lon - trackMapProps.trackMinLon) * trackMapProps.trackScale +
        (trackMapProps.tSvgW - trackMapProps.tPadding * 2 - trackMapProps.trackLonSpan * trackMapProps.trackScale) / 2;
      const ptY =
        trackMapProps.tPadding +
        (trackMapProps.trackMaxLat - tel.lat) * trackMapProps.trackScale +
        (trackMapProps.tSvgH - trackMapProps.tPadding * 2 - trackMapProps.trackLatSpan * trackMapProps.trackScale) / 2;

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
    const wH = 34 * cqw;

    ctx.save();

    drawRoundedRect(ctx, wX, wY, wW, wH, 6 * cqw);
    ctx.fillStyle = "rgba(9, 9, 11, 0.7)";
    ctx.fill();

    ctx.save();
    drawRoundedRect(ctx, wX, wY, wW, wH, 6 * cqw);
    ctx.clip();
    ctx.fillStyle = "#22d3ee";
    ctx.fillRect(wX, wY, 1.5 * cqw, wH);
    ctx.restore();

    ctx.strokeStyle = "rgba(39, 39, 42, 0.8)";
    ctx.lineWidth = 1;
    drawRoundedRect(ctx, wX, wY, wW, wH, 6 * cqw);
    ctx.stroke();

    const elapsed = Math.max(0, (trackMapProps.telemetryTime || 0) - (trackMapProps.lapTimesStarts?.[tel.lap] || 0));
    const curTimeStr = trackMapProps.formatLapTime(elapsed);
    const bestTimeStr = trackMapProps.bestLapTimeStr || "0:00.00";

    ctx.textBaseline = "top";

    ctx.fillStyle = "#22d3ee";
    ctx.font = `900 ${4.5 * cqw}px sans-serif`;
    ctx.textAlign = "left";
    ctx.fillText(`LAP ${tel.lap}`, wX + 5 * cqw, wY + 5 * cqw);

    let rightY = wY + 5 * cqw;

    if (bestTimeStr !== "0:00.00") {
      ctx.textAlign = "right";
      const bestLabel = trackMapProps.bestLapNum > 0 ? `BEST (L${trackMapProps.bestLapNum}):` : "BEST:";

      ctx.fillStyle = "#10b981";
      ctx.font = `900 ${4.5 * cqw}px monospace`;
      const timeWidth = ctx.measureText(bestTimeStr).width;

      ctx.fillText(bestTimeStr, wX + wW - 5 * cqw, rightY);

      ctx.fillStyle = "#71717a";
      ctx.font = `900 ${3.5 * cqw}px sans-serif`;
      ctx.fillText(bestLabel, wX + wW - 5 * cqw - timeWidth - 1.5 * cqw, rightY + 0.5 * cqw);

      rightY += 4.5 * cqw + 0.5 * cqw;
    }

    const prevDuration = trackMapProps.lapTimesLaps?.[tel.lap - 1] || 0;
    if (prevDuration > 0) {
      const lastTimeStr = trackMapProps.formatLapTime(prevDuration);
      ctx.textAlign = "right";

      ctx.fillStyle = "#d4d4d8";
      ctx.font = `bold ${4.5 * cqw}px monospace`;
      const timeWidth = ctx.measureText(lastTimeStr).width;

      ctx.fillText(lastTimeStr, wX + wW - 5 * cqw, rightY);

      ctx.fillStyle = "#71717a";
      ctx.font = `900 ${3.5 * cqw}px sans-serif`;
      ctx.fillText("LAST:", wX + wW - 5 * cqw - timeWidth - 1.5 * cqw, rightY + 0.5 * cqw);
    }

    ctx.fillStyle = "rgba(161, 161, 170, 1)";
    ctx.font = `bold ${3.5 * cqw}px sans-serif`;
    ctx.textAlign = "left";
    ctx.fillText("CURRENT TIME", wX + 5 * cqw, wY + 12 * cqw);

    ctx.fillStyle = "#f4f4f5";
    ctx.font = `900 ${12 * cqw}px monospace`;
    ctx.fillText(curTimeStr, wX + 5 * cqw, wY + 16 * cqw);

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

    let delta = 0;
    if (hasBestLap && tel.lap !== bestLapNum) {
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

      void bestStartDist;
      void bestStartTime;
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#71717a";
    ctx.font = `900 ${3 * cqw}px sans-serif`;
    ctx.fillText("LAP DELTA", wX + wW / 2, wY + 4 * cqw);

    let valueStr = "0.00";
    let valColor = "#a1a1aa";
    if (!hasBestLap) {
      valueStr = "--.--";
      valColor = "#71717a";
    } else if (delta < 0) {
      valueStr = delta.toFixed(2);
      valColor = "#22d3ee";
    } else if (delta > 0) {
      valueStr = "+" + delta.toFixed(2);
      valColor = "#f43f5e";
    }

    ctx.fillStyle = valColor;
    ctx.font = `900 ${7 * cqw}px monospace`;
    ctx.fillText(valueStr, wX + wW / 2, wY + 7.5 * cqw);

    const barY = wY + 16 * cqw;
    const barH = 3 * cqw;
    const barW = wW - 10 * cqw;
    const barX = wX + 5 * cqw;

    drawRoundedRect(ctx, barX, barY, barW, barH, 1.5 * cqw);
    ctx.fillStyle = "#18181b";
    ctx.fill();
    ctx.strokeStyle = "rgba(39, 39, 42, 0.6)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "rgba(113, 113, 122, 0.8)";
    ctx.fillRect(barX + barW / 2 - 0.25 * cqw, barY, 0.5 * cqw, barH);

    if (hasBestLap && delta !== 0) {
      const clampLimit = 2.0;
      const clampedDelta = Math.max(-clampLimit, Math.min(clampLimit, delta));
      const barPercent = Math.abs(clampedDelta) / clampLimit;
      const fillW = barPercent * (barW / 2);

      ctx.save();
      drawRoundedRect(ctx, barX, barY, barW, barH, 1.5 * cqw);
      ctx.clip();

      if (delta < 0) {
        ctx.fillStyle = "#22d3ee";
        ctx.shadowColor = "#22d3ee";
        ctx.shadowBlur = 6;
        ctx.fillRect(barX + barW / 2 - fillW, barY, fillW, barH);
      } else {
        ctx.fillStyle = "#f43f5e";
        ctx.shadowColor = "#f43f5e";
        ctx.shadowBlur = 6;
        ctx.fillRect(barX + barW / 2, barY, fillW, barH);
      }
      ctx.restore();
    }

    ctx.restore();
  }

  ctx.restore();
}
