/**
 * Deterministic fresh-post ranking for bot discovery.
 * Prefer newer posts, then recently active authors (lastSeenAt ?? createdAt).
 */

export type FreshPostCandidateInput = {
  id: string;
  createdAt: Date;
  author: {
    lastSeenAt: Date | null;
    createdAt: Date;
  };
};

export type RankedFreshPost = {
  id: string;
  createdAt: Date;
  authorActivityAt: Date;
};

export function authorActivityAt(author: {
  lastSeenAt: Date | null;
  createdAt: Date;
}): Date {
  return author.lastSeenAt ?? author.createdAt;
}

/** Stable sort: post createdAt desc, author activity desc, id desc. */
export function rankFreshPosts(
  rows: FreshPostCandidateInput[],
): RankedFreshPost[] {
  return rows
    .map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      authorActivityAt: authorActivityAt(row.author),
    }))
    .sort((a, b) => {
      const byPost = b.createdAt.getTime() - a.createdAt.getTime();
      if (byPost !== 0) return byPost;
      const byAuthor =
        b.authorActivityAt.getTime() - a.authorActivityAt.getTime();
      if (byAuthor !== 0) return byAuthor;
      return b.id.localeCompare(a.id);
    });
}

export type FreshUserCandidateInput = {
  id: string;
  lastSeenAt: Date | null;
  createdAt: Date;
};

/** Stable sort for follow discovery: activity desc, createdAt desc, id desc. */
export function rankFreshUsers(
  rows: FreshUserCandidateInput[],
): FreshUserCandidateInput[] {
  return [...rows].sort((a, b) => {
    const aAct = (a.lastSeenAt ?? a.createdAt).getTime();
    const bAct = (b.lastSeenAt ?? b.createdAt).getTime();
    if (bAct !== aAct) return bAct - aAct;
    const byCreated = b.createdAt.getTime() - a.createdAt.getTime();
    if (byCreated !== 0) return byCreated;
    return b.id.localeCompare(a.id);
  });
}
