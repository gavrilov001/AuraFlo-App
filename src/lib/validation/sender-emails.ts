import { z } from "zod";

import { emailSchema } from "./auth";

const uuid = z.uuid({ message: "Invalid identifier." });

export const addSenderEmailSchema = z.object({
  email: emailSchema,
});

export const senderEmailIdSchema = z.object({ id: uuid });

export type AddSenderEmailInput = z.infer<typeof addSenderEmailSchema>;
