import cors from "cors";
import cookieParser from "cookie-parser";
import express, { type Express } from "express";
import helmet from "helmet";

import type { PrismaClient } from "@prisma/client";

import { getConfig, type AppConfig } from "./config/env.js";
import { prisma } from "./infrastructure/prisma/client.js";
import { createAdminModule } from "./modules/admin/index.js";
import { createAuthModule } from "./modules/auth/index.js";
import { createChatModule } from "./modules/chat/index.js";
import { createCommentModule } from "./modules/comments/index.js";
import { createFeedModule } from "./modules/feed/index.js";
import { createFollowModule } from "./modules/follows/index.js";
import { createInterestModule } from "./modules/interests/index.js";
import { createMediaModule } from "./modules/media/index.js";
import { createModerationModule } from "./modules/moderation/index.js";
import { createNotificationModule } from "./modules/notifications/index.js";
import { createPostModule } from "./modules/posts/index.js";
import { createStoryModule } from "./modules/stories/index.js";
import { createUserModule } from "./modules/users/index.js";
import { asyncHandler } from "./shared/http/async-handler.js";
import {
  errorHandler,
  notFoundHandler,
} from "./shared/http/error-handler.js";
import { requestId } from "./shared/http/request-id.js";

export interface AppDependencies {
  config?: AppConfig;
  database?: PrismaClient;
}

export function createApp(dependencies: AppDependencies = {}): Express {
  const config = dependencies.config ?? getConfig();
  const database = dependencies.database ?? prisma;
  const auth = createAuthModule(config, database);
  const admin = createAdminModule(database, auth.authenticate);
  const users = createUserModule(config, database, auth.service, {
    authenticate: auth.authenticate,
    optionalAuthenticate: auth.optionalAuthenticate,
    requireVerified: auth.requireVerified,
  });
  const media = createMediaModule(
    config,
    database,
    auth.authenticate,
    auth.requireVerified,
  );
  const feed = createFeedModule(
    config,
    database,
    auth.authenticate,
    auth.optionalAuthenticate,
  );
  const posts = createPostModule(config, database, {
    authenticate: auth.authenticate,
    optionalAuthenticate: auth.optionalAuthenticate,
    requireVerified: auth.requireVerified,
  });
  const stories = createStoryModule(config, database, {
    authenticate: auth.authenticate,
    requireVerified: auth.requireVerified,
  });
  const comments = createCommentModule(config, database, {
    authenticate: auth.authenticate,
    optionalAuthenticate: auth.optionalAuthenticate,
    requireVerified: auth.requireVerified,
  });
  const follows = createFollowModule(config, database, {
    authenticate: auth.authenticate,
    optionalAuthenticate: auth.optionalAuthenticate,
    requireVerified: auth.requireVerified,
  });
  const interests = createInterestModule(config, database, {
    authenticate: auth.authenticate,
    requireVerified: auth.requireVerified,
  });
  const chat = createChatModule(config, database, {
    authenticate: auth.authenticate,
    requireVerified: auth.requireVerified,
  });
  const notifications = createNotificationModule(
    config,
    database,
    auth.authenticate,
  );
  const moderation = createModerationModule(
    config,
    database,
    auth.authenticate,
  );
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(
    helmet({
      // Media is served from the API origin and embedded by the web/admin
      // apps on other origins; same-origin CORP would block those images.
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );
  app.use(
    cors({
      origin: [config.WEB_ORIGIN, config.ADMIN_ORIGIN],
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(requestId);

  app.get("/health/live", (_request, response) => {
    response.status(200).json({
      success: true,
      data: { status: "live" },
    });
  });

  app.get(
    "/health/ready",
    asyncHandler(async (request, response) => {
      await database.$queryRaw`SELECT 1`;
      response.status(200).json({
        success: true,
        data: { status: "ready" },
        meta: { requestId: request.requestId },
      });
    }),
  );

  app.use("/api/v1/auth", auth.router);
  app.use("/api/v1/users", moderation.userBlocksRouter);
  app.use("/api/v1/users", follows.userRouter);
  app.use("/api/v1/users", posts.userPostsRouter);
  app.use("/api/v1/users", users.router);
  app.use("/api/v1/media", media.router);
  app.use("/api/v1/feed", feed.router);
  app.use("/api/v1/posts", comments.postCommentsRouter);
  app.use("/api/v1/posts", posts.router);
  app.use("/api/v1/hashtags", posts.hashtags);
  app.use("/api/v1/comments", comments.router);
  app.use("/api/v1/stories", stories.router);
  app.use("/api/v1/follow-requests", follows.router);
  app.use("/api/v1/interests", interests.router);
  app.use("/api/v1/matches", interests.matchesRouter);
  app.use("/api/v1/conversations", chat.router);
  app.use("/api/v1/messages", chat.messagesRouter);
  app.use("/api/v1/notifications", notifications.router);
  app.use("/api/v1/blocks", moderation.blocksRouter);
  app.use("/api/v1/reports", moderation.reportsRouter);
  app.use("/api/v1/admin", admin.router);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
