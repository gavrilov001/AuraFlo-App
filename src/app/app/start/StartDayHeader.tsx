export function StartDayHeader({
  greeting,
  name,
  dateLabel,
}: {
  greeting: string;
  name: string | null;
  dateLabel: string;
}) {
  return (
    <header className="flex flex-col gap-1.5">
      <p className="text-[13px] text-faint">{dateLabel}</p>
      <h1 className="text-[clamp(2rem,1.6rem+1.3vw,2.5rem)] font-semibold leading-tight tracking-[-0.015em] text-ink">
        {greeting}
        {name ? `, ${name}` : ""}
      </h1>
      <p className="max-w-xl text-[16px] leading-relaxed text-muted">
        Let&rsquo;s turn what&rsquo;s on your mind into a clear plan for today.
      </p>
    </header>
  );
}
