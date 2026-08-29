import { cn } from "@/lib/utils/cn";

import styles from "@/components/welcome/welcome.module.css";

interface AuraFloWordmarkProps {
  /** Smaller type for compact placements (e.g. mobile header). */
  size?: "sm" | "md";
  /** Show the short gold rule beneath the wordmark (visible on larger screens). */
  withRule?: boolean;
  className?: string;
}

/**
 * The AuraFlo wordmark — white "Aura", gold "Flo", tight tracking, no gap,
 * no icon. Text only, matching the existing brand treatment.
 */
export function AuraFloWordmark({
  size = "md",
  withRule = false,
  className,
}: AuraFloWordmarkProps) {
  return (
    <span
      className={cn(styles.brand, size === "sm" && styles.brandSm, className)}
    >
      <span className={styles.brandName}>
        <span className={styles.brandAura}>Aura</span>
        <span className={styles.brandFlo}>Flo</span>
      </span>
      {withRule && <span className={styles.brandRule} aria-hidden="true" />}
    </span>
  );
}
