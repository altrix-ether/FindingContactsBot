export const SUPPORTED_CONTACT_TYPES = [
  "email",
  "telegram",
  "discord",
  "linkedin",
  "whatsapp",
  "twitter",
  "website",
  "github",
  "facebook",
  "instagram",
  "youtube",
  "mastodon",
  "twitch",
  "reddit",
  "phone",
  "signal",
  "skype",
  "medium",
  "matrix",
  "bluesky",
];

const URL_RULES = [
  { type: "telegram", pattern: /(?:https?:\/\/)?(?:t\.me|telegram\.me)\/([a-zA-Z0-9_+]+)/gi },
  { type: "discord", pattern: /https?:\/\/(?:discord\.gg|discord\.com\/invite)\/([a-zA-Z0-9-]+)/gi },
  { type: "discord", pattern: /https?:\/\/discord\.com\/users\/(\d+)/gi },
  { type: "linkedin", pattern: /https?:\/\/(?:[\w-]+\.)?linkedin\.com\/(?:in|company|pub)\/[^\s)>\]"']+/gi },
  { type: "whatsapp", pattern: /https?:\/\/(?:wa\.me|api\.whatsapp\.com\/send)\/[^\s)>\]"']+/gi },
  { type: "twitter", pattern: /https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]{1,15})\/?/gi },
  { type: "facebook", pattern: /https?:\/\/(?:www\.)?(?:facebook|fb)\.com\/[^\s)>\]"']+/gi },
  { type: "instagram", pattern: /https?:\/\/(?:www\.)?instagram\.com\/[a-zA-Z0-9_.]+/gi },
  { type: "youtube", pattern: /https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/[^\s)>\]"']+/gi },
  { type: "mastodon", pattern: /https?:\/\/[^\s/]+\.social\/@[^\s)>\]"']+/gi },
  { type: "twitch", pattern: /https?:\/\/(?:www\.)?twitch\.tv\/[a-zA-Z0-9_]+/gi },
  { type: "reddit", pattern: /https?:\/\/(?:www\.)?reddit\.com\/(?:u|user)\/[a-zA-Z0-9_-]+/gi },
  { type: "medium", pattern: /https?:\/\/(?:www\.)?medium\.com\/@?[^\s)>\]"']+/gi },
  { type: "bluesky", pattern: /https?:\/\/bsky\.app\/profile\/[^\s)>\]"']+/gi },
  { type: "signal", pattern: /https?:\/\/signal\.me\/#p\/[^\s)>\]"']+/gi },
  { type: "matrix", pattern: /https?:\/\/matrix\.to\/#[^\s)>\]"']+/gi },
];

const HANDLE_RULES = [
  { type: "telegram", pattern: /(?:^|\s)(?:telegram|tg)\s*[:@]\s*@?([a-zA-Z0-9_]{4,32})/gi },
  { type: "discord", pattern: /(?:^|\s)discord\s*[:@]\s*([^\s,;|]+)/gi },
  { type: "whatsapp", pattern: /(?:^|\s)whatsapp\s*[:@]\s*([+\d\s()-]{8,20})/gi },
  { type: "email", pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { type: "phone", pattern: /(?:^|\s)(?:tel|phone|mobile)\s*[:.]?\s*(\+?[\d\s().-]{8,18}\d)/gi },
  { type: "skype", pattern: /(?:^|\s)skype\s*[:@]\s*([a-zA-Z0-9.,\-_]{3,32})/gi },
];

const PROVIDER_TO_TYPE = {
  linkedin: "linkedin",
  twitter: "twitter",
  facebook: "facebook",
  instagram: "instagram",
  youtube: "youtube",
  twitch: "twitch",
  reddit: "reddit",
  medium: "medium",
  mastodon: "mastodon",
  bluesky: "bluesky",
  generic: "website",
  custom: "website",
};

function normalizeContactKey(type, value) {
  return `${type}:${String(value).trim().toLowerCase()}`;
}

function contactHref(type, value) {
  if (type === "email") return `mailto:${value}`;
  if (type === "telegram" && !value.startsWith("http")) return `https://t.me/${value.replace(/^@/, "")}`;
  if (type === "twitter" && !value.startsWith("http")) return `https://x.com/${value.replace(/^@/, "")}`;
  if (type === "whatsapp" && !value.startsWith("http")) {
    const digits = value.replace(/\D/g, "");
    return digits ? `https://wa.me/${digits}` : null;
  }
  if (value.startsWith("http")) return value;
  return null;
}

export function addContact(list, seen, { type, value, source }) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed || !SUPPORTED_CONTACT_TYPES.includes(type)) return;
  const key = normalizeContactKey(type, trimmed);
  if (seen.has(key)) return;
  seen.add(key);
  list.push({
    type,
    value: trimmed,
    href: contactHref(type, trimmed),
    source,
  });
}

export function extractContactsFromText(text, source, list, seen) {
  if (!text || typeof text !== "string") return;

  for (const { type, pattern } of URL_RULES) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const raw = match[0];
      addContact(list, seen, { type, value: raw.startsWith("http") ? raw : `https://${raw}`, source });
    }
  }

  for (const { type, pattern } of HANDLE_RULES) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const val = match[1] ?? match[0];
      if (type === "email" && val.endsWith("@users.noreply.github.com")) continue;
      addContact(list, seen, { type, value: val.trim(), source });
    }
  }
}

export function collectFromUserProfile(user, list, seen) {
  addContact(list, seen, {
    type: "github",
    value: user.html_url,
    source: "profile",
  });

  if (user.blog) {
    const blog = user.blog.trim();
    if (blog) {
      const withProto = /^https?:\/\//i.test(blog) ? blog : `https://${blog}`;
      addContact(list, seen, { type: "website", value: withProto, source: "profile_blog" });
      extractContactsFromText(withProto, "profile_blog", list, seen);
    }
  }

  if (user.twitter_username) {
    addContact(list, seen, {
      type: "twitter",
      value: `https://x.com/${user.twitter_username}`,
      source: "profile_twitter",
    });
  }

  if (user.bio) {
    extractContactsFromText(user.bio, "profile_bio", list, seen);
  }

  if (user.company) {
    extractContactsFromText(String(user.company), "profile_company", list, seen);
  }
}

export function collectFromSocialAccounts(accounts, list, seen) {
  if (!Array.isArray(accounts)) return;
  for (const account of accounts) {
    if (!account?.url) continue;
    const key = String(account.provider ?? "").toLowerCase();
    const type =
      PROVIDER_TO_TYPE[key] ?? (key.includes("linkedin") ? "linkedin" : "website");
    addContact(list, seen, { type, value: account.url, source: "github_social" });
    extractContactsFromText(account.url, "github_social", list, seen);
  }
}

export function summarizeContacts(contacts) {
  const typesPresent = [...new Set(contacts.map((c) => c.type))].sort();
  return {
    contacts,
    contactCount: contacts.length,
    contactTypesFound: typesPresent.length,
    contactTypes: typesPresent,
    supportedContactTypes: SUPPORTED_CONTACT_TYPES,
  };
}