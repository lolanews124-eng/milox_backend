import type { AppConfig } from "../../../config/env.js";
import {
  presentPublicAuthor,
  type PostAuthorViewRecord,
} from "../../posts/application/post-view.js";

export interface CommentViewRecord {
  id: string;
  postId: string;
  parentId: string | null;
  body: string;
  likeCount: number;
  replyCount: number;
  depth: number;
  createdAt: Date;
  updatedAt: Date;
  author: PostAuthorViewRecord;
  likes: Array<{ userId: string }>;
}

export function presentComment(
  comment: CommentViewRecord,
  config: AppConfig,
): object {
  return {
    id: comment.id,
    postId: comment.postId,
    parentId: comment.parentId,
    author: presentPublicAuthor(comment.author, config),
    body: comment.body,
    likeCount: comment.likeCount,
    replyCount: comment.replyCount,
    viewerLiked: comment.likes.length > 0,
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
  };
}
