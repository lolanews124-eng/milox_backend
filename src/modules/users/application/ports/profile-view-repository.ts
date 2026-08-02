import type { PostAuthorViewRecord } from "../../../posts/application/post-view.js";

export interface ProfileViewRecord {
  viewerId: string;
  viewedAt: Date;
  updatedAt: Date;
  viewer: PostAuthorViewRecord;
}

export interface ProfileViewListQuery {
  limit: number;
  before?: { updatedAt: Date; viewerId: string };
}

export interface ProfileViewRepository {
  upsertView(profileUserId: string, viewerId: string): Promise<void>;
  countViews(profileUserId: string): Promise<number>;
  listViews(
    profileUserId: string,
    query: ProfileViewListQuery,
  ): Promise<ProfileViewRecord[]>;
}
