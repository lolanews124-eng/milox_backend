import { describe, expect, it } from "vitest";

import {
  normalizeInstagramHandle,
  normalizeWebsiteUrl,
  updateProfileSchema,
} from "./user-schemas.js";

describe("normalizeWebsiteUrl", () => {
  it("adds https when scheme is missing", () => {
    expect(normalizeWebsiteUrl("example.com/me")).toBe(
      "https://example.com/me",
    );
    expect(normalizeWebsiteUrl("www.example.com")).toBe(
      "https://www.example.com/",
    );
  });

  it("keeps absolute https urls", () => {
    expect(normalizeWebsiteUrl("https://milox.app/u/jane")).toBe(
      "https://milox.app/u/jane",
    );
  });

  it("returns null for blank", () => {
    expect(normalizeWebsiteUrl("   ")).toBeNull();
  });
});

describe("normalizeInstagramHandle", () => {
  it("strips @ and extracts from profile urls", () => {
    expect(normalizeInstagramHandle("@jane_doe")).toBe("jane_doe");
    expect(
      normalizeInstagramHandle("https://www.instagram.com/jane_doe/"),
    ).toBe("jane_doe");
    expect(normalizeInstagramHandle("instagram.com/jane.doe")).toBe(
      "jane.doe",
    );
  });

  it("returns null for blank", () => {
    expect(normalizeInstagramHandle("")).toBeNull();
  });
});

describe("updateProfileSchema social links", () => {
  it("accepts bare website and Instagram URL", () => {
    const parsed = updateProfileSchema.parse({
      websiteUrl: "milox.app",
      instagramHandle: "https://instagram.com/milox_app",
    });
    expect(parsed.websiteUrl).toBe("https://milox.app/");
    expect(parsed.instagramHandle).toBe("milox_app");
  });
});
