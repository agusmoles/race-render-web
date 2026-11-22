"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  Compass,
  Crosshair,
  Eye,
  Flame,
  Maximize2,
  Mountain,
  RotateCcw,
} from "lucide-react";
import type {
  ComparisonSnapshot,
  LapPoint3D,
  ProcessedLap3D,
} from "@/utils/lap-comparison";

type CameraMode = "orbit" | "chase-a" | "chase-b" | "top";
type LineColorMode = "lap" | "speed-delta";

interface Track3DViewerProps {
  lapA: ProcessedLap3D;
  lapB: ProcessedLap3D;
  snapshot: ComparisonSnapshot;
  labelA: string;
  labelB: string;
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface ScreenPt {
  x: number;
  y: number;
  cz: number;
}

interface CameraState {
  yaw: number;
  pitch: number;
  distance: number;
  targetX: number;
  targetY: number;
  targetZ: number;
}

interface CameraBasis {
  pos: Vec3;
  right: Vec3;
  up: Vec3;
  forward: Vec3;
  focalLen: number;
  halfW: number;
  halfH: number;
}

interface TrackStation {
  x: number;
  y: number;
  z: number;
  rightX: number;
  rightZ: number;
  curvature: number;
  normDist: number;
}

interface TrackMeta {
  centerX: number;
  centerY: number;
  centerZ: number;
  minY: number;
  radius: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  key: string;
}

interface LapBRenderPoint {
  x: number;
  y: number;
  z: number;
  normDist: number;
  speedDiff: number;
}

interface Poly3D {
  verts: Vec3[];
  fill: string;
  stroke?: string;
  lineWidth?: number;
}

interface RenderParams {
  lapA: ProcessedLap3D;
  lapB: ProcessedLap3D;
  snapshot: ComparisonSnapshot;
  labelA: string;
  labelB: string;
  cameraMode: CameraMode;
  followMidpoint: boolean;
  colorMode: LineColorMode;
  trackWidth: number;
  elevationScale: number;
  showElevationColumns: boolean;
  trackMeta: TrackMeta;
  trackStations: TrackStation[];
  lapARenderPath: LapPoint3D[];
  lapBRenderPath: LapBRenderPoint[];
}

const NEAR_PLANE = 0.45;
const ELEVATION_OPTIONS = [1, 3, 5] as const;

function normalizeVec3(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len < 1e-9) return { x: 0, y: 0, z: 1 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function crossVec3(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dotVec3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function toCamSpace(p: Vec3, basis: CameraBasis): Vec3 {
  const dx = p.x - basis.pos.x;
  const dy = p.y - basis.pos.y;
  const dz = p.z - basis.pos.z;
  return {
    x: dx * basis.right.x + dy * basis.right.y + dz * basis.right.z,
    y: dx * basis.up.x + dy * basis.up.y + dz * basis.up.z,
    z: dx * basis.forward.x + dy * basis.forward.y + dz * basis.forward.z,
  };
}

function projectCamPt(c: Vec3, basis: CameraBasis): ScreenPt {
  const invZ = basis.focalLen / c.z;
  return {
    x: basis.halfW + c.x * invZ,
    y: basis.halfH - c.y * invZ,
    cz: c.z,
  };
}

function projectWorldPt(p: Vec3, basis: CameraBasis): ScreenPt | null {
  const c = toCamSpace(p, basis);
  if (c.z <= NEAR_PLANE) return null;
  return projectCamPt(c, basis);
}

function clipSegmentToScreen(
  a: Vec3,
  b: Vec3,
  basis: CameraBasis,
): [ScreenPt, ScreenPt] | null {
  let ca = toCamSpace(a, basis);
  let cb = toCamSpace(b, basis);

  if (ca.z <= NEAR_PLANE && cb.z <= NEAR_PLANE) return null;

  if (ca.z <= NEAR_PLANE) {
    const t = (NEAR_PLANE - ca.z) / (cb.z - ca.z);
    ca = {
      x: ca.x + (cb.x - ca.x) * t,
      y: ca.y + (cb.y - ca.y) * t,
      z: NEAR_PLANE,
    };
  } else if (cb.z <= NEAR_PLANE) {
    const t = (NEAR_PLANE - cb.z) / (ca.z - cb.z);
    cb = {
      x: cb.x + (ca.x - cb.x) * t,
      y: cb.y + (ca.y - cb.y) * t,
      z: NEAR_PLANE,
    };
  }

  return [projectCamPt(ca, basis), projectCamPt(cb, basis)];
}

function clipPolygonToScreen(
  verts: Vec3[],
  basis: CameraBasis,
): { pts: ScreenPt[]; avgDepth: number } | null {
  const camVerts = verts.map((v) => toCamSpace(v, basis));
  const clipped: Vec3[] = [];
  const count = camVerts.length;

  for (let i = 0; i < count; i++) {
    const curr = camVerts[i];
    const next = camVerts[(i + 1) % count];
    const currIn = curr.z >= NEAR_PLANE;
    const nextIn = next.z >= NEAR_PLANE;

    if (currIn && nextIn) {
      clipped.push(next);
    } else if (currIn && !nextIn) {
      const t = (NEAR_PLANE - curr.z) / (next.z - curr.z);
      clipped.push({
        x: curr.x + (next.x - curr.x) * t,
        y: curr.y + (next.y - curr.y) * t,
        z: NEAR_PLANE,
      });
    } else if (!currIn && nextIn) {
      const t = (NEAR_PLANE - curr.z) / (next.z - curr.z);
      clipped.push({
        x: curr.x + (next.x - curr.x) * t,
        y: curr.y + (next.y - curr.y) * t,
        z: NEAR_PLANE,
      });
      clipped.push(next);
    }
  }

  if (clipped.length < 3) return null;

  let depthSum = 0;
  const pts: ScreenPt[] = new Array(clipped.length);
  for (let i = 0; i < clipped.length; i++) {
    depthSum += clipped[i].z;
    pts[i] = projectCamPt(clipped[i], basis);
  }

  return { pts, avgDepth: depthSum / clipped.length };
}

function drawScreenPoly(
  ctx: CanvasRenderingContext2D,
  pts: ScreenPt[],
  fill: string,
  stroke?: string,
  lineWidth = 1,
) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i].x, pts[i].y);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

function sampleLapSpeedAtNormDist(lap: ProcessedLap3D, normDist: number): number {
  const pts = lap.points;
  if (pts.length === 0) return 0;
  if (normDist <= pts[0].normDist) return pts[0].speed;
  if (normDist >= pts[pts.length - 1].normDist) return pts[pts.length - 1].speed;

  let lo = 0;
  let hi = pts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].normDist < normDist) lo = mid + 1;
    else hi = mid - 1;
  }
  const idxB = Math.min(pts.length - 1, lo);
  const idxA = Math.max(0, idxB - 1);
  const a = pts[idxA];
  const b = pts[idxB];
  const span = b.normDist - a.normDist;
  const t = span > 1e-9 ? (normDist - a.normDist) / span : 0;
  return a.speed + (b.speed - a.speed) * t;
}

