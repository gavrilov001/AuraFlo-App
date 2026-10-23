const FALLBACK = "#a79f90";

/** Small metadata indicator for a user-defined category colour. */
export function CategoryDot({
  color,
  className = "size-2",
}: {
  color?: string | null;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 rounded-full ${className}`}
      style={{ backgroundColor: color || FALLBACK }}
    />
  );
}
