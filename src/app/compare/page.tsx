import type { Metadata } from "next";
import LapCompareStudio from "@/components/LapCompareStudio";
import StudioHeader from "@/components/StudioHeader";

export const metadata: Metadata = {
  title: "3D Lap Compare - Open RaceRender Web",
  description:
    "Upload multiple AiM RaceStudio CSV files and compare karting lines, speeds, and time deltas in interactive 3D with Three.js.",
};

export default function ComparePage() {
  return (
    <main className="min-h-screen bg-zinc-950 flex flex-col items-center">
      <StudioHeader activeRoute="compare" />

      <div className="w-full max-w-7xl px-4 py-6 text-zinc-100 select-none">
        <LapCompareStudio />
      </div>

      <footer className="w-full mt-auto border-t border-zinc-900/60 py-6 text-center select-none">
        <p className="text-[9px] text-zinc-650 uppercase tracking-widest font-bold">
          Open RaceRender Web • 3D Multi-CSV Telemetry Comparator • Powered by
          Three.js
        </p>
      </footer>
    </main>
  );
}
