import type { OfficialMessageButton } from "./official-chat-types.js";

export const MILOX_OFFICIAL_USERNAME = "milox";
export const MILOX_OFFICIAL_DISPLAY_NAME = "Milox Official";

/** Stable media id for the Milox Official avatar shown in chat. */
export const MILOX_OFFICIAL_AVATAR_MEDIA_ID =
  "a0000000-0000-4000-8000-000000000001";
export const MILOX_OFFICIAL_AVATAR_STORAGE_KEY =
  "public/branding/milox-official-avatar.webp";

export const OFFICIAL_WELCOME_BUTTONS: OfficialMessageButton[] = [
  {
    label: "Discover people",
    action: { type: "NAVIGATE", route: "discover" },
  },
  {
    label: "Edit your profile",
    action: { type: "NAVIGATE", route: "profile" },
  },
];

export function buildOfficialWelcomeBody(displayName: string): string {
  const name = displayName.trim();
  return `Hi ${name}! 👋 Welcome to Milox — we're glad you're here.

Explore people nearby, share moments, and chat when you both show interest. Tap below to get started.`;
}
