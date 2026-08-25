"use client";

import {
  Activity, Blocks, Bot, CalendarClock, CircleGauge, GitBranch, LibraryBig, Search, Settings2, Sparkles
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

const navigation = [
  { href: "/", label: "Overview", icon: CircleGauge },
  { href: "/search", label: "Search", icon: Search },
  { href: "/research", label: "Research", icon: Bot },
  { href: "/workflows", label: "Workflows", icon: CalendarClock },
  { href: "/graph", label: "Knowledge graph", icon: GitBranch },
  { href: "/integrations", label: "Integrations", icon: Blocks },
  { href: "/activity", label: "Activity", icon: Activity }
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
        <Link href="/" className="brand">
          <div className="brand-mark" />
          <div className="brand-copy"><div className="brand-name">Aperture</div><div className="brand-sub">Company brain</div></div>
        </Link>
        <div className="nav-label">Workspace</div>
        <nav className="nav">
          {navigation.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return <Link key={item.href} href={item.href} className={`nav-item ${active ? "active" : ""}`}><item.icon size={16} /><span>{item.label}</span></Link>;
          })}
        </nav>
        <div className="nav-label">Library</div>
        <nav className="nav">
          <Link href="/search?view=documents" className="nav-item"><LibraryBig size={16} /><span>All knowledge</span></Link>
          <Link href="/integrations" className="nav-item"><Sparkles size={16} /><span>Source catalog</span></Link>
        </nav>
        <div className="sidebar-footer">
          <div className="workspace-chip"><div className="workspace-avatar">A</div><div><div style={{color:"var(--text)"}}>Local workspace</div><div style={{fontSize:10,color:"var(--faint)"}}>No authentication</div></div></div>
        </div>
      </aside>
      <header className="topbar">
        <span className="topbar-title">{current?.label ?? "Knowledge"}</span>
        <div className="topbar-spacer" />
        <Link href="/search" className="nav-item" style={{minHeight:34}}><Search size={14}/><span>Search</span><span className="key-hint">⌘ K</span></Link>
        <div className="status-dot" title="Workspace online" />
        <Link href="/activity" aria-label="System status"><Settings2 size={15} color="var(--muted)" /></Link>
      </header>
      <main>{children}</main>
      <nav className="mobile-nav" aria-label="Workspace navigation">
        {navigation.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return <Link key={item.href} href={item.href} className={active ? "active" : ""}><item.icon size={16}/><span>{item.label.replace("Knowledge ", "")}</span></Link>;
        })}
      </nav>
    </div>
  );
}
