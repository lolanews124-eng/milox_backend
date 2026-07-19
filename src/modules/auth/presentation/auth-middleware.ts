import { UserRole } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { NextFunction, Request, RequestHandler, Response } from "express";

import { AppError } from "../../../shared/errors/app-error.js";
import {
  DEV_ADMIN_BYPASS_TOKEN,
  isAdminAuthBypassEnabled,
  resolveDevBypassStaff,
} from "../../../shared/dev-admin-auth.js";
import type { CryptoService } from "../application/services/crypto-service.js";

export function authenticate(
  crypto: CryptoService,
  database?: PrismaClient,
): RequestHandler {
  return (request: Request, _response: Response, next: NextFunction) => {
    const header = request.header("authorization");
    const token =
      header?.startsWith("Bearer ") === true ? header.slice(7) : undefined;

    if (
      isAdminAuthBypassEnabled() &&
      token === DEV_ADMIN_BYPASS_TOKEN &&
      database
    ) {
      void resolveDevBypassStaff(database)
        .then((staff) => {
          if (!staff) {
            next(
              new AppError(
                "FORBIDDEN",
                "Dev auth bypass requires at least one active staff user in the database",
                403,
              ),
            );
            return;
          }
          request.auth = {
            userId: staff.id,
            role: staff.role,
            emailVerified: true,
          };
          next();
        })
        .catch(next);
      return;
    }

    if (!token) {
      next(new AppError("UNAUTHENTICATED", "Authentication required", 401));
      return;
    }

    void crypto
      .verifyAccessToken(token)
      .then((claims) => {
        if (!Object.values(UserRole).includes(claims.role as UserRole)) {
          throw new Error("Invalid role claim");
        }
        request.auth = {
          userId: claims.userId,
          role: claims.role as UserRole,
          emailVerified: claims.emailVerified,
        };
        next();
      })
      .catch(() => {
        next(new AppError("UNAUTHENTICATED", "Invalid or expired token", 401));
      });
  };
}

export function optionalAuthenticate(crypto: CryptoService): RequestHandler {
  return (request: Request, _response: Response, next: NextFunction) => {
    const header = request.header("authorization");
    if (!header) {
      next();
      return;
    }
    const token = header.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (!token) {
      next(new AppError("UNAUTHENTICATED", "Invalid access token", 401));
      return;
    }
    void crypto
      .verifyAccessToken(token)
      .then((claims) => {
        if (!Object.values(UserRole).includes(claims.role as UserRole)) {
          throw new Error("Invalid role claim");
        }
        request.auth = {
          userId: claims.userId,
          role: claims.role as UserRole,
          emailVerified: claims.emailVerified,
        };
        next();
      })
      .catch(() => {
        next(new AppError("UNAUTHENTICATED", "Invalid or expired token", 401));
      });
  };
}

export const requireVerified: RequestHandler = (request, _response, next) => {
  if (!request.auth?.emailVerified) {
    next(
      new AppError(
        "EMAIL_NOT_VERIFIED",
        "Email verification is required",
        403,
      ),
    );
    return;
  }
  next();
};
