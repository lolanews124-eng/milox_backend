export const AGE_RANGE_VALUES = [
  "AGE_18_24",
  "AGE_25_28",
  "AGE_29_34",
  "AGE_35_39",
  "AGE_40_44",
  "AGE_45_49",
  "AGE_50_54",
  "AGE_55_59",
  "AGE_60_64",
  "AGE_65_70",
] as const;

export type AgeRangeValue = (typeof AGE_RANGE_VALUES)[number];

export const AGE_RANGE_LABELS: Record<AgeRangeValue, string> = {
  AGE_18_24: "18-24",
  AGE_25_28: "25-28",
  AGE_29_34: "29-34",
  AGE_35_39: "35-39",
  AGE_40_44: "40-44",
  AGE_45_49: "45-49",
  AGE_50_54: "50-54",
  AGE_55_59: "55-59",
  AGE_60_64: "60-64",
  AGE_65_70: "65-70",
};

export const AGE_RANGE_OPTIONS = AGE_RANGE_VALUES.map((value) => ({
  value,
  label: AGE_RANGE_LABELS[value],
}));

export function ageRangeLabel(value: AgeRangeValue): string {
  return AGE_RANGE_LABELS[value];
}

export function isAgeRangeValue(value: string): value is AgeRangeValue {
  return (AGE_RANGE_VALUES as readonly string[]).includes(value);
}

/** Map an exact age (e.g. from legacy DOB) to the matching bucket. */
export function ageToRangeValue(age: number): AgeRangeValue {
  if (age <= 24) return "AGE_18_24";
  if (age <= 28) return "AGE_25_28";
  if (age <= 34) return "AGE_29_34";
  if (age <= 39) return "AGE_35_39";
  if (age <= 44) return "AGE_40_44";
  if (age <= 49) return "AGE_45_49";
  if (age <= 54) return "AGE_50_54";
  if (age <= 59) return "AGE_55_59";
  if (age <= 64) return "AGE_60_64";
  return "AGE_65_70";
}
