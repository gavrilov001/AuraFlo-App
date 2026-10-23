import { z } from "zod";

const uuid = z.uuid({ message: "Invalid identifier." });

export const quickCaptureSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, { message: "Write something first." })
    .max(5000, { message: "That thought is too long." }),
});

export const setTaskDoneSchema = z.object({
  planId: uuid,
  taskId: uuid,
  done: z.boolean(),
});

export const completeDaySchema = z.object({ planId: uuid });

export const resetTodaySchema = z.object({
  reopenCompleted: z.boolean(),
  confirm: z.string().refine((v) => v === "RESET", {
    message: "Type RESET to confirm.",
  }),
});

export type QuickCaptureInput = z.infer<typeof quickCaptureSchema>;
