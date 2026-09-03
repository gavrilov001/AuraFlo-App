import { cn } from "@/lib/utils/cn";

import styles from "@/components/welcome/welcome.module.css";

interface AuraFloWordmarkProps {
  /** Type size for the placement. */
  size?: "sm" | "md" | "lg";
  /** "onDark" (default) = cream "Aura"; "onLight" = navy "Aura". */
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
 * The AuraFlo wordmark — "Aura" + gold "Flo", tight tracking, no icon.
 * On dark surfaces "Aura" is cream; on light surfaces it is navy.
 */
export function AuraFloWordmark({
  size = "md",
  variant = "onDark",
  withRule = false,
  className,
}: AuraFloWordmarkProps) {
  return (
    <span
      className={cn(
        styles.brand,
        SIZE_CLASS[size],
        variant === "onLight" && styles.brandOnLight,
        className,
      )}
    >
      <span className={styles.brandName}>
        <span className={styles.brandAura}>Aura</span>
        <span className={styles.brandFlo}>Flo</span>
      </span>
      {withRule && <span className={styles.brandRule} aria-hidden="true" />}
    </span>
  );
}
