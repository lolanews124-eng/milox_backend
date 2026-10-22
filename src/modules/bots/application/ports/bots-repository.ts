import type {
  BotAccountStatus,
  BotCandidateBatchStatus,
} from "@prisma/client";

export interface CandidateRow {
  id: string;
  username: string;
  country: string;
  createdAt: Date;
  lastSeenAt: Date | null;
  hasProfilePhoto: boolean;
}

export interface RankedCandidatePreview {
  id: string;
  username: string;
  country: string;
  createdAt: string;
  lastSeenAt: string | null;
  inactiveAt: string;
  inactivitySource: "lastSeenAt" | "createdAt_fallback";
  hasProfilePhoto: boolean;
}

export interface BotCandidateBatchRecord {
  id: string;
  criteriaVersion: string;
  criteria: unknown;
  rankedAt: Date;
  previewSnapshot: unknown;
  eligibleCount: number;
  previewCount: number;
  selectedUserIds: string[];
  status: BotCandidateBatchStatus;
  createdByAdminId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface BotAccountListItem {
  id: string;
  userId: string;
  username: string;
  displayName: string | null;
  status: BotAccountStatus;
  sourceCandidateUserId: string | null;
  candidateBatchId: string | null;
  createdAt: Date;
  /** Bot-owned profile MediaAsset id (never the source human's media id). */
  profilePhotoMediaId: string | null;
}

export interface BotAccountDetail extends BotAccountListItem {
  bio: string | null;
  permissions: unknown;
  provisionedByAdminId: string | null;
  updatedAt: Date;
  emailVerified: boolean;
  isAutomatedAccount: boolean;
}

export interface BotMetrics {
  totalBots: number;
  activeBots: number;
  pausedBots: number;
  disabledBots: number;
  jobsProcessed: number;
  jobsFailed: number;
  jobsPending: number;
  jobsProcessing: number;
  jobsCancelled: number;
  jobsSkipped: number;
  killSwitch: boolean;
  globalPause: boolean;
  workerEnabled: boolean;
  viewsEnabled: boolean;
}

export interface BotSettingsRecord {
  id: string;
  killSwitch: boolean;
  globalPause: boolean;
  maxConcurrency: number;
  activityLimits: unknown;
  commentTemplates: unknown;
  usernameSuffix: string;
  updatedAt: Date;
}

export interface ProvisionSourceRow {
  id: string;
  username: string;
  displayName: string | null;
  bio: string | null;
  ageRange: string;
  gender: string;
  country: string;
  /** Source profile photo media id when present; reused only if PUBLIC + accessible. */
  profilePhotoMediaId: string | null;
}

export interface CreateAutomatedBotInput {
  userId: string;
  botAccountId: string;
  username: string;
  usernameNormalized: string;
  email: string;
  passwordHash: string;
  displayName: string;
  /** Copied from source when present; null/empty stays null (no fictional bio). */
  bio: string | null;
  ageRange: string;
  gender: string;
  country: string;
  /** Clone PUBLIC profile photo into a bot-owned MediaAsset when authorized. */
  sourceProfilePhotoMediaId: string | null;
  /** Local upload root used to copy accessible public profile bytes. */
  uploadRoot: string;
  sourceCandidateUserId: string;
  candidateBatchId: string;
  provisionedByAdminId: string;
  permissions: unknown;
}

export interface CreatedBotRecord {
  botAccountId: string;
  userId: string;
  username: string;
  sourceCandidateUserId: string;
  skipped: boolean;
  skipReason?: string;
}

export interface BotJobListItem {
  id: string;
  botAccountId: string;
  botUsername: string;
  activityType: string;
  targetType: string;
  targetId: string;
  status: string;
  attempts: number;
  lastError: string | null;
  metadata: unknown;
  createdAt: Date;
  processedAt: Date | null;
}

export interface BotAuditListItem {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  metadata: unknown;
  actorUserId: string | null;
  createdAt: Date;
}

export interface BotsRepository {
  countEligibleCandidates(): Promise<number>;
  listEligibleCandidates(limit: number): Promise<CandidateRow[]>;
  ensureSettings(): Promise<BotSettingsRecord>;
  updateSettings(
    data: Partial<{
      killSwitch: boolean;
      globalPause: boolean;
      maxConcurrency: number;
      activityLimits: unknown;
      commentTemplates: unknown;
      usernameSuffix: string;
    }>,
  ): Promise<BotSettingsRecord>;
  createCandidateBatch(input: {
    id: string;
    criteriaVersion: string;
    criteria: unknown;
    rankedAt: Date;
    previewSnapshot: unknown;
    eligibleCount: number;
    previewCount: number;
    createdByAdminId: string;
  }): Promise<BotCandidateBatchRecord>;
  getCandidateBatch(id: string): Promise<BotCandidateBatchRecord | null>;
  updateCandidateBatchSelection(input: {
    id: string;
    selectedUserIds: string[];
    status: BotCandidateBatchStatus;
  }): Promise<BotCandidateBatchRecord>;
  updateCandidateBatchStatus(
    id: string,
    status: BotCandidateBatchStatus,
  ): Promise<BotCandidateBatchRecord>;
  /** Atomically claim SELECTION_LOCKED → PROVISIONING. False if already claimed. */
  claimBatchForProvisioning(batchId: string): Promise<boolean>;
  listBotAccounts(input: {
    query?: string;
    status?: BotAccountStatus;
    limit: number;
    offset: number;
  }): Promise<{ items: BotAccountListItem[]; total: number }>;
  getBotAccount(id: string): Promise<BotAccountDetail | null>;
  updateBotAccountStatus(
    id: string,
    status: BotAccountStatus,
  ): Promise<BotAccountDetail>;
  updateBotAccountPermissions(
    id: string,
    permissions: unknown,
  ): Promise<BotAccountDetail>;
  getMetrics(workerEnabled: boolean): Promise<BotMetrics>;
  findProvisionSources(ids: string[]): Promise<ProvisionSourceRow[]>;
  findExistingBotSourceIds(sourceIds: string[]): Promise<Set<string>>;
  usernameTaken(usernameNormalized: string): Promise<boolean>;
  createAutomatedBot(input: CreateAutomatedBotInput): Promise<CreatedBotRecord>;
  listActivityJobs(input: {
    limit: number;
    offset: number;
    botAccountId?: string;
    activityType?: string;
    status?: string;
    createdFrom?: Date;
    createdTo?: Date;
  }): Promise<{ items: BotJobListItem[]; total: number }>;
  getActivityJob(id: string): Promise<BotJobListItem | null>;
  cancelPendingJob(id: string): Promise<BotJobListItem | null>;
  retryFailedJob(id: string): Promise<BotJobListItem | null>;
  cancelPendingJobsForBot(botAccountId: string): Promise<number>;
  listBotAuditLogs(input: {
    limit: number;
    offset: number;
  }): Promise<{ items: BotAuditListItem[]; total: number }>;
  writeAudit(input: {
    actorUserId: string;
    action: string;
    resourceType: string;
    resourceId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}
