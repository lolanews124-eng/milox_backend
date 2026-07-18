import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";

import { AppError } from "../errors/app-error.js";
import { isAppError } from "../errors/app-error.js";

export const notFoundHandler: RequestHandler = (_request, _response, next) => {
  next(new AppError("NOT_FOUND", "Route not found", 404));
};

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  request,
  response,
  _next,
) => {
  void _next;
  if (error instanceof ZodError) {
    response.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: error.issues.map((issue) => ({
          field: issue.path.join("."),
          issue: issue.code,
        })),
      },
      meta: { requestId: request.requestId },
    });
    return;
  }

  if (isAppError(error)) {
    response.status(error.statusCode).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
      meta: { requestId: request.requestId },
    });
    return;
  }

  response.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
      details: [],
    },
    meta: { requestId: request.requestId },
  });
};
