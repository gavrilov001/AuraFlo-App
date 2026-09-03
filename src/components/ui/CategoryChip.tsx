/**
 * Category indicator: a clearly readable dot + name in a pale tinted chip.
 * The chip text is mixed heavily toward ink so it keeps a hue hint while
 * staying well above WCAG AA contrast for every category colour. Falls back
 * to a neutral chip if the colour is missing or `color-mix` is unavailable.
 */
export function CategoryChip({
  name,
  color,
}: {
  name: string;
  color?: string | null;
}) {
  const style: React.CSSProperties | undefined = color
    ? {
        // Background stays a very light tint; text and dot carry a deeper,
        // clearly readable version of the hue (WCAG AA on the surface).
        backgroundColor: `color-mix(in srgb, ${color} 14%, var(--color-surface))`,
        borderColor: `color-mix(in srgb, ${color} 32%, var(--color-surface))`,
        color: `color-mix(in srgb, ${color} 42%, #10201a)`,
      }
    : undefined;

  const dotStyle: React.CSSProperties | undefined = color
    ? { backgroundColor: `color-mix(in srgb, ${color} 90%, #0a1a12)` }
    : undefined;

  return (
    <span
      style={style}
      className="inline-flex min-w-0 items-center gap-1.5 rounded-md border border-line bg-surface-soft px-1.5 py-0.5 text-[12px] font-medium text-body"
    >
      <span
        aria-hidden
        style={dotStyle}
        className="size-1.5 shrink-0 rounded-full bg-faint"
      />
      <span className="truncate">{name}</span>
    </span>
  );
}
