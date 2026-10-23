/**
 * The auth routes render their own full-bleed shells (AuthShell for
 * login / signup). This layout is a passthrough.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
