"use client";

import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Boxes,
  ChartColumnBig,
  FlaskConical,
  LayoutDashboard,
  SearchCode,
  ServerCog,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/performance", label: "Performance", icon: Activity },
  { href: "/suggestions", label: "Suggestions", icon: SearchCode },
  { href: "/commands", label: "Signals", icon: Sparkles },
  { href: "/inspector", label: "Inspector", icon: ChartColumnBig },
  { href: "/lab", label: "Benchmarks", icon: FlaskConical },
  { href: "/models", label: "Models", icon: Boxes },
  { href: "/daemon", label: "Daemon", icon: ServerCog },
] satisfies Array<{ href: string; label: string; icon: LucideIcon }>;

export function AppNav({ collapsed = false }: { collapsed?: boolean }) {
  const pathname = usePathname();

  return (
    <nav className="app-nav">
      {NAV_ITEMS.map((item) => {
        const active =
          item.href === "/" ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={active ? "nav-link nav-link-active" : "nav-link"}
            aria-label={item.label}
            title={item.label}
          >
            <Icon className="nav-link-icon" aria-hidden="true" />
            <span className={collapsed ? "nav-link-label visually-hidden" : "nav-link-label"}>
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
