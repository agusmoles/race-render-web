"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  Camera,
  Compass,
  Crosshair,
  Flame,
  Maximize2,
  RotateCcw,
} from "lucide-react";
import type {
  ComparisonSnapshot,
  LapPoint3D,
  ProcessedLap3D,
  TrackCenterlinePoint,
} from "@/utils/lap-comparison";

type CameraMode = "orbit" | "chase-a" | "chase-b" | "top";
type LineColorMode = "lap" | "speed-delta";

interface Track3DViewerProps {
  lapA: ProcessedLap3D;
  lapB: ProcessedLap3D;
  centerline: TrackCenterlinePoint[];
  snapshot: ComparisonSnapshot;
  labelA: string;
  labelB: string;
}

interface KartRig {
  root: THREE.Group;
  flPivot: THREE.Group;
  frPivot: THREE.Group;
}

interface LiveFrameState {
  snapshot: ComparisonSnapshot;
  cameraMode: CameraMode;
  followMidpoint: boolean;
  labelA: string;
  labelB: string;
}

function sampleSpeedAtNorm(lap: ProcessedLap3D, normDist: number): number {
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

function disposeObject3D(root: THREE.Object3D) {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
      obj.geometry?.dispose();
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of mats) {
        if (!mat) continue;
        if (mat instanceof THREE.MeshStandardMaterial) {
          mat.map?.dispose();
        } else if (mat instanceof THREE.MeshBasicMaterial) {
          mat.map?.dispose();
        }
        mat.dispose();
      }
    }
  });
}

function createAsphaltTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#1c1c22";
    ctx.fillRect(0, 0, 128, 128);

    for (let i = 0; i < 650; i++) {
      const x = (i * 73) % 128;
      const y = (i * 41) % 128;
      const shade = 24 + ((i * 19) % 18);
      ctx.fillStyle = `rgb(${shade}, ${shade}, ${shade + 4})`;
      ctx.fillRect(x, y, 2, 2);
    }

    ctx.fillStyle = "rgba(228, 228, 231, 0.85)";
    ctx.fillRect(2, 0, 3, 128);
    ctx.fillRect(123, 0, 3, 128);

    ctx.fillStyle = "rgba(161, 161, 170, 0.25)";
    ctx.fillRect(63, 12, 2, 42);
    ctx.fillRect(63, 76, 2, 42);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function createCheckerTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const cols = 16;
    const rows = 4;
    const cw = canvas.width / cols;
    const ch = canvas.height / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        ctx.fillStyle = (r + c) % 2 === 0 ? "#f4f4f5" : "#18181b";
        ctx.fillRect(c * cw, r * ch, cw, ch);
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createKartMesh(primaryHex: number, darkHex: number): KartRig {
  const root = new THREE.Group();

  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x27272a,
    roughness: 0.45,
    metalness: 0.65,
  });
  const bodyMat = new THREE.MeshStandardMaterial({
    color: primaryHex,
    emissive: darkHex,
    emissiveIntensity: 0.25,
    roughness: 0.32,
    metalness: 0.25,
  });
  const tireMat = new THREE.MeshStandardMaterial({
    color: 0x111114,
    roughness: 0.88,
    metalness: 0.08,
  });
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0xd4d4d8,
    roughness: 0.3,
    metalness: 0.85,
  });
  const suitMat = new THREE.MeshStandardMaterial({
    color: 0x18181b,
    roughness: 0.65,
    metalness: 0.1,
  });
  const helmetMat = new THREE.MeshStandardMaterial({
    color: primaryHex,
    emissive: primaryHex,
    emissiveIntensity: 0.28,
    roughness: 0.18,
    metalness: 0.45,
  });
  const visorMat = new THREE.MeshStandardMaterial({
    color: 0x09090b,
    roughness: 0.1,
    metalness: 0.9,
  });

  const floorpan = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.08, 1.82), frameMat);
  floorpan.position.set(0, 0.12, 0.04);
  root.add(floorpan);

  const podGeo = new THREE.BoxGeometry(0.24, 0.2, 0.92);
  const leftPod = new THREE.Mesh(podGeo, bodyMat);
  leftPod.position.set(0.42, 0.2, -0.02);
  root.add(leftPod);

  const rightPod = new THREE.Mesh(podGeo, bodyMat);
  rightPod.position.set(-0.42, 0.2, -0.02);
  root.add(rightPod);

  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.16, 0.32), bodyMat);
  nose.position.set(0, 0.2, 0.86);
  root.add(nose);

  const fairing = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.3, 0.44), bodyMat);
  fairing.position.set(0, 0.4, 0.56);
  fairing.rotation.x = 0.38;
  root.add(fairing);

  const steeringWheel = new THREE.Mesh(
    new THREE.TorusGeometry(0.11, 0.02, 8, 16),
    frameMat,
  );
  steeringWheel.position.set(0, 0.5, 0.3);
  steeringWheel.rotation.x = -0.45;
  root.add(steeringWheel);

  const rearBumper = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.16, 0.16), frameMat);
  rearBumper.position.set(0, 0.2, -0.88);
  root.add(rearBumper);

  const engine = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.28, 0.32), rimMat);
  engine.position.set(-0.28, 0.3, -0.44);
  root.add(engine);

  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.38, 0.32), suitMat);
  seat.position.set(0, 0.34, -0.2);
  seat.rotation.x = -0.22;
  root.add(seat);

  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.16, 0.42, 12), suitMat);
  torso.position.set(0, 0.54, -0.14);
  torso.rotation.x = 0.14;
  root.add(torso);

  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 14), helmetMat);
  helmet.position.set(0, 0.86, -0.08);
  root.add(helmet);

  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.08, 0.14), visorMat);
  visor.position.set(0, 0.87, 0.04);
  root.add(visor);

  const makeWheel = (radius: number, width: number) => {
    const group = new THREE.Group();
    const tire = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, width, 16),
      tireMat,
    );
    tire.rotation.z = Math.PI / 2;
    group.add(tire);

    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.56, radius * 0.56, width + 0.015, 12),
      rimMat,
    );
    hub.rotation.z = Math.PI / 2;
    group.add(hub);
    return group;
  };

  const flPivot = new THREE.Group();
  flPivot.position.set(0.54, 0.16, 0.62);
  flPivot.add(makeWheel(0.16, 0.16));
  root.add(flPivot);

  const frPivot = new THREE.Group();
  frPivot.position.set(-0.54, 0.16, 0.62);
  frPivot.add(makeWheel(0.16, 0.16));
  root.add(frPivot);

  const rlWheel = makeWheel(0.18, 0.22);
  rlWheel.position.set(0.58, 0.18, -0.62);
  root.add(rlWheel);

  const rrWheel = makeWheel(0.18, 0.22);
  rrWheel.position.set(-0.58, 0.18, -0.62);
  root.add(rrWheel);

  return { root, flPivot, frPivot };
}

