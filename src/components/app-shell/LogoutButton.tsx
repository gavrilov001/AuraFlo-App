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
    <form
      action={signOutAction}
      className={variant === "nav" ? "contents" : undefined}
    >
      <button
        type="submit"
        className={cn(
          "inline-flex items-center gap-2 rounded-md text-sm font-medium transition-colors",
          variant === "nav"
            ? "px-2.5 py-2 text-[13px] text-muted hover:bg-surface-hover hover:text-ink"
            : "h-11 border border-line bg-surface px-5 text-ink hover:bg-surface-hover",
        )}
      >
        <LogOut aria-hidden className="size-4" />
        Log out
      </button>
    </form>
  );
}
