import type { Metadata } from "next";
import LapCompareStudio from "@/components/LapCompareStudio";
import StudioFooter from "@/components/StudioFooter";
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

      <StudioFooter subtitle="3D Multi-CSV Telemetry Comparator • Powered by Three.js" />
    </main>
  );
}
