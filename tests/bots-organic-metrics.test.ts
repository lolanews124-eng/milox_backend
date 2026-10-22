import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Organic vs operational engagement:
 * - Public denormalized posts.likeCount / commentCount: organic (bots do not
 *   increment). Domain rows (post_likes / comments) still store bot actions.
 * - Trending score: recomputed from organic like/comment subqueries excluding
 *   isAutomatedAccount.
 * - Admin/ops can still count all post_likes including automated accounts.
 */
describe("organic engagement separation", () => {
  it("feed score SQL excludes automated likes and comments", () => {
    const source = readFileSync(
      resolve("src/jobs/feed/feed-score-worker.ts"),
      "utf8",
    );
    expect(source).toContain('bu."isAutomatedAccount" = false');
    expect(source).toContain('cu."isAutomatedAccount" = false');
    expect(source).toContain("ORGANIC_LIKES");
    expect(source).toContain("ORGANIC_COMMENTS");
  });

  it("post like path skips denormalized increment for automated actors", () => {
    const source = readFileSync(
      resolve("src/modules/posts/infrastructure/prisma-post-repository.ts"),
      "utf8",
    );
    expect(source).toContain("isAutomatedAccount");
    expect(source).toContain("organic-only");
    // Outbox (and thus FCM) is not gated on isAutomatedAccount.
    expect(source).toContain('eventType: "post.liked"');
    const likeBlock = source.slice(
      source.indexOf("if (relation === \"like\")"),
      source.indexOf("} else {", source.indexOf("if (relation === \"like\")")),
    );
    expect(likeBlock).toContain("outboxEvent.create");
    expect(likeBlock.indexOf("outboxEvent.create")).toBeGreaterThan(
      likeBlock.indexOf("isAutomatedAccount"),
    );
  });

  it("comment create path skips denormalized increment for automated authors", () => {
    const source = readFileSync(
      resolve(
        "src/modules/comments/infrastructure/prisma-comment-repository.ts",
      ),
      "utf8",
    );
    expect(source).toContain("isAutomatedAccount");
    expect(source).toContain("organic-only");
    expect(source).toContain('eventType: replyRecipientId');
    expect(source).toContain('"post.commented"');
  });
});
