import { getWorkspaceContext, requireUser } from "@/lib/auth/context";
import { AppShell } from "@/components/app-shell/AppShell";
import { EmptyState } from "@/components/ui/Surface";

export default async function AppLayout({ children }: LayoutProps<"/app">) {
  // Redirects to /login when unauthenticated.
  await requireUser("/app");

  const context = await getWorkspaceContext();

  if (!context) {
    // Authenticated, but the signup trigger hasn't finished provisioning the
    // profile + workspace yet. Show a calm holding screen instead of the app.
    return (
      <div className="flex min-h-dvh items-center justify-center px-4">
        <EmptyState
          className="max-w-md"
          title="Finishing your setup"
          description="Your workspace is being prepared. Give it a moment, then refresh this page."
        />
      </div>
    );
  }

  return (
    <AppShell
      workspaceName={context.workspace.name}
      userName={context.profile.full_name ?? context.user.email ?? "You"}
    >
      {children}
    </AppShell>
  );
}
