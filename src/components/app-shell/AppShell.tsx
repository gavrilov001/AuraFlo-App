"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

import { AuraFloWordmark } from "@/components/brand/AuraFloWordmark";
import { cn } from "@/lib/utils/cn";
import { NAV_ITEMS, isNavItemActive } from "./nav";
import { LogoutButton } from "./LogoutButton";

interface AppShellProps {
  workspaceName: string;
  userName: string;
  accountMeta: string;
  children: React.ReactNode;
}

function initialOf(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed[0]!.toUpperCase() : "A";
}

export function AppShell({
  workspaceName,
  userName,
  accountMeta,
  children,
}: AppShellProps) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="app-root h-svh bg-app-bg md:p-3">
      <div className="flex h-full overflow-hidden bg-canvas md:rounded-2xl md:border md:border-line md:shadow-frame">
        {/* Desktop sidebar */}
        <aside className="hidden w-[15.5rem] shrink-0 flex-col border-r border-line bg-sidebar md:flex">
          <SidebarInner
            pathname={pathname}
            workspaceName={workspaceName}
            userName={userName}
            accountMeta={accountMeta}
          />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Mobile header — navy brand strip */}
          <header className="flex h-14 shrink-0 items-center justify-between bg-navy-900 px-4 md:hidden">
            <Link href="/app/capture" aria-label="AuraFlo — Dream Catcher">
              <AuraFloWordmark size="sm" />
            </Link>
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              aria-expanded={drawerOpen}
              className="inline-flex size-9 items-center justify-center rounded-md text-cream-70 hover:bg-white/10 hover:text-cream"
            >
              <Menu aria-hidden className="size-5" />
            </button>
          </header>

          {drawerOpen && (
            <MobileDrawer
              pathname={pathname}
              workspaceName={workspaceName}
              userName={userName}
              accountMeta={accountMeta}
              onClose={() => setDrawerOpen(false)}
            />
          )}

          <main className="min-w-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[1560px] px-[clamp(1.5rem,3.5vw,3.5rem)] py-[clamp(1.75rem,3vw,3.25rem)]">
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

function SidebarInner({
  pathname,
  workspaceName,
  userName,
  accountMeta,
  onNavigate,
}: {
  pathname: string;
  workspaceName: string;
  userName: string;
  accountMeta: string;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full flex-col p-3.5">
      <Link
        href="/app/capture"
        aria-label="AuraFlo — Dream Catcher"
        onClick={onNavigate}
        className="rounded-md px-2 py-1"
      >
        <AuraFloWordmark size="md" variant="onLight" withRule />
      </Link>
      <p
        className="mt-2 truncate px-2 text-[13px] text-faint"
        title={workspaceName}
      >
        {workspaceName}
      </p>

      <nav
        aria-label="Primary"
        className="mt-6 flex flex-1 flex-col gap-0.5"
      >
        {NAV_ITEMS.map((item) => {
          const active = isNavItemActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              onClick={onNavigate}
              className={cn(
                "group relative flex h-10 items-center gap-2.5 rounded-md pl-3.5 pr-2.5 text-[14px] transition-colors",
                active
                  ? "bg-beige font-medium text-ink"
                  : "text-muted hover:bg-surface-hover hover:text-ink",
              )}
            >
              {active && (
                <span
                  aria-hidden
                  className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-gold"
                />
              )}
              <Icon
                aria-hidden
                className={cn(
                  "size-[17px] shrink-0",
                  active
                    ? "text-gold-dark"
                    : "text-faint group-hover:text-muted",
                )}
              />
              <span className="flex-1 truncate">{item.label}</span>
              {!item.ready && (
                <span className="text-[11px] font-normal text-faint">
                  Planned
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="mt-3 border-t border-line pt-3">
        <div className="flex items-center gap-2.5 px-1.5 py-1">
          <span
            aria-hidden
            className="grid size-8 shrink-0 place-items-center rounded-full bg-navy-900 text-[12px] font-semibold text-cream"
          >
            {initialOf(userName)}
          </span>
          <div className="min-w-0 flex-1">
            <p
              className="truncate text-[13px] font-medium text-ink"
              title={userName}
            >
              {userName}
            </p>
            <p className="truncate text-[11px] text-faint" title={accountMeta}>
              {accountMeta}
            </p>
          </div>
        </div>
        <div className="mt-0.5 flex">
          <LogoutButton />
        </div>
      </div>
    </div>
  );
}

function MobileDrawer({
  pathname,
  workspaceName,
  userName,
  accountMeta,
  onClose,
}: {
  pathname: string;
  workspaceName: string;
  userName: string;
  accountMeta: string;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const openedAt = useRef(pathname);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  useEffect(() => {
    if (pathname !== openedAt.current) onClose();
  }, [pathname, onClose]);

  return (
    <div className="fixed inset-0 z-40 md:hidden">
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className="absolute inset-0 bg-navy-900/25 motion-safe:animate-[app-fade-in_150ms_ease-out]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        className="absolute inset-y-0 left-0 w-[min(18rem,82vw)] overflow-y-auto border-r border-line bg-sidebar motion-safe:animate-[app-fade-in_180ms_ease-out]"
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close menu"
          className="absolute right-3 top-3 z-10 inline-flex size-9 items-center justify-center rounded-md text-muted hover:bg-surface-hover hover:text-ink"
        >
          <X aria-hidden className="size-5" />
        </button>
        <div className="min-h-full">
          <SidebarInner
            pathname={pathname}
            workspaceName={workspaceName}
            userName={userName}
            accountMeta={accountMeta}
            onNavigate={onClose}
          />
        </div>
      </div>
    </div>
  );
}
