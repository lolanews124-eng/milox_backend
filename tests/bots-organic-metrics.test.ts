import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Total vs organic engagement:
 * - Public denormalized posts.likeCount / commentCount / followerCount: total
 *   (bots increment via PostService / CommentService / FollowService).
 * - Trending score: organic only (excludes isAutomatedAccount likes/comments
 *   and organic follower boost).
 * - Domain rows remain the audit source; do not double-count in the executor.
 */
describe("total vs organic engagement separation", () => {
  it("feed score SQL excludes automated likes, comments, and followers", () => {
    const source = readFileSync(
      resolve("src/jobs/feed/feed-score-worker.ts"),
      "utf8",
    );
    expect(source).toContain('bu."isAutomatedAccount" = false');
    expect(source).toContain('cu."isAutomatedAccount" = false');
    expect(source).toContain('fu."isAutomatedAccount" = false');
    expect(source).toContain("ORGANIC_LIKES");
    expect(source).toContain("ORGANIC_COMMENTS");
    expect(source).toContain("ORGANIC_FOLLOWERS");
  });

  it("post like path increments denormalized likeCount for all actors", () => {
    const source = readFileSync(
      resolve("src/modules/posts/infrastructure/prisma-post-repository.ts"),
      "utf8",
    );
    const likeBlock = source.slice(
      source.indexOf("if (relation === \"like\")"),
      source.indexOf("} else {", source.indexOf("if (relation === \"like\")")),
    );
    expect(likeBlock).toContain('likeCount: { increment: 1 }');
    expect(likeBlock).not.toMatch(
      /if\s*\(\s*!actor\?\.isAutomatedAccount\s*\)/,
    );
    expect(likeBlock).toContain('eventType: "post.liked"');
  });

  it("comment create path increments denormalized commentCount for all authors", () => {
    const source = readFileSync(
      resolve(
        "src/modules/comments/infrastructure/prisma-comment-repository.ts",
      ),
      "utf8",
    );
    expect(source).toContain('commentCount: { increment: 1 }');
    expect(source).toContain("total engagement");
    expect(source).not.toMatch(
      /if\s*\(\s*!author\?\.isAutomatedAccount\s*\)\s*\{\s*await transaction\.post\.update/,
    );
  });

  it("follow path increments followerCount without automated skip", () => {
    const source = readFileSync(
      resolve(
        "src/modules/follows/infrastructure/prisma-follow-repository.ts",
      ),
      "utf8",
    );
    expect(source).toContain('followerCount: { increment: 1 }');
    expect(source).toContain("followingCount: { increment: 1 }");
    expect(source).not.toContain("countTowardPublic");
  });

  it("bot executor delegates to domain services (no second counter system)", () => {
    const source = readFileSync(
      resolve("src/modules/bots/application/bot-activity-executor.ts"),
      "utf8",
    );
    expect(source).toContain("this.deps.posts.like");
    expect(source).toContain("this.deps.comments.create");
    expect(source).toContain("this.deps.follows.follow");
    expect(source).not.toContain("likeCount");
    expect(source).not.toContain("followerCount");
  });
});
