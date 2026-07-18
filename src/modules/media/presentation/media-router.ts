import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import multer, { MulterError } from "multer";

import { AppError } from "../../../shared/errors/app-error.js";
import { asyncHandler } from "../../../shared/http/async-handler.js";
import type { MediaController } from "./media-controller.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1,
    fields: 4,
  },
});

const imageUpload: RequestHandler = (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  upload.single("file")(request, response, (error: unknown) => {
    if (error instanceof MulterError) {
      const tooLarge = error.code === "LIMIT_FILE_SIZE";
      next(
        new AppError(
          tooLarge ? "PAYLOAD_TOO_LARGE" : "VALIDATION_ERROR",
          tooLarge ? "Image must be 10 MB or smaller" : "Invalid file upload",
          tooLarge ? 413 : 400,
        ),
      );
      return;
    }
    next(error);
  });
};

export function createMediaRouter(
  controller: MediaController,
  authenticate: RequestHandler,
  requireVerified: RequestHandler,
): Router {
  const router = Router();
  router.get("/:mediaId", asyncHandler(controller.getPublic));
  router.post(
    "/",
    authenticate,
    requireVerified,
    imageUpload,
    asyncHandler(controller.upload),
  );
  return router;
}
