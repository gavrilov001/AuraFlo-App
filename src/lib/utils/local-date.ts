/** Timezone-aware "today" helpers for the Start My Day workflow. */

function safeZone(timezone: string | null | undefined): string {
  if (!timezone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return timezone;
  } catch {
    return "UTC";
  }
}

/** The current calendar date in `timezone`, as "YYYY-MM-DD". */
export function localDateFor(
  timezone: string | null | undefined,
  now: Date = new Date(),
): string {
  const zone = safeZone(timezone);
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Start/end of the local day as UTC ISO strings (for `due_at` range filters). */
export function localDayBoundsUtc(
  timezone: string | null | undefined,
  localDate: string,
): { startUtc: string; endUtc: string } {
  const zone = safeZone(timezone);
  // Offset (minutes) between the given zone and UTC at local noon on `localDate`.
  const noon = new Date(`${localDate}T12:00:00Z`);
  const asZone = new Date(
    noon.toLocaleString("en-US", { timeZone: zone }),
  );
  const asUtc = new Date(noon.toLocaleString("en-US", { timeZone: "UTC" }));
  const offsetMs = asUtc.getTime() - asZone.getTime();

  const startLocal = new Date(`${localDate}T00:00:00Z`).getTime() + offsetMs;
  const endLocal = startLocal + 24 * 60 * 60 * 1000;
  return {
    startUtc: new Date(startLocal).toISOString(),
    endUtc: new Date(endLocal).toISOString(),
  };
}

/** "Good morning" / "Good afternoon" / "Good evening" for the local hour. */
export function greetingFor(
  timezone: string | null | undefined,
  now: Date = new Date(),
): string {
  const zone = safeZone(timezone);
  const hourStr = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour: "numeric",
    hour12: false,
  }).format(now);
  const hour = Number.parseInt(hourStr, 10);
  if (Number.isNaN(hour)) return "Hello";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** "Tuesday, 2 September" — a quiet, human date. */
export function longLocalDate(
  timezone: string | null | undefined,
  now: Date = new Date(),
): string {
  const zone = safeZone(timezone);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);
}
