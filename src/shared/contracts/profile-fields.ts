import { z } from "zod";

import { AGE_RANGE_VALUES } from "./age-ranges.js";
import { COUNTRY_NAMES } from "./countries.js";

export const ageRangeSchema = z.enum(AGE_RANGE_VALUES);

export const countrySchema = z.enum(COUNTRY_NAMES);
