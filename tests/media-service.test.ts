import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config/env.js";
import type {
  CreateMediaData,
  MediaRepository,
} from "../src/modules/media/application/ports/media-repository.js";
import { MediaService } from "../src/modules/media/application/services/media-service.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("MediaService", () => {
  it("validates, re-encodes, and persists a public profile image", async () => {
    const uploadRoot = await mkdtemp(path.join(os.tmpdir(), "milox-media-"));
    temporaryDirectories.push(uploadRoot);
    const repository = createRepository();
    const service = new MediaService(repository, {
      UPLOAD_ROOT: uploadRoot,
      API_PUBLIC_URL: "http://localhost:3001",
    } as AppConfig);
    const png = await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 3,
        background: "#663399",
      },
    })
      .png()
      .toBuffer();

    const output = await service.uploadImage(
      "55db32ec-8c85-421d-b598-d53dd088cd7d",
      "PROFILE_PHOTO",
      png,
    );

    expect(output).toMatchObject({
      kind: "PROFILE_PHOTO",
      mimeType: "image/webp",
      width: 32,
      height: 32,
    });
    expect(repository.create).toHaveBeenCalledOnce();
    const created = vi.mocked(repository.create).mock.calls[0]?.[0];
    expect(created?.storageKey).toMatch(
      /^public\/profiles\/[0-9a-f-]+\.webp$/,
    );
    const bytes = await readFile(path.resolve(uploadRoot, created!.storageKey));
    expect((await sharp(bytes).metadata()).format).toBe("webp");
  });

  it("rejects content that is not an image", async () => {
    const service = new MediaService(createRepository(), {
      UPLOAD_ROOT: os.tmpdir(),
      API_PUBLIC_URL: "http://localhost:3001",
    } as AppConfig);

    await expect(
      service.uploadImage(
        "55db32ec-8c85-421d-b598-d53dd088cd7d",
        "PROFILE_PHOTO",
        Buffer.from("not-an-image"),
      ),
    ).rejects.toMatchObject({
      code: "UNSUPPORTED_MEDIA_TYPE",
      statusCode: 415,
    });
  });

  it("stores chat images privately without a public URL", async () => {
    const uploadRoot = await mkdtemp(path.join(os.tmpdir(), "milox-chat-"));
    temporaryDirectories.push(uploadRoot);
    const repository = createRepository();
    const service = new MediaService(repository, {
      UPLOAD_ROOT: uploadRoot,
      API_PUBLIC_URL: "http://localhost:3001",
    } as AppConfig);
    const image = await sharp({
      create: {
        width: 16,
        height: 16,
        channels: 3,
        background: "#111111",
      },
    })
      .png()
      .toBuffer();

    const output = await service.uploadImage(
      "55db32ec-8c85-421d-b598-d53dd088cd7d",
      "CHAT_IMAGE",
      image,
    );

    expect(output).toMatchObject({ kind: "CHAT_IMAGE", url: null });
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "CHAT_IMAGE",
        visibility: "MATCH_ONLY",
        storageKey: expect.stringMatching(
          /^private\/chat\/[0-9a-f-]+\.webp$/,
        ),
      }),
    );
  });

  it("does not resolve deleted or non-public media", async () => {
    const repository = createRepository();
    vi.mocked(repository.findPublicById).mockResolvedValue(null);
    const service = new MediaService(repository, {
      UPLOAD_ROOT: os.tmpdir(),
      API_PUBLIC_URL: "http://localhost:3001",
    } as AppConfig);

    await expect(
      service.resolvePublicMedia("7727295b-22ee-43a4-a82d-7754c65f2532"),
    ).rejects.toMatchObject({ code: "MEDIA_NOT_FOUND", statusCode: 404 });
  });

  it("compresses a large profile photo under the kind byte budget", async () => {
    const uploadRoot = await mkdtemp(path.join(os.tmpdir(), "milox-media-big-"));
    temporaryDirectories.push(uploadRoot);
    const repository = createRepository();
    const service = new MediaService(repository, {
      UPLOAD_ROOT: uploadRoot,
      API_PUBLIC_URL: "http://localhost:3001",
    } as AppConfig);
    // Noisy image so WebP cannot trivially shrink below budget without resize/quality steps.
    const pixels = Buffer.alloc(2_000 * 2_000 * 3);
    for (let i = 0; i < pixels.length; i += 1) {
      pixels[i] = (i * 37 + 11) % 256;
    }
    const png = await sharp(pixels, {
      raw: { width: 2_000, height: 2_000, channels: 3 },
    })
      .png()
      .toBuffer();

    expect(png.byteLength).toBeGreaterThan(80_000);

    await service.uploadImage(
      "55db32ec-8c85-421d-b598-d53dd088cd7d",
      "PROFILE_PHOTO",
      png,
    );

    const created = vi.mocked(repository.create).mock.calls[0]?.[0];
    expect(created?.byteSize).toBeLessThanOrEqual(120_000);
    expect(created?.width).toBeLessThanOrEqual(720);
    expect(created?.height).toBeLessThanOrEqual(720);
    expect(created?.mimeType).toBe("image/webp");
  });
});

function createRepository(): MediaRepository {
  return {
    create: vi.fn((data: CreateMediaData) =>
      Promise.resolve({
        ...data,
        createdAt: new Date("2026-07-17T00:00:00.000Z"),
      }),
    ),
    findPublicById: vi.fn(),
  };
}
