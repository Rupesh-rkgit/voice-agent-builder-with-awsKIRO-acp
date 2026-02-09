import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Voice Agent Studio",
  description: "Create and manage AI agents with voice commands",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased">
        <nav className="sticky top-0 z-50 border-b border-slate-800 bg-slate-950/80 backdrop-blur-sm">
          <div className="flex h-14 items-center justify-between px-6">
            <a href="/" className="flex items-center gap-2 text-lg font-semibold">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600 text-sm">⚡</span>
              Voice Agent Studio
            </a>
            <div className="flex items-center gap-3">
              <a href="/" className="rounded-lg px-3 py-1.5 text-sm text-slate-400 hover:text-white hover:bg-slate-800 transition-colors">
                Dashboard
              </a>
              <a href="/agents/new" className="rounded-lg bg-violet-600 px-4 py-1.5 text-sm font-medium hover:bg-violet-700 transition-colors">
                + New Agent
              </a>
            </div>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
