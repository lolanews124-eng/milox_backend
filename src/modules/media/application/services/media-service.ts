import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, open, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { MediaKind, MediaVisibility } from "@prisma/client";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";

import type { AppConfig } from "../../../../config/env.js";
import { AppError } from "../../../../shared/errors/app-error.js";
import type { MediaRepository } from "../ports/media-repository.js";

const MAX_VIDEO_BYTES = 10 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const ALLOWED_UPLOAD_KINDS = new Set<MediaKind>([
  MediaKind.PROFILE_PHOTO,
  MediaKind.COVER_PHOTO,
  MediaKind.POST_IMAGE,
  MediaKind.CHAT_IMAGE,
  MediaKind.STORY_IMAGE,
]);

/** Kind-wise max edge (px) and target max stored size (bytes). */
const KIND_BUDGETS: Partial<
  Record<MediaKind, { maxEdge: number; maxBytes: number }>
> = {
  [MediaKind.PROFILE_PHOTO]: { maxEdge: 720, maxBytes: 120_000 },
  [MediaKind.COVER_PHOTO]: { maxEdge: 1_440, maxBytes: 220_000 },
  [MediaKind.POST_IMAGE]: { maxEdge: 1_440, maxBytes: 280_000 },
  [MediaKind.STORY_IMAGE]: { maxEdge: 1_080, maxBytes: 220_000 },
  [MediaKind.CHAT_IMAGE]: { maxEdge: 1_080, maxBytes: 200_000 },
};

const QUALITY_STEPS = [82, 74, 66, 58, 50, 42] as const;
const EDGE_FALLBACK_FACTORS = [1, 0.85, 0.72, 0.6] as const;

export class MediaService {
  constructor(
    private readonly repository: MediaRepository,
    private readonly config: AppConfig,
  ) {}

  async uploadImage(
    ownerUserId: string,
    kind: MediaKind,
    input: Buffer,
  ): Promise<object> {
    if (!ALLOWED_UPLOAD_KINDS.has(kind)) {
      throw new AppError(
        "UNSUPPORTED_MEDIA_TYPE",
        "This media kind is not available on this endpoint",
        415,
      );
    }

    const detected = await fileTypeFromBuffer(input);
    if (!detected || !ALLOWED_MIME_TYPES.has(detected.mime)) {
      throw new AppError(
        "UNSUPPORTED_MEDIA_TYPE",
        "Only JPEG, PNG, and WebP images are supported",
        415,
      );
    }

    const budget = KIND_BUDGETS[kind];
    if (!budget) {
      throw new AppError(
        "UNSUPPORTED_MEDIA_TYPE",
        "This media kind is not available on this endpoint",
        415,
      );
    }
    let output: {
      data: Buffer;
      info: { width: number; height: number; size: number };
    };
    try {
      const image = sharp(input, {
        limitInputPixels: 40_000_000,
        failOn: "warning",
      });
      const metadata = await image.metadata();
      if (
        !metadata.width ||
        !metadata.height ||
        metadata.width > 12_000 ||
        metadata.height > 12_000
      ) {
        throw new Error("Invalid image dimensions");
      }
      output = await encodeWithinBudget(image, budget.maxEdge, budget.maxBytes);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        "UNSUPPORTED_MEDIA_TYPE",
        "The uploaded image is invalid",
        415,
      );
    }

    const id = randomUUID();
    const directory = kindDirectory(kind);
    const isChatImage = kind === MediaKind.CHAT_IMAGE;
    const storageKey = `${isChatImage ? "private" : "public"}/${directory}/${id}.webp`;
    const absolutePath = path.resolve(this.config.UPLOAD_ROOT, storageKey);
    const temporaryPath = `${absolutePath}.tmp`;
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(temporaryPath, output.data, { flag: "wx" });
    await rename(temporaryPath, absolutePath);

