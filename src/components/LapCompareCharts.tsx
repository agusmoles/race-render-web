"use client";

import React, { useMemo, useRef, useState } from "react";
import { Activity, Gauge, TrendingUp } from "lucide-react";
import {
  sampleLapAtNormDist,
  type ComparisonSnapshot,
  type ProcessedLap3D,
} from "@/utils/lap-comparison";

type SecondaryChannel = "rpm" | "latAcc" | "lonAcc";

interface LapCompareChartsProps {
  lapA: ProcessedLap3D;
  lapB: ProcessedLap3D;
  snapshot: ComparisonSnapshot;
  progress: number;
  syncMode: "distance" | "time";
  onScrub: (nextProgress: number) => void;
}

const CHART_W = 860;
const DELTA_H = 92;
const SPEED_H = 128;
const EXTRA_H = 92;
const PAD_L = 44;
const PAD_R = 14;
const PAD_Y = 12;
const SAMPLE_BINS = 220;

export default function LapCompareCharts({
  lapA,
  lapB,
  snapshot,
  progress,
  syncMode,
  onScrub,
}: LapCompareChartsProps) {
  const [secondaryChannel, setSecondaryChannel] =
    useState<SecondaryChannel>("rpm");
  const isDraggingRef = useRef(false);

  const traceData = useMemo(() => {
    const plotW = CHART_W - PAD_L - PAD_R;
    const rows: {
      norm: number;
      speedA: number;
      speedB: number;
      delta: number;
      rpmA: number;
      rpmB: number;
      latA: number;
      latB: number;
      lonA: number;
      lonB: number;
    }[] = [];

    let maxSpeed = 60;
    let maxAbsDelta = 0.25;
    let maxRpm = 6000;
    let maxAbsG = 1.0;

    for (let i = 0; i <= SAMPLE_BINS; i++) {
      const norm = i / SAMPLE_BINS;
      const pA = sampleLapAtNormDist(lapA, norm);
      const pB = sampleLapAtNormDist(lapB, norm);
      const delta = pB.elapsedTime - pA.elapsedTime;

      maxSpeed = Math.max(maxSpeed, pA.speed, pB.speed);
      maxAbsDelta = Math.max(maxAbsDelta, Math.abs(delta));
      maxRpm = Math.max(maxRpm, pA.rpm, pB.rpm);
      maxAbsG = Math.max(
        maxAbsG,
        Math.abs(pA.latAcc),
        Math.abs(pB.latAcc),
        Math.abs(pA.lonAcc),
        Math.abs(pB.lonAcc),
      );

      rows.push({
        norm,
        speedA: pA.speed,
        speedB: pB.speed,
        delta,
        rpmA: pA.rpm,
        rpmB: pB.rpm,
        latA: pA.latAcc,
        latB: pB.latAcc,
        lonA: pA.lonAcc,
        lonB: pB.lonAcc,
      });
    }

    const speedCeil = Math.ceil(maxSpeed / 10) * 10 || 120;
    const deltaBound = Math.min(10, Math.max(0.3, Math.ceil(maxAbsDelta * 5) / 5));
    const rpmCeil = Math.ceil(maxRpm / 1000) * 1000 || 12000;
    const gBound = Math.ceil(maxAbsG * 2) / 2 || 2.0;

    const toX = (norm: number) => PAD_L + norm * plotW;

    const buildLinePath = (
      getter: (r: (typeof rows)[number]) => number,
      minVal: number,
      maxVal: number,
      height: number,
    ) => {
      const innerH = height - PAD_Y * 2;
      const span = maxVal - minVal || 1;
      return rows
        .map((r, idx) => {
          const x = toX(r.norm);
          const ratio = Math.max(0, Math.min(1, (getter(r) - minVal) / span));
          const y = PAD_Y + (1 - ratio) * innerH;
          return `${idx === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
        })
        .join(" ");
    };

    const deltaMidY = PAD_Y + (DELTA_H - PAD_Y * 2) * 0.5;
    const deltaLine = buildLinePath(
      (r) => r.delta,
      -deltaBound,
      deltaBound,
      DELTA_H,
    );
    const deltaArea = `${deltaLine} L${toX(1).toFixed(1)} ${deltaMidY.toFixed(1)} L${toX(0).toFixed(1)} ${deltaMidY.toFixed(1)} Z`;

    return {
      plotW,
      speedCeil,
      deltaBound,
      deltaMidY,
      rpmCeil,
      gBound,
      deltaLine,
      deltaArea,
      speedPathA: buildLinePath((r) => r.speedA, 0, speedCeil, SPEED_H),
      speedPathB: buildLinePath((r) => r.speedB, 0, speedCeil, SPEED_H),
      rpmPathA: buildLinePath((r) => r.rpmA, 0, rpmCeil, EXTRA_H),
      rpmPathB: buildLinePath((r) => r.rpmB, 0, rpmCeil, EXTRA_H),
      latPathA: buildLinePath((r) => r.latA, -gBound, gBound, EXTRA_H),
      latPathB: buildLinePath((r) => r.latB, -gBound, gBound, EXTRA_H),
      lonPathA: buildLinePath((r) => r.lonA, -gBound, gBound, EXTRA_H),
      lonPathB: buildLinePath((r) => r.lonB, -gBound, gBound, EXTRA_H),
    };
  }, [lapA, lapB]);

  const cursorNorm =
    syncMode === "distance" ? progress : snapshot.pointA.normDist;
  const cursorX = PAD_L + Math.max(0, Math.min(1, cursorNorm)) * traceData.plotW;

  const scrubFromClientX = (clientX: number, el: SVGSVGElement) => {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    const svgX = ((clientX - rect.left) / rect.width) * CHART_W;
    const norm = Math.max(0, Math.min(1, (svgX - PAD_L) / traceData.plotW));
    if (syncMode === "distance") {
      onScrub(norm);
    } else {
      const targetPt = sampleLapAtNormDist(lapA, norm);
      const maxT = Math.max(lapA.lapTime, lapB.lapTime) || 1;
      onScrub(Math.max(0, Math.min(1, targetPt.elapsedTime / maxT)));
    }
  };

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    isDraggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubFromClientX(e.clientX, e.currentTarget);
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!isDraggingRef.current) return;
    scrubFromClientX(e.clientX, e.currentTarget);
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    }
  };

  const extraPathA =
    secondaryChannel === "rpm"
      ? traceData.rpmPathA
      : secondaryChannel === "latAcc"
        ? traceData.latPathA
        : traceData.lonPathA;
  const extraPathB =
    secondaryChannel === "rpm"
      ? traceData.rpmPathB
      : secondaryChannel === "latAcc"
        ? traceData.latPathB
        : traceData.lonPathB;

  const totalH = DELTA_H + SPEED_H + EXTRA_H;
  const speedTopY = DELTA_H;
  const extraTopY = DELTA_H + SPEED_H;

  return (
    <div className="bg-zinc-900/80 backdrop-blur-md border border-zinc-800 rounded-3xl p-4 flex flex-col space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center space-x-2">
          <TrendingUp size={14} className="text-cyan-400" />
          <h3 className="text-xs font-black uppercase tracking-widest text-zinc-300">
            Synchronized Lap Traces (Click or Drag to Scrub 3D Karts)
          </h3>
        </div>

        <div className="flex items-center space-x-1.5">
          {(
            [
              { id: "rpm", label: "Engine RPM", icon: Gauge },
              { id: "latAcc", label: "Lateral G", icon: Activity },
              { id: "lonAcc", label: "Brake / Accel G", icon: Activity },
            ] as const
          ).map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setSecondaryChannel(id)}
              className={`px-2.5 py-1 rounded-lg text-[9px] font-extrabold uppercase tracking-wider border transition cursor-pointer ${
                secondaryChannel === id
                  ? "bg-cyan-400/15 border-cyan-400/60 text-cyan-300"
                  : "bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="w-full overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-950/90">
        <svg
          viewBox={`0 0 ${CHART_W} ${totalH}`}
          className="w-full h-auto block cursor-crosshair select-none touch-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <defs>
            <linearGradient id="deltaFillGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.35" />
              <stop offset="50%" stopColor="#f43f5e" stopOpacity="0.06" />
              <stop offset="50%" stopColor="#10b981" stopOpacity="0.06" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.38" />
            </linearGradient>
          </defs>

          {[0.25, 0.5, 0.75].map((tick) => {
            const tx = PAD_L + tick * traceData.plotW;
            return (
              <line
                key={tick}
                x1={tx}
                y1={0}
                x2={tx}
                y2={totalH}
                stroke="rgba(63,63,70,0.3)"
                strokeDasharray="3 3"
              />
            );
          })}

          <g>
            <line
              x1={PAD_L}
              y1={traceData.deltaMidY}
              x2={CHART_W - PAD_R}
              y2={traceData.deltaMidY}
              stroke="rgba(161,161,170,0.35)"
              strokeDasharray="4 4"
            />
            <path d={traceData.deltaArea} fill="url(#deltaFillGrad)" />
            <path
              d={traceData.deltaLine}
              fill="none"
              stroke="#e4e4e7"
              strokeWidth={1.6}
            />
            <text
              x={6}
              y={16}
              fill="#a1a1aa"
              fontSize="9"
              fontWeight="700"
            >
              Δt (s)
            </text>
            <text x={6} y={28} fill="#f43f5e" fontSize="8">
              +{traceData.deltaBound.toFixed(1)}
            </text>
            <text x={6} y={DELTA_H - 10} fill="#10b981" fontSize="8">
              -{traceData.deltaBound.toFixed(1)}
            </text>
          </g>

          <line
            x1={0}
            y1={speedTopY}
            x2={CHART_W}
            y2={speedTopY}
            stroke="rgba(39,39,42,0.9)"
          />

          <g transform={`translate(0, ${speedTopY})`}>
            <path
              d={traceData.speedPathA}
              fill="none"
              stroke="#22d3ee"
              strokeWidth={1.8}
              opacity={0.9}
            />
            <path
              d={traceData.speedPathB}
              fill="none"
              stroke="#f43f5e"
              strokeWidth={1.8}
              opacity={0.95}
            />
            <text x={6} y={16} fill="#a1a1aa" fontSize="9" fontWeight="700">
              SPD
            </text>
            <text x={6} y={28} fill="#71717a" fontSize="8">
              {traceData.speedCeil}
            </text>
            <text x={6} y={SPEED_H - 10} fill="#71717a" fontSize="8">
              0
            </text>
          </g>

          <line
            x1={0}
            y1={extraTopY}
            x2={CHART_W}
            y2={extraTopY}
            stroke="rgba(39,39,42,0.9)"
          />

          <g transform={`translate(0, ${extraTopY})`}>
            {secondaryChannel !== "rpm" && (
              <line
                x1={PAD_L}
                y1={EXTRA_H / 2}
                x2={CHART_W - PAD_R}
                y2={EXTRA_H / 2}
                stroke="rgba(161,161,170,0.3)"
                strokeDasharray="3 3"
              />
            )}
            <path
              d={extraPathA}
              fill="none"
              stroke="#22d3ee"
              strokeWidth={1.5}
              opacity={0.85}
            />
            <path
              d={extraPathB}
              fill="none"
              stroke="#f43f5e"
              strokeWidth={1.5}
              opacity={0.9}
            />
            <text x={6} y={16} fill="#a1a1aa" fontSize="9" fontWeight="700">
              {secondaryChannel === "rpm"
                ? "RPM"
                : secondaryChannel === "latAcc"
                  ? "LAT G"
                  : "LON G"}
            </text>
            <text x={6} y={28} fill="#71717a" fontSize="8">
              {secondaryChannel === "rpm"
                ? `${Math.round(traceData.rpmCeil / 1000)}k`
                : `+${traceData.gBound.toFixed(1)}`}
            </text>
            <text x={6} y={EXTRA_H - 10} fill="#71717a" fontSize="8">
              {secondaryChannel === "rpm"
                ? "0"
                : `-${traceData.gBound.toFixed(1)}`}
            </text>
          </g>

          <line
            x1={cursorX}
            y1={0}
            x2={cursorX}
            y2={totalH}
            stroke="#f4f4f5"
            strokeWidth={1.5}
          />
          <circle
            cx={cursorX}
            cy={
              speedTopY +
              PAD_Y +
              (1 -
                Math.max(
                  0,
                  Math.min(1, snapshot.pointA.speed / traceData.speedCeil),
                )) *
                (SPEED_H - PAD_Y * 2)
            }
            r={3.5}
            fill="#22d3ee"
          />
          <circle
            cx={cursorX}
            cy={
              speedTopY +
              PAD_Y +
              (1 -
                Math.max(
                  0,
                  Math.min(1, snapshot.pointB.speed / traceData.speedCeil),
                )) *
                (SPEED_H - PAD_Y * 2)
            }
            r={3.5}
            fill="#f43f5e"
          />
        </svg>
      </div>
    </div>
  );
}
