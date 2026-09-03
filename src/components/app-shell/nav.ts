import {
  Compass,
  ListChecks,
  type LucideIcon,
  NotebookPen,
  Settings,
  Sun,
  Sunrise,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** false = route exists but the feature is a styled placeholder ("PLANNED"). */
  ready: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Today", href: "/app/today", icon: Sun, ready: true },
  { label: "Dream Catcher", href: "/app/capture", icon: NotebookPen, ready: true },
  { label: "Start My Day", href: "/app/start", icon: Sunrise, ready: true },
  { label: "Focus", href: "/app/focus", icon: Compass, ready: true },
  { label: "All Tasks", href: "/app/tasks", icon: ListChecks, ready: true },
  { label: "Settings", href: "/app/settings", icon: Settings, ready: true },
];

export function isNavItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
