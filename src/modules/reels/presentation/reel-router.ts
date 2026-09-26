import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import multer, { MulterError } from "multer";

import type { AppConfig } from "../../../config/env.js";
import { AppError } from "../../../shared/errors/app-error.js";
import { asyncHandler } from "../../../shared/http/async-handler.js";
import { createRateLimit } from "../../../shared/http/rate-limit.js";
import type { ReelController } from "./reel-controller.js";

export function createReelRouter(
  controller: ReelController,
  config: AppConfig,
  authenticate: RequestHandler,
  requireVerified: RequestHandler,
): Router {
  const router = Router();
  const createLimit = createRateLimit(20, 10 * 60 * 1000);
  const actionLimit = createRateLimit(240, 10 * 60 * 1000);
  const videoUpload = createVideoUpload(config.UPLOAD_ROOT);

  router.get("/quota", authenticate, asyncHandler(controller.quota));
  router.get(
    "/hashtag/:tag",
    authenticate,
    asyncHandler(controller.byHashtag),
  );
  router.get("/", authenticate, asyncHandler(controller.list));
  router.get("/:reelId", authenticate, asyncHandler(controller.one));
  router.post(
    "/",
    authenticate,
    requireVerified,
    createLimit,
    asyncHandler(controller.ensureQuota),
    videoUpload,
    asyncHandler(controller.create),
  );
  router.post(
    "/:reelId/save",
    authenticate,
    actionLimit,
    asyncHandler(controller.save),
  );
  router.post(
    "/:reelId/view",
    authenticate,
    actionLimit,
    asyncHandler(controller.view),
  );
  router.post(
    "/:reelId/share",
    authenticate,
    actionLimit,
    asyncHandler(controller.share),
  );
  router.post(
    "/:reelId/like",
    authenticate,
    actionLimit,
    asyncHandler(controller.like),
  );
  router.get(
    "/:reelId/comments",
    authenticate,
    asyncHandler(controller.comments),
  );
  router.get(
    "/comments/:commentId/replies",
    authenticate,
    asyncHandler(controller.replies),
  );
  router.post(
    "/:reelId/comments",
    authenticate,
    requireVerified,
    actionLimit,
    asyncHandler(controller.addComment),
  );
  router.post(
    "/:reelId/comments/:commentId/like",
    authenticate,
    actionLimit,
    asyncHandler(controller.likeComment),
  );
  router.delete(
    "/:reelId/comments/:commentId",
    authenticate,
    requireVerified,
    asyncHandler(controller.removeComment),
  );
  router.delete(
    "/:reelId",
    authenticate,
    requireVerified,
    asyncHandler(controller.remove),
  );
  return router;
}

export function createUserReelsRouter(
  controller: ReelController,
  authenticate: RequestHandler,
): Router {
  const router = Router();
  router.get(
    "/:username/reels",
    authenticate,
    asyncHandler(controller.byUsername),
  );
  return router;
}

function createVideoUpload(uploadRoot: string): RequestHandler {
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_request, _file, callback) => {
        const directory = path.join(uploadRoot, "tmp");
        mkdirSync(directory, { recursive: true });
        callback(null, directory);
      },
      filename: (_request, _file, callback) => {
        callback(null, `${randomUUID()}.mp4`);
      },
    }),
    limits: {
      fileSize: 10 * 1024 * 1024,
      files: 1,
      fields: 6,
    },
  });

  return (request: Request, response: Response, next: NextFunction) => {
    upload.single("file")(request, response, (error: unknown) => {
      if (error instanceof MulterError) {
        const tooLarge = error.code === "LIMIT_FILE_SIZE";
        next(
          new AppError(
            tooLarge ? "PAYLOAD_TOO_LARGE" : "VALIDATION_ERROR",
            tooLarge
              ? "Video must be 10 MB or smaller"
              : "Invalid file upload",
            tooLarge ? 413 : 400,
          ),
        );
        return;
      }
      next(error);
    });
  };
}
