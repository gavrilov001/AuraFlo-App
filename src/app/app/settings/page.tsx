import type { Metadata } from "next";

import { requireWorkspaceContext } from "@/lib/auth/context";
import { listTimeZones } from "@/lib/utils/timezones";
import { PageHeader } from "@/components/ui/PageHeader";
import { LogoutButton } from "@/components/app-shell/LogoutButton";
import { ProfileForm } from "./ProfileForm";
import { WorkspaceForm } from "./WorkspaceForm";

export const metadata: Metadata = { title: "Settings" };

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-x-10 gap-y-4 border-t border-line-soft py-8 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
      <div>
        <h2 className="text-[17px] font-semibold text-ink">{title}</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">{description}</p>
      </div>
      <div>{children}</div>
    </section>
  );
}

export default async function SettingsPage() {
  const { user, profile, workspace, role } = await requireWorkspaceContext();
  const timezones = listTimeZones();
  const canEditWorkspace = role === "owner" || role === "admin";

  return (
    <div className="flex max-w-[800px] flex-col gap-2">
      <PageHeader title="Settings" subtitle={`Signed in as ${user.email}`} />

      <div className="mt-4">
        <Section
          title="Profile"
          description="Your name and timezone. Times across AuraFlo are shown in your timezone."
        >
          <ProfileForm
            initialName={profile.full_name ?? ""}
            initialTimezone={profile.timezone}
            timezones={timezones}
          />
        </Section>

        <Section
          title="Workspace"
          description={
            canEditWorkspace
              ? "The name your workspace shows across the app."
              : "Only an owner or admin can rename this workspace."
          }
        >
          <WorkspaceForm
            initialName={workspace.name}
            canEdit={canEditWorkspace}
          />
        </Section>

        <Section
          title="Session"
          description="Sign out of AuraFlo on this device."
        >
          <LogoutButton variant="button" />
        </Section>
      </div>
    </div>
  );
}
