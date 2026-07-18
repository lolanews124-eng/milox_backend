/**
 * Local-dev demo data: users with profile photos, image posts, likes,
 * comments, and follows so the feed looks alive.
 *
 * Run: npm run seed:demo --workspace=@milox/api
 * Re-running wipes and recreates all demo accounts (emails @demo.milox).
 * Every demo account password: MiloxDemo123!
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  Gender,
  MediaKind,
  MediaVisibility,
  PrismaClient,
  RelationshipGoal,
} from "@prisma/client";
import argon2 from "argon2";
import "dotenv/config";
import sharp from "sharp";

import { extractHashtags } from "../src/shared/hashtags.js";

const prisma = new PrismaClient();
const UPLOAD_ROOT = path.resolve(
  process.cwd(),
  process.env.UPLOAD_ROOT ?? "../../uploads",
);
const DEMO_PASSWORD = "MiloxDemo123!";

function rng(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PALETTES: Array<[string, string, string]> = [
  ["#ff9a8b", "#ff6a88", "#ff99ac"], // sunset
  ["#0f2027", "#203a43", "#2c5364"], // night city
  ["#134e5e", "#71b280", "#a8e063"], // forest
  ["#1a2980", "#26d0ce", "#7fdbda"], // ocean
  ["#42275a", "#734b6d", "#b993d6"], // dusk
  ["#f7971e", "#ffd200", "#ffe982"], // golden hour
  ["#764ba2", "#667eea", "#9bb1ff"], // violet sky
  ["#c31432", "#240b36", "#7a2048"], // neon night
  ["#3e2723", "#6d4c41", "#a1887f"], // coffee
  ["#355c7d", "#6c5b7b", "#c06c84"], // evening haze
];

function sceneSvg(index: number): string {
  const random = rng(index * 7919 + 17);
  const [c1, c2, c3] = PALETTES[index % PALETTES.length] as [
    string,
    string,
    string,
  ];
  const width = 900;
  const height = 640;
  const circles = Array.from({ length: 6 }, (_, i) => {
    const r = 40 + random() * 180;
    return `<circle cx="${(random() * width).toFixed(0)}" cy="${(
      random() * height
    ).toFixed(0)}" r="${r.toFixed(0)}" fill="${
      i % 2 === 0 ? c3 : "#ffffff"
    }" opacity="${(0.08 + random() * 0.2).toFixed(2)}"/>`;
  }).join("");
  const sunY = 120 + random() * 220;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0" stop-color="${c1}"/>
      <stop offset="1" stop-color="${c2}"/>
    </linearGradient>
    <radialGradient id="sun" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.9"/>
      <stop offset="1" stop-color="${c3}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  ${circles}
  <circle cx="${(width * (0.25 + random() * 0.5)).toFixed(0)}" cy="${sunY.toFixed(0)}" r="150" fill="url(#sun)"/>
  <rect y="${(height * 0.72).toFixed(0)}" width="${width}" height="${(height * 0.28).toFixed(0)}" fill="#000000" opacity="0.18"/>
</svg>`;
}

function avatarSvg(name: string, index: number): string {
  const [c1, c2] = PALETTES[(index * 3 + 1) % PALETTES.length] as [
    string,
    string,
    string,
  ];
  const initials = name.slice(0, 2).toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${c1}"/>
      <stop offset="1" stop-color="${c2}"/>
    </linearGradient>
  </defs>
  <rect width="400" height="400" fill="url(#g)"/>
  <circle cx="330" cy="70" r="110" fill="#ffffff" opacity="0.14"/>
  <circle cx="60" cy="340" r="130" fill="#ffffff" opacity="0.1"/>
  <text x="200" y="238" font-family="Arial, sans-serif" font-size="140" font-weight="bold" fill="#ffffff" text-anchor="middle" opacity="0.92">${initials}</text>
</svg>`;
}

async function createImageAsset(
  ownerUserId: string,
  kind: "PROFILE_PHOTO" | "POST_IMAGE" | "COVER_PHOTO",
  svg: string,
  createdAt: Date,
): Promise<string> {
  const id = randomUUID();
  const directory =
    kind === "PROFILE_PHOTO"
      ? "profiles"
      : kind === "COVER_PHOTO"
        ? "covers"
        : "posts";
  const { data, info } = await sharp(Buffer.from(svg))
    .webp({ quality: 85 })
    .toBuffer({ resolveWithObject: true });
  const storageKey = `public/${directory}/${id}.webp`;
  const absolutePath = path.resolve(UPLOAD_ROOT, storageKey);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, data);
  await prisma.mediaAsset.create({
    data: {
      id,
      ownerUserId,
      kind: MediaKind[kind],
      visibility: MediaVisibility.PUBLIC,
      storageKey,
      mimeType: "image/webp",
      byteSize: info.size,
      width: info.width,
      height: info.height,
      checksumSha256: createHash("sha256").update(data).digest("hex"),
      createdAt,
    },
  });
  return id;
}

interface DemoUser {
  username: string;
  displayName: string;
  bio: string;
  gender: Gender;
  goal: RelationshipGoal;
  country: string;
  birthYear: number;
  verified?: boolean;
  interests: string[];
}

const DEMO_USERS: DemoUser[] = [
  {
    username: "moonlight_muse",
    displayName: "Moonlight",
    bio: "Chasing sunsets and honest conversations. Poetry keeps me sane.",
    gender: Gender.FEMALE,
    goal: RelationshipGoal.LONG_TERM,
    country: "IN",
    birthYear: 1999,
    verified: true,
    interests: ["art", "books", "photography"],
  },
  {
    username: "silent_boy",
    displayName: "Silent Boy",
    bio: "Coffee, music and silence. Perfect combo.",
    gender: Gender.MALE,
    goal: RelationshipGoal.DATING,
    country: "IN",
    birthYear: 1997,
    verified: true,
    interests: ["music", "movies", "food"],
  },
  {
    username: "sky_walker",
    displayName: "Sky",
    bio: "Photographer. I collect horizons.",
    gender: Gender.MALE,
    goal: RelationshipGoal.FRIENDSHIP,
    country: "IN",
    birthYear: 1996,
    interests: ["photography", "travel", "outdoors"],
  },
  {
    username: "lost_in_thoughts",
    displayName: "Daydreamer",
    bio: "Overthinker by day, stargazer by night.",
    gender: Gender.FEMALE,
    goal: RelationshipGoal.UNSURE,
    country: "IN",
    birthYear: 2001,
    interests: ["books", "music", "art"],
  },
  {
    username: "hidden_muse",
    displayName: "Hidden Muse",
    bio: "Loves 90s bollywood, rainy evenings and long walks.",
    gender: Gender.FEMALE,
    goal: RelationshipGoal.DATING,
    country: "IN",
    birthYear: 1998,
    verified: true,
    interests: ["movies", "music", "food"],
  },
  {
    username: "mountain_soul",
    displayName: "Mountain Soul",
    bio: "Himalayas > everything. Trekker, chai lover.",
    gender: Gender.MALE,
    goal: RelationshipGoal.LONG_TERM,
    country: "IN",
    birthYear: 1995,
    interests: ["outdoors", "travel", "fitness"],
  },
  {
    username: "midnight_rider",
    displayName: "Midnight Rider",
    bio: "Night drives and lo-fi playlists.",
    gender: Gender.MALE,
    goal: RelationshipGoal.CASUAL,
    country: "IN",
    birthYear: 2000,
    interests: ["music", "gaming", "movies"],
  },
  {
    username: "paper_planes",
    displayName: "Paper Planes",
    bio: "Writing letters I never send.",
    gender: Gender.NON_BINARY,
    goal: RelationshipGoal.FRIENDSHIP,
    country: "IN",
    birthYear: 2002,
    interests: ["books", "art", "music"],
  },
  {
    username: "chai_or_coffee",
    displayName: "Chai > Coffee",
    bio: "Foodie exploring one street at a time. Ask me about biryani.",
    gender: Gender.FEMALE,
    goal: RelationshipGoal.DATING,
    country: "IN",
    birthYear: 1999,
    interests: ["food", "travel", "movies"],
  },
  {
    username: "pixel_heart",
    displayName: "Pixel Heart",
    bio: "Gamer. Building worlds, one pixel at a time.",
    gender: Gender.MALE,
    goal: RelationshipGoal.UNSURE,
    country: "IN",
    birthYear: 2001,
    interests: ["gaming", "art", "music"],
  },
  {
    username: "wildflower_",
    displayName: "Wildflower",
    bio: "Plant mom. Sunrise yoga. Good vibes only.",
    gender: Gender.FEMALE,
    goal: RelationshipGoal.LONG_TERM,
    country: "IN",
    birthYear: 1998,
    verified: true,
    interests: ["fitness", "outdoors", "food"],
  },
  {
    username: "quiet_storm",
    displayName: "Quiet Storm",
    bio: "Calm outside, chaos inside. Cricket and old ghazals.",
    gender: Gender.MALE,
    goal: RelationshipGoal.MARRIAGE,
    country: "IN",
    birthYear: 1994,
    interests: ["music", "fitness", "books"],
  },
];

interface DemoPost {
  author: string;
  body: string;
  images: number;
  hoursAgo: number;
}

const DEMO_POSTS: DemoPost[] = [
  {
    author: "moonlight_muse",
    body: "Some sunsets are proof that endings can be beautiful too. 🌇\n#sunset #nature #goodvibes",
    images: 1,
    hoursAgo: 2,
  },
  {
    author: "silent_boy",
    body: "Coffee, music and silence. Perfect combo! ☕🎧\n#coffee #music #chill",
    images: 1,
    hoursAgo: 5,
  },
  {
    author: "sky_walker",
    body: "Caught the city breathing at 5 AM. Nobody talks about how soft the world is before sunrise.\n#photography #citylife #sunrise",
    images: 2,
    hoursAgo: 8,
  },
  {
    author: "lost_in_thoughts",
    body: "Reading my old diary and cringing at 2019 me. Growth is real. 📖\n#books #latenightthoughts",
    images: 0,
    hoursAgo: 10,
  },
  {
    author: "hidden_muse",
    body: "Rain + old bollywood songs = therapy nobody prescribed. 🌧️\n#rain #music #mood",
    images: 1,
    hoursAgo: 13,
  },
  {
    author: "mountain_soul",
    body: "Left a piece of my heart at 14,000 feet. Again.\n#travel #mountains #trekking",
    images: 2,
    hoursAgo: 16,
  },
  {
    author: "midnight_rider",
    body: "Empty roads, full playlist. Night drives fix everything.\n#nightdrive #lofi #musiclovers",
    images: 1,
    hoursAgo: 20,
  },
  {
    author: "paper_planes",
    body: "Wrote a letter today I'll never send. Felt lighter anyway. ✉️\n#feelings #anonymous",
    images: 0,
    hoursAgo: 24,
  },
  {
    author: "chai_or_coffee",
    body: "Found a tiny stall that serves the best kulhad chai in the city. Not sharing the location. 😌🍵\n#foodie #chai #streetfood",
    images: 1,
    hoursAgo: 27,
  },
  {
    author: "pixel_heart",
    body: "6 hours straight building my dream city in-game. Productivity? Never heard of her. 🎮\n#gaming #weekendvibes",
    images: 1,
    hoursAgo: 30,
  },
  {
    author: "wildflower_",
    body: "Sunrise yoga on the terrace. My plants judged my balance. 🌱\n#yoga #morningroutine #goodvibes",
    images: 1,
    hoursAgo: 34,
  },
  {
    author: "quiet_storm",
    body: "An old ghazal, evening chai, and rain outside. Some evenings are complete on their own.\n#ghazal #mood #rain",
    images: 1,
    hoursAgo: 38,
  },
  {
    author: "moonlight_muse",
    body: "Being anonymous here is freeing. I can finally say things out loud without a name attached.\n#anonymous #realtalk",
    images: 0,
    hoursAgo: 42,
  },
  {
    author: "sky_walker",
    body: "Golden hour hits different when you wait 40 minutes for the right cloud. 📸\n#goldenhour #photography #sunset",
    images: 2,
    hoursAgo: 47,
  },
  {
    author: "silent_boy",
    body: "Unpopular opinion: the album is better than the single. Fight me.\n#music #musiclovers",
    images: 0,
    hoursAgo: 52,
  },
  {
    author: "hidden_muse",
    body: "Movie marathon night. Started with comedy, ended up crying at a 90s classic. Standard.\n#movies #weekendvibes",
    images: 1,
    hoursAgo: 58,
  },
  {
    author: "mountain_soul",
    body: "Campfire, maggi, and strangers who became friends by midnight. This is why I travel.\n#travel #camping #stories",
    images: 1,
    hoursAgo: 64,
  },
  {
    author: "chai_or_coffee",
    body: "Rated every biryani in a 5 km radius. My research is more thorough than my degree. 🍛\n#biryani #foodie #food",
    images: 2,
    hoursAgo: 70,
  },
  {
    author: "lost_in_thoughts",
    body: "The moon looked extra dramatic tonight, so here you go. 🌙\n#moon #night #photography",
    images: 1,
    hoursAgo: 76,
  },
  {
    author: "wildflower_",
    body: "New plant day! Named him Sir Leafs-a-lot. He's already my favourite child. 🪴\n#plants #plantmom",
    images: 1,
    hoursAgo: 84,
  },
  {
    author: "midnight_rider",
    body: "3 AM thoughts hit different when the city is finally quiet.\n#latenightthoughts #nightowl",
    images: 1,
    hoursAgo: 92,
  },
  {
    author: "pixel_heart",
    body: "Drew my first digital portrait today. Hands are officially the final boss of art. 🎨\n#art #digitalart",
    images: 1,
    hoursAgo: 100,
  },
  {
    author: "quiet_storm",
    body: "Won the local cricket match today. Shoulder hurts, ego healed. 🏏\n#cricket #weekendvibes",
    images: 1,
    hoursAgo: 110,
  },
  {
    author: "paper_planes",
    body: "Sketched strangers at the metro station. Everyone has a story on their face.\n#art #sketching #people",
    images: 2,
    hoursAgo: 122,
  },
  {
    author: "hidden_muse",
    body: "Note to self: stop shrinking yourself to fit places you've outgrown.\n#selflove #growth #realtalk",
    images: 0,
    hoursAgo: 134,
  },
];

const COMMENTS = [
  "This is so relatable! 💯",
  "Okay this made my day.",
  "Beautiful! 😍",
  "Felt this deeply.",
  "Where is this?? I need to go!",
  "Stop, this is too good.",
  "Same energy, honestly.",
  "You have a way with words.",
  "Adding this to my mood board.",
  "This deserves more likes.",
  "Wow, the vibes! ✨",
  "I needed to read this today, thank you.",
];

async function main(): Promise<void> {
  console.log(`Upload root: ${UPLOAD_ROOT}`);

  // Wipe previous demo data (posts → media → users).
  const existing = await prisma.user.findMany({
    where: { email: { endsWith: "@demo.milox" } },
    select: { id: true },
  });
  if (existing.length > 0) {
    const ids = existing.map((entry) => entry.id);
    await prisma.story.deleteMany({ where: { authorId: { in: ids } } });
    await prisma.post.deleteMany({ where: { authorId: { in: ids } } });
    await prisma.user.updateMany({
      where: { id: { in: ids } },
      data: { profilePhotoMediaId: null, coverPhotoMediaId: null },
    });
    await prisma.mediaAsset.deleteMany({
      where: { ownerUserId: { in: ids } },
    });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    console.log(`Removed ${existing.length} previous demo users.`);
  }

  const passwordHash = await argon2.hash(DEMO_PASSWORD);
  const tags = await prisma.interestTag.findMany();
  const tagBySlug = new Map(tags.map((tag) => [tag.slug, tag.id]));
  const now = Date.now();
  const random = rng(20260717);

  // Users + profile photos
  const userIdByName = new Map<string, string>();
  for (const [index, demo] of DEMO_USERS.entries()) {
    const createdAt = new Date(now - (12 + index) * 24 * 3600 * 1000);
    const user = await prisma.user.create({
      data: {
        username: demo.username,
        usernameNormalized: demo.username.toLowerCase(),
        email: `${demo.username}@demo.milox`,
        passwordHash,
        emailVerifiedAt: createdAt,
        dateOfBirth: new Date(Date.UTC(demo.birthYear, index % 12, 5 + index)),
        gender: demo.gender,
        displayName: demo.displayName,
        bio: demo.bio,
        countryCode: demo.country,
        relationshipGoal: demo.goal,
        isVerifiedBadge: demo.verified ?? false,
        // First few users read as "online" (5-minute presence window).
        lastSeenAt: new Date(now - index * 2 * 60 * 1000),
        createdAt,
      },
    });
    userIdByName.set(demo.username, user.id);

    const photoId = await createImageAsset(
      user.id,
      "PROFILE_PHOTO",
      avatarSvg(demo.displayName, index),
      createdAt,
    );
    const coverId = await createImageAsset(
      user.id,
      "COVER_PHOTO",
      sceneSvg(300 + index),
      createdAt,
    );
    await prisma.user.update({
      where: { id: user.id },
      data: { profilePhotoMediaId: photoId, coverPhotoMediaId: coverId },
    });

    for (const slug of demo.interests) {
      const tagId = tagBySlug.get(slug);
      if (tagId) {
        await prisma.userInterest.create({
          data: { userId: user.id, tagId },
        });
      }
    }
  }
  console.log(`Created ${DEMO_USERS.length} demo users.`);

  // Posts with generated images, likes, comments
  const allIds = [...userIdByName.values()];
  let imageIndex = 0;
  let totalImages = 0;
  for (const [postIndex, demo] of DEMO_POSTS.entries()) {
    const authorId = userIdByName.get(demo.author);
    if (!authorId) continue;
    const createdAt = new Date(now - demo.hoursAgo * 3600 * 1000);

    const likerPool = allIds
      .filter((id) => id !== authorId)
      .sort(() => random() - 0.5);
    const likers = likerPool.slice(
      0,
      2 + Math.floor(random() * (likerPool.length - 2)),
    );
    const commentCount = Math.floor(random() * 4);

    const post = await prisma.post.create({
      data: {
        authorId,
        body: demo.body,
        likeCount: likers.length,
        commentCount,
        shareCount: Math.floor(random() * 5),
        trendingScore:
          likers.length * 3 + commentCount * 4 + (200 - demo.hoursAgo) / 10,
        createdAt,
      },
    });

    for (const tag of extractHashtags(demo.body)) {
      const hashtag = await prisma.hashtag.upsert({
        where: { tag },
        create: { tag, postCount: 1, lastUsedAt: createdAt },
        update: {
          postCount: { increment: 1 },
          lastUsedAt: createdAt,
        },
      });
      await prisma.postHashtag.create({
        data: { postId: post.id, hashtagId: hashtag.id },
      });
    }

    for (let i = 0; i < demo.images; i += 1) {
      const assetId = await createImageAsset(
        authorId,
        "POST_IMAGE",
        sceneSvg(imageIndex),
        createdAt,
      );
      imageIndex += 1;
      totalImages += 1;
      await prisma.postMedia.create({
        data: { postId: post.id, mediaAssetId: assetId, sortOrder: i },
      });
    }

    for (const likerId of likers) {
      await prisma.postLike.create({
        data: {
          postId: post.id,
          userId: likerId,
          createdAt: new Date(
            createdAt.getTime() + random() * 3600 * 1000,
          ),
        },
      });
    }

    for (let i = 0; i < commentCount; i += 1) {
      const commenter = likers[i % likers.length] ?? likerPool[0];
      if (!commenter) break;
      await prisma.comment.create({
        data: {
          postId: post.id,
          authorId: commenter,
          body: COMMENTS[(postIndex + i * 5) % COMMENTS.length] as string,
          createdAt: new Date(
            createdAt.getTime() + (i + 1) * 40 * 60 * 1000,
          ),
        },
      });
    }
  }
  console.log(
    `Created ${DEMO_POSTS.length} posts with ${totalImages} generated images.`,
  );

  // Stories (last few hours, 24h TTL)
  const STORY_AUTHORS: Array<{ author: string; caption: string | null; hoursAgo: number }> = [
    { author: "moonlight_muse", caption: "Golden hour from my window 🌇", hoursAgo: 1 },
    { author: "moonlight_muse", caption: null, hoursAgo: 3 },
    { author: "silent_boy", caption: "Today's brew ☕", hoursAgo: 2 },
    { author: "sky_walker", caption: "Chasing light again", hoursAgo: 4 },
    { author: "hidden_muse", caption: "Rainy evening mood 🌧️", hoursAgo: 5 },
    { author: "mountain_soul", caption: "Basecamp views", hoursAgo: 6 },
    { author: "chai_or_coffee", caption: "Street food hunt 🍛", hoursAgo: 7 },
    { author: "wildflower_", caption: "Morning greens 🌱", hoursAgo: 8 },
  ];
  let storyImage = 500;
  for (const entry of STORY_AUTHORS) {
    const authorId = userIdByName.get(entry.author);
    if (!authorId) continue;
    const createdAt = new Date(now - entry.hoursAgo * 3600 * 1000);
    const assetId = await createImageAsset(
      authorId,
      "POST_IMAGE",
      sceneSvg(storyImage),
      createdAt,
    );
    storyImage += 1;
    await prisma.story.create({
      data: {
        authorId,
        mediaAssetId: assetId,
        caption: entry.caption,
        createdAt,
        expiresAt: new Date(createdAt.getTime() + 24 * 3600 * 1000),
      },
    });
  }
  console.log(`Created ${STORY_AUTHORS.length} stories.`);

  // Follows among demo users
  let followCount = 0;
  for (const followerId of allIds) {
    const targets = allIds
      .filter((id) => id !== followerId)
      .sort(() => random() - 0.5)
      .slice(0, 3 + Math.floor(random() * 4));
    for (const followeeId of targets) {
      await prisma.follow.create({
        data: { followerId, followeeId },
      });
      followCount += 1;
    }
  }

  // Sync counters for every user — deleting demo users cascades follow rows
  // belonging to real accounts, so their counts must be recomputed too.
  const everyUser = await prisma.user.findMany({ select: { id: true } });
  for (const { id } of everyUser) {
    const [posts, followers, following] = await Promise.all([
      prisma.post.count({ where: { authorId: id, deletedAt: null } }),
      prisma.follow.count({ where: { followeeId: id, status: "ACTIVE" } }),
      prisma.follow.count({ where: { followerId: id, status: "ACTIVE" } }),
    ]);
    await prisma.user.update({
      where: { id },
      data: {
        postCount: posts,
        followerCount: followers,
        followingCount: following,
      },
    });
  }
  console.log(`Created ${followCount} follow relations and synced counters.`);
  console.log(
    `Done. Log in as any demo user, e.g. silent_boy@demo.milox / ${DEMO_PASSWORD}`,
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
