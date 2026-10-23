/**
 * Safe existing-content audit against keyword UGC rules.
 *
 * Default: dry-run — prints summary counts and sample IDs (no private PII dumps).
 * --apply: sets PENDING + isHidden for review matches; REJECTED+hidden for reject
 *          matches. Does NOT delete content.
 *
 * Usage:
 *   npx tsx scripts/audit-ugc-moderation.ts
 *   npx tsx scripts/audit-ugc-moderation.ts --apply
 */
import { PrismaClient, UgcModerationState } from "@prisma/client";

import { evaluateUgcFields, evaluateUgcText } from "../src/modules/moderation/application/evaluate-ugc-text.js";
import { UGC_LENGTH_LIMITS } from "../src/modules/moderation/application/ugc-text-normalize.js";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const BATCH = 200;

type FlagRow = {
  kind: "post" | "comment" | "bio";
  id: string;
  decision: "pending" | "rejected";
  ruleHint: string;
};

async function main(): Promise<void> {
  const flags: FlagRow[] = [];
  let postsScanned = 0;
  let commentsScanned = 0;
  let biosScanned = 0;

  // Posts (approved + public-looking only — skip already held)
  let postCursor: string | undefined;
  for (;;) {
    const batch = await prisma.post.findMany({
      where: {
        deletedAt: null,
        moderationState: UgcModerationState.APPROVED,
        ...(postCursor ? { id: { gt: postCursor } } : {}),
      },
      orderBy: { id: "asc" },
      take: BATCH,
      select: { id: true, body: true },
    });
    if (batch.length === 0) break;
    for (const row of batch) {
      postsScanned += 1;
      const evaluation = evaluateUgcText(row.body, {
        maxLength: UGC_LENGTH_LIMITS.postBody,
      });
      if (evaluation.decision === "allow") continue;
      flags.push({
        kind: "post",
        id: row.id,
        decision: evaluation.decision,
        ruleHint: evaluation.auditReason ?? evaluation.decision,
      });
      if (APPLY) {
        const state =
          evaluation.decision === "rejected"
            ? UgcModerationState.REJECTED
            : UgcModerationState.PENDING;
        await prisma.post.update({
          where: { id: row.id },
          data: {
            moderationState: state,
            moderationReason: evaluation.auditReason,
            moderatedAt: new Date(),
            isHidden: true,
          },
        });
      }
    }
    postCursor = batch[batch.length - 1]?.id;
    if (batch.length < BATCH) break;
  }

  // Comments
  let commentCursor: string | undefined;
  for (;;) {
    const batch = await prisma.comment.findMany({
      where: {
        deletedAt: null,
        moderationState: UgcModerationState.APPROVED,
        ...(commentCursor ? { id: { gt: commentCursor } } : {}),
      },
      orderBy: { id: "asc" },
      take: BATCH,
      select: { id: true, body: true },
    });
    if (batch.length === 0) break;
    for (const row of batch) {
      commentsScanned += 1;
      const evaluation = evaluateUgcText(row.body, {
        maxLength: UGC_LENGTH_LIMITS.comment,
      });
      if (evaluation.decision === "allow") continue;
      flags.push({
        kind: "comment",
        id: row.id,
        decision: evaluation.decision,
        ruleHint: evaluation.auditReason ?? evaluation.decision,
      });
      if (APPLY) {
        const state =
          evaluation.decision === "rejected"
            ? UgcModerationState.REJECTED
            : UgcModerationState.PENDING;
        await prisma.comment.update({
          where: { id: row.id },
          data: {
            moderationState: state,
            moderationReason: evaluation.auditReason,
            moderatedAt: new Date(),
            isHidden: true,
          },
        });
      }
    }
    commentCursor = batch[batch.length - 1]?.id;
    if (batch.length < BATCH) break;
  }

  // Bios
  let bioCursor: string | undefined;
  for (;;) {
    const batch = await prisma.user.findMany({
      where: {
        deletedAt: null,
        bioModerationState: UgcModerationState.APPROVED,
        ...(bioCursor ? { id: { gt: bioCursor } } : {}),
      },
      orderBy: { id: "asc" },
      take: BATCH,
      select: { id: true, bio: true, websiteUrl: true },
    });
    if (batch.length === 0) break;
    for (const row of batch) {
      biosScanned += 1;
      const evaluation = evaluateUgcFields([
        { label: "bio", value: row.bio, maxLength: UGC_LENGTH_LIMITS.bio },
        {
          label: "websiteUrl",
          value: row.websiteUrl,
          maxLength: UGC_LENGTH_LIMITS.websiteUrl,
        },
      ]);
      if (evaluation.decision === "allow") continue;
      flags.push({
        kind: "bio",
        id: row.id,
        decision: evaluation.decision,
        ruleHint: evaluation.auditReason ?? evaluation.decision,
      });
      if (APPLY) {
        const state =
          evaluation.decision === "rejected"
            ? UgcModerationState.REJECTED
            : UgcModerationState.PENDING;
        await prisma.user.update({
          where: { id: row.id },
          data: {
            bioModerationState: state,
            bioModerationReason: evaluation.auditReason,
            bioModeratedAt: new Date(),
          },
        });
      }
    }
    bioCursor = batch[batch.length - 1]?.id;
    if (batch.length < BATCH) break;
  }

  const pending = flags.filter((f) => f.decision === "pending").length;
  const rejected = flags.filter((f) => f.decision === "rejected").length;
  const byKind = {
    post: flags.filter((f) => f.kind === "post").length,
    comment: flags.filter((f) => f.kind === "comment").length,
    bio: flags.filter((f) => f.kind === "bio").length,
  };

  console.log(
    JSON.stringify(
      {
        mode: APPLY ? "apply" : "dry-run",
        scanned: {
          posts: postsScanned,
          comments: commentsScanned,
          bios: biosScanned,
        },
        flagged: {
          total: flags.length,
          pending,
          rejected,
          byKind,
        },
        sample: flags.slice(0, 25).map((f) => ({
          kind: f.kind,
          id: f.id,
          decision: f.decision,
          ruleHint: f.ruleHint,
        })),
        remediation: APPLY
          ? "Flagged records updated to PENDING/REJECTED and hidden from public. Review in admin /moderation/ugc."
          : "Dry-run only. Re-run with --apply to hide violating records without deleting them.",
      },
      null,
      2,
    ),
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
