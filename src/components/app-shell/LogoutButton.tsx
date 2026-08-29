"use client";

import { LogOut } from "lucide-react";

import { signOutAction } from "@/app/(auth)/actions";
import { cn } from "@/lib/utils/cn";

export function LogoutButton({
  variant = "nav",
}: {
  variant?: "nav" | "button";
}) {
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        className={cn(
          variant === "nav"
            ? "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
            : "inline-flex items-center gap-2 rounded-md border border-border-strong bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-surface-sunken",
        )}
      >
        <LogOut aria-hidden className="size-4" />
        Logout
      </button>
    </form>
  );
}
