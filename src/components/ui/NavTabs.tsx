"use client";

import Link from "next/link";

import { cn } from "@/lib/utils/cn";

export interface NavTab {
  key: string;
  label: string;
  href: string;
  count?: number;
}

/** Editorial tabs — text label + plain count, thin gold underline when active. */
export function NavTabs({
  tabs,
  activeKey,
  label,
}: {
  tabs: NavTab[];
  activeKey: string;
  label: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-b border-line-soft"
    >
      {tabs.map((tab) => {
        const active = tab.key === activeKey;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            role="tab"
            aria-selected={active}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 pb-2.5 pt-1 text-[15px] transition-colors",
              active
                ? "border-gold font-semibold text-ink"
                : "border-transparent font-medium text-muted hover:text-ink",
            )}
          >
            {tab.label}
            {typeof tab.count === "number" && (
              <span
                className={cn(
                  "ml-1.5 text-[13px] tabular-nums",
                  active ? "text-muted" : "text-faint",
                )}
              >
                {tab.count}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
