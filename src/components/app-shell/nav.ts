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
  /** Show in the mobile bottom bar. */
  primaryMobile?: boolean;
  /** Available in this phase (others are "coming next phase"). */
  ready: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Today", href: "/app/today", icon: Sun, ready: false },
  {
    label: "Dream Catcher",
    href: "/app/capture",
    icon: NotebookPen,
    primaryMobile: true,
    ready: true,
  },
  { label: "Start My Day", href: "/app/start", icon: Sunrise, ready: false },
  {
    label: "Focus",
    href: "/app/focus",
    icon: Compass,
    primaryMobile: true,
    ready: true,
  },
  { label: "All Tasks", href: "/app/tasks", icon: ListChecks, ready: false },
  {
    label: "Settings",
    href: "/app/settings",
    icon: Settings,
    primaryMobile: true,
    ready: true,
  },
];
