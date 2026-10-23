import Image from "next/image";

import { cn } from "@/lib/utils/cn";

import styles from "@/components/welcome/welcome.module.css";
import logo from "./auraflo-logo.png";

interface AuraFloWordmarkProps {
  /** Type size for the placement. */
  size?: "sm" | "md" | "lg";
  /** "onDark" (default) = inverted to white for dark surfaces; "onLight" = original black. */
  variant?: "onDark" | "onLight";
  /** Show the short gold rule beneath the wordmark (visible on larger screens). */
  withRule?: boolean;
  className?: string;
}

const SIZE_CLASS: Record<NonNullable<AuraFloWordmarkProps["size"]>, string> = {
  sm: styles.brandSm,
  md: "",
  lg: styles.brandLg,
};

/**
 * The AuraFlo wordmark mark — rendered from the brand logo image.
 * On dark surfaces (default) it's inverted to white; on light surfaces it's
 * shown in its original black.
 */
export function AuraFloWordmark({
  size = "md",
  variant = "onDark",
  withRule = false,
  className,
}: AuraFloWordmarkProps) {
  return (
    <span className={cn(styles.brand, SIZE_CLASS[size], className)}>
      <Image
        src={logo}
        alt="AuraFlo"
        priority
        className={cn(
          styles.brandImg,
          variant === "onDark" && styles.brandImgOnDark,
        )}
      />
      {withRule && <span className={styles.brandRule} aria-hidden="true" />}
    </span>
  );
}
