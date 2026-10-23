import { z } from "zod";

const uuid = z.uuid({ message: "Invalid identifier." });
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Use a valid date." });
const optionalDateTime = z
  .string()
  .trim()
  .min(1)
  .transform((v) => new Date(v).toISOString())
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: "Use a valid time." })
  .nullish()
  .or(z.literal("").transform(() => null));
const notes = z
  .string()
  .trim()
  .max(5000, { message: "That note is too long." })
  .nullish()
  .or(z.literal("").transform(() => null));

export const DECISIONS = ["do_now", "schedule", "delegate", "later"] as const;

export const processCaptureSchema = z
  .object({
    captureId: uuid,
    planId: uuid,
    decision: z.enum(DECISIONS),
    scheduledFor: dateOnly.nullish(),
    dueAt: optionalDateTime,
    notes,
    focusItemId: uuid.nullish().or(z.literal("").transform(() => null)),
    delegateName: z
      .string()
      .trim()
      .max(120, { message: "That name is too long." })
      .nullish(),
    delegateEmail: z
      .email({ message: "Enter a valid email address." })
      .nullish()
      .or(z.literal("").transform(() => null)),
    addToToday: z.boolean().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.decision === "schedule" && !val.scheduledFor) {
      ctx.addIssue({
        code: "custom",
        path: ["scheduledFor"],
        message: "Choose a date to schedule this for.",
      });
    }
    if (
      val.decision === "delegate" &&
      !val.delegateName?.trim()
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["delegateName"],
        message: "Who are you handing this to?",
      });
    }
  });

export const captureIdPlanSchema = z.object({
  captureId: uuid,
  planId: uuid,
  force: z.boolean().optional(),
});

export const editCaptureSchema = z.object({
  captureId: uuid,
  content: z
    .string()
    .trim()
    .min(1, { message: "Write something first." })
    .max(5000, { message: "That thought is too long." }),
  notes,
});

export const planIdSchema = z.object({ planId: uuid });

export const addTaskToPlanSchema = z.object({
  planId: uuid,
  taskId: uuid,
});

export const createPlanTaskSchema = z.object({
  planId: uuid,
  title: z
    .string()
    .trim()
    .min(1, { message: "Give the task a short title." })
    .max(300, { message: "That title is too long." }),
  notes,
  focusItemId: uuid.nullish().or(z.literal("").transform(() => null)),
  categoryId: uuid.nullish().or(z.literal("").transform(() => null)),
});

export const planItemSchema = z.object({ planItemId: uuid });

export const toggleTopThreeSchema = z.object({
  planItemId: uuid,
  value: z.boolean(),
});

export const reorderPlanItemSchema = z.object({
  planItemId: uuid,
  direction: z.enum(["up", "down"]),
});

export const reorderPlanItemsSchema = z.object({
  planId: uuid,
  itemIds: z
    .array(uuid)
    .min(1, { message: "Nothing to reorder." })
    .max(200, { message: "Too many items." }),
});

export const updatePlanTaskSchema = z.object({
  taskId: uuid,
  title: z
    .string()
    .trim()
    .min(1, { message: "Give the task a short title." })
    .max(300, { message: "That title is too long." }),
  notes,
});

export const linkFocusSchema = z.object({
  taskId: uuid,
  focusItemId: uuid.nullish().or(z.literal("").transform(() => null)),
});

export const rescheduleTaskSchema = z.object({
  taskId: uuid,
  scheduledFor: dateOnly,
});

export const taskIdSchema = z.object({ taskId: uuid });

const captureIdList = z
  .array(uuid)
  .min(1, { message: "Select at least one thought." })
  .max(50, { message: "Select at most 50 thoughts at a time." });

/** The one shared decision set used by both One at a time and Batch organize. */
export const BATCH_DECISIONS = [
  "do_now",
  "schedule",
  "delegate",
  "later",
  "discard",
] as const;

export const batchDecisionSchema = z
  .object({
    planId: uuid,
    captureIds: captureIdList,
    decision: z.enum(BATCH_DECISIONS),
    scheduledFor: dateOnly.nullish(),
    dueAt: optionalDateTime,
    notes,
    focusItemId: uuid.nullish().or(z.literal("").transform(() => null)),
    delegateName: z
      .string()
      .trim()
      .max(120, { message: "That name is too long." })
      .nullish(),
    delegateEmail: z
      .email({ message: "Enter a valid email address." })
      .nullish()
      .or(z.literal("").transform(() => null)),
    addToToday: z.boolean().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.decision === "schedule" && !val.scheduledFor) {
      ctx.addIssue({
        code: "custom",
        path: ["scheduledFor"],
        message: "Choose a date to schedule these for.",
      });
    }
    if (val.decision === "delegate" && !val.delegateName?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["delegateName"],
        message: "Who are you handing these to?",
      });
    }
  });

export const batchUndoDecisionSchema = z.object({
  planId: uuid,
  captureIds: captureIdList,
  decision: z.enum(BATCH_DECISIONS),
});

export const restartPlanningSchema = z.object({
  planId: uuid,
  clearTopThree: z.boolean().optional(),
  reopenCompleted: z.boolean().optional(),
});

export type BatchDecisionInput = z.infer<typeof batchDecisionSchema>;

export type ProcessCaptureInput = z.infer<typeof processCaptureSchema>;
