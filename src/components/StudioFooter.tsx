interface StudioFooterProps {
  subtitle: string;
}

export default function StudioFooter({ subtitle }: StudioFooterProps) {
  return (
    <footer className="w-full mt-auto border-t border-zinc-900/60 py-6 px-6 text-center">
      <div className="max-w-7xl mx-auto flex flex-col items-center space-y-2">
        <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold select-none">
          Open RaceRender Web • {subtitle}
        </p>
        <p className="text-xs text-zinc-500 flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
          <span>
            Created by{" "}
            <a
              href="https://agustinmoles.com.ar"
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-300 hover:text-cyan-400 transition-colors underline underline-offset-4 decoration-zinc-700 hover:decoration-cyan-400"
            >
              Agustín Molés
            </a>
          </span>
          <span className="text-zinc-700" aria-hidden="true">
            •
          </span>
          <span>
            Open source —{" "}
            <a
              href="https://github.com/agusmoles/race-render-web"
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-300 hover:text-cyan-400 transition-colors underline underline-offset-4 decoration-zinc-700 hover:decoration-cyan-400"
            >
              contribute on GitHub
            </a>
          </span>
        </p>
      </div>
    </footer>
  );
}
