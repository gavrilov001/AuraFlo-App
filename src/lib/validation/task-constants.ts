/**
 * Plain constants/types/pure functions shared between the Tasks module's
 * Zod schemas (src/lib/validation/tasks.ts, server-only) and its Client
 * Components. Kept zod-free and in its own module on purpose: a Client
 * Component importing even one runtime binding from a file that also
 * builds Zod schemas at module scope pulls the whole zod runtime into the
 * browser bundle, since schema construction is a side effect and isn't
 * tree-shakeable away from the rest of the module.
 */

export const TASK_VIEWS = [
  "open",
  "today",
  "scheduled",
  "delegated",
  "later",
  "completed",
] as const;
export type TaskView = (typeof TASK_VIEWS)[number];

export const TASK_SORTS = ["manual", "due", "newest", "oldest"] as const;
export type TaskSort = (typeof TASK_SORTS)[number];

/** UI destination → db bucket. "later" is shown; "someday" is stored. */
export const DESTINATIONS = ["today", "scheduled", "delegated", "later"] as const;
export type Destination = (typeof DESTINATIONS)[number];

export function destinationToBucket(d: Destination): string {
  return d === "later" ? "someday" : d;
}
