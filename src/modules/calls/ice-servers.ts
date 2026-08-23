import { createHmac } from "node:crypto";

import type { AppConfig } from "../../config/env.js";

export type IceServerConfig = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

/**
 * Build WebRTC ICE server list.
 * When TURN_SECRET is set, uses coturn REST (time-limited) credentials.
 * Otherwise falls back to public STUN + optional static TURN user/pass.
 */
export function buildIceServers(
  config: AppConfig,
  userId: string,
): IceServerConfig[] {
  const turnUrls = parseUrls(config.TURN_URLS);
  const stunUrls = parseUrls(config.STUN_URLS);
  const servers: IceServerConfig[] = [];

  if (stunUrls.length > 0) {
    servers.push({ urls: stunUrls });
  } else {
    servers.push({
      urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"],
    });
  }

  if (turnUrls.length === 0) {
    return servers;
  }

  const ttl = Math.max(60, config.TURN_CREDENTIAL_TTL_SEC);
  if (config.TURN_SECRET.trim()) {
    const expiry = Math.floor(Date.now() / 1000) + ttl;
    const username = `${expiry}:${userId}`;
    const credential = createHmac("sha1", config.TURN_SECRET)
      .update(username)
      .digest("base64");
    servers.push({ urls: turnUrls, username, credential });
    return servers;
  }

  if (config.TURN_USERNAME.trim() && config.TURN_PASSWORD.trim()) {
    servers.push({
      urls: turnUrls,
      username: config.TURN_USERNAME,
      credential: config.TURN_PASSWORD,
    });
  }

  return servers;
}

function parseUrls(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
