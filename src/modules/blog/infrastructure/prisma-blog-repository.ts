import { CmsPageStatus, type PrismaClient } from "@prisma/client";

export interface BlogPostRecord {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  bodyMarkdown: string;
  coverImageUrl: string | null;
  metaDescription: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BlogPostListItem {
  slug: string;
  title: string;
  excerpt: string | null;
  coverImageUrl: string | null;
  publishedAt: Date | null;
}

export class PrismaBlogRepository {
  constructor(private readonly database: PrismaClient) {}

  async listPublished(options: {
    limit: number;
    offset: number;
  }): Promise<{ items: BlogPostListItem[]; total: number }> {
    const where = { status: CmsPageStatus.PUBLISHED };
    const [rows, total] = await Promise.all([
      this.database.blogPost.findMany({
        where,
        orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
        skip: options.offset,
        take: options.limit,
        select: {
          slug: true,
          title: true,
          excerpt: true,
          coverImageUrl: true,
          publishedAt: true,
        },
      }),
      this.database.blogPost.count({ where }),
    ]);
    return { items: rows, total };
  }

  async findPublishedBySlug(slug: string): Promise<BlogPostRecord | null> {
    const row = await this.database.blogPost.findFirst({
      where: { slug, status: CmsPageStatus.PUBLISHED },
    });
    return row ? mapBlogPost(row) : null;
  }

  async listPublishedSlugs(): Promise<Array<{ slug: string; updatedAt: Date }>> {
    return this.database.blogPost.findMany({
      where: { status: CmsPageStatus.PUBLISHED },
      select: { slug: true, updatedAt: true },
      orderBy: { publishedAt: "desc" },
    });
  }
}

function mapBlogPost(row: {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  bodyMarkdown: string;
  coverImageUrl: string | null;
  metaDescription: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): BlogPostRecord {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    bodyMarkdown: row.bodyMarkdown,
    coverImageUrl: row.coverImageUrl,
    metaDescription: row.metaDescription,
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
