export const PROFILE_COMPLETION_FIELD_LABELS = {
  displayName: "Display name",
  profilePhoto: "Profile photo",
  ageRange: "Age range",
  country: "Country",
  relationshipGoal: "What you're looking for",
  interests: "At least one interest",
} as const;

export type ProfileCompletionField = keyof typeof PROFILE_COMPLETION_FIELD_LABELS;

export interface ProfileCompletionInput {
  displayName: string | null;
  profilePhotoId?: string | null;
  profilePhotoUrl?: string | null;
  ageRange?: string | null;
  country?: string | null;
  relationshipGoal?: string | null;
  interests?: string[];
}

export function assessProfileCompletion(input: ProfileCompletionInput): {
  isComplete: boolean;
  missingFields: ProfileCompletionField[];
} {
  const missing: ProfileCompletionField[] = [];

  const displayName = input.displayName?.trim() ?? "";
  if (displayName.length < 2) {
    missing.push("displayName");
  }

  const hasPhoto =
    Boolean(input.profilePhotoId?.trim()) ||
    Boolean(input.profilePhotoUrl?.trim());
  if (!hasPhoto) {
    missing.push("profilePhoto");
  }

  if (!input.ageRange) {
    missing.push("ageRange");
  }

  if (!input.country?.trim()) {
    missing.push("country");
  }

  if (!input.relationshipGoal) {
    missing.push("relationshipGoal");
  }

  if (!input.interests?.length) {
    missing.push("interests");
  }

  return {
    isComplete: missing.length === 0,
    missingFields: missing,
  };
}

export const USERNAME_COOLDOWN_DAYS = 15;
export const USERNAME_COOLDOWN_MS = USERNAME_COOLDOWN_DAYS * 86_400_000;

export function usernameChangeAvailableAt(
  usernameChangedAt: Date | string | null | undefined,
  createdAt: Date | string,
): Date {
  const anchor = usernameChangedAt
    ? new Date(usernameChangedAt)
    : new Date(createdAt);
  return new Date(anchor.getTime() + USERNAME_COOLDOWN_MS);
}

export function canChangeUsername(
  usernameChangedAt: Date | string | null | undefined,
  createdAt: Date | string,
  now = Date.now(),
): boolean {
  return (
    now >= usernameChangeAvailableAt(usernameChangedAt, createdAt).getTime()
  );
}
