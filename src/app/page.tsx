import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getUser } from "@/lib/auth/context";
import { WelcomeHeader } from "@/components/welcome/WelcomeHeader";
import { WelcomeHero } from "@/components/welcome/WelcomeHero";
import { WelcomeSteps } from "@/components/welcome/WelcomeSteps";
import { WelcomeClosing } from "@/components/welcome/WelcomeClosing";
import styles from "@/components/welcome/welcome.module.css";

export const metadata: Metadata = {
  title: { absolute: "AuraFlo — Clear your mind, shape your day" },
  description:
    "Capture what's on your mind, choose what deserves your attention, and move forward without carrying everything at once.",
};

export default async function RootPage() {
  const user = await getUser();
  if (user) {
    redirect("/app");
  }

  return (
    <div className={styles.page}>
      <div className={styles.frame}>
        <div className={styles.inner}>
          <WelcomeHeader />
          <main>
            <WelcomeHero />
            <WelcomeSteps />
            <WelcomeClosing />
          </main>
        </div>
      </div>
    </div>
  );
}
