import type { OfficialMessageButton } from "./official-chat-types.js";

export const MILOX_OFFICIAL_USERNAME = "milox";
export const MILOX_OFFICIAL_DISPLAY_NAME = "Milox Official";

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
