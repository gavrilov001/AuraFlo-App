import styles from "@/components/welcome/welcome.module.css";

/**
 * Decorative product-flow composition: a loose "brain dump" of captured
 * thoughts resolving into a calm "start your day" decision surface.
 * Purely visual — hidden from assistive tech.
 */
export function AuthWorkflow() {
  return (
    <div className={styles.workflow} aria-hidden="true">
      <div className={styles.workflowFull}>
        <div className={styles.wfGrid}>
          <div className={styles.wfCol}>
            <span className={`${styles.wfLabel} ${styles.wfBrainLabel}`}>
              Brain dump
            </span>
            <div className={styles.wfThoughts}>
              <div className={styles.wfThought}>Call the dentist</div>
              <div className={styles.wfThought}>
                Review the proposal
                <span className={styles.wfThoughtTime}>captured 8:14</span>
              </div>
              <div className={styles.wfThought}>Plan next week</div>
            </div>
          </div>

          <svg
            className={styles.wfArrow}
            width="80"
            height="140"
            viewBox="0 0 80 140"
            fill="none"
          >
            <path
              className={styles.wfArrowLine}
              d="M4 116 C 44 112, 34 34, 68 26"
            />
            <path
              className={styles.wfArrowHead}
              d="M58 22 L 70 25 L 64 36"
            />
          </svg>
          <span className={styles.wfArrowV} />

          <div className={`${styles.wfCol} ${styles.wfPanel}`}>
            <span className={`${styles.wfLabel} ${styles.wfStartLabel}`}>
              Start your day
            </span>
            <p className={styles.wfPanelHeading}>Choose what happens next</p>
            <div className={styles.wfDecision}>
              <span className={`${styles.wfTag} ${styles.wfTagNow}`}>
                Do now
              </span>
              Review the proposal
            </div>
            <div className={styles.wfDecision}>
              <span className={`${styles.wfTag} ${styles.wfTagSchedule}`}>
                Schedule
              </span>
              Call the dentist
            </div>
            <div className={styles.wfDecision}>
              <span className={`${styles.wfTag} ${styles.wfTagLater}`}>
                Later
              </span>
              Plan next week
            </div>
          </div>
        </div>

        <p className={styles.wfFootnote}>A clear direction for today</p>
      </div>

      <div className={styles.wfCompact}>
        <span>Brain dump</span>
        <span className={styles.wfCompactArrow} />
        <span>Start your day</span>
      </div>
    </div>
  );
}
