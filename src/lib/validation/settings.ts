import { z } from "zod";

export const updateProfileSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(1, { message: "Enter your name." })
    .max(120, { message: "That name is too long." }),
  timezone: z
    .string()
    .trim()
    .min(1, { message: "Choose a timezone." })
    .max(64, { message: "Invalid timezone." })
    .refine(isValidTimeZone, { message: "That timezone is not recognized." }),
});

export const updateWorkspaceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { message: "Workspace name cannot be empty." })
    .max(120, { message: "That name is too long." }),
});

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;