function buildKartPolys(
  pt: LapPoint3D,
  elevScale: number,
  primaryHex: string,
  darkHex: string,
): Poly3D[] {
  const yaw = pt.headingRad;
  const pitch = Math.max(-0.25, Math.min(0.25, -pt.slopeRad));
  const roll = Math.max(-0.08, Math.min(0.08, pt.latAcc * 0.035));

  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);
  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);
  const cosR = Math.cos(roll);
  const sinR = Math.sin(roll);

  const worldOriginY = pt.y * elevScale;

  const xform = (lx: number, ly: number, lz: number): Vec3 => {
    const rx = lx * cosR - ly * sinR;
    const ry0 = lx * sinR + ly * cosR;
    const rz0 = lz;

    const py = ry0 * cosP - rz0 * sinP;
    const pz = ry0 * sinP + rz0 * cosP;

    return {
      x: pt.x + rx * cosY + pz * sinY,
      y: worldOriginY + py,
      z: pt.z - rx * sinY + pz * cosY,
    };
  };

  const makeBox = (
    cx: number,
    cy: number,
    cz: number,
    hx: number,
    hy: number,
    hz: number,
    fillTop: string,
    fillSide: string,
    stroke: string,
    steerRad = 0,
  ): Poly3D[] => {
    const cs = Math.cos(steerRad);
    const sn = Math.sin(steerRad);
    const localPt = (dx: number, dy: number, dz: number): Vec3 => {
      const rx = dx * cs + dz * sn;
      const rz = -dx * sn + dz * cs;
      return xform(cx + rx, cy + dy, cz + rz);
    };

    const p000 = localPt(-hx, -hy, -hz);
    const p100 = localPt(hx, -hy, -hz);
    const p101 = localPt(hx, -hy, hz);
    const p001 = localPt(-hx, -hy, hz);
    const p010 = localPt(-hx, hy, -hz);
    const p110 = localPt(hx, hy, -hz);
    const p111 = localPt(hx, hy, hz);
    const p011 = localPt(-hx, hy, hz);

    return [
      { verts: [p010, p110, p111, p011], fill: fillTop, stroke, lineWidth: 1 },
      { verts: [p001, p101, p111, p011], fill: fillSide, stroke, lineWidth: 1 },
      { verts: [p000, p100, p110, p010], fill: fillSide, stroke, lineWidth: 1 },
      { verts: [p100, p101, p111, p110], fill: fillSide, stroke, lineWidth: 1 },
      { verts: [p000, p001, p011, p010], fill: fillSide, stroke, lineWidth: 1 },
    ];
  };

  const polys: Poly3D[] = [];
  const steerRad = Math.max(-0.45, Math.min(0.45, (pt.steeringDeg * Math.PI) / 180));

  polys.push(...makeBox(0, 0.14, 0.05, 0.36, 0.06, 0.95, "#27272a", "#18181b", "#52525b"));
  polys.push(...makeBox(-0.48, 0.22, -0.05, 0.14, 0.11, 0.48, primaryHex, darkHex, "#09090b"));
  polys.push(...makeBox(0.48, 0.22, -0.05, 0.14, 0.11, 0.48, primaryHex, darkHex, "#09090b"));
  polys.push(...makeBox(0, 0.26, 0.88, 0.38, 0.09, 0.18, primaryHex, darkHex, "#09090b"));
  polys.push(...makeBox(0, 0.46, 0.56, 0.15, 0.16, 0.24, primaryHex, darkHex, "#09090b"));
  polys.push(...makeBox(0, 0.22, -0.92, 0.54, 0.09, 0.1, "#3f3f46", "#18181b", "#09090b"));
  polys.push(...makeBox(0.28, 0.34, -0.45, 0.14, 0.14, 0.18, "#71717a", "#3f3f46", "#18181b"));

  polys.push(...makeBox(-0.56, 0.18, 0.62, 0.11, 0.18, 0.19, "#18181b", "#09090b", "#3f3f46", steerRad));
  polys.push(...makeBox(0.56, 0.18, 0.62, 0.11, 0.18, 0.19, "#18181b", "#09090b", "#3f3f46", steerRad));
  polys.push(...makeBox(-0.62, 0.2, -0.64, 0.14, 0.2, 0.21, "#18181b", "#09090b", "#3f3f46"));
  polys.push(...makeBox(0.62, 0.2, -0.64, 0.14, 0.2, 0.21, "#18181b", "#09090b", "#3f3f46"));

  polys.push(...makeBox(0, 0.52, -0.14, 0.22, 0.22, 0.18, "#27272a", "#18181b", "#52525b"));
  polys.push(...makeBox(0, 0.88, -0.1, 0.16, 0.16, 0.17, primaryHex, darkHex, "#ffffff"));

  return polys;
}

