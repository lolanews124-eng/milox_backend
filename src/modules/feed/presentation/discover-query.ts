import { ageRangeSchema, countrySchema } from "../../../shared/contracts/profile-fields.js";
import { z } from "zod";

import { feedQuerySchema } from "./feed-query.js";

const genderSchema = z.enum([
  "MALE",
  "FEMALE",
  "NON_BINARY",
  "OTHER",
  "PREFER_NOT_TO_SAY",
]);

function repeatedQueryParam<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => {
    if (value === undefined || value === null || value === "") return undefined;
    const items = Array.isArray(value)
      ? value.flatMap((entry) => String(entry).split(","))
      : String(value).split(",");
    const normalized = items.map((entry) => entry.trim()).filter(Boolean);
    return normalized.length > 0 ? normalized : undefined;
  }, z.array(schema).optional());
}

export const discoverQuerySchema = feedQuerySchema.extend({
  ageRange: repeatedQueryParam(ageRangeSchema),
  gender: repeatedQueryParam(genderSchema),
  country: repeatedQueryParam(countrySchema),
});

export type DiscoverQuery = z.infer<typeof discoverQuerySchema>;
