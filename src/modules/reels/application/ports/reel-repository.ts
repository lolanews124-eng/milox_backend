export interface ReelAuthorRecord {
  id: string;
  username: string;
  displayName: string | null;
  profilePhoto: { id: string } | null;
  followers?: Array<{ status: string }>;
}

export interface ReelRecord {
  id: string;
  authorId: string;
  mediaAssetId: string;
  posterMediaId: string | null;
  caption: string | null;
  durationMs: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  viewCount: number;
  status: "PENDING" | "APPROVED" | "REJECTED";
  rejectReason: string | null;
  createdAt: Date;
  author: ReelAuthorRecord;
  likes: Array<{ userId: string }>;
  saves: Array<{ userId: string }>;
}

export interface ReelCommentRecord {
  id: string;
  body: string;
  parentId: string | null;
  likeCount: number;
  replyCount: number;
  depth: number;
  createdAt: Date;
  author: ReelAuthorRecord;
  likes: Array<{ userId: string }>;
}

export interface ReelPageCursor {
  id: string;
  createdAt: Date;
}

export interface ReelRepository {
  countSince(authorId: string, since: Date): Promise<number>;
  reelsEnabled(): Promise<boolean>;
  createWithinDailyLimit(input: {
    authorId: string;
    mediaAssetId: string;
    posterMediaId: string | null;
    caption: string | null;
    durationMs: number;
    dayStart: Date;
  }): Promise<ReelRecord>;
  ownsPoster(authorId: string, mediaId: string): Promise<boolean>;
  listByUsername(input: {
    username: string;
    viewerId: string;
    limit: number;
    cursor?: ReelPageCursor | undefined;
  }): Promise<ReelRecord[] | null>;
  list(input: {
    viewerId: string;
    limit: number;
    cursor?: ReelPageCursor | undefined;
    friendsOnly?: boolean | undefined;
  }): Promise<ReelRecord[]>;
  listByHashtag(input: {
    tag: string;
    viewerId: string;
    limit: number;
    cursor?: ReelPageCursor | undefined;
  }): Promise<ReelRecord[]>;
  findVisible(
    reelId: string,
    viewerId: string,
  ): Promise<ReelRecord | null>;
  toggleLike(
    reelId: string,
    userId: string,
  ): Promise<{ likedByMe: boolean; likeCount: number } | null>;
  toggleSave(
    reelId: string,
    userId: string,
  ): Promise<{ savedByMe: boolean } | null>;
  share(
    reelId: string,
    userId: string,
  ): Promise<{ shareCount: number } | null>;
  listComments(input: {
    reelId: string;
    viewerId: string;
    limit: number;
    cursor?: ReelPageCursor | undefined;
  }): Promise<ReelCommentRecord[] | null>;
  listReplies(input: {
    commentId: string;
    viewerId: string;
    limit: number;
    cursor?: ReelPageCursor | undefined;
  }): Promise<ReelCommentRecord[] | null>;
  addComment(input: {
    reelId: string;
    authorId: string;
    body: string;
    parentId?: string | undefined;
  }): Promise<ReelCommentRecord | null>;
  deleteComment(
    reelId: string,
    commentId: string,
    actorId: string,
  ): Promise<boolean>;
  toggleCommentLike(
    reelId: string,
    commentId: string,
    userId: string,
  ): Promise<{ likedByMe: boolean; likeCount: number } | null>;
  softDelete(reelId: string, authorId: string): Promise<boolean>;
  recordView(
    reelId: string,
    viewerId: string,
  ): Promise<{ viewCount: number } | null>;
}
