"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils/cn";
import { NAV_ITEMS } from "./nav";
import { LogoutButton } from "./LogoutButton";

interface AppShellProps {
  workspaceName: string;
  userName: string;
  children: React.ReactNode;
}

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({
  workspaceName,
  userName,
  children,
}: AppShellProps) {
  const pathname = usePathname();
  const mobileItems = NAV_ITEMS.filter((item) => item.primaryMobile);

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface px-3 py-5 md:flex">
        <div className="px-3">
          <div className="flex items-center gap-2 text-base font-semibold tracking-tight text-ink">
            <span
              aria-hidden
              className="inline-block size-4 rounded-full border-2 border-evergreen"
            />
            AuraFlo
          </div>
          <p className="mt-1 truncate text-xs text-ink-muted" title={workspaceName}>
            {workspaceName}
          </p>
        </div>

        <nav aria-label="Primary" className="mt-6 flex flex-1 flex-col gap-1">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-evergreen-soft text-evergreen"
                    : "text-ink-muted hover:bg-surface-sunken hover:text-ink",
                )}
              >
                <Icon aria-hidden className="size-4" />
                <span className="flex-1">{item.label}</span>
                {!item.ready && (
                  <span className="rounded-sm bg-amber-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber">
                    Soon
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="mt-4 border-t border-border pt-3">
          <p className="truncate px-3 pb-1 text-xs text-ink-subtle" title={userName}>
            {userName}
          </p>
          <LogoutButton />
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-3 md:hidden">
        <div className="flex items-center gap-2 text-base font-semibold tracking-tight text-ink">
          <span
            aria-hidden
            className="inline-block size-4 rounded-full border-2 border-evergreen"
          />
          AuraFlo
        </div>
        <span className="max-w-[45%] truncate text-xs text-ink-muted">
          {workspaceName}
        </span>
      </header>

      <main className="flex-1 px-4 py-6 pb-24 md:px-8 md:py-10 md:pb-10">
        <div className="mx-auto w-full max-w-3xl">{children}</div>
      </main>

      {/* Mobile bottom navigation */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-10 flex border-t border-border bg-surface md:hidden"
      >
        {mobileItems.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium",
                active ? "text-evergreen" : "text-ink-muted",
              )}
            >
              <Icon aria-hidden className="size-5" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