function buildTrackAndLinesGroup(
  centerline: TrackCenterlinePoint[],
  lapA: ProcessedLap3D,
  lapB: ProcessedLap3D,
  trackWidth: number,
  colorMode: LineColorMode,
): THREE.Group {
  const group = new THREE.Group();
  if (centerline.length < 4) return group;

  const halfW = trackWidth * 0.5;
  const roadVerts: number[] = [];
  const roadUvs: number[] = [];
  const roadIndices: number[] = [];

  let totalArc = 0;
  for (let i = 0; i < centerline.length; i++) {
    const s = centerline[i];
    if (i > 0) {
      const prev = centerline[i - 1];
      totalArc += Math.hypot(s.x - prev.x, s.z - prev.z);
    }

    const leftX = s.x - s.rightX * halfW;
    const leftZ = s.z - s.rightZ * halfW;
    const rightX = s.x + s.rightX * halfW;
    const rightZ = s.z + s.rightZ * halfW;

    roadVerts.push(leftX, 0, leftZ, rightX, 0, rightZ);
    const vCoord = totalArc * 0.08;
    roadUvs.push(0, vCoord, 1, vCoord);

    if (i < centerline.length - 1) {
      const row = i * 2;
      roadIndices.push(row, row + 1, row + 2);
      roadIndices.push(row + 1, row + 3, row + 2);
    }
  }

  const roadGeo = new THREE.BufferGeometry();
  roadGeo.setAttribute("position", new THREE.Float32BufferAttribute(roadVerts, 3));
  roadGeo.setAttribute("uv", new THREE.Float32BufferAttribute(roadUvs, 2));
  roadGeo.setIndex(roadIndices);
  roadGeo.computeVertexNormals();

  const asphaltTex = createAsphaltTexture();
  const roadMat = new THREE.MeshStandardMaterial({
    map: asphaltTex,
    roughness: 0.85,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });
  group.add(new THREE.Mesh(roadGeo, roadMat));

  // Raised corner kerbs on curved segments
  const kerbVerts: number[] = [];
  const kerbColors: number[] = [];
  const kerbIndices: number[] = [];
  let kerbVertexOffset = 0;

  for (let i = 0; i < centerline.length - 1; i++) {
    const s0 = centerline[i];
    const s1 = centerline[i + 1];
    if (s0.curvature < 0.018) continue;

    const isRed = Math.floor(i / 2) % 2 === 0;
    const cr = isRed ? 0.95 : 0.94;
    const cg = isRed ? 0.24 : 0.94;
    const cb = isRed ? 0.37 : 0.96;

    for (const side of [-1, 1]) {
      const innerOff = halfW * side;
      const outerOff = (halfW + 0.85) * side;

      const p0x = s0.x + s0.rightX * innerOff;
      const p0z = s0.z + s0.rightZ * innerOff;
      const p1x = s0.x + s0.rightX * outerOff;
      const p1z = s0.z + s0.rightZ * outerOff;
      const p2x = s1.x + s1.rightX * outerOff;
      const p2z = s1.z + s1.rightZ * outerOff;
      const p3x = s1.x + s1.rightX * innerOff;
      const p3z = s1.z + s1.rightZ * innerOff;

      kerbVerts.push(
        p0x, 0.02, p0z,
        p1x, 0.06, p1z,
        p2x, 0.06, p2z,
        p3x, 0.02, p3z,
      );
      for (let k = 0; k < 4; k++) kerbColors.push(cr, cg, cb);
      kerbIndices.push(
        kerbVertexOffset,
        kerbVertexOffset + 1,
        kerbVertexOffset + 2,
        kerbVertexOffset,
        kerbVertexOffset + 2,
        kerbVertexOffset + 3,
      );
      kerbVertexOffset += 4;
    }
  }

  if (kerbVerts.length > 0) {
    const kerbGeo = new THREE.BufferGeometry();
    kerbGeo.setAttribute("position", new THREE.Float32BufferAttribute(kerbVerts, 3));
    kerbGeo.setAttribute("color", new THREE.Float32BufferAttribute(kerbColors, 3));
    kerbGeo.setIndex(kerbIndices);
    kerbGeo.computeVertexNormals();
    const kerbMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.6,
      metalness: 0.05,
      side: THREE.DoubleSide,
    });
    group.add(new THREE.Mesh(kerbGeo, kerbMat));
  }

  // Start / Finish Gantry
  const sf = centerline[0];
  const gantrySpan = trackWidth + 1.4;
  const gantryHeight = 3.4;
  const gantryGroup = new THREE.Group();
  gantryGroup.position.set(sf.x, 0, sf.z);
  gantryGroup.rotation.y = Math.atan2(sf.rightZ, -sf.rightX);

  const postMat = new THREE.MeshStandardMaterial({
    color: 0x71717a,
    metalness: 0.75,
    roughness: 0.35,
  });
  const postGeo = new THREE.BoxGeometry(0.24, gantryHeight, 0.24);
  const leftPost = new THREE.Mesh(postGeo, postMat);
  leftPost.position.set(-gantrySpan * 0.5, gantryHeight * 0.5, 0);
  gantryGroup.add(leftPost);

  const rightPost = new THREE.Mesh(postGeo, postMat);
  rightPost.position.set(gantrySpan * 0.5, gantryHeight * 0.5, 0);
  gantryGroup.add(rightPost);

  const checkerTex = createCheckerTexture();
  const banner = new THREE.Mesh(
    new THREE.BoxGeometry(gantrySpan + 0.3, 0.7, 0.28),
    new THREE.MeshStandardMaterial({ map: checkerTex, roughness: 0.5 }),
  );
  banner.position.set(0, gantryHeight - 0.25, 0);
  gantryGroup.add(banner);

  const sfStrip = new THREE.Mesh(
    new THREE.PlaneGeometry(trackWidth, 0.55),
    new THREE.MeshBasicMaterial({ map: checkerTex, side: THREE.DoubleSide }),
  );
  sfStrip.rotation.x = -Math.PI / 2;
  sfStrip.position.set(0, 0.03, 0);
  gantryGroup.add(sfStrip);
  group.add(gantryGroup);

  // Racing Line Tubes (strictly planar yLift, never force-closing open laps)
  const buildLapCurve = (lap: ProcessedLap3D, yLift: number) => {
    const pts = lap.points;
    const step = Math.max(1, Math.floor(pts.length / 320));
    const vecs: THREE.Vector3[] = [];
    for (let i = 0; i < pts.length; i += step) {
      vecs.push(new THREE.Vector3(pts[i].x, yLift, pts[i].z));
    }
    const last = pts[pts.length - 1];
    if (last && vecs[vecs.length - 1].distanceTo(new THREE.Vector3(last.x, yLift, last.z)) > 0.1) {
      vecs.push(new THREE.Vector3(last.x, yLift, last.z));
    }
    const isClosed =
      vecs.length >= 4 && vecs[0].distanceTo(vecs[vecs.length - 1]) < 35;
    return {
      curve: new THREE.CatmullRomCurve3(vecs, isClosed, "catmullrom", 0.3),
      isClosed,
    };
  };

  if (lapA.points.length >= 6) {
    const { curve, isClosed } = buildLapCurve(lapA, 0.07);
    const tubeAGeo = new THREE.TubeGeometry(curve, 360, 0.1, 6, isClosed);
    const tubeAMat = new THREE.MeshStandardMaterial({
      color: 0x22d3ee,
      emissive: 0x0891b2,
      emissiveIntensity: 0.55,
      roughness: 0.3,
    });
    group.add(new THREE.Mesh(tubeAGeo, tubeAMat));
  }

  if (lapB.points.length >= 6) {
    const { curve, isClosed } = buildLapCurve(lapB, 0.09);
    const tubularSegs = 360;
    const radialSegs = 6;
    const tubeBGeo = new THREE.TubeGeometry(curve, tubularSegs, 0.11, radialSegs, isClosed);

    if (colorMode === "speed-delta") {
      const posAttr = tubeBGeo.attributes.position;
      const colors = new Float32Array(posAttr.count * 3);
      const ringSize = radialSegs + 1;
      const faster = new THREE.Color(0x10b981);
      const equal = new THREE.Color(0xfacc15);
      const slower = new THREE.Color(0xf43f5e);

      for (let s = 0; s <= tubularSegs; s++) {
        const u = s / tubularSegs;
        const spdB = sampleSpeedAtNorm(lapB, u);
        const spdA = sampleSpeedAtNorm(lapA, u);
        const diff = spdB - spdA;
        const c = diff > 1.2 ? faster : diff < -1.2 ? slower : equal;

        for (let r = 0; r < ringSize; r++) {
          const idx = (s * ringSize + r) * 3;
          if (idx + 2 < colors.length) {
            colors[idx] = c.r;
            colors[idx + 1] = c.g;
            colors[idx + 2] = c.b;
          }
        }
      }
      tubeBGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      const tubeBMat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        emissive: 0x18181b,
        emissiveIntensity: 0.25,
        roughness: 0.35,
      });
      group.add(new THREE.Mesh(tubeBGeo, tubeBMat));
    } else {
      const tubeBMat = new THREE.MeshStandardMaterial({
        color: 0xf43f5e,
        emissive: 0x9f1239,
        emissiveIntensity: 0.5,
        roughness: 0.3,
      });
      group.add(new THREE.Mesh(tubeBGeo, tubeBMat));
    }
  }

  return group;
}

