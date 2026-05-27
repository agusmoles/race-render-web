"use client";

import React, { useState } from "react";

interface GForceRadarProps {
  latAcc: number;
  lonAcc: number;
}

export default function GForceRadar({ latAcc = 0, lonAcc = 0 }: GForceRadarProps) {
  const [prevG, setPrevG] = useState({ latAcc, lonAcc });
  const [history, setHistory] = useState<{ x: number; y: number }[]>([]);

  if (latAcc !== prevG.latAcc || lonAcc !== prevG.lonAcc) {
    setPrevG({ latAcc, lonAcc });
    setHistory((prev) => {
      const updated = [...prev, { x: latAcc, y: lonAcc }];
      return updated.length > 6 ? updated.slice(updated.length - 6) : updated;
    });
  }

  const maxG = 1.6;
  const center = 100;
  const radius = 80;

  const getCoordinates = (gX: number, gY: number) => {
    const x = center - (gX / maxG) * radius;
    const y = center + (gY / maxG) * radius;
    return {
      x: Math.max(center - radius, Math.min(center + radius, x)),
      y: Math.max(center - radius, Math.min(center + radius, y)),
    };
  };

  const currentCoords = getCoordinates(latAcc, lonAcc);

  return (
    <div className="flex flex-col items-center justify-center w-full h-full text-zinc-100 relative select-none">
      <div className="flex justify-center space-x-3 text-[9px] font-mono text-white/70 mb-1">
        <div>LAT: <span className="font-bold text-white/90">{latAcc.toFixed(2)}G</span></div>
        <div>LON: <span className="font-bold text-white/90">{lonAcc.toFixed(2)}G</span></div>
      </div>

      <div className="relative w-36 h-36">
        <svg className="w-full h-full" viewBox="0 0 200 200">
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.2)"
            strokeWidth={1}
            strokeDasharray="4 4"
          />

          <circle
            cx={center}
            cy={center}
            r={radius * (1.0 / maxG)}
            fill="none"
            stroke="rgba(255,255,255,0.3)"
            strokeWidth={1}
          />

          <circle
            cx={center}
            cy={center}
            r={radius * (0.5 / maxG)}
            fill="none"
            stroke="rgba(255,255,255,0.15)"
            strokeWidth={1}
            strokeDasharray="2 2"
          />

          <line
            x1={center - radius}
            y1={center}
            x2={center + radius}
            y2={center}
            stroke="rgba(255,255,255,0.18)"
            strokeWidth={1}
          />
          <line
            x1={center}
            y1={center - radius}
            x2={center}
            y2={center + radius}
            stroke="rgba(255,255,255,0.18)"
            strokeWidth={1}
          />

          {history.slice(0, -1).map((gPoint, index) => {
            const coords = getCoordinates(gPoint.x, gPoint.y);
            const opacity = (index + 1) / history.length;
            const size = 3 + opacity * 3;
            return (
              <circle
                key={index}
                cx={coords.x}
                cy={coords.y}
                r={size}
                fill="#f43f5e"
                opacity={opacity * 0.4}
              />
            );
          })}

          <circle
            cx={currentCoords.x}
            cy={currentCoords.y}
            r={7}
            fill="#f43f5e"
            className="drop-shadow-[0_0_8px_rgba(244,63,94,0.8)] transition-all duration-75 ease-out"
          />
          <circle
            cx={currentCoords.x}
            cy={currentCoords.y}
            r={2}
            fill="#ffffff"
          />
        </svg>
      </div>
    </div>
  );
}
