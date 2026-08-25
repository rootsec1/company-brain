"use client";

import {
  Aperture,
  Books,
  CalendarDots,
  CirclesFour,
  Graph,
  MagnifyingGlass,
  Pulse,
  Robot,
  SlidersHorizontal,
  Sparkle
} from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

const navigation = [
  { href: "/", label: "Overview", icon: Aperture },
  { href: "/search", label: "Search", icon: MagnifyingGlass },
  { href: "/research", label: "Research", icon: Robot },
  { href: "/workflows", label: "Workflows", icon: CalendarDots },
  { href: "/graph", label: "Knowledge graph", icon: Graph },
  { href: "/integrations", label: "Integrations", icon: CirclesFour },
  { href: "/activity", label: "Activity", icon: Pulse }
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const current = navigation.find((item) => item.href === "/" ? pathname === "/" : pathname.startsWith(item.href));
  useEffect(() => {
    const openSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (pathname.startsWith("/search")) document.querySelector<HTMLInputElement>('input[placeholder="Search the company brain…"]')?.focus();
        else router.push("/search");
      }
    };
    window.addEventListener("keydown", openSearch);
    return () => window.removeEventListener("keydown", openSearch);
  }, [pathname, router]);
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/" className="brand" aria-label="Aperture overview">
          <span className="brand-mark"><Aperture size={24} weight="thin" /></span>
          <span className="brand-copy"><span className="brand-name">Aperture</span><span className="brand-sub">Company brain</span></span>
        </Link>
        <nav className="nav" aria-label="Workspace">
          {navigation.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return <Link key={item.href} href={item.href} aria-label={item.label} title={item.label} className={`nav-item ${active ? "active" : ""}`}><item.icon size={19} weight={active ? "regular" : "thin"} /><span>{item.label}</span></Link>;
          })}
        </nav>
        <nav className="nav nav-secondary" aria-label="Library">
          <Link href="/search?view=documents" aria-label="All knowledge" title="All knowledge" className="nav-item"><Books size={19} weight="thin" /><span>All knowledge</span></Link>
          <Link href="/integrations" aria-label="Source catalog" title="Source catalog" className="nav-item"><Sparkle size={19} weight="thin" /><span>Source catalog</span></Link>
        </nav>
        <div className="sidebar-footer">
          <div className="workspace-chip" title="Local workspace · no authentication"><div className="workspace-avatar">N</div><div><div>Local workspace</div><div>No authentication</div></div></div>
        </div>
      </aside>
      <header className="topbar">
        <Link href="/" className="topbar-brand">Aperture</Link>
        <span className="topbar-divider" />
        <span className="topbar-title">{current?.label ?? "Knowledge"}</span>
        <div className="topbar-spacer" />
        <span className="topbar-meta">Mode · Agent</span>
        <Link href="/search" className="topbar-search"><MagnifyingGlass size={15} weight="thin"/><span>Search</span><span className="key-hint">⌘ K</span></Link>
        <div className="status-dot" title="Workspace online" />
        <Link href="/activity" className="topbar-icon" aria-label="System status"><SlidersHorizontal size={16} weight="thin" /></Link>
      </header>
      <main>{children}</main>
      <nav className="mobile-nav" aria-label="Workspace navigation">
        {navigation.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return <Link key={item.href} href={item.href} className={active ? "active" : ""}><item.icon size={18} weight={active ? "regular" : "thin"}/><span>{item.label.replace("Knowledge ", "")}</span></Link>;
        })}
      </nav>
    </div>
  );
}
