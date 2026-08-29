import Link from "next/link";

import { AuraFloWordmark } from "@/components/brand/AuraFloWordmark";
import styles from "./welcome.module.css";

export function WelcomeHeader() {
  return (
    <header className={styles.header}>
      <Link href="/" aria-label="AuraFlo home">
        <AuraFloWordmark withRule />
      </Link>

      <div className={styles.headerActions}>
        <Link href="/login" className={styles.navLink}>
          Sign in
        </Link>
        <Link
          href="/signup"
          className={`${styles.btnPrimary} ${styles.btnPrimarySm}`}
        >
          Start your flow
        </Link>
      </div>
    </header>
  );
}
