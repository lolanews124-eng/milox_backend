import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { AppError } from "../src/shared/errors/app-error.js";
import { errorHandler } from "../src/shared/http/error-handler.js";

describe("errorHandler", () => {
  it("returns the application error when no response has been sent", async () => {
    const app = express();
    app.get("/missing", (_req, _res, next) => {
      next(new AppError("NOT_FOUND", "Missing", 404));
    });
    app.use(errorHandler);

    const response = await request(app).get("/missing");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("does not write a second response after headers are sent", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = express();
    app.get("/once", (_req, res, next) => {
      res.status(200).json({ ok: true });
      next(new Error("late failure"));
    });
    app.use(errorHandler);

    const response = await request(app).get("/once");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("logs unexpected errors and still returns one 500 response", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = express();
    app.get("/boom", () => {
      throw new Error("database offline");
    });
    app.use(errorHandler);

    const response = await request(app).get("/boom");

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("INTERNAL_ERROR");
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
