/**
 * Configurable UGC keyword rules for AdSense / policy protection.
 * Edit this file (or replace RULE_SETS at runtime in tests) to add/remove phrases.
 * Matching uses normalized text + token boundaries — see ugc-text-normalize.ts /
 * evaluate-ugc-text.ts.
 *
 * Gap this addresses: multi-word solicitation phrases alone missed common
 * sexually solicitous bio language (e.g. "horny, seducing") that AdSense flags.
 */

export type UgcRuleSeverity = "reject" | "review" | "spam";

export type UgcRuleCategory =
  | "sexual_explicit"
  | "sexual_solicitous"
  | "sexual_promotional"
  | "spam_scam";

export type UgcKeywordRule = {
  id: string;
  category: UgcRuleCategory;
  /** Phrase matched against normalized text (token-bounded). */
  phrase: string;
  severity: UgcRuleSeverity;
  language?: "en" | "hi" | "mixed";
};

/**
 * Initial phrase lists. Not exhaustive — extend here without touching call sites.
 */
export const UGC_KEYWORD_RULES: UgcKeywordRule[] = [
  // A. Explicit sexual solicitation — reject
  { id: "sex.en.sex_chat", category: "sexual_explicit", phrase: "sex chat", severity: "reject", language: "en" },
  { id: "sex.en.full_sex_chat", category: "sexual_explicit", phrase: "full sex chat", severity: "reject", language: "en" },
  { id: "sex.en.sexual_services", category: "sexual_explicit", phrase: "sexual services", severity: "reject", language: "en" },
  { id: "sex.en.live_sex_show", category: "sexual_explicit", phrase: "live sex show", severity: "reject", language: "en" },
  { id: "sex.en.sex_video_call", category: "sexual_explicit", phrase: "sex video call", severity: "reject", language: "en" },
  { id: "sex.en.nude_video_call", category: "sexual_explicit", phrase: "nude video call", severity: "reject", language: "en" },
  { id: "sex.en.naked_video_call", category: "sexual_explicit", phrase: "naked video call", severity: "reject", language: "en" },
  { id: "sex.en.private_parts", category: "sexual_explicit", phrase: "show your private parts", severity: "reject", language: "en" },
  { id: "sex.en.full_body_show", category: "sexual_explicit", phrase: "full body show", severity: "reject", language: "en" },
  { id: "sex.en.explicit_acts", category: "sexual_explicit", phrase: "explicit sexual acts", severity: "reject", language: "en" },
  { id: "sex.en.paid_sexual", category: "sexual_explicit", phrase: "paid sexual services", severity: "reject", language: "en" },
  { id: "sex.hi.nangi_video", category: "sexual_explicit", phrase: "nangi video call", severity: "reject", language: "hi" },
  { id: "sex.hi.kapde_utaro", category: "sexual_explicit", phrase: "kapde utaro", severity: "reject", language: "hi" },
  { id: "sex.hi.private_parts_dikhao", category: "sexual_explicit", phrase: "private parts dikhao", severity: "reject", language: "hi" },
  { id: "sex.hi.sex_karne", category: "sexual_explicit", phrase: "sex karne ke liye", severity: "reject", language: "hi" },
  { id: "sex.hi.sexual_video", category: "sexual_explicit", phrase: "sexual video dikhao", severity: "reject", language: "hi" },
  { id: "sex.hi.adult_service", category: "sexual_explicit", phrase: "adult service", severity: "reject", language: "mixed" },
  { id: "sex.hi.nude_photo", category: "sexual_explicit", phrase: "nude photo bhejo", severity: "reject", language: "hi" },

  // A2. Sexually solicitous profile / bio language — reject (token-bounded)
  { id: "sex.solicit.horny", category: "sexual_solicitous", phrase: "horny", severity: "reject", language: "en" },
  { id: "sex.solicit.seducing", category: "sexual_solicitous", phrase: "seducing", severity: "reject", language: "en" },
  { id: "sex.solicit.seduce", category: "sexual_solicitous", phrase: "seduce", severity: "reject", language: "en" },
  { id: "sex.solicit.seduce_me", category: "sexual_solicitous", phrase: "seduce me", severity: "reject", language: "en" },
  { id: "sex.solicit.looking_for_sex", category: "sexual_solicitous", phrase: "looking for sex", severity: "reject", language: "en" },
  { id: "sex.solicit.want_sex", category: "sexual_solicitous", phrase: "want sex", severity: "reject", language: "en" },
  { id: "sex.solicit.for_sex", category: "sexual_solicitous", phrase: "for sex", severity: "reject", language: "en" },
  { id: "sex.solicit.nsfw", category: "sexual_solicitous", phrase: "nsfw", severity: "reject", language: "en" },
  { id: "sex.solicit.onlyfans", category: "sexual_solicitous", phrase: "onlyfans", severity: "reject", language: "en" },
  { id: "sex.solicit.nude", category: "sexual_solicitous", phrase: "nude", severity: "reject", language: "en" },
  { id: "sex.solicit.nudes", category: "sexual_solicitous", phrase: "nudes", severity: "reject", language: "en" },
  { id: "sex.solicit.naked", category: "sexual_solicitous", phrase: "naked", severity: "reject", language: "en" },

  // B. Suspicious promotional — review (hold)
  { id: "promo.full_enjoyment", category: "sexual_promotional", phrase: "full enjoyment", severity: "review", language: "en" },
  { id: "promo.hot_video_call", category: "sexual_promotional", phrase: "hot video call", severity: "review", language: "en" },
  { id: "promo.adult_chat", category: "sexual_promotional", phrase: "adult chat", severity: "review", language: "en" },
  { id: "promo.sexy_chat", category: "sexual_promotional", phrase: "sexy chat", severity: "review", language: "en" },
  { id: "promo.sexy", category: "sexual_promotional", phrase: "sexy", severity: "review", language: "en" },
  { id: "promo.whatsapp_me", category: "sexual_promotional", phrase: "whatsapp me", severity: "review", language: "en" },
  { id: "promo.dm_video_call", category: "sexual_promotional", phrase: "dm for video call", severity: "review", language: "en" },
  { id: "promo.paid_video_call", category: "sexual_promotional", phrase: "paid video call", severity: "review", language: "en" },
  { id: "promo.private_show", category: "sexual_promotional", phrase: "private show", severity: "review", language: "en" },
  { id: "promo.body_show", category: "sexual_promotional", phrase: "body show", severity: "review", language: "en" },
  { id: "promo.special_service", category: "sexual_promotional", phrase: "special service", severity: "review", language: "en" },

  // C. Spam / scam phrases
  { id: "spam.click_my_link", category: "spam_scam", phrase: "click my link", severity: "spam", language: "en" },
  { id: "spam.free_money", category: "spam_scam", phrase: "free money", severity: "spam", language: "en" },
  { id: "spam.instant_earning", category: "spam_scam", phrase: "instant earning", severity: "spam", language: "en" },
  { id: "spam.send_money_first", category: "spam_scam", phrase: "send money first", severity: "spam", language: "en" },
  { id: "spam.guaranteed_income", category: "spam_scam", phrase: "guaranteed income", severity: "spam", language: "en" },
  { id: "spam.investment_double", category: "spam_scam", phrase: "investment double", severity: "spam", language: "en" },
  { id: "spam.make_money_fast", category: "spam_scam", phrase: "make money fast", severity: "spam", language: "en" },
];

/**
 * Tokens that must NOT trigger alone. Multi-word rules still apply
 * (e.g. "whatsapp me", "adult chat"). Enforced in evaluate-ugc-text.
 */
export const UGC_HARMLESS_ALONE = new Set([
  "whatsapp",
  "video",
  "call",
  "private",
  "dating",
  "relationship",
  "chat",
  "dm",
  "adult",
]);
