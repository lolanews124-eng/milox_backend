import { z } from "zod";

export const upsertPushDeviceSchema = z.object({
  token: z.string().trim().min(1).max(512),
  platform: z.enum(["ANDROID", "IOS"]),
});

export const deletePushDeviceSchema = z.object({
  token: z.string().trim().min(1).max(512),
});
