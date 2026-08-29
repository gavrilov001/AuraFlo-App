import styles from "./welcome.module.css";

const STEPS = [
  {
    num: "01",
    title: "Capture freely",
    body: "Get thoughts out of your head before they disappear.",
  },
  {
    num: "02",
    title: "Decide intentionally",
    body: "Do it, schedule it, delegate it, save it, or let it go.",
  },
  {
    num: "03",
    title: "Focus on what matters",
    body: "Shape a realistic day around your most important direction.",
  },
];

export function WelcomeSteps() {
  return (
    <section className={styles.steps} aria-labelledby="welcome-steps-heading">
      <h2 id="welcome-steps-heading" className={styles.srOnly}>
        How AuraFlo works
      </h2>

      <div className={styles.stepsGrid}>
        {STEPS.map((step) => (
          <div key={step.num} className={styles.step}>
            <p className={styles.stepNum}>{step.num} &mdash;</p>
            <h3 className={styles.stepTitle}>{step.title}</h3>
            <p className={styles.stepBody}>{step.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
