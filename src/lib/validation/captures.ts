import { z } from "zod";

const uuid = z.uuid({ message: "Invalid identifier." });
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Use a valid date." });

export const CAPTURE_STATUSES = [
  "inbox",
  "processed",
  "discarded",
  "archived",
] as const;

export const captureContentSchema = z
  .string()
  .trim()
  .min(1, { message: "Write something first." })
  .max(5000, { message: "That capture is too long." });

export const createCaptureSchema = z.object({
  content: captureContentSchema,
  categoryId: uuid.nullish(),
  clientToken: z.string().max(100).optional(),
});

export const updateCaptureSchema = z.object({
  id: uuid,
  content: captureContentSchema,
  notes: z
    .string()
    .trim()
    .max(5000, { message: "That note is too long." })
    .nullish(),
  categoryId: uuid.nullish(),
});

export const captureFilterSchema = z
  .enum(["inbox", "processed", "archived", "discarded"])
  .default("inbox");
export type CaptureFilter = z.infer<typeof captureFilterSchema>;

/** Paginated list query for a Dream Catcher tab. */
export const listCapturesSchema = z.object({
  filter: captureFilterSchema,
  page: z.coerce.number().int().min(1).max(999).default(1),
  q: z.string().trim().max(120).optional().default(""),
  category: z.string().optional().default(""),
  from: dateOnly.optional().or(z.literal("").transform(() => undefined)),
  to: dateOnly.optional().or(z.literal("").transform(() => undefined)),
});
export type ListCapturesInput = z.infer<typeof listCapturesSchema>;

// --- lifecycle actions --------------------------------------------------

export const captureIdSchema = z.object({ id: uuid });

/** Archive from inbox / processed / discarded. */
export const archiveCaptureSchema = z.object({ id: uuid });

/** Discard is only reachable from the inbox. */
export const discardCaptureSchema = z.object({ id: uuid });

/** Restore an archived or discarded capture (server decides target status). */
export const restoreCaptureSchema = z.object({ id: uuid });

/** Copy a processed/archived capture's content into a fresh inbox thought. */
export const copyToInboxSchema = z.object({ id: uuid });

/** Permanent delete — only from archived / discarded. */
export const deleteCaptureSchema = z.object({ id: uuid });

export const deleteCapturesBulkSchema = z.object({
  ids: z.array(uuid).min(1).max(200),
  confirm: z.string().refine((v) => v === "DELETE", {
    message: "Type DELETE to confirm.",
  }),
});

export type CreateCaptureInput = z.infer<typeof createCaptureSchema>;
export type UpdateCaptureInput = z.infer<typeof updateCaptureSchema>;
