/**
 * Framework-neutral API contracts shared by the TypeScript applications.
 */
export const API_VERSION = "v1" as const;
export const API_BASE_PATH = `/api/${API_VERSION}` as const;

export {
  AGE_RANGE_LABELS,
  AGE_RANGE_OPTIONS,
  AGE_RANGE_VALUES,
  ageRangeLabel,
  ageToRangeValue,
  isAgeRangeValue,
  type AgeRangeValue,
} from "./age-ranges.js";
export {
  COUNTRY_CODE_TO_NAME,
  COUNTRY_NAMES,
  countryNameFromCode,
  filterCountries,
  isCountryName,
  type CountryName,
} from "./countries.js";
export { ageRangeSchema, countrySchema } from "./profile-fields.js";
