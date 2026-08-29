import { z, ZodError } from "zod";

/** Discriminated result returned by every Server Action. */
export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export function actionOk<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function actionError(
  error: string,
  fieldErrors?: Record<string, string>,
): ActionResult<never> {
  return { ok: false, error, fieldErrors };
}

/**
 * Parses `input` with `schema`. On failure returns a flattened field-error map
 * suitable for returning straight to the client.
 */
export function parseInput<T>(
  schema: z.ZodType<T>,
  input: unknown,
):
  | { success: true; data: T }
  | { success: false; error: string; fieldErrors: Record<string, string> } {
  try {
    return { success: true, data: schema.parse(input) };
  } catch (error) {
    if (error instanceof ZodError) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of error.issues) {
        const key = issue.path.join(".") || "form";
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      return {
        success: false,
        error: "Please correct the highlighted fields.",
        fieldErrors,
      };
    }
    throw error;
  }
}

/** Extracts a human-readable message from an unknown thrown value. */
export function toMessage(error: unknown, fallback = "Something went wrong."): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}
