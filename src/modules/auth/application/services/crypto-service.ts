import { createHash, randomBytes, randomUUID } from "node:crypto";

import * as argon2 from "argon2";
import { jwtVerify, SignJWT } from "jose";

import type { AppConfig } from "../../../../config/env.js";

export interface AccessTokenClaims {
  userId: string;
  role: string;
  emailVerified: boolean;
}

export interface OpaqueToken {
  raw: string;
  hash: string;
}

export class CryptoService {
  private readonly jwtSecret: Uint8Array;
  private dummyPasswordHash: Promise<string> | undefined;

  constructor(private readonly config: AppConfig) {
    this.jwtSecret = new TextEncoder().encode(config.JWT_ACCESS_SECRET);
  }

  async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
  }

  async verifyPassword(hash: string, password: string): Promise<boolean> {
    return argon2.verify(hash, password);
  }

  /**
   * Performs an Argon2 verification even when no account exists, reducing
   * login timing differences that could otherwise aid email enumeration.
   */
  async verifyLoginPassword(
    hash: string | undefined,
    password: string,
  ): Promise<boolean> {
    this.dummyPasswordHash ??= this.hashPassword(
      "milox-non-account-password-sentinel",
    );
    const candidate = hash ?? (await this.dummyPasswordHash);
    const valid = await this.verifyPassword(candidate, password);
    return hash !== undefined && valid;
  }

  createOpaqueToken(): OpaqueToken {
    const raw = randomBytes(48).toString("base64url");
    return { raw, hash: this.hashOpaqueToken(raw) };
  }

  hashOpaqueToken(raw: string): string {
    return createHash("sha256").update(raw).digest("hex");
  }

  hashIp(ip: string | undefined): string | undefined {
    if (!ip) return undefined;
    return createHash("sha256")
      .update(`${this.config.JWT_ACCESS_SECRET}:${ip}`)
      .digest("hex");
  }

  createId(): string {
    return randomUUID();
  }

  async createAccessToken(claims: AccessTokenClaims): Promise<string> {
    return new SignJWT({
      role: claims.role,
      emailVerified: claims.emailVerified,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(claims.userId)
      .setIssuer(this.config.JWT_ISSUER)
      .setAudience(this.config.JWT_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(
        Math.floor(Date.now() / 1000) + this.config.JWT_ACCESS_TTL_SECONDS,
      )
      .sign(this.jwtSecret);
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    const { payload } = await jwtVerify(token, this.jwtSecret, {
      issuer: this.config.JWT_ISSUER,
      audience: this.config.JWT_AUDIENCE,
    });

    if (
      !payload.sub ||
      typeof payload.role !== "string" ||
      typeof payload.emailVerified !== "boolean"
    ) {
      throw new Error("Invalid access token claims");
    }

    return {
      userId: payload.sub,
      role: payload.role,
      emailVerified: payload.emailVerified,
    };
  }
}
