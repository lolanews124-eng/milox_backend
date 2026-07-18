import type { Request, Response } from "express";

import type { AppConfig } from "../../../config/env.js";
import { AppError } from "../../../shared/errors/app-error.js";
import type {
  AuthService,
  AuthSession,
  RequestContext,
} from "../application/services/auth-service.js";
import {
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  resetPasswordSchema,
  signupSchema,
  tokenSchema,
} from "./auth-schemas.js";

const REFRESH_COOKIE = "milox_rt";

export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfig,
  ) {}

  signup = async (request: Request, response: Response): Promise<void> => {
    const input = signupSchema.parse(request.body);
    const session = await this.auth.signup(input, requestContext(request));
    this.sendSession(request, response, session, 201);
  };

  login = async (request: Request, response: Response): Promise<void> => {
    const input = loginSchema.parse(request.body);
    const session = await this.auth.login(
      input.email,
      input.password,
      requestContext(request),
    );
    this.sendSession(request, response, session, 200);
  };

  refresh = async (request: Request, response: Response): Promise<void> => {
    const input = refreshSchema.parse(request.body ?? {});
    const refreshToken =
      input.refreshToken ?? readCookie(request, REFRESH_COOKIE);
    if (!refreshToken) {
      throw new AppError("INVALID_TOKEN", "Refresh token is required", 401);
    }

    const session = await this.auth.refresh(
      refreshToken,
      requestContext(request),
    );
    this.sendSession(request, response, session, 200);
  };

  logout = async (request: Request, response: Response): Promise<void> => {
    const body = refreshSchema.parse(request.body ?? {});
    await this.auth.logout(
      body.refreshToken ?? readCookie(request, REFRESH_COOKIE),
    );
    response.clearCookie(REFRESH_COOKIE, this.refreshCookieOptions());
    response.status(204).send();
  };

  verifyEmail = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const { token } = tokenSchema.parse(request.body);
    await this.auth.verifyEmail(token);
    response.status(200).json(messageEnvelope(request, "Email verified"));
  };

  resendVerification = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    if (!request.auth) {
      throw new AppError("UNAUTHENTICATED", "Authentication required", 401);
    }
    await this.auth.resendVerification(request.auth.userId);
    response
      .status(202)
      .json(
        messageEnvelope(
          request,
          "If verification is required, an email has been queued",
        ),
      );
  };

  forgotPassword = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const { email } = forgotPasswordSchema.parse(request.body);
    await this.auth.forgotPassword(email);
    response
      .status(202)
      .json(
        messageEnvelope(
          request,
          "If the account exists, a reset email has been queued",
        ),
      );
  };

  resetPassword = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const input = resetPasswordSchema.parse(request.body);
    await this.auth.resetPassword(input.token, input.password);
    response
      .status(200)
      .json(messageEnvelope(request, "Password reset successfully"));
  };

  private sendSession(
    request: Request,
    response: Response,
    session: AuthSession,
    status: number,
  ): void {
    const isMobile = request.header("x-client-platform") === "mobile";
    if (!isMobile) {
      response.cookie(
        REFRESH_COOKIE,
        session.refreshToken,
        this.refreshCookieOptions(),
      );
    }

    response.status(status).json({
      success: true,
      data: {
        accessToken: session.accessToken,
        ...(isMobile ? { refreshToken: session.refreshToken } : {}),
        expiresIn: session.expiresIn,
        user: session.user,
      },
      meta: { requestId: request.requestId },
    });
  }

  private refreshCookieOptions(): {
    httpOnly: true;
    secure: boolean;
    sameSite: "strict";
    path: string;
    maxAge: number;
  } {
    return {
      httpOnly: true,
      secure: this.config.NODE_ENV === "production",
      sameSite: "strict",
      path: "/api/v1/auth",
      maxAge: this.config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    };
  }
}

function requestContext(request: Request): RequestContext {
  const userAgent = request.header("user-agent");
  return {
    ...(request.ip ? { ip: request.ip } : {}),
    ...(userAgent ? { userAgent } : {}),
  };
}

function readCookie(request: Request, name: string): string | undefined {
  const value: unknown = request.cookies?.[name];
  return typeof value === "string" ? value : undefined;
}

function messageEnvelope(request: Request, message: string): object {
  return {
    success: true,
    data: { message },
    meta: { requestId: request.requestId },
  };
}
