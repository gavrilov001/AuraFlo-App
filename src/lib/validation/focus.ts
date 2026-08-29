import { z } from "zod";

const uuid = z.uuid({ message: "Invalid identifier." });

export const FOCUS_HORIZONS = ["short", "medium", "long"] as const;
export const FOCUS_STATUSES = [
  "active",
  "paused",
  "completed",
  "archived",
] as const;

const titleSchema = z
  .string()
  .trim()
  .min(1, { message: "Give it a short title." })
  .max(160, { message: "Keep the title under 160 characters." });

const descriptionSchema = z
  .string()
  .trim()
  .max(2000, { message: "That description is too long." })
  .nullish();

// Accepts "" from empty date inputs and normalizes to null.
const targetDateSchema = z
  .union([
    z.literal(""),
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Use a valid date." }),
  ])
  .nullish()
  .transform((value) => (value ? value : null));

export const createFocusItemSchema = z.object({
  title: titleSchema,
  description: descriptionSchema,
  horizon: z.enum(FOCUS_HORIZONS),
  targetDate: targetDateSchema,
});

export const updateFocusItemSchema = z.object({
  id: uuid,
  title: titleSchema,
  description: descriptionSchema,
  targetDate: targetDateSchema,
});

export const setFocusStatusSchema = z.object({
  id: uuid,
  status: z.enum(FOCUS_STATUSES),
});

export const reorderFocusItemSchema = z.object({
  id: uuid,
  horizon: z.enum(FOCUS_HORIZONS),
  direction: z.enum(["up", "down"]),
});

export type CreateFocusItemInput = z.infer<typeof createFocusItemSchema>;
export type UpdateFocusItemInput = z.infer<typeof updateFocusItemSchema>;
export type SetFocusStatusInput = z.infer<typeof setFocusStatusSchema>;
export type ReorderFocusItemInput = z.infer<typeof reorderFocusItemSchema>;
