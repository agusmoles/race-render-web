import Image from "next/image";
import Link from "next/link";
import { GitCompare, Video } from "lucide-react";

interface StudioHeaderProps {
  activeRoute: "hud" | "compare";
}

export default function StudioHeader({ activeRoute }: StudioHeaderProps) {
  return (
    <header className="w-full border-b border-zinc-900 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-30 select-none py-3.5 px-6">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
        <Link href="/" className="flex items-center space-x-3 group">
          <Image
            src="/assets/images/logo.png"
            alt="Logo"
            width={48}
            height={48}
          />
          <div className="flex flex-col">
            <h1 className="text-sm font-black uppercase tracking-widest text-zinc-100 flex items-center space-x-1.5 group-hover:text-cyan-300 transition-colors">
              <span>Open RaceRender</span>
              <span className="text-[10px] bg-rose-500 text-zinc-950 font-black px-1.5 py-0.5 rounded-md">
                HUD
              </span>
            </h1>
            <span className="text-[9px] text-zinc-500 uppercase tracking-widest font-bold">
              Carbon Edition Overlay Studio
            </span>
          </div>
        </Link>

        <nav className="flex items-center space-x-1.5 bg-zinc-900/80 border border-zinc-800 p-1 rounded-2xl">
          <Link
            href="/"
            className={`px-3.5 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-wider flex items-center space-x-2 transition ${
              activeRoute === "hud"
                ? "bg-cyan-400 text-zinc-950 shadow-[0_0_15px_rgba(34,211,238,0.25)]"
                : "text-zinc-400 hover:text-zinc-100"
            }`}
          >
            <Video size={14} />
            <span>POV Video HUD</span>
          </Link>
          <Link
            href="/compare"
            className={`px-3.5 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-wider flex items-center space-x-2 transition ${
              activeRoute === "compare"
                ? "bg-rose-500 text-zinc-950 shadow-[0_0_15px_rgba(244,63,94,0.3)]"
                : "text-zinc-400 hover:text-zinc-100"
            }`}
          >
            <GitCompare size={14} />
            <span>3D Lap Compare</span>
          </Link>
        </nav>

        <div className="hidden md:flex items-center space-x-4 text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">
          <div>100% Offline Client Studio</div>
          <div>•</div>
          <div>WebGL &amp; WebCodecs</div>
        </div>
      </div>
    </header>
  );
}
