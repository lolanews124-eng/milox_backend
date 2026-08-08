import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AgeRange,
  Gender,
  MediaKind,
  MediaVisibility,
  type PrismaClient,
  UserRole,
  UserStatus,
} from "@prisma/client";
import sharp from "sharp";

import { getConfig } from "../config/env.js";
import {
  MILOX_OFFICIAL_AVATAR_MEDIA_ID,
  MILOX_OFFICIAL_AVATAR_STORAGE_KEY,
  MILOX_OFFICIAL_BIO,
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
      bio: true,
    },
  });

  if (existing) {
    const needsUpdate =
      !existing.isSystemAccount ||
      !existing.isVerifiedBadge ||
      existing.displayName !== MILOX_OFFICIAL_DISPLAY_NAME ||
      existing.bio !== MILOX_OFFICIAL_BIO;
    if (needsUpdate) {
      await database.user.update({
        where: { id: existing.id },
        data: {
          isSystemAccount: true,
          isVerifiedBadge: true,
          displayName: MILOX_OFFICIAL_DISPLAY_NAME,
          bio: MILOX_OFFICIAL_BIO,
          hideOnline: true,
          hideLastSeen: true,
        },
      });
    }
    await ensureMiloxOfficialAvatar(database, existing.id);
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
      bio: MILOX_OFFICIAL_BIO,
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

  await ensureMiloxOfficialAvatar(database, created.id);

  return {
    id: created.id,
    username: created.username,
    displayName: created.displayName ?? MILOX_OFFICIAL_DISPLAY_NAME,
  };
}

async function ensureMiloxOfficialAvatar(
  database: PrismaClient,
  officialUserId: string,
): Promise<void> {
  const config = getConfig();
  const uploadRoot = path.resolve(config.UPLOAD_ROOT);
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const bundledSource = path.resolve(
    moduleDir,
    "../../assets/branding/milox-official-avatar.png",
  );

  let sourceBuffer: Buffer;
  try {
    sourceBuffer = await readFile(bundledSource);
  } catch {
    console.warn(
      "Milox Official avatar source missing; skipping profile photo setup:",
      bundledSource,
    );
    return;
  }

  const processed = await sharp(sourceBuffer)
    .rotate()
    .resize({ width: 512, height: 512, fit: "cover" })
    .webp({ quality: 88 })
    .toBuffer({ resolveWithObject: true });

  const absolutePath = path.resolve(uploadRoot, MILOX_OFFICIAL_AVATAR_STORAGE_KEY);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, processed.data);

  const checksumSha256 = createHash("sha256")
    .update(processed.data)
    .digest("hex");

  await database.mediaAsset.upsert({
    where: { id: MILOX_OFFICIAL_AVATAR_MEDIA_ID },
    create: {
      id: MILOX_OFFICIAL_AVATAR_MEDIA_ID,
      ownerUserId: officialUserId,
      kind: MediaKind.PROFILE_PHOTO,
      visibility: MediaVisibility.PUBLIC,
      storageKey: MILOX_OFFICIAL_AVATAR_STORAGE_KEY,
      mimeType: "image/webp",
      byteSize: processed.info.size,
      width: processed.info.width,
      height: processed.info.height,
      checksumSha256,
    },
    update: {
      ownerUserId: officialUserId,
      storageKey: MILOX_OFFICIAL_AVATAR_STORAGE_KEY,
      mimeType: "image/webp",
      byteSize: processed.info.size,
      width: processed.info.width,
      height: processed.info.height,
      checksumSha256,
      deletedAt: null,
    },
  });

  await database.user.update({
    where: { id: officialUserId },
    data: { profilePhotoMediaId: MILOX_OFFICIAL_AVATAR_MEDIA_ID },
  });
}
