import type { Metadata } from "next";

import { requireWorkspaceContext } from "@/lib/auth/context";
import { listTimeZones } from "@/lib/utils/timezones";
import { Card } from "@/components/ui/Surface";
import { LogoutButton } from "@/components/app-shell/LogoutButton";
import { ProfileForm } from "./ProfileForm";
import { WorkspaceForm } from "./WorkspaceForm";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { user, profile, workspace, role } = await requireWorkspaceContext();
  const timezones = listTimeZones();
  const canEditWorkspace = role === "owner" || role === "admin";

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Settings
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Signed in as {user.email}
        </p>
      </header>

      <Card className="p-5">
        <h2 className="text-base font-semibold text-ink">Profile</h2>
        <p className="mb-4 mt-1 text-sm text-ink-muted">
          Your name and timezone. Times across AuraFlo are shown in your
          timezone.
        </p>
        <ProfileForm
          initialName={profile.full_name ?? ""}
          initialTimezone={profile.timezone}
          timezones={timezones}
        />
      </Card>

      <Card className="p-5">
        <h2 className="text-base font-semibold text-ink">Workspace</h2>
        <p className="mb-4 mt-1 text-sm text-ink-muted">
          {canEditWorkspace
            ? "The name your workspace shows across the app."
            : "Only an owner or admin can rename this workspace."}
        </p>
        <WorkspaceForm
          initialName={workspace.name}
          canEdit={canEditWorkspace}
        />
      </Card>

      <Card className="p-5">
        <h2 className="text-base font-semibold text-ink">Session</h2>
        <p className="mb-4 mt-1 text-sm text-ink-muted">
          Sign out of AuraFlo on this device.
        </p>
        <LogoutButton variant="button" />
      </Card>
    </div>
  );
}
