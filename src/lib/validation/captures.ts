import { z } from "zod";

const uuid = z.uuid({ message: "Invalid identifier." });

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

export const setCaptureStatusSchema = z.object({
  id: uuid,
  status: z.enum(CAPTURE_STATUSES),
});

export const captureFilterSchema = z
  .enum(["inbox", "processed", "archived", "discarded"])
  .default("inbox");

export type CreateCaptureInput = z.infer<typeof createCaptureSchema>;
export type UpdateCaptureInput = z.infer<typeof updateCaptureSchema>;
export type SetCaptureStatusInput = z.infer<typeof setCaptureStatusSchema>;
export type CaptureFilter = z.infer<typeof captureFilterSchema>;