export default function Track3DViewer({
  lapA,
  lapB,
  centerline,
  snapshot,
  labelA,
  labelB,
}: Track3DViewerProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const badgeARef = useRef<HTMLDivElement>(null);
  const badgeBRef = useRef<HTMLDivElement>(null);

  const [cameraMode, setCameraMode] = useState<CameraMode>("orbit");
  const [followMidpoint, setFollowMidpoint] = useState(false);
  const [colorMode, setColorMode] = useState<LineColorMode>("lap");
  const [trackWidth, setTrackWidth] = useState(9);

  const trackMeta = useMemo(() => {
    const pts = centerline.length > 0 ? centerline : lapA.points;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;

    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }

    if (!Number.isFinite(minX)) {
      return {
        centerX: 0,
        centerZ: 0,
        radius: 100,
        key: "empty",
      };
    }

    return {
      centerX: (minX + maxX) * 0.5,
      centerZ: (minZ + maxZ) * 0.5,
      radius: Math.max(40, Math.hypot(maxX - minX, maxZ - minZ) * 0.55),
      key: `${lapA.sessionId}_${lapA.lapNumber}_${lapB.sessionId}_${lapB.lapNumber}_${centerline.length}`,
    };
  }, [centerline, lapA, lapB]);

  const liveRef = useRef<LiveFrameState>({
    snapshot,
    cameraMode,
    followMidpoint,
    labelA,
    labelB,
  });

  useEffect(() => {
    liveRef.current = {
      snapshot,
      cameraMode,
      followMidpoint,
      labelA,
      labelB,
    };
  }, [snapshot, cameraMode, followMidpoint, labelA, labelB]);

  const sceneRefs = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    trackGroup: THREE.Group | null;
    gridHelper: THREE.GridHelper | null;
    kartA: KartRig;
    kartB: KartRig;
  } | null>(null);

  const lastTrackKeyRef = useRef<string>("");

  const applyCameraPreset = (nextMode: CameraMode) => {
    const refs = sceneRefs.current;
    if (!refs) return;
    if (nextMode === "top") {
      const dist = Math.max(120, trackMeta.radius * 2.15);
      refs.controls.target.set(trackMeta.centerX, 0, trackMeta.centerZ);
      refs.camera.position.set(
        trackMeta.centerX,
        dist,
        trackMeta.centerZ + dist * 0.04,
      );
      refs.controls.update();
    } else if (nextMode === "orbit") {
      const dist = Math.max(90, trackMeta.radius * 1.75);
      refs.controls.target.set(trackMeta.centerX, 0, trackMeta.centerZ);
      refs.camera.position.set(
        trackMeta.centerX + dist * 0.16,
        dist * 0.86,
        trackMeta.centerZ + dist * 0.88,
      );
      refs.controls.update();
    }
  };

  useEffect(() => {
    const mountEl = mountRef.current;
    if (!mountEl) return;

    const width = Math.max(320, mountEl.clientWidth || 960);
    const height = Math.max(240, mountEl.clientHeight || 560);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(width, height);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    mountEl.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x07070a);
    scene.fog = new THREE.FogExp2(0x07070a, 0.00055);

    const camera = new THREE.PerspectiveCamera(48, width / height, 0.25, 4000);
    camera.position.set(25, 110, 115);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.485;
    controls.minDistance = 6;
    controls.maxDistance = 1600;

    const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x18181b, 0.95);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.45);
    dirLight.position.set(160, 260, 120);
    scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0x22d3ee, 0.45);
    fillLight.position.set(-140, 80, -140);
    scene.add(fillLight);

    const kartA = createKartMesh(0x22d3ee, 0x0891b2);
    const kartB = createKartMesh(0xf43f5e, 0x9f1239);
    scene.add(kartA.root);
    scene.add(kartB.root);

    const connectorPositions = new Float32Array(6);
    const connectorGeo = new THREE.BufferGeometry();
    connectorGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(connectorPositions, 3),
    );
    const connectorLine = new THREE.Line(
      connectorGeo,
      new THREE.LineDashedMaterial({
        color: 0xe4e4e7,
        dashSize: 1.2,
        gapSize: 0.9,
        transparent: true,
        opacity: 0.6,
      }),
    );
    scene.add(connectorLine);

    sceneRefs.current = {
      scene,
      camera,
      controls,
      trackGroup: null,
      gridHelper: null,
      kartA,
      kartB,
    };

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const w = Math.max(320, Math.round(entry.contentRect.width));
      const h = Math.max(240, Math.round(entry.contentRect.height));
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(mountEl);

    const projVec = new THREE.Vector3();
    let rafId = 0;

    const updateKartTransform = (rig: KartRig, pt: LapPoint3D) => {
      rig.root.position.set(pt.x, 0.04, pt.z);
      rig.root.rotation.order = "YXZ";
      rig.root.rotation.y = pt.headingRad;
      rig.root.rotation.x = 0;
      rig.root.rotation.z = Math.max(-0.07, Math.min(0.07, pt.latAcc * 0.03));
      const steerRad = Math.max(-0.42, Math.min(0.42, -(pt.steeringDeg * Math.PI) / 180));
      rig.flPivot.rotation.y = steerRad;
      rig.frPivot.rotation.y = steerRad;
    };

    const updateBadge = (
      el: HTMLDivElement | null,
      worldPos: THREE.Vector3,
      w: number,
      h: number,
    ) => {
      if (!el) return;
      projVec.copy(worldPos).project(camera);
      if (projVec.z > 1 || projVec.z < -1) {
        el.style.opacity = "0";
        return;
      }
      const sx = (projVec.x * 0.5 + 0.5) * w;
      const sy = (-projVec.y * 0.5 + 0.5) * h;
      el.style.opacity = "1";
      el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -115%)`;
    };

    const animate = () => {
      const state = liveRef.current;
      const { pointA, pointB } = state.snapshot;

      updateKartTransform(kartA, pointA);
      updateKartTransform(kartB, pointB);

      const posAttr = connectorGeo.attributes.position as THREE.BufferAttribute;
      posAttr.setXYZ(0, pointA.x, 0.35, pointA.z);
      posAttr.setXYZ(1, pointB.x, 0.35, pointB.z);
      posAttr.needsUpdate = true;
      connectorLine.computeLineDistances();

      if (state.cameraMode === "chase-a" || state.cameraMode === "chase-b") {
        controls.enabled = false;
        const focus = state.cameraMode === "chase-a" ? pointA : pointB;
        const sinH = Math.sin(focus.headingRad);
        const cosH = Math.cos(focus.headingRad);

        const desiredPos = new THREE.Vector3(
          focus.x - sinH * 10.5,
          3.8,
          focus.z - cosH * 10.5,
        );
        camera.position.lerp(desiredPos, 0.22);
        camera.lookAt(
          focus.x + sinH * 12,
          1.0,
          focus.z + cosH * 12,
        );
      } else {
        controls.enabled = true;
        if (state.cameraMode === "orbit" && state.followMidpoint) {
          controls.target.lerp(
            new THREE.Vector3(
              (pointA.x + pointB.x) * 0.5,
              0,
              (pointA.z + pointB.z) * 0.5,
            ),
            0.18,
          );
        }
        controls.update();
      }

      renderer.render(scene, camera);

      const cw = renderer.domElement.clientWidth || width;
      const ch = renderer.domElement.clientHeight || height;
      updateBadge(
        badgeARef.current,
        new THREE.Vector3(pointA.x, 1.35, pointA.z),
        cw,
        ch,
      );
      updateBadge(
        badgeBRef.current,
        new THREE.Vector3(pointB.x, 1.35, pointB.z),
        cw,
        ch,
      );

      rafId = requestAnimationFrame(animate);
    };

    rafId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      controls.dispose();
      if (sceneRefs.current?.trackGroup) {
        disposeObject3D(sceneRefs.current.trackGroup);
      }
      if (sceneRefs.current?.gridHelper) {
        sceneRefs.current.gridHelper.geometry.dispose();
      }
      disposeObject3D(kartA.root);
      disposeObject3D(kartB.root);
      connectorGeo.dispose();
      (connectorLine.material as THREE.Material).dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mountEl) {
        mountEl.removeChild(renderer.domElement);
      }
      sceneRefs.current = null;
    };
  }, []);

  useEffect(() => {
    const refs = sceneRefs.current;
    if (!refs) return;

    if (refs.trackGroup) {
      refs.scene.remove(refs.trackGroup);
      disposeObject3D(refs.trackGroup);
      refs.trackGroup = null;
    }

    if (refs.gridHelper) {
      refs.scene.remove(refs.gridHelper);
      refs.gridHelper.geometry.dispose();
      refs.gridHelper = null;
    }

    const gridSize = Math.max(300, Math.ceil((trackMeta.radius * 3) / 50) * 50);
    const grid = new THREE.GridHelper(
      gridSize,
      Math.max(12, Math.round(gridSize / 20)),
      0x27272a,
      0x18181b,
    );
    grid.position.set(trackMeta.centerX, -0.15, trackMeta.centerZ);
    refs.scene.add(grid);
    refs.gridHelper = grid;

    const trackGroup = buildTrackAndLinesGroup(
      centerline,
      lapA,
      lapB,
      trackWidth,
      colorMode,
    );
    refs.scene.add(trackGroup);
    refs.trackGroup = trackGroup;

    if (lastTrackKeyRef.current !== trackMeta.key) {
      lastTrackKeyRef.current = trackMeta.key;
      const dist = Math.max(90, trackMeta.radius * 1.75);
      refs.controls.target.set(trackMeta.centerX, 0, trackMeta.centerZ);
      refs.camera.position.set(
        trackMeta.centerX + dist * 0.16,
        dist * 0.86,
        trackMeta.centerZ + dist * 0.88,
      );
      refs.controls.update();
    }
  }, [centerline, lapA, lapB, trackWidth, colorMode, trackMeta]);

  return (
    <div className="flex flex-col space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-zinc-950/80 border border-zinc-800 px-3 py-2.5 rounded-2xl">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-black uppercase tracking-wider text-zinc-500 flex items-center space-x-1 mr-1">
            <Camera size={12} className="text-cyan-400" />
            <span>Three.js Cam</span>
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
                if (item.id === "top" || item.id === "orbit") {
                  applyCameraPreset(item.id);
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
              applyCameraPreset(cameraMode === "top" ? "top" : "orbit");
            }}
            className="px-2.5 py-1 rounded-lg text-[10px] font-extrabold uppercase tracking-wider border bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700 transition flex items-center space-x-1 cursor-pointer"
          >
            <RotateCcw size={11} />
            <span>Reset</span>
          </button>
        </div>
      </div>

      <div className="relative w-full aspect-16/10 min-h-96 bg-zinc-950 rounded-3xl border border-zinc-800/80 overflow-hidden shadow-2xl">
        <div
          ref={mountRef}
          className="w-full h-full cursor-grab active:cursor-grabbing"
        />

        <div
          ref={badgeARef}
          className="absolute top-0 left-0 pointer-events-none px-2 py-1 rounded-lg bg-zinc-950/90 border border-cyan-400/80 shadow-[0_0_10px_rgba(34,211,238,0.28)] whitespace-nowrap"
          style={{ opacity: 0 }}
        >
          <div className="text-[10px] font-bold text-zinc-100 leading-tight">
            A • {Math.round(snapshot.pointA.speed)} km/h
          </div>
          <div className="text-[9px] font-mono font-bold text-cyan-400 leading-tight">
            {labelA}
          </div>
        </div>

        <div
          ref={badgeBRef}
          className="absolute top-0 left-0 pointer-events-none px-2 py-1 rounded-lg bg-zinc-950/90 border border-rose-500/80 shadow-[0_0_10px_rgba(244,63,94,0.28)] whitespace-nowrap"
          style={{ opacity: 0 }}
        >
          <div className="text-[10px] font-bold text-zinc-100 leading-tight">
            B • {Math.round(snapshot.pointB.speed)} km/h
          </div>
          <div className="text-[9px] font-mono font-bold text-rose-400 leading-tight">
            {labelB} ({snapshot.timeDelta >= 0 ? "+" : ""}
            {snapshot.timeDelta.toFixed(3)}s)
          </div>
        </div>

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
              ? "WebGL Orbit • Left-Drag: Rotate • Right-Drag: Pan • Scroll: Zoom"
              : cameraMode === "top"
                ? "Right-Drag: Pan • Scroll: Zoom"
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
          <div className="absolute bottom-3 right-4 pointer-events-none bg-amber-950/80 border border-amber-700/60 text-amber-300 px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider flex items-center space-x-1">
            <Maximize2 size={10} />
            <span>Dead-Reckoned Path (No GPS Channels)</span>
          </div>
        )}
      </div>
    </div>
  );
}
