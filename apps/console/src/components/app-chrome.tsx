"use client";

import { PanelLeftClose, PanelLeftOpen, TerminalSquare } from "lucide-react";
import { useState } from "react";

import { AppNav } from "@/components/nav";
import type { RuntimeStatus } from "@/lib/types";

interface AppChromeProps {
  runtime: RuntimeStatus;
  children: React.ReactNode;
}

export function AppChrome({ runtime, children }: AppChromeProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className={collapsed ? "app-shell sidebar-collapsed" : "app-shell"}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-mark">
            <TerminalSquare aria-hidden="true" />
          </div>
          <h1>cli-auto-complete</h1>
          <p>Terminal engine</p>
        </div>
        <AppNav collapsed={collapsed} />
      </aside>
      <div className="app-main">
        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="icon-button sidebar-toggle"
              onClick={() => setCollapsed((current) => !current)}
              aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
              aria-pressed={collapsed}
              title={collapsed ? "Expand navigation" : "Collapse navigation"}
            >
              {collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
            </button>
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
  );
}
