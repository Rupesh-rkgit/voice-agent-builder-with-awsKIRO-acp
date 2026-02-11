import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Voice Agent Studio",
  description: "Create and manage AI agents with voice commands",
};

function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="14" cy="14" r="13" stroke="url(#logo-grad)" strokeWidth="1.5" opacity="0.4" />
      <rect x="7" y="11" width="2" height="6" rx="1" fill="url(#logo-grad)" />
      <rect x="11" y="8" width="2" height="12" rx="1" fill="url(#logo-grad)" />
      <rect x="15" y="6" width="2" height="16" rx="1" fill="url(#logo-grad)" />
      <rect x="19" y="9" width="2" height="10" rx="1" fill="url(#logo-grad)" />
      <defs>
        <linearGradient id="logo-grad" x1="0" y1="0" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor="#a78bfa" />
          <stop offset="1" stopColor="#6366f1" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${inter.variable}`}>
      <body className={`min-h-screen antialiased ${inter.className}`}>
        {/* Header */}
        <nav className="nav-header sticky top-0 z-50">
          <div className="flex h-16 items-center justify-between px-6">
            {/* Brand */}
            <a href="/" className="flex items-center gap-3 group">
              <div className="relative">
                <div className="logo-glow absolute inset-0 rounded-full" />
                <Logo />
              </div>
              <div className="flex flex-col">
                <span className="text-[15px] font-bold tracking-tight text-white leading-tight">
                  Voice Agent Studio
                </span>
                <span className="text-[10px] font-medium text-slate-500 tracking-wider uppercase leading-tight">
                  Powered by Kiro
                </span>
              </div>
            </a>

            {/* Nav */}
            <div className="flex items-center gap-1">
              <a
                href="/agents"
                className="nav-link flex items-center gap-2 rounded-lg px-3.5 py-2 text-[13px] font-medium text-slate-400 hover:text-white transition-all duration-200"
              >
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" className="opacity-60">
                  <rect x="1" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
                  <rect x="9" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
                  <rect x="1" y="9" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
                  <rect x="9" y="9" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
                </svg>
                Agents
              </a>
              <a
                href="/history"
                className="nav-link flex items-center gap-2 rounded-lg px-3.5 py-2 text-[13px] font-medium text-slate-400 hover:text-white transition-all duration-200"
              >
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" className="opacity-60">
                  <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.3"/>
                  <path d="M8 4v4l2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                History
              </a>
              <div className="w-px h-5 bg-white/[0.06] mx-1.5" />
              <a
                href="/agents/new"
                className="btn-primary flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-semibold text-white transition-all duration-200"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                New Agent
              </a>
            </div>
          </div>
          <div className="nav-glow-line" />
        </nav>

        {/* Page content */}
        <main>
          {children}
        </main>

        {/* Footer */}
        <footer className="border-t border-white/[0.04] bg-[#06060b]">
          <div className="flex h-12 items-center justify-between px-6">
            <div className="flex items-center gap-4">
              <span className="text-[11px] text-slate-600 font-medium">Voice Agent Studio</span>
              <span className="text-[11px] text-slate-700">v1.0.0</span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-[11px] text-slate-700">Kiro CLI + ACP</span>
              <span className="flex items-center gap-1.5 text-[11px] text-slate-600">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                System Healthy
              </span>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
