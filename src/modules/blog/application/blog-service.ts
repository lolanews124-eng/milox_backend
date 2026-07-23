import type { PrismaBlogRepository } from "../infrastructure/prisma-blog-repository.js";

export class BlogService {
  constructor(private readonly repository: PrismaBlogRepository) {}

  async listPosts(query: { page: number; pageSize: number }) {
    const pageSize = Math.min(Math.max(query.pageSize, 1), 50);
    const page = Math.max(query.page, 1);
    const offset = (page - 1) * pageSize;
    const result = await this.repository.listPublished({ limit: pageSize, offset });
    return {
      items: result.items.map(presentBlogListItem),
      page,
      pageSize,
      total: result.total,
      totalPages: Math.max(1, Math.ceil(result.total / pageSize)),
    };
  }

  async getPostBySlug(slug: string) {
    const post = await this.repository.findPublishedBySlug(slug);
    if (!post) return null;
    return presentBlogPost(post);
  }

  async listSitemapEntries() {
    const rows = await this.repository.listPublishedSlugs();
    return rows.map((row) => ({
      slug: row.slug,
      updatedAt: row.updatedAt.toISOString(),
    }));
  }
}

function presentBlogListItem(item: {
  slug: string;
  title: string;
  excerpt: string | null;
  coverImageUrl: string | null;
  publishedAt: Date | null;
}) {
  return {
    slug: item.slug,
    title: item.title,
    excerpt: item.excerpt,
    coverImageUrl: item.coverImageUrl,
    publishedAt: item.publishedAt?.toISOString() ?? null,
  };
}

function presentBlogPost(post: {
  slug: string;
  title: string;
  excerpt: string | null;
  bodyMarkdown: string;
  coverImageUrl: string | null;
  metaDescription: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    bodyMarkdown: post.bodyMarkdown,
    coverImageUrl: post.coverImageUrl,
    metaDescription: post.metaDescription,
    publishedAt: post.publishedAt?.toISOString() ?? null,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  };
}
