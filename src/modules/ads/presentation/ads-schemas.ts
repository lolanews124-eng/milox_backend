import { AdPlacement } from "@prisma/client";
import { z } from "zod";

export const adPlacementQuerySchema = z.object({
  placement: z.enum(AdPlacement),
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

export const adSlotQuerySchema = z.object({
  placement: z.enum(AdPlacement),
  slot: z.coerce.number().int().min(0).max(10_000).default(0),
});

export const adIdParamSchema = z.object({
  adId: z.uuid(),
});
