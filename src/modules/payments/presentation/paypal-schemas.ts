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

export const verifyRazorpaySchema = z
  .object({
    razorpay_order_id: z.string().trim().min(1).max(64).optional(),
    razorpay_payment_id: z.string().trim().min(1).max(64).optional(),
    razorpay_signature: z.string().trim().min(1).max(256).optional(),
    providerOrderId: z.string().trim().min(1).max(64).optional(),
    paymentId: z.string().trim().min(1).max(64).optional(),
    signature: z.string().trim().min(1).max(256).optional(),
  })
  .strict()
  .transform((value) => {
    const orderId = value.razorpay_order_id || value.providerOrderId || "";
    const paymentId = value.razorpay_payment_id || value.paymentId || "";
    const signature = value.razorpay_signature || value.signature || "";
    return { orderId, paymentId, signature };
  })
  .refine((value) => Boolean(value.orderId && value.paymentId && value.signature), {
    message: "razorpay_order_id, razorpay_payment_id and razorpay_signature required",
  });

export const markCheckoutSchema = z
  .object({
    paypalOrderId: z.string().trim().min(1).max(64).optional(),
    providerOrderId: z.string().trim().min(1).max(64).optional(),
    razorpay_order_id: z.string().trim().min(1).max(64).optional(),
  })
  .strict()
  .refine(
    (value) =>
      Boolean(value.paypalOrderId || value.providerOrderId || value.razorpay_order_id),
    { message: "providerOrderId required" },
  );
