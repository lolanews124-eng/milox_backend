import { ageRangeSchema, countrySchema } from "@milox/contracts";
import { z } from "zod";

const password = z.string().min(10).max(128);
const email = z.string().trim().email().max(255);

export const signupSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(3)
      .max(32)
      .regex(/^[a-zA-Z0-9_]+$/),
    email,
    password,
    ageRange: ageRangeSchema,
    country: countrySchema,
    gender: z.enum([
      "MALE",
      "FEMALE",
      "NON_BINARY",
      "OTHER",
      "PREFER_NOT_TO_SAY",
    ]),
    referralCode: z
      .string()
      .trim()
      .min(4)
      .max(16)
      .regex(/^[a-zA-Z0-9]+$/)
      .optional(),
  })
  .strict();

export const loginSchema = z
  .object({
    email,
    password: z.string().min(1).max(128),
  })
  .strict();

export const refreshSchema = z
  .object({
    refreshToken: z.string().min(32).optional(),
  })
  .strict();

export const tokenSchema = z
  .object({
    token: z.string().min(32),
  })
  .strict();

export const forgotPasswordSchema = z
  .object({
    email,
  })
  .strict();

export const resetPasswordSchema = z
  .object({
    token: z.string().min(32),
    password,
  })
  .strict();
