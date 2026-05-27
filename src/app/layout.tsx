import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RaceRender Web HUD - Telemetry Overlay Studio",
  description: "Synchronize and render beautiful RPM, Speedometer, G-force, and track map telemetry overlays onto POV racing videos, fully client-side.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased dark">
      <body className="min-h-full flex flex-col bg-zinc-950 text-zinc-100">{children}</body>
    </html>
  );
}
