import type { OfficialMessageButton } from "./official-chat-types.js";

export const MILOX_OFFICIAL_USERNAME = "milox";
export const MILOX_OFFICIAL_DISPLAY_NAME = "Milox Official";
export const MILOX_OFFICIAL_BIO =
  "Official updates, welcome messages, and news from the Milox team.";

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

Explore people nearby, share moments, and chat only when you both show interest.

⚠️ Important safety rules

• Do not send or ask for money, UPI, bank details, gifts, investments, or any other financial transaction.
• Never share OTPs, passwords, Aadhaar, or other personal documents.
• Milox is not responsible for any money, deals, or transactions between users. If you choose to send/receive money or make any deal outside the app, you do so at your own risk.

🚫 Content rules

• Nudity, sexual content, pornography, and sexually explicit photos/videos are not allowed.
• Harassment, threats, scams, hate speech, and illegal activity are not allowed.
• Profiles or chats that break these rules may be removed, and accounts may be banned.

By using Milox, you agree to our policies:

• Community Guidelines: https://milox.in/community-guidelines
• Safety: https://milox.in/safety
• Terms & Conditions: https://milox.in/terms-and-conditions
• Privacy Policy: https://milox.in/privacy-policy
• Age Policy: https://milox.in/age-policy
• Child Safety: https://milox.in/child-safety
• Content Moderation: https://milox.in/content-moderation
• Disclaimer: https://milox.in/disclaimer
• Cookie Policy: https://milox.in/cookie-policy
• Copyright Policy: https://milox.in/copyright-policy
• Advertising Policy: https://milox.in/advertising-policy
• Delete Account: https://milox.in/delete-account

Stay safe, be respectful, and enjoy Milox. Tap below to get started.`;
}
