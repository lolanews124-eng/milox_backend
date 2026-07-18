import type { ReportStatus, ReportTargetType } from "@prisma/client";

import type { PostAuthorViewRecord } from "../../../posts/application/post-view.js";

export interface BlockPageQuery {
  blockerId: string;
  limit: number;
  before?: { id: string; createdAt: Date };
}

export interface BlockListEntry {
  id: string;
  createdAt: Date;
  user: PostAuthorViewRecord;
}

export interface CreateReportData {
  reporterId: string;
  targetType: ReportTargetType;
  reportedUserId: string | null;
  postId: string | null;
  commentId: string | null;
  messageId: string | null;
  reasonCode: string;
  details: string | null;
}

export interface CreatedReport {
  id: string;
  status: ReportStatus;
  createdAt: Date;
}

export class CannotBlockSelfError extends Error {}
export class BlockConflictError extends Error {
  constructor(readonly reason: "already_blocked" | "not_blocked") {
    super(reason);
  }
}
export class ReportConflictError extends Error {
  constructor(readonly reason: "already_reported" | "self_report") {
    super(reason);
  }
}
export class ReportTargetInvalidError extends Error {}

export interface ModerationRepository {
  block(username: string, blockerId: string): Promise<boolean | null>;
  unblock(username: string, blockerId: string): Promise<boolean | null>;
  listBlocks(query: BlockPageQuery): Promise<BlockListEntry[]>;
  createReport(data: CreateReportData): Promise<CreatedReport | null>;
}
