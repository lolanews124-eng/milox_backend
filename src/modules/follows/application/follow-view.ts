import type { AppConfig } from "../../../config/env.js";
import {
  presentPublicAuthor,
  type PostAuthorViewRecord,
} from "../../posts/application/post-view.js";

export type FollowUserRecord = PostAuthorViewRecord;

export interface FollowListEntry {
  id: string;
  createdAt: Date;
  user: FollowUserRecord;
}

export function presentFollowUser(
  user: FollowUserRecord,
  config: AppConfig,
): object {
  return presentPublicAuthor(user, config);
}

export function presentFollowRequest(
  entry: FollowListEntry,
  config: AppConfig,
): object {
  return {
    id: entry.id,
    user: presentFollowUser(entry.user, config),
    createdAt: entry.createdAt.toISOString(),
  };
}
