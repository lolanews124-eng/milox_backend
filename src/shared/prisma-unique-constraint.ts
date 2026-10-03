import { Prisma } from "@prisma/client";

/**
 * Field names from a Prisma P2002 error.
 * Returns null when the error is not a unique-constraint violation.
 * Prisma 6 may report `meta.target` as a string array or a single constraint name.
 */
export function uniqueConstraintFields(error: unknown): string[] | null {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== "P2002"
  ) {
    return null;
  }

  const target = error.meta?.target;
  if (Array.isArray(target)) {
    return target.map((field) => String(field));
  }
  if (typeof target === "string" && target.length > 0) {
    return [target];
  }
  return [];
}

export function uniqueConstraintMentions(
  error: unknown,
  field: string,
): boolean {
  const fields = uniqueConstraintFields(error);
  if (!fields) return false;
  const needle = field.toLowerCase();
  return fields.some((value) => value.toLowerCase().includes(needle));
}
