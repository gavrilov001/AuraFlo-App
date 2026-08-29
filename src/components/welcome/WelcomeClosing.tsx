import Link from "next/link";

import styles from "./welcome.module.css";

export function WelcomeClosing() {
  return (
    <section className={styles.closing} aria-labelledby="welcome-closing-line">
      <h2 id="welcome-closing-line" className={styles.closingLine}>
        Your day doesn&rsquo;t need more noise. It needs a clearer flow.
      </h2>
      <div className={styles.closingActions}>
        <Link href="/signup" className={styles.btnPrimary}>
          Start your flow
        </Link>
      </div>
    </section>
  );
}
