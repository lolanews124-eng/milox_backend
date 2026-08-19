import { z } from "zod";

export const createPaypalCheckoutSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("POINT_PACK"),
      packId: z.uuid(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("PREMIUM"),
      planId: z.uuid(),
      billingCycle: z.enum(["MONTHLY", "YEARLY", "ONE_TIME"]),
    })
    .strict(),
  z.object({ kind: z.literal("VERIFIED_BADGE") }).strict(),
]);

export const capturePaypalCheckoutSchema = z
  .object({
    paypalOrderId: z.string().trim().min(1).max(64),
  })
  .strict();
