import type { ReportStatus } from "@prisma/client";

import type { PostViewRecord } from "../post-view.js";

export interface CreatePostData {
  authorId: string;
  body: string | null;
  mediaIds: string[];
  idempotencyKey?: string;
  requestHash?: string;
}

export interface PostPageQuery {
  username: string;
  viewerId?: string;
  limit: number;
  before?: { id: string; createdAt: Date };
}

export interface SavedPageQuery {
  viewerId: string;
  limit: number;
  before?: { id: string; createdAt: Date };
}

export interface SavedPostRecord {
  post: PostViewRecord;
  savedAt: Date;
}

export interface HashtagRecord {
  tag: string;
  postCount: number;
}

export interface HashtagPageQuery {
  tag: string;
  viewerId?: string;
  limit: number;
  before?: { id: string; createdAt: Date };
}

export interface CreatedPost {
  post: PostViewRecord;
  replayed: boolean;
}

export interface ReportRecord {
  id: string;
  status: ReportStatus;
  createdAt: Date;
}

export interface PostRepository {
  create(data: CreatePostData): Promise<CreatedPost>;
  findVisible(postId: string, viewerId?: string): Promise<PostViewRecord | null>;
  listByUsername(query: PostPageQuery): Promise<PostViewRecord[] | null>;
  listSaved(query: SavedPageQuery): Promise<SavedPostRecord[]>;
  listTrendingHashtags(limit: number): Promise<HashtagRecord[]>;
  searchHashtags(term: string, limit: number): Promise<HashtagRecord[]>;
  findHashtag(tag: string): Promise<HashtagRecord | null>;
  listByHashtag(query: HashtagPageQuery): Promise<PostViewRecord[]>;
  update(
    postId: string,
    authorId: string,
    body: string | null,
  ): Promise<PostViewRecord | null>;
  softDelete(postId: string, authorId: string): Promise<boolean>;
  like(postId: string, userId: string): Promise<PostViewRecord | null>;
  unlike(postId: string, userId: string): Promise<PostViewRecord | null>;
  save(postId: string, userId: string): Promise<PostViewRecord | null>;
  unsave(postId: string, userId: string): Promise<PostViewRecord | null>;
  share(postId: string, userId: string): Promise<PostViewRecord | null>;
  report(
    postId: string,
    reporterId: string,
    reasonCode: string,
    details?: string,
  ): Promise<ReportRecord | null>;
}

export class PostMediaOwnershipError extends Error {}
export class IdempotencyConflictError extends Error {}
export class PostActionConflictError extends Error {}
