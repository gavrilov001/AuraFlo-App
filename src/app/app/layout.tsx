import { getWorkspaceContext, requireUser } from "@/lib/auth/context";
import { AppShell } from "@/components/app-shell/AppShell";
import { ToastProvider } from "@/components/ui/Toast";

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  assistant: "Assistant",
};

export default async function AppLayout({ children }: LayoutProps<"/app">) {
  // Redirects to /login when unauthenticated.
  await requireUser("/app");

  const context = await getWorkspaceContext();

  if (!context) {
    // Authenticated, but the signup trigger hasn't finished provisioning the
    // profile + workspace yet. Show a calm holding screen instead of the app.
    return (
      <div className="app-root flex min-h-dvh items-center justify-center px-6 text-center">
        <div>
          <p className="text-lg font-semibold text-ink">Finishing your setup</p>
          <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted">
            Your workspace is being prepared. Give it a moment, then refresh
            this page.
          </p>
        </div>
      </div>
    );
  }

  const displayName =
    context.profile.full_name?.trim() || context.user.email || "You";
  const accountMeta =
    ROLE_LABEL[context.role] ?? context.user.email ?? "Member";

  return (
    <ToastProvider>
      <AppShell
        workspaceName={context.workspace.name}
        userName={displayName}
        accountMeta={accountMeta}
      >
        {children}
      </AppShell>
    </ToastProvider>
  );
}