function drawTrack3DScene(
  ctx: CanvasRenderingContext2D,
  viewport: { width: number; height: number; dpr: number },
  cam: CameraState,
  params: RenderParams,
) {
  const { width, height, dpr } = viewport;
  const {
    snapshot,
    labelA,
    labelB,
    cameraMode,
    followMidpoint,
    colorMode,
    trackWidth,
    elevationScale,
    showElevationColumns,
    trackMeta,
    trackStations,
    lapARenderPath,
    lapBRenderPath,
  } = params;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
  bgGrad.addColorStop(0, "#050507");
  bgGrad.addColorStop(0.55, "#09090b");
  bgGrad.addColorStop(1, "#111116");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  let camPos: Vec3;
  let camTarget: Vec3;

  if (cameraMode === "chase-a" || cameraMode === "chase-b") {
    const focusPt = cameraMode === "chase-a" ? snapshot.pointA : snapshot.pointB;
    const chaseDist = 11.5;
    const chaseHeight = 4.2;
    const lookAhead = 12;
    const sinH = Math.sin(focusPt.headingRad);
    const cosH = Math.cos(focusPt.headingRad);
    const ptY = focusPt.y * elevationScale;

    camPos = {
      x: focusPt.x - sinH * chaseDist,
      y: ptY + chaseHeight,
      z: focusPt.z - cosH * chaseDist,
    };
    camTarget = {
      x: focusPt.x + sinH * lookAhead,
      y: ptY + 1.1,
      z: focusPt.z + cosH * lookAhead,
    };
  } else {
    if (cameraMode === "orbit" && followMidpoint) {
      cam.targetX = (snapshot.pointA.x + snapshot.pointB.x) * 0.5;
      cam.targetY =
        (snapshot.pointA.y + snapshot.pointB.y) * 0.5 * elevationScale;
      cam.targetZ = (snapshot.pointA.z + snapshot.pointB.z) * 0.5;
    }

    const pitch =
      cameraMode === "top" ? 1.48 : Math.max(0.08, Math.min(1.48, cam.pitch));
    camTarget = {
      x: cam.targetX,
      y: cam.targetY,
      z: cam.targetZ,
    };
    camPos = {
      x: camTarget.x + cam.distance * Math.cos(pitch) * Math.sin(cam.yaw),
      y: camTarget.y + cam.distance * Math.sin(pitch),
      z: camTarget.z + cam.distance * Math.cos(pitch) * Math.cos(cam.yaw),
    };
  }

  const worldUp: Vec3 = { x: 0, y: 1, z: 0 };
  const forward = normalizeVec3({
    x: camTarget.x - camPos.x,
    y: camTarget.y - camPos.y,
    z: camTarget.z - camPos.z,
  });
  const right = normalizeVec3(crossVec3(worldUp, forward));
  const up = normalizeVec3(crossVec3(forward, right));

  const fovRad =
    (cameraMode === "chase-a" || cameraMode === "chase-b" ? 58 : 48) *
    (Math.PI / 180);
  const focalLen = (height * 0.5) / Math.tan(fovRad * 0.5);

  const basis: CameraBasis = {
    pos: camPos,
    right,
    up,
    forward,
    focalLen,
    halfW: width * 0.5,
    halfH: height * 0.5,
  };

  const gridY = trackMeta.minY * elevationScale - 0.6;
  const gridStep = trackMeta.radius > 220 ? 50 : 25;
  const minGX = Math.floor((trackMeta.minX - 60) / gridStep) * gridStep;
  const maxGX = Math.ceil((trackMeta.maxX + 60) / gridStep) * gridStep;
  const minGZ = Math.floor((trackMeta.minZ - 60) / gridStep) * gridStep;
  const maxGZ = Math.ceil((trackMeta.maxZ + 60) / gridStep) * gridStep;

  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(63, 63, 70, 0.28)";
  ctx.beginPath();
  for (let gx = minGX; gx <= maxGX; gx += gridStep) {
    const seg = clipSegmentToScreen(
      { x: gx, y: gridY, z: minGZ },
      { x: gx, y: gridY, z: maxGZ },
      basis,
    );
    if (seg) {
      ctx.moveTo(seg[0].x, seg[0].y);
      ctx.lineTo(seg[1].x, seg[1].y);
    }
  }
  for (let gz = minGZ; gz <= maxGZ; gz += gridStep) {
    const seg = clipSegmentToScreen(
      { x: minGX, y: gridY, z: gz },
      { x: maxGX, y: gridY, z: gz },
      basis,
    );
    if (seg) {
      ctx.moveTo(seg[0].x, seg[0].y);
      ctx.lineTo(seg[1].x, seg[1].y);
    }
  }
  ctx.stroke();

  const halfW = trackWidth * 0.5;
  const kerbWidth = 0.85;
  const ribbonItems: {
    pts: ScreenPt[];
    depth: number;
    fill: string;
    stroke?: string;
  }[] = [];

  for (let i = 0; i < trackStations.length - 1; i++) {
    const s0 = trackStations[i];
    const s1 = trackStations[i + 1];
    const y0 = s0.y * elevationScale;
    const y1 = s1.y * elevationScale;

    const l0: Vec3 = {
      x: s0.x - s0.rightX * halfW,
      y: y0,
      z: s0.z - s0.rightZ * halfW,
    };
    const r0: Vec3 = {
      x: s0.x + s0.rightX * halfW,
      y: y0,
      z: s0.z + s0.rightZ * halfW,
    };
    const r1: Vec3 = {
      x: s1.x + s1.rightX * halfW,
      y: y1,
      z: s1.z + s1.rightZ * halfW,
    };
    const l1: Vec3 = {
      x: s1.x - s1.rightX * halfW,
      y: y1,
      z: s1.z - s1.rightZ * halfW,
    };

    const clipped = clipPolygonToScreen([l0, r0, r1, l1], basis);
    if (clipped) {
      const slopeShade = Math.max(-14, Math.min(14, Math.round((y1 - y0) * 6)));
      const baseL = 24 + slopeShade;
      ribbonItems.push({
        pts: clipped.pts,
        depth: clipped.avgDepth,
        fill: `rgb(${baseL}, ${baseL + 1}, ${baseL + 5})`,
        stroke: "rgba(63, 63, 70, 0.25)",
      });
    }

    if (showElevationColumns && i % 4 === 0) {
      const colSeg = clipSegmentToScreen(
        { x: s0.x, y: y0, z: s0.z },
        { x: s0.x, y: gridY, z: s0.z },
        basis,
      );
      if (colSeg) {
        ctx.strokeStyle = "rgba(82, 82, 91, 0.35)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(colSeg[0].x, colSeg[0].y);
        ctx.lineTo(colSeg[1].x, colSeg[1].y);
        ctx.stroke();
      }
    }

    if (s0.curvature > 0.025) {
      const kerbColor =
        i % 2 === 0 ? "rgba(244, 63, 94, 0.72)" : "rgba(244, 244, 245, 0.75)";
      for (const side of [-1, 1]) {
        const innerOff = halfW * side;
        const outerOff = (halfW + kerbWidth) * side;
        const k0: Vec3 = {
          x: s0.x + s0.rightX * innerOff,
          y: y0 + 0.03,
          z: s0.z + s0.rightZ * innerOff,
        };
        const k1: Vec3 = {
          x: s0.x + s0.rightX * outerOff,
          y: y0 + 0.05,
          z: s0.z + s0.rightZ * outerOff,
        };
        const k2: Vec3 = {
          x: s1.x + s1.rightX * outerOff,
          y: y1 + 0.05,
          z: s1.z + s1.rightZ * outerOff,
        };
        const k3: Vec3 = {
          x: s1.x + s1.rightX * innerOff,
          y: y1 + 0.03,
          z: s1.z + s1.rightZ * innerOff,
        };
        const kClip = clipPolygonToScreen([k0, k1, k2, k3], basis);
        if (kClip) {
          ribbonItems.push({
            pts: kClip.pts,
            depth: kClip.avgDepth - 0.05,
            fill: kerbColor,
          });
        }
      }
    }
  }

  ribbonItems.sort((a, b) => b.depth - a.depth);
  for (const item of ribbonItems) {
    drawScreenPoly(ctx, item.pts, item.fill, item.stroke, 0.8);
  }

  for (const side of [-1, 1]) {
    ctx.beginPath();
    for (let i = 0; i < trackStations.length - 1; i++) {
      const s0 = trackStations[i];
      const s1 = trackStations[i + 1];
      const seg = clipSegmentToScreen(
        {
          x: s0.x + s0.rightX * halfW * side,
          y: s0.y * elevationScale + 0.02,
          z: s0.z + s0.rightZ * halfW * side,
        },
        {
          x: s1.x + s1.rightX * halfW * side,
          y: s1.y * elevationScale + 0.02,
          z: s1.z + s1.rightZ * halfW * side,
        },
        basis,
      );
      if (seg) {
        ctx.moveTo(seg[0].x, seg[0].y);
        ctx.lineTo(seg[1].x, seg[1].y);
      }
    }
    ctx.strokeStyle = "rgba(161, 161, 170, 0.45)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  if (trackStations.length > 0) {
    const sf = trackStations[0];
    const sfY = sf.y * elevationScale;
    const postL: Vec3 = {
      x: sf.x - sf.rightX * (halfW + 0.4),
      y: sfY,
      z: sf.z - sf.rightZ * (halfW + 0.4),
    };
    const postR: Vec3 = {
      x: sf.x + sf.rightX * (halfW + 0.4),
      y: sfY,
      z: sf.z + sf.rightZ * (halfW + 0.4),
    };
    const gantryH = 3.2;

    const leftPole = clipSegmentToScreen(
      postL,
      { ...postL, y: sfY + gantryH },
      basis,
    );
    const rightPole = clipSegmentToScreen(
      postR,
      { ...postR, y: sfY + gantryH },
      basis,
    );
    const sfLine = clipSegmentToScreen(
      { x: sf.x - sf.rightX * halfW, y: sfY + 0.04, z: sf.z - sf.rightZ * halfW },
      { x: sf.x + sf.rightX * halfW, y: sfY + 0.04, z: sf.z + sf.rightZ * halfW },
      basis,
    );
    const banner = clipPolygonToScreen(
      [
        { ...postL, y: sfY + gantryH - 0.55 },
        { ...postR, y: sfY + gantryH - 0.55 },
        { ...postR, y: sfY + gantryH },
        { ...postL, y: sfY + gantryH },
      ],
      basis,
    );

    if (sfLine) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(sfLine[0].x, sfLine[0].y);
      ctx.lineTo(sfLine[1].x, sfLine[1].y);
      ctx.stroke();
    }
    ctx.strokeStyle = "#a1a1aa";
    ctx.lineWidth = 2.5;
    for (const pole of [leftPole, rightPole]) {
      if (pole) {
        ctx.beginPath();
        ctx.moveTo(pole[0].x, pole[0].y);
        ctx.lineTo(pole[1].x, pole[1].y);
        ctx.stroke();
      }
    }
    if (banner) {
      drawScreenPoly(ctx, banner.pts, "rgba(24, 24, 27, 0.9)", "#e4e4e7", 1.2);
    }
  }

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (let i = 0; i < lapARenderPath.length - 1; i++) {
    const p0 = lapARenderPath[i];
    const p1 = lapARenderPath[i + 1];
    const seg = clipSegmentToScreen(
      { x: p0.x, y: p0.y * elevationScale + 0.08, z: p0.z },
      { x: p1.x, y: p1.y * elevationScale + 0.08, z: p1.z },
      basis,
    );
    if (seg) {
      const isTail =
        p1.normDist <= snapshot.pointA.normDist &&
        p1.normDist >= snapshot.pointA.normDist - 0.06;
      ctx.strokeStyle = isTail
        ? "rgba(34, 211, 238, 0.95)"
        : "rgba(34, 211, 238, 0.45)";
      ctx.lineWidth = isTail ? 3.8 : 2;
      ctx.beginPath();
      ctx.moveTo(seg[0].x, seg[0].y);
      ctx.lineTo(seg[1].x, seg[1].y);
      ctx.stroke();
    }
  }

  for (let i = 0; i < lapBRenderPath.length - 1; i++) {
    const p0 = lapBRenderPath[i];
    const p1 = lapBRenderPath[i + 1];
    const seg = clipSegmentToScreen(
      { x: p0.x, y: p0.y * elevationScale + 0.11, z: p0.z },
      { x: p1.x, y: p1.y * elevationScale + 0.11, z: p1.z },
      basis,
    );
    if (seg) {
      const isTail =
        p1.normDist <= snapshot.pointB.normDist &&
        p1.normDist >= snapshot.pointB.normDist - 0.06;
      let stroke = isTail
        ? "rgba(244, 63, 94, 0.98)"
        : "rgba(244, 63, 94, 0.65)";

      if (colorMode === "speed-delta") {
        if (p1.speedDiff > 1.2) {
          stroke = isTail ? "rgba(16, 185, 129, 0.98)" : "rgba(16, 185, 129, 0.78)";
        } else if (p1.speedDiff < -1.2) {
          stroke = isTail ? "rgba(244, 63, 94, 0.98)" : "rgba(244, 63, 94, 0.78)";
        } else {
          stroke = isTail ? "rgba(250, 204, 21, 0.95)" : "rgba(250, 204, 21, 0.7)";
        }
      }

      ctx.strokeStyle = stroke;
      ctx.lineWidth = isTail ? 3.8 : 2.3;
      ctx.beginPath();
      ctx.moveTo(seg[0].x, seg[0].y);
      ctx.lineTo(seg[1].x, seg[1].y);
      ctx.stroke();
    }
  }

  const linkSeg = clipSegmentToScreen(
    {
      x: snapshot.pointA.x,
      y: snapshot.pointA.y * elevationScale + 0.35,
      z: snapshot.pointA.z,
    },
    {
      x: snapshot.pointB.x,
      y: snapshot.pointB.y * elevationScale + 0.35,
      z: snapshot.pointB.z,
    },
    basis,
  );
  if (linkSeg) {
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = "rgba(244, 244, 245, 0.55)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(linkSeg[0].x, linkSeg[0].y);
    ctx.lineTo(linkSeg[1].x, linkSeg[1].y);
    ctx.stroke();
    ctx.restore();
  }

  const kartADepth = dotVec3(
    {
      x: snapshot.pointA.x - camPos.x,
      y: snapshot.pointA.y * elevationScale - camPos.y,
      z: snapshot.pointA.z - camPos.z,
    },
    forward,
  );
  const kartBDepth = dotVec3(
    {
      x: snapshot.pointB.x - camPos.x,
      y: snapshot.pointB.y * elevationScale - camPos.y,
      z: snapshot.pointB.z - camPos.z,
    },
    forward,
  );

  const kartItems = [
    {
      depth: kartADepth,
      pt: snapshot.pointA,
      primary: "#22d3ee",
      dark: "#0891b2",
      tag: `A • ${Math.round(snapshot.pointA.speed)} km/h`,
      subTag: labelA,
    },
    {
      depth: kartBDepth,
      pt: snapshot.pointB,
      primary: "#f43f5e",
      dark: "#be123c",
      tag: `B • ${Math.round(snapshot.pointB.speed)} km/h`,
      subTag: `${labelB} (${snapshot.timeDelta >= 0 ? "+" : ""}${snapshot.timeDelta.toFixed(3)}s)`,
    },
  ].sort((a, b) => b.depth - a.depth);

  for (const kart of kartItems) {
    const polys = buildKartPolys(kart.pt, elevationScale, kart.primary, kart.dark);
    const projectedPolys: {
      pts: ScreenPt[];
      avgDepth: number;
      fill: string;
      stroke?: string;
      lineWidth?: number;
    }[] = [];

    for (const poly of polys) {
      const res = clipPolygonToScreen(poly.verts, basis);
      if (res) {
        projectedPolys.push({
          pts: res.pts,
          avgDepth: res.avgDepth,
          fill: poly.fill,
          stroke: poly.stroke,
          lineWidth: poly.lineWidth,
        });
      }
    }

    projectedPolys.sort((a, b) => b.avgDepth - a.avgDepth);
    for (const p of projectedPolys) {
      drawScreenPoly(ctx, p.pts, p.fill, p.stroke, p.lineWidth);
    }

    const tagWorld: Vec3 = {
      x: kart.pt.x,
      y: kart.pt.y * elevationScale + 1.45,
      z: kart.pt.z,
    };
    const tagScreen = projectWorldPt(tagWorld, basis);
    if (tagScreen && tagScreen.x > -100 && tagScreen.x < width + 100) {
      ctx.font = "700 10px Inter, sans-serif";
      const mainW = ctx.measureText(kart.tag).width;
      ctx.font = "700 9px Orbitron, monospace";
      const subW = ctx.measureText(kart.subTag).width;
      const boxW = Math.max(mainW, subW) + 18;
      const boxH = 32;
      const bx = tagScreen.x - boxW * 0.5;
      const by = tagScreen.y - boxH - 8;

      ctx.strokeStyle = kart.primary;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(tagScreen.x, tagScreen.y + 4);
      ctx.lineTo(tagScreen.x, by + boxH);
      ctx.stroke();

      ctx.fillStyle = "rgba(9, 9, 11, 0.88)";
      ctx.strokeStyle = kart.primary;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.roundRect(bx, by, boxW, boxH, 7);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "#f4f4f5";
      ctx.font = "700 10px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(kart.tag, tagScreen.x, by + 13);

      ctx.fillStyle = kart.primary;
      ctx.font = "700 9px Orbitron, monospace";
      ctx.fillText(kart.subTag, tagScreen.x, by + 25);
    }
  }

  const compX = width - 38;
  const compY = height - 38;
  const northDx = dotVec3({ x: 0, y: 0, z: 1 }, right);
  const northDy = -dotVec3({ x: 0, y: 0, z: 1 }, up);
  const compLen = Math.hypot(northDx, northDy) || 1;
  const nx = (northDx / compLen) * 14;
  const ny = (northDy / compLen) * 14;

  ctx.fillStyle = "rgba(9, 9, 11, 0.78)";
  ctx.strokeStyle = "rgba(63, 63, 70, 0.8)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(compX, compY, 20, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = "#22d3ee";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(compX, compY);
  ctx.lineTo(compX + nx, compY + ny);
  ctx.stroke();

  ctx.fillStyle = "#22d3ee";
  ctx.font = "900 9px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("N", compX + nx * 1.35, compY + ny * 1.35);
  ctx.textBaseline = "alphabetic";
}

