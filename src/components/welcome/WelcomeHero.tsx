import Link from "next/link";

import styles from "./welcome.module.css";
import { FlowIllustration } from "./FlowIllustration";

export function WelcomeHero() {
  return (
    <section className={styles.hero} aria-labelledby="welcome-headline">
      <div className={styles.heroCopy}>
        <p className={`${styles.eyebrow} ${styles.reveal} ${styles.d1}`}>
          A clearer start, every day
        </p>

        <h1
          id="welcome-headline"
          className={`${styles.headline} ${styles.reveal} ${styles.d2}`}
        >
          {"Clear your mind.\nShape your day."}
        </h1>

        <p className={`${styles.sub} ${styles.reveal} ${styles.d3}`}>
          Capture what&rsquo;s on your mind, choose what deserves your
          attention, and move forward without carrying everything at once.
        </p>

        <div className={`${styles.actions} ${styles.reveal} ${styles.d4}`}>
          <Link href="/signup" className={styles.btnPrimary}>
            Start your flow
          </Link>
          <Link href="/login" className={styles.secondaryLink}>
            I already have an account
          </Link>
        </div>
      </div>

      <FlowIllustration />
    </section>
  );
}
