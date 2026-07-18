import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { AppError } from "../../../../shared/errors/app-error.js";

const cursorSchema = z.discriminatedUnion("kind", [
  z.object({
    version: z.literal(1),
    kind: z.literal("chronological"),
    id: z.string().uuid(),
    createdAt: z.string().datetime(),
  }),
  z.object({
    version: z.literal(1),
    kind: z.literal("ranked"),
    id: z.string().uuid(),
    createdAt: z.string().datetime(),
    score: z.number().finite(),
  }),
]);

export type FeedCursor = z.infer<typeof cursorSchema>;

export class FeedCursorCodec {
  constructor(private readonly secret: string) {}

  encode(cursor: FeedCursor): string {
    const payload = Buffer.from(JSON.stringify(cursor)).toString("base64url");
    return `${payload}.${this.sign(payload)}`;
  }

  decode(value: string): FeedCursor {
    const [payload, signature, extra] = value.split(".");
    if (!payload || !signature || extra !== undefined) {
      throw invalidCursor();
    }
    const expected = this.sign(payload);
    const actualBuffer = Buffer.from(signature, "base64url");
    const expectedBuffer = Buffer.from(expected, "base64url");
    if (
      actualBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(actualBuffer, expectedBuffer)
    ) {
      throw invalidCursor();
    }

    try {
      const parsed: unknown = JSON.parse(
        Buffer.from(payload, "base64url").toString("utf8"),
      );
      return cursorSchema.parse(parsed);
    } catch {
      throw invalidCursor();
    }
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.secret)
      .update(payload)
      .digest("base64url");
  }
}

function invalidCursor(): AppError {
  return new AppError(
    "INVALID_CURSOR",
    "The pagination cursor is invalid or expired",
    400,
  );
}
