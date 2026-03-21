"use client";

import type { LucideIcon } from "lucide-react";
import {
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
  { href: "/suggestions", label: "Suggestions", icon: SearchCode },
  { href: "/commands", label: "Signals", icon: Sparkles },
  { href: "/ranking", label: "Ranking", icon: ChartColumnBig },
  { href: "/lab", label: "Model Lab", icon: FlaskConical },
  { href: "/daemon", label: "Ops", icon: ServerCog },
] satisfies Array<{ href: string; label: string; icon: LucideIcon }>;

export function AppNav() {
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
          >
            <Icon className="nav-link-icon" aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
