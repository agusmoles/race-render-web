"use client";

import React, { useEffect, useRef } from "react";

interface GForceRadarProps {
  latAcc: number; // lateral acceleration in Gs
  lonAcc: number; // longitudinal acceleration in Gs
}

export default function GForceRadar({ latAcc = 0, lonAcc = 0 }: GForceRadarProps) {
  // Store history of Gs to draw tail/trail effect
  const historyRef = useRef<{ x: number; y: number }[]>([]);

  // Update trail history
  useEffect(() => {
    historyRef.current.push({ x: latAcc, y: lonAcc });
    if (historyRef.current.length > 6) {
      historyRef.current.shift();
    }
  }, [latAcc, lonAcc]);

  const maxG = 1.6; // Scale of radar
  const center = 100;
  const radius = 80;

  // Convert G values to SVG Coordinates
  // Positive latAcc is right, negative is left
  // Positive lonAcc is acceleration (up in graph) or braking (down in graph). Aim standard: LonAcc negative is braking (down).
  const getCoordinates = (gX: number, gY: number) => {
    const x = center + (gX / maxG) * radius;
    // In SVG, y axis goes down. So we invert gY so positive (acceleration) goes UP
    const y = center - (gY / maxG) * radius;
    return {
      x: Math.max(center - radius, Math.min(center + radius, x)),
      y: Math.max(center - radius, Math.min(center + radius, y)),
    };
  };

  const currentCoords = getCoordinates(latAcc, lonAcc);

  return (
    <div className="flex flex-col items-center justify-center bg-zinc-900/85 backdrop-blur-md border border-zinc-800 rounded-2xl p-4 w-full h-full text-zinc-100 shadow-2xl relative select-none">
      <div className="absolute top-2 left-3 text-[10px] uppercase tracking-wider text-zinc-500 font-sans">
        G-Force
      </div>
      
      <div className="absolute top-2 right-3 flex space-x-2 text-[9px] font-mono text-zinc-400">
        <div>LAT: <span className="font-bold">{latAcc.toFixed(2)}G</span></div>
        <div>LON: <span className="font-bold">{lonAcc.toFixed(2)}G</span></div>
      </div>

      <div className="relative w-36 h-36 mt-2">
        <svg className="w-full h-full" viewBox="0 0 200 200">
          {/* Outer circle 1.5G */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="#27272a"
            strokeWidth={1}
            strokeDasharray="4 4"
          />
          <text
            x={center + radius - 12}
            y={center - 4}
            fill="#52525b"
            fontSize="8"
            className="font-mono font-bold"
          >
            1.5G
          </text>

          {/* Middle circle 1.0G */}
          <circle
            cx={center}
            cy={center}
            r={radius * (1.0 / maxG)}
            fill="none"
            stroke="#3f3f46"
            strokeWidth={1}
          />
          <text
            x={center + radius * (1.0 / maxG) - 12}
            y={center - 4}
            fill="#52525b"
            fontSize="8"
            className="font-mono font-bold"
          >
            1.0G
          </text>

          {/* Inner circle 0.5G */}
          <circle
            cx={center}
            cy={center}
            r={radius * (0.5 / maxG)}
            fill="none"
            stroke="#27272a"
            strokeWidth={1}
            strokeDasharray="2 2"
          />

          {/* Crosshairs */}
          <line
            x1={center - radius}
            y1={center}
            x2={center + radius}
            y2={center}
            stroke="#27272a"
            strokeWidth={1}
          />
          <line
            x1={center}
            y1={center - radius}
            x2={center}
            y2={center + radius}
            stroke="#27272a"
            strokeWidth={1}
          />

          {/* Trail / Tail circles */}
          {historyRef.current.slice(0, -1).map((gPoint, index) => {
            const coords = getCoordinates(gPoint.x, gPoint.y);
            const opacity = (index + 1) / historyRef.current.length;
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

          {/* Current G dot */}
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
