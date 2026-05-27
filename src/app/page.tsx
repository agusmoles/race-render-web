"use client";

import Workspace from "@/components/Workspace";
import { Flame } from "lucide-react";

export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-950 flex flex-col items-center">
      {/* Header section */}
      <header className="w-full border-b border-zinc-900 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-30 select-none py-4 px-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.15)]">
              <Flame size={22} className="animate-pulse" />
            </div>
            <div className="flex flex-col">
              <h1 className="text-sm font-black uppercase tracking-widest text-zinc-100 flex items-center space-x-1.5">
                <span>RaceRender</span>
                <span className="text-[10px] bg-rose-500 text-zinc-950 font-black px-1.5 py-0.5 rounded-md">
                  HUD
                </span>
              </h1>
              <span className="text-[9px] text-zinc-500 uppercase tracking-widest font-bold">
                Carbon Edition Overlay Studio
              </span>
            </div>
          </div>
          
          <div className="flex items-center space-x-6 text-[10px] text-zinc-550 uppercase tracking-wider font-semibold">
            <div>100% Offline Client Studio</div>
            <div>•</div>
            <div>GPU Accelerated Export</div>
          </div>
        </div>
      </header>

      {/* Main interactive studio dashboard workspace */}
      <Workspace />

      {/* Footer */}
      <footer className="w-full mt-auto border-t border-zinc-900/60 py-6 text-center select-none">
        <p className="text-[9px] text-zinc-650 uppercase tracking-widest font-bold">
          RaceRender Web • Crafted with precision • GPU Accelerated Rendering
        </p>
      </footer>
    </main>
  );
}
