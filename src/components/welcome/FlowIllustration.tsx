import styles from "./welcome.module.css";

const THOUGHTS = [
  { text: "Book dentist appointment", meta: "captured 9:02" },
  { text: "Review the proposal", meta: null },
  { text: "Plan next week", meta: null },
];

const PRIORITIES = ["Finish the proposal", "Confirm the appointment", "Plan Monday"];

/**
 * Decorative editorial illustration: quickly captured thoughts flowing into a
 * calm "Today" plan. Purely visual — hidden from assistive tech; the same idea
 * is carried by the hero copy and the steps below.
 */
export function FlowIllustration() {
  return (
    <div
      className={`${styles.story} ${styles.reveal} ${styles.d4}`}
      aria-hidden="true"
    >
      <div className={styles.storyGlow} />

      <div className={styles.storyGrid}>
        <svg
          className={styles.connector}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          <path
            className={styles.flowPath}
            d="M 4 74 C 30 74, 34 34, 62 30 C 78 27, 84 30, 96 30"
          />
        </svg>

        <div className={styles.storyCol}>
          <span className={styles.onMindLabel}>On my mind</span>
          <div className={styles.thoughts}>
            {THOUGHTS.map((thought) => (
              <div key={thought.text} className={styles.thought}>
                {thought.text}
                {thought.meta && (
                  <span className={styles.thoughtMeta}>{thought.meta}</span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className={styles.connectorV} />

        <div className={styles.today}>
          <span className={styles.todayKicker}>Today</span>
          <p className={styles.todayTitle}>What matters most</p>
          {PRIORITIES.map((priority) => (
            <div key={priority} className={styles.priorityRow}>
              <span className={styles.check} />
              {priority}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