    try {
      const record = await this.repository.create({
        id,
        ownerUserId,
        kind,
        visibility: isChatImage
          ? MediaVisibility.MATCH_ONLY
          : MediaVisibility.PUBLIC,
        storageKey,
        mimeType: "image/webp",
        byteSize: output.info.size,
        width: output.info.width,
        height: output.info.height,
        checksumSha256: createHash("sha256")
          .update(output.data)
          .digest("hex"),
      });
      return {
        id: record.id,
        kind: record.kind,
        url: isChatImage
          ? null
          : `${this.config.API_PUBLIC_URL.replace(/\/$/, "")}/api/v1/media/${record.id}`,
        mimeType: record.mimeType,
        width: record.width,
        height: record.height,
        createdAt: record.createdAt.toISOString(),
      };
    } catch (error: unknown) {
      await unlink(absolutePath).catch(() => undefined);
      throw error;
    }
  }

  /**
   * Stores an already-playable MP4. No transcode — the file is public as soon
   * as this returns.
   */
  async uploadReelVideo(
    ownerUserId: string,
    tempPath: string,
  ): Promise<{ id: string; url: string; byteSize: number }> {
    const info = await stat(tempPath);
    if (info.size <= 0 || info.size > MAX_VIDEO_BYTES) {
      throw new AppError(
        "PAYLOAD_TOO_LARGE",
        "Video must be 10 MB or smaller",
        413,
      );
    }
    await assertMp4(tempPath);

    const id = randomUUID();
    const storageKey = `public/reels/${id}.mp4`;
    const absolutePath = path.resolve(this.config.UPLOAD_ROOT, storageKey);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await moveFile(tempPath, absolutePath);

    try {
      const record = await this.repository.create({
        id,
        ownerUserId,
        kind: MediaKind.REEL_VIDEO,
        visibility: MediaVisibility.PUBLIC,
        storageKey,
        mimeType: "video/mp4",
        byteSize: info.size,
        width: null,
        height: null,
        checksumSha256: await sha256File(absolutePath),
      });
      return {
        id: record.id,
        url: `${this.config.API_PUBLIC_URL.replace(/\/$/, "")}/api/v1/media/${record.id}`,
        byteSize: record.byteSize,
      };
    } catch (error: unknown) {
      await unlink(absolutePath).catch(() => undefined);
      throw error;
    }
  }

  async discardUpload(mediaId: string, ownerUserId: string): Promise<void> {
    const record = await this.repository.findOwnedById(mediaId, ownerUserId);
    if (!record) return;
    const absolutePath = path.resolve(this.config.UPLOAD_ROOT, record.storageKey);
    await unlink(absolutePath).catch(() => undefined);
    await this.repository.hardDelete(mediaId).catch(() => undefined);
  }

  async resolvePublicMedia(mediaId: string): Promise<{
    absolutePath: string;
    mimeType: string;
    checksum: string | null;
  }> {
    const record = await this.repository.findPublicById(mediaId);
    if (!record) {
      throw new AppError("MEDIA_NOT_FOUND", "Media not found", 404);
    }
    const uploadRoot = path.resolve(this.config.UPLOAD_ROOT);
    const absolutePath = path.resolve(uploadRoot, record.storageKey);
    if (!absolutePath.startsWith(`${uploadRoot}${path.sep}`)) {
      throw new AppError("MEDIA_NOT_FOUND", "Media not found", 404);
    }
    return {
      absolutePath,
      mimeType: record.mimeType,
      checksum: record.checksumSha256,
    };
  }
}

async function encodeWithinBudget(
  image: ReturnType<typeof sharp>,
  maxEdge: number,
  maxBytes: number,
): Promise<{
  data: Buffer;
  info: { width: number; height: number; size: number };
}> {
  let best: {
    data: Buffer;
    info: { width: number; height: number; size: number };
  } | null = null;

  for (const edgeFactor of EDGE_FALLBACK_FACTORS) {
    const edge = Math.max(320, Math.round(maxEdge * edgeFactor));
    for (const quality of QUALITY_STEPS) {
      const result = await image
        .clone()
        .rotate()
        .resize({
          width: edge,
          height: edge,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality, effort: 4 })
        .toBuffer({ resolveWithObject: true });

      const candidate = {
        data: result.data,
        info: {
          width: result.info.width,
          height: result.info.height,
          size: result.info.size,
        },
      };

      if (!best || candidate.info.size < best.info.size) {
        best = candidate;
      }
      if (candidate.info.size <= maxBytes) {
        return candidate;
      }
    }
  }

  if (!best) {
    throw new Error("Failed to encode image");
  }
  return best;
}

function kindDirectory(kind: MediaKind): string {
  switch (kind) {
    case MediaKind.PROFILE_PHOTO:
      return "profiles";
    case MediaKind.COVER_PHOTO:
      return "covers";
    case MediaKind.POST_IMAGE:
      return "posts";
    case MediaKind.STORY_IMAGE:
      return "stories";
    case MediaKind.CHAT_IMAGE:
      return "chat";
    case MediaKind.REEL_VIDEO:
      return "reels";
    default:
      throw new Error(`Unsupported upload media kind: ${kind}`);
  }
}

async function assertMp4(filePath: string): Promise<void> {
  const handle = await open(filePath, "r");
  try {
    const header = Buffer.alloc(16);
    const { bytesRead } = await handle.read(header, 0, 16, 0);
    const brand = bytesRead >= 8 ? header.subarray(4, 8).toString("ascii") : "";
    if (brand !== "ftyp") {
      throw new AppError(
        "UNSUPPORTED_MEDIA_TYPE",
        "Only MP4 videos are supported",
        415,
      );
    }
  } finally {
    await handle.close();
  }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => {
      hash.update(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => resolve());
  });
  return hash.digest("hex");
}

async function moveFile(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch {
    await copyFile(from, to);
    await unlink(from).catch(() => undefined);
  }
}