export default function Track3DViewer({
  lapA,
  lapB,
  snapshot,
  labelA,
  labelB,
}: Track3DViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [cameraMode, setCameraMode] = useState<CameraMode>("orbit");
  const [followMidpoint, setFollowMidpoint] = useState(false);
  const [colorMode, setColorMode] = useState<LineColorMode>("lap");
  const [trackWidth, setTrackWidth] = useState(9);
  const [elevationScale, setElevationScale] = useState<(typeof ELEVATION_OPTIONS)[number]>(3);
  const [showElevationColumns, setShowElevationColumns] = useState(false);

  const trackMeta = useMemo<TrackMeta>(() => {
    const allPts = [...lapA.points, ...lapB.points];
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;

    for (const p of allPts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }

    if (!Number.isFinite(minX)) {
      return {
        centerX: 0,
        centerY: 0,
        centerZ: 0,
        minY: 0,
        radius: 100,
        minX: -100,
        maxX: 100,
        minZ: -100,
        maxZ: 100,
        key: "empty",
      };
    }

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const centerZ = (minZ + maxZ) / 2;
    const radius = Math.max(40, Math.hypot(maxX - minX, maxZ - minZ) * 0.55);

    return {
      centerX,
      centerY,
      centerZ,
      minY,
      radius,
      minX,
      maxX,
      minZ,
      maxZ,
      key: `${lapA.sessionId}_${lapA.lapNumber}_${lapB.sessionId}_${lapB.lapNumber}`,
    };
  }, [lapA, lapB]);

  const trackStations = useMemo<TrackStation[]>(() => {
    const pts = lapA.points;
    if (pts.length < 4) return [];

    const maxStations = 260;
    const step = Math.max(1, Math.floor(pts.length / maxStations));
    const sampled: LapPoint3D[] = [];
    for (let i = 0; i < pts.length; i += step) {
      sampled.push(pts[i]);
    }
    if (sampled[sampled.length - 1] !== pts[pts.length - 1]) {
      sampled.push(pts[pts.length - 1]);
    }

    return sampled.map((pt, idx) => {
      const prev = sampled[(idx - 1 + sampled.length) % sampled.length];
      const next = sampled[(idx + 1) % sampled.length];
      let dH = next.headingRad - prev.headingRad;
      while (dH > Math.PI) dH -= Math.PI * 2;
      while (dH < -Math.PI) dH += Math.PI * 2;
      const ds = Math.max(1, Math.hypot(next.x - prev.x, next.z - prev.z));

      return {
        x: pt.x,
        y: pt.y,
        z: pt.z,
        rightX: Math.cos(pt.headingRad),
        rightZ: -Math.sin(pt.headingRad),
        curvature: Math.abs(dH) / ds,
        normDist: pt.normDist,
      };
    });
  }, [lapA.points]);

  const lapBRenderPath = useMemo<LapBRenderPoint[]>(() => {
    const pts = lapB.points;
    const maxPts = 400;
    const step = Math.max(1, Math.floor(pts.length / maxPts));
    const out: LapBRenderPoint[] = [];

    for (let i = 0; i < pts.length; i += step) {
      const pt = pts[i];
      const speedA = sampleLapSpeedAtNormDist(lapA, pt.normDist);
      out.push({
        x: pt.x,
        y: pt.y,
        z: pt.z,
        normDist: pt.normDist,
        speedDiff: pt.speed - speedA,
      });
    }
    const last = pts[pts.length - 1];
    if (last && (out.length === 0 || out[out.length - 1].normDist < 0.999)) {
      const speedA = sampleLapSpeedAtNormDist(lapA, last.normDist);
      out.push({
        x: last.x,
        y: last.y,
        z: last.z,
        normDist: last.normDist,
        speedDiff: last.speed - speedA,
      });
    }
    return out;
  }, [lapA, lapB.points]);

  const lapARenderPath = useMemo(() => {
    const pts = lapA.points;
    const step = Math.max(1, Math.floor(pts.length / 400));
    const out: LapPoint3D[] = [];
    for (let i = 0; i < pts.length; i += step) out.push(pts[i]);
    if (pts.length > 0 && out[out.length - 1] !== pts[pts.length - 1]) {
      out.push(pts[pts.length - 1]);
    }
    return out;
  }, [lapA.points]);

  const cameraRef = useRef<CameraState>({
    yaw: 0.65,
    pitch: 0.58,
    distance: 220,
    targetX: 0,
    targetY: 0,
    targetZ: 0,
  });
  const lastTrackKeyRef = useRef<string>("");
  const viewportRef = useRef<{ width: number; height: number; dpr: number }>({
    width: 960,
    height: 540,
    dpr: 1,
  });
  const latestParamsRef = useRef<RenderParams | null>(null);
  const rafDrawRef = useRef<number | null>(null);

  const dragRef = useRef<{
    active: boolean;
    mode: "rotate" | "pan";
    startX: number;
    startY: number;
    startYaw: number;
    startPitch: number;
    startTargetX: number;
    startTargetZ: number;
  } | null>(null);

  const scheduleRedraw = () => {
    if (rafDrawRef.current !== null) return;
    rafDrawRef.current = requestAnimationFrame(() => {
      rafDrawRef.current = null;
      const canvas = canvasRef.current;
      const params = latestParamsRef.current;
      if (!canvas || !params) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      drawTrack3DScene(ctx, viewportRef.current, cameraRef.current, params);
    });
  };

  const resetCameraToTrack = (mode: CameraMode = cameraMode) => {
    cameraRef.current = {
      yaw: 0.65,
      pitch: mode === "top" ? 1.46 : 0.58,
      distance: Math.max(85, trackMeta.radius * 1.95),
      targetX: trackMeta.centerX,
      targetY: trackMeta.centerY * elevationScale,
      targetZ: trackMeta.centerZ,
    };
    scheduleRedraw();
  };

  useEffect(() => {
    const el = containerRef.current;
    const canvas = canvasRef.current;
    if (!el || !canvas) return;

    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.max(320, Math.round(rect.width));
      const height = Math.max(240, Math.round(rect.height));
      viewportRef.current = { width, height, dpr };
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const ctx = canvas.getContext("2d");
      if (ctx && latestParamsRef.current) {
        drawTrack3DScene(ctx, viewportRef.current, cameraRef.current, latestParamsRef.current);
      }
    };

    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (rafDrawRef.current !== null) {
        cancelAnimationFrame(rafDrawRef.current);
        rafDrawRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const params: RenderParams = {
      lapA,
      lapB,
      snapshot,
      labelA,
      labelB,
      cameraMode,
      followMidpoint,
      colorMode,
      trackWidth,
      elevationScale,
      showElevationColumns,
      trackMeta,
      trackStations,
      lapARenderPath,
      lapBRenderPath,
    };
    latestParamsRef.current = params;

    if (lastTrackKeyRef.current !== trackMeta.key) {
      lastTrackKeyRef.current = trackMeta.key;
      cameraRef.current = {
        yaw: 0.65,
        pitch: cameraMode === "top" ? 1.46 : 0.58,
        distance: Math.max(85, trackMeta.radius * 1.95),
        targetX: trackMeta.centerX,
        targetY: trackMeta.centerY * elevationScale,
        targetZ: trackMeta.centerZ,
      };
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawTrack3DScene(ctx, viewportRef.current, cameraRef.current, params);
  }, [
    lapA,
    lapB,
    snapshot,
    labelA,
    labelB,
    cameraMode,
    followMidpoint,
    colorMode,
    trackWidth,
    elevationScale,
    showElevationColumns,
    trackMeta,
    trackStations,
    lapARenderPath,
    lapBRenderPath,
  ]);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (cameraMode === "chase-a" || cameraMode === "chase-b") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const isPan = e.button === 2 || e.shiftKey || cameraMode === "top";
    dragRef.current = {
      active: true,
      mode: isPan ? "pan" : "rotate",
      startX: e.clientX,
      startY: e.clientY,
      startYaw: cameraRef.current.yaw,
      startPitch: cameraRef.current.pitch,
      startTargetX: cameraRef.current.targetX,
      startTargetZ: cameraRef.current.targetZ,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || !drag.active) return;

    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const cam = cameraRef.current;

    if (drag.mode === "rotate") {
      cam.yaw = drag.startYaw - dx * 0.007;
      cam.pitch = Math.max(0.08, Math.min(1.46, drag.startPitch + dy * 0.006));
    } else {
      const panSpeed = cam.distance * 0.0022;
      const cosY = Math.cos(cam.yaw);
      const sinY = Math.sin(cam.yaw);
      if (followMidpoint) setFollowMidpoint(false);
      cam.targetX = drag.startTargetX - (dx * cosY + dy * sinY) * panSpeed;
      cam.targetZ = drag.startTargetZ + (dx * sinY - dy * cosY) * panSpeed;
    }
    scheduleRedraw();
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.active) {
      dragRef.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (cameraMode === "chase-a" || cameraMode === "chase-b") return;
    const factor = e.deltaY > 0 ? 1.1 : 0.9;
    cameraRef.current.distance = Math.max(
      12,
      Math.min(1200, cameraRef.current.distance * factor),
    );
    scheduleRedraw();
  };

  return (
    <div className="flex flex-col space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-zinc-950/80 border border-zinc-800 px-3 py-2.5 rounded-2xl">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-black uppercase tracking-wider text-zinc-500 flex items-center space-x-1 mr-1">
            <Camera size={12} className="text-cyan-400" />
            <span>View</span>
          </span>
          {(
            [
              { id: "orbit", label: "3D Orbit" },
              { id: "chase-a", label: "Chase Lap A" },
              { id: "chase-b", label: "Chase Lap B" },
              { id: "top", label: "Top Down" },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setCameraMode(item.id);
                if (item.id === "top") {
                  cameraRef.current.pitch = 1.48;
                } else if (item.id === "orbit" && cameraRef.current.pitch > 1.35) {
                  cameraRef.current.pitch = 0.58;
                }
              }}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold uppercase tracking-wider border transition cursor-pointer ${
                cameraMode === item.id
                  ? "bg-cyan-400 text-zinc-950 border-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.28)]"
                  : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700"
              }`}
            >
              {item.label}
            </button>
          ))}

          {cameraMode === "orbit" && (
            <button
              type="button"
              onClick={() => setFollowMidpoint((v) => !v)}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold uppercase tracking-wider border transition flex items-center space-x-1 cursor-pointer ${
                followMidpoint
                  ? "bg-cyan-500/20 border-cyan-400/60 text-cyan-300"
                  : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Crosshair size={11} />
              <span>Follow Karts</span>
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              setColorMode((m) => (m === "lap" ? "speed-delta" : "lap"))
            }
            className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold uppercase tracking-wider border transition flex items-center space-x-1 cursor-pointer ${
              colorMode === "speed-delta"
                ? "bg-emerald-500/20 border-emerald-400/60 text-emerald-300"
                : "bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700"
            }`}
            title="Toggle Lap B trajectory color between Lap Identity and Speed Delta"
          >
            <Flame size={11} />
            <span>{colorMode === "lap" ? "Lines: Lap Colors" : "Lines: Speed Δ"}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              const idx = ELEVATION_OPTIONS.indexOf(elevationScale);
              setElevationScale(
                ELEVATION_OPTIONS[(idx + 1) % ELEVATION_OPTIONS.length],
              );
            }}
            className="px-2.5 py-1 rounded-lg text-[10px] font-extrabold uppercase tracking-wider border bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700 transition flex items-center space-x-1 cursor-pointer"
            title="Cycle terrain elevation exaggeration"
          >
            <Mountain size={11} className="text-cyan-400" />
            <span>Elev {elevationScale}x</span>
          </button>

          <button
            type="button"
            onClick={() => setShowElevationColumns((v) => !v)}
            className={`px-2 py-1 rounded-lg text-[10px] font-extrabold uppercase tracking-wider border transition flex items-center space-x-1 cursor-pointer ${
              showElevationColumns
                ? "bg-zinc-800 border-zinc-600 text-zinc-100"
                : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200"
            }`}
            title="Toggle vertical elevation support struts"
          >
            <Eye size={11} />
            <span>Pillars</span>
          </button>

          <label className="flex items-center space-x-1.5 text-[10px] text-zinc-400 font-bold uppercase bg-zinc-900 border border-zinc-800 px-2.5 py-1 rounded-lg">
            <span>Width {trackWidth}m</span>
            <input
              type="range"
              min={6}
              max={16}
              step={1}
              value={trackWidth}
              onChange={(e) => setTrackWidth(Number(e.target.value))}
              className="w-14 h-1 accent-cyan-400 cursor-pointer"
            />
          </label>

          <button
            type="button"
            onClick={() => {
              setFollowMidpoint(false);
              resetCameraToTrack(cameraMode);
            }}
            className="px-2.5 py-1 rounded-lg text-[10px] font-extrabold uppercase tracking-wider border bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700 transition flex items-center space-x-1 cursor-pointer"
          >
            <RotateCcw size={11} />
            <span>Reset</span>
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative w-full aspect-16/10 min-h-96 bg-zinc-950 rounded-3xl border border-zinc-800/80 overflow-hidden shadow-2xl"
      >
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onWheel={handleWheel}
          onContextMenu={(e) => e.preventDefault()}
          className="w-full h-full block cursor-grab active:cursor-grabbing touch-none"
        />

        <div className="absolute top-3 left-3 pointer-events-none flex flex-col space-y-1.5 bg-zinc-950/85 backdrop-blur-md border border-zinc-800/90 rounded-2xl px-3.5 py-2.5">
          <div className="flex items-center space-x-3 text-[11px] font-mono font-bold">
            <span className="flex items-center space-x-1.5 text-cyan-400">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_8px_#22d3ee]" />
              <span>A: {Math.round(snapshot.pointA.speed)} km/h</span>
            </span>
            <span className="text-zinc-600">vs</span>
            <span className="flex items-center space-x-1.5 text-rose-400">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shadow-[0_0_8px_#f43f5e]" />
              <span>B: {Math.round(snapshot.pointB.speed)} km/h</span>
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-mono">
            <span
              className={
                snapshot.timeDelta <= 0
                  ? "text-emerald-400 font-bold"
                  : "text-rose-400 font-bold"
              }
            >
              Δt {snapshot.timeDelta >= 0 ? "+" : ""}
              {snapshot.timeDelta.toFixed(3)}s
            </span>
            <span className="text-zinc-400">
              Gap {snapshot.distanceGapMeters.toFixed(1)}m
            </span>
            <span className="text-zinc-400">
              Line{" "}
              {Math.abs(snapshot.lateralOffsetMeters) < 0.25
                ? "Aligned"
                : `${Math.abs(snapshot.lateralOffsetMeters).toFixed(1)}m ${
                    snapshot.lateralOffsetMeters > 0 ? "Right" : "Left"
                  } of A`}
            </span>
          </div>
        </div>

        <div className="absolute bottom-3 left-3 pointer-events-none bg-zinc-950/75 backdrop-blur-md border border-zinc-800/80 rounded-xl px-2.5 py-1.5 text-[9px] text-zinc-400 uppercase font-bold tracking-wider flex items-center space-x-2">
          <Compass size={11} className="text-cyan-400" />
          <span>
            {cameraMode === "orbit"
              ? "Drag: Orbit • Shift/Right-Drag: Pan • Scroll: Zoom"
              : cameraMode === "top"
                ? "Drag: Pan • Scroll: Zoom"
                : `Locked Chase Cam (${cameraMode === "chase-a" ? labelA : labelB})`}
          </span>
        </div>

        {colorMode === "speed-delta" && (
          <div className="absolute top-3 right-3 pointer-events-none bg-zinc-950/85 backdrop-blur-md border border-zinc-800 rounded-xl px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider flex items-center space-x-2.5">
            <span className="flex items-center space-x-1 text-emerald-400">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>B Faster</span>
            </span>
            <span className="flex items-center space-x-1 text-yellow-400">
              <span className="w-2 h-2 rounded-full bg-yellow-400" />
              <span>Equal</span>
            </span>
            <span className="flex items-center space-x-1 text-rose-400">
              <span className="w-2 h-2 rounded-full bg-rose-500" />
              <span>B Slower</span>
            </span>
          </div>
        )}

        {(!lapA.hasGps || !lapB.hasGps) && (
          <div className="absolute bottom-3 right-14 pointer-events-none bg-amber-950/80 border border-amber-700/60 text-amber-300 px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider flex items-center space-x-1">
            <Maximize2 size={10} />
            <span>Dead-Reckoned Path (No GPS Channels)</span>
          </div>
        )}
      </div>
    </div>
  );
}
