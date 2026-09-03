import { z } from "zod";

const uuid = z.uuid({ message: "Invalid identifier." });
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Use a valid date." });
const optionalUuid = uuid.nullish().or(z.literal("").transform(() => null));
const optionalDateOnly = dateOnly
  .nullish()
  .or(z.literal("").transform(() => null));
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
const title = z
  .string()
  .trim()
  .min(1, { message: "Give the task a short title." })
  .max(300, { message: "That title is too long." });
const delegateName = z
  .string()
  .trim()
  .max(120, { message: "That name is too long." })
  .nullish()
  .or(z.literal("").transform(() => null));
const delegateEmail = z
  .email({ message: "Enter a valid email address." })
  .nullish()
  .or(z.literal("").transform(() => null));
const priority = z.coerce.number().int().min(1).max(4).optional();

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

export const listTasksSchema = z.object({
  view: z.enum(TASK_VIEWS).default("open"),
  q: z.string().trim().max(120).optional().default(""),
  category: z.string().optional().default(""),
  focus: z.string().optional().default(""),
  sort: z.enum(TASK_SORTS).default("manual"),
  page: z.coerce.number().int().min(1).max(999).default(1),
  showCancelled: z
    .union([z.literal("1"), z.literal("true"), z.boolean()])
    .optional()
    .transform((v) => v === "1" || v === "true" || v === true),
});

const destinationFields = z
  .object({
    destination: z.enum(DESTINATIONS),
    scheduledFor: optionalDateOnly,
    dueAt: optionalDateTime,
    delegateName,
    delegateEmail,
    reopenPlan: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.destination === "scheduled" && !v.scheduledFor) {
      ctx.addIssue({
        code: "custom",
        path: ["scheduledFor"],
        message: "Choose a date.",
      });
    }
    if (v.destination === "delegated" && !v.delegateName?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["delegateName"],
        message: "Who are you handing this to?",
      });
    }
  });

export const createTaskSchema = z
  .object({
    title,
    notes,
    categoryId: optionalUuid,
    focusItemId: optionalUuid,
    priority,
  })
  .and(destinationFields);

export const updateTaskSchema = z
  .object({
    taskId: uuid,
    title,
    notes,
    categoryId: optionalUuid,
    focusItemId: optionalUuid,
    priority,
  })
  .and(destinationFields);

export const moveTaskSchema = z
  .object({ taskId: uuid })
  .and(destinationFields);

export const setTaskStatusSchema = z.object({
  taskId: uuid,
  op: z.enum(["complete", "reopen", "cancel"]),
});

export const setTaskTopThreeSchema = z.object({
  taskId: uuid,
  value: z.boolean(),
});

export const reorderTasksSchema = z.object({
  taskIds: z.array(uuid).min(1).max(500),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type MoveTaskInput = z.infer<typeof moveTaskSchema>;
export type ListTasksInput = z.infer<typeof listTasksSchema>;
