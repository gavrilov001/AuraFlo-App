import Link from "next/link";

import { AuraFloWordmark } from "@/components/brand/AuraFloWordmark";
import styles from "@/components/welcome/welcome.module.css";
import { AuthWorkflow } from "./AuthWorkflow";

interface AuthShellProps {
  eyebrow: string;
  /** May contain "\n" for an intentional line break. */
  heading: string;
  subtitle: string;
  children: React.ReactNode;
}

/**
 * Shared composition for /login and /signup.
 * Desktop: two columns — brand story (55%) + form panel (45%).
 * Mobile: single column — wordmark, short intro, then the form.
 * Reuses the welcome page's navy + gold visual system.
 */
export function AuthShell({
  eyebrow,
  heading,
  subtitle,
  children,
}: AuthShellProps) {
  return (
    <div className={styles.authPage}>
      <div className={styles.authShell}>
        <section className={styles.authBrand}>
          <Link
            href="/"
            className={styles.authWordmarkLink}
            aria-label="AuraFlo home"
          >
            <AuraFloWordmark size="lg" withRule />
          </Link>

          <p className={styles.authBrandEyebrow}>From thoughts to direction</p>
          <h1 className={styles.authBrandHeading}>
            {"From brain dump\nto a day with direction."}
          </h1>
          <p className={styles.authBrandBody}>
            Capture everything pulling at your attention. Then shape it into a
            day you can actually move through.
          </p>

          <AuthWorkflow />
        </section>

        <section className={styles.authFormWrap}>
          <div className={styles.authFormPanel}>
            <p className={styles.authEyebrow}>{eyebrow}</p>
            <h2 className={styles.authHeading}>{heading}</h2>
            <p className={styles.authSubtitle}>{subtitle}</p>
            {children}
          </div>
        </section>
      </div>
    </div>
  );
}
