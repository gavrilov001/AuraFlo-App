import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: "Enter a valid email address." }));

export const passwordSchema = z
  .string()
  .min(8, { message: "Use at least 8 characters." })
  .max(72, { message: "Passwords can be at most 72 characters." });

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, { message: "Enter your password." }),
  redirectTo: z.string().optional(),
});

export const signupSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(1, { message: "Enter your name." })
    .max(120, { message: "That name is too long." }),
  email: emailSchema,
  password: passwordSchema,
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const updatePasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type SignupInput = z.infer<typeof signupSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type UpdatePasswordInput = z.infer<typeof updatePasswordSchema>;
