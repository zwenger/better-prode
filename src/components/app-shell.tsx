/**
 * AppShell — bottom-tab-bar shell for authenticated app routes.
 *
 * Wraps page content so it never hides behind the fixed tab bar.
 * The tab bar uses env(safe-area-inset-bottom) to stay above the
 * iPhone home indicator.
 *
 * Usage: wrap the root element of any authenticated route page with
 * <AppShell>…</AppShell>. Do NOT add it to the index/auth routes.
 */

import { Link, useRouterState } from "@tanstack/react-router";

interface Tab {
  to: string;
  label: string;
  icon: React.ReactNode;
}

function CalendarIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

const TABS: Tab[] = [
  { to: "/today", label: "Hoy", icon: <CalendarIcon /> },
  { to: "/matches", label: "Partidos", icon: <ListIcon /> },
  { to: "/groups", label: "Grupos", icon: <UsersIcon /> },
];

function TabItem({ tab }: { tab: Tab }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const isActive =
    tab.to === "/today"
      ? pathname.startsWith("/today")
      : tab.to === "/matches"
        ? pathname.startsWith("/matches")
        : pathname.startsWith("/groups") || pathname.startsWith("/leaderboard");

  return (
    <Link
      to={tab.to}
      className={[
        "flex flex-1 flex-col items-center justify-center gap-1 min-h-[44px]",
        "transition-colors duration-150 ease-out",
        isActive
          ? "text-primary bg-muted"
          : "text-muted-foreground",
      ].join(" ")}
      aria-current={isActive ? "page" : undefined}
    >
      {tab.icon}
      <span className="text-xs font-semibold">{tab.label}</span>
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Page content — padded so it doesn't hide under the tab bar */}
      <div className="pb-[calc(4rem+env(safe-area-inset-bottom))]">
        {children}
      </div>

      {/* Fixed bottom tab bar */}
      <nav
        className="fixed bottom-0 inset-x-0 z-20 bg-background border-t border-border"
        style={{
          boxShadow:
            "0 1px 2px oklch(0.22 0.015 152 / 0.06), 0 2px 8px oklch(0.22 0.015 152 / 0.08)",
        }}
        aria-label="Main navigation"
      >
        <div
          className="max-w-md mx-auto flex"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          {TABS.map((tab) => (
            <TabItem key={tab.to} tab={tab} />
          ))}
        </div>
      </nav>
    </>
  );
}
