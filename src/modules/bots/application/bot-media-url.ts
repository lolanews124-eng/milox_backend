import type { AppConfig } from "../../../config/env.js";

/** Public media URL used by bots list/detail (same path as app media serving). */
export function botProfilePhotoUrl(
  mediaId: string | null | undefined,
  config: AppConfig,
): string | null {
  if (!mediaId) return null;
  return `${config.API_PUBLIC_URL.replace(/\/$/, "")}/api/v1/media/${mediaId}`;
}
