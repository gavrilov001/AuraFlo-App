import type { Metadata } from "next";

import { requireWorkspaceContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { listTimeZones } from "@/lib/utils/timezones";
import { buildInboundAddress, buildDreamAddress } from "@/lib/email/inbound-address";
import type { SenderEmailSummary } from "@/lib/types/database.types";
import { PageHeader } from "@/components/ui/PageHeader";
import { LogoutButton } from "@/components/app-shell/LogoutButton";
import { ProfileForm } from "./ProfileForm";
import { WorkspaceForm } from "./WorkspaceForm";
import { SenderEmailsSection } from "./SenderEmailsSection";

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

  // user_sender_emails / profiles.inbound_alias only exist once
  // supabase/migrations/20261026120000_email_to_dreamcatcher.sql has been
  // applied. Until then, degrade to a "coming soon" state instead of
  // breaking the rest of Settings for existing users.
  const supabase = await createClient();
  // Select only what the UI needs — never `*`. verification_token_hash and
  // the rate-limit timestamps are internal to the RPCs above; there's no
  // reason to ship them into the client component's serialized props.
  const sendersRes = await supabase
    .from("user_sender_emails")
    .select("id, email, status, created_at")
    .order("created_at", { ascending: true });
  const emailToDreamcatcherAvailable = !sendersRes.error && Boolean(profile.inbound_alias);
  const senderEmails: SenderEmailSummary[] = sendersRes.error ? [] : sendersRes.data ?? [];
  // dream_handle (20261101000000_dream_catcher_handles.sql) is a separate,
  // later migration from the rest of Email to Dream Catcher — degrade this
  // one block independently rather than gating it on emailToDreamcatcherAvailable.
  const dreamAddress = profile.dream_handle ? buildDreamAddress(profile.dream_handle) : null;

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
          title="Email to Dream Catcher"
          description="Send a thought to your Dream Catcher from your account email, or add up to 2 more verified addresses."
        >
          {emailToDreamcatcherAvailable ? (
            <SenderEmailsSection
              primaryEmail={user.email ?? ""}
              primaryVerified={
                profile.primary_email_verified_at != null &&
                profile.primary_email_verified_email === (user.email ?? "").toLowerCase()
              }
              inboundAddress={buildInboundAddress(profile.inbound_alias)}
              dreamAddress={dreamAddress}
              initialSenderEmails={senderEmails}
            />
          ) : (
            <p className="text-sm text-muted">
              Not set up on this environment yet.
            </p>
          )}
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
