import type { Metadata } from "next";
import { TerminalSquare } from "lucide-react";
import { Inter, Roboto_Mono, Space_Grotesk } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { AppNav } from "@/components/nav";
import { getRuntimeStatusWithHealth } from "@/lib/server/runtime";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

const robotoMono = Roboto_Mono({
  variable: "--font-roboto-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "cli-auto-complete Console",
  description: "Local control app for the cli-auto-complete daemon, SQLite logs, and model benchmarking.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const runtime = await getRuntimeStatusWithHealth();

  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable} ${robotoMono.variable}`}>
      <body>
        <div className="app-shell">
          <aside className="sidebar">
            <div className="sidebar-brand">
              <div className="sidebar-brand-mark">
                <TerminalSquare aria-hidden="true" />
              </div>
              <h1>cli-auto-complete</h1>
              <p>Terminal engine</p>
            </div>
            <AppNav />
            <div className="sidebar-cta">
              <Link href="/daemon" className="button-link sidebar-sync">
                Sync Config
              </Link>
            </div>
          </aside>
          <div className="app-main">
            <header className="topbar">
              <div className="topbar-left">
                <h2>cli-auto-complete Console</h2>
                <div className="topbar-statuses">
                  <span className={runtime.health.ok ? "status-chip status-chip-live" : "status-chip"}>
                    <span className="status-dot" aria-hidden="true" />
                    {runtime.health.ok ? "Healthy" : "Offline"}
                  </span>
                  <span className="model-chip">Model: {runtime.health.modelName}</span>
                </div>
              </div>
            </header>
            <main className="main-shell">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
