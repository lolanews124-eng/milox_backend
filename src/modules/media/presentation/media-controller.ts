import type { Request, Response } from "express";
import { z } from "zod";

import { AppError } from "../../../shared/errors/app-error.js";
import type { MediaService } from "../application/services/media-service.js";

const mediaUploadSchema = z.object({
  kind: z.enum(["PROFILE_PHOTO", "COVER_PHOTO", "POST_IMAGE"]),
});
const mediaParamsSchema = z.object({ mediaId: z.string().uuid() });

export class MediaController {
  constructor(private readonly media: MediaService) {}

  getPublic = async (request: Request, response: Response): Promise<void> => {
    const { mediaId } = mediaParamsSchema.parse(request.params);
    const media = await this.media.resolvePublicMedia(mediaId);
    response.type(media.mimeType);
    response.setHeader("Cache-Control", "public, max-age=3600");
    if (media.checksum) response.setHeader("ETag", `"${media.checksum}"`);
    await new Promise<void>((resolve, reject) => {
      response.sendFile(media.absolutePath, (error) => {
        if (error) {
          reject(new AppError("MEDIA_NOT_FOUND", "Media not found", 404));
          return;
        }
        resolve();
      });
    });
  };

  upload = async (request: Request, response: Response): Promise<void> => {
    if (!request.auth) {
      throw new AppError("UNAUTHENTICATED", "Authentication required", 401);
    }
    if (!request.file) {
      throw new AppError("VALIDATION_ERROR", "Image file is required", 400, [
        { field: "file", issue: "required" },
      ]);
    }
    const { kind } = mediaUploadSchema.parse(request.body as unknown);
    const asset = await this.media.uploadImage(
      request.auth.userId,
      kind,
      request.file.buffer,
    );
    response.status(201).json({
      success: true,
      data: asset,
      meta: { requestId: request.requestId },
    });
  };
}
