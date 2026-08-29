import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="mb-8 flex items-center justify-center gap-2 text-lg font-semibold tracking-tight text-ink"
        >
          <span
            aria-hidden
            className="inline-block size-5 rounded-full border-2 border-evergreen"
          />
          AuraFlo
        </Link>
        {children}
        <p className="mt-8 text-center text-xs text-ink-subtle">
          A calm place to capture what&apos;s on your mind.
        </p>
      </div>
    </div>
  );
}
