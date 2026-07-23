import type { Request, Response } from "express";

import type { BlogService } from "../application/blog-service.js";
import { blogListQuerySchema, blogSlugParamSchema } from "./blog-schemas.js";

export class BlogController {
  constructor(private readonly blog: BlogService) {}

  listPosts = async (request: Request, response: Response): Promise<void> => {
    const query = blogListQuerySchema.parse(request.query);
    const data = await this.blog.listPosts(query);
    response.status(200).json({ success: true, data });
  };

  getPost = async (request: Request, response: Response): Promise<void> => {
    const { slug } = blogSlugParamSchema.parse(request.params);
    const data = await this.blog.getPostBySlug(slug);
    if (!data) {
      response.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "Blog post not found" },
      });
      return;
    }
    response.status(200).json({ success: true, data });
  };
}
