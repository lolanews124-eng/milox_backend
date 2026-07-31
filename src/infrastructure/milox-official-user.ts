import { createHash, randomBytes } from "node:crypto";

import {
  AgeRange,
  Gender,
  type PrismaClient,
  UserRole,
  UserStatus,
} from "@prisma/client";

import {
  MILOX_OFFICIAL_DISPLAY_NAME,
  MILOX_OFFICIAL_USERNAME,
} from "../modules/official-chat/official-chat-config.js";

const SYSTEM_EMAIL = "official@milox.internal";

export interface MiloxOfficialUserRecord {
  id: string;
  username: string;
  displayName: string;
}

export async function ensureMiloxOfficialUser(
  database: PrismaClient,
): Promise<MiloxOfficialUserRecord> {
  const existing = await database.user.findFirst({
    where: {
      OR: [
        { usernameNormalized: MILOX_OFFICIAL_USERNAME },
        { isSystemAccount: true, usernameNormalized: MILOX_OFFICIAL_USERNAME },
      ],
    },
    select: {
      id: true,
      username: true,
      displayName: true,
      isSystemAccount: true,
      isVerifiedBadge: true,
    },
  });

  if (existing) {
    if (
      !existing.isSystemAccount ||
      !existing.isVerifiedBadge ||
      existing.displayName !== MILOX_OFFICIAL_DISPLAY_NAME
    ) {
      await database.user.update({
        where: { id: existing.id },
        data: {
          isSystemAccount: true,
          isVerifiedBadge: true,
          displayName: MILOX_OFFICIAL_DISPLAY_NAME,
          hideOnline: true,
          hideLastSeen: true,
        },
      });
    }
    return {
      id: existing.id,
      username: existing.username,
      displayName: MILOX_OFFICIAL_DISPLAY_NAME,
    };
  }

  const passwordHash = createHash("sha256")
    .update(randomBytes(64))
    .digest("hex");

  const created = await database.user.create({
    data: {
      username: MILOX_OFFICIAL_USERNAME,
      usernameNormalized: MILOX_OFFICIAL_USERNAME,
      email: SYSTEM_EMAIL,
      passwordHash,
      ageRange: AgeRange.AGE_25_28,
      gender: Gender.OTHER,
      country: "Global",
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      displayName: MILOX_OFFICIAL_DISPLAY_NAME,
      isVerifiedBadge: true,
      isSystemAccount: true,
      hideOnline: true,
      hideLastSeen: true,
      emailVerifiedAt: new Date(),
    },
    select: {
      id: true,
      username: true,
      displayName: true,
    },
  });

  return {
    id: created.id,
    username: created.username,
    displayName: created.displayName ?? MILOX_OFFICIAL_DISPLAY_NAME,
  };
}
