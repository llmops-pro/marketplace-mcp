// Shopstr-modern event shapes — what shopstr.store's UI actually renders.
//
// Shopstr migrated away from raw NIP-15 (kind:30017 stalls + kind:30018
// products) to:
//   kind:30019  — shop profile (NIP-15 §"Customer Support" leftover, but with
//                 Shopstr-flavored content: name/about/ui/merchants/...).
//                 The `d` tag MUST be the seller's pubkey hex; one shop per
//                 pubkey. Replaceability is by pubkey, not slug.
//   kind:30402  — NIP-99 Classified Listing. ALL product data lives in tags;
//                 `content` is the long-form description. Shopstr requires
//                 a `["t", "shopstr"]` tag for the product to surface in its
//                 marketplace feed.
//
// Crucially, shopstr.store reads from its own Postgres cache — populated by
// HTTP POSTs to /api/db/cache-event. Publishing to a NOSTR relay alone is
// invisible to the storefront. The `cache-event.ts` helper handles the POST;
// builders here only construct the events.

import { z } from "zod";

export const SHOP_PROFILE_KIND = 30019;
export const NIP99_PRODUCT_KIND = 30402;

// ---- kind:30019 — shop profile ---------------------------------------------

const ShopUiZ = z.object({
  picture: z.string().default(""),
  banner: z.string().default(""),
  theme: z.string().default(""),
  darkMode: z.boolean().default(false),
});
export type ShopUi = z.infer<typeof ShopUiZ>;

export const ShopProfileContentZ = z.object({
  name: z.string().default(""),
  about: z.string().default(""),
  ui: ShopUiZ.default({
    picture: "",
    banner: "",
    theme: "",
    darkMode: false,
  }),
  merchants: z.array(z.string()).min(1),
});
export type ShopProfileContent = z.infer<typeof ShopProfileContentZ>;

export type ShopProfileInput = {
  pubkey_hex: string;
  name: string;
  about?: string;
  picture?: string;
  banner?: string;
};

export function buildShopProfileEvent(input: ShopProfileInput): {
  kind: number;
  content: string;
  tags: string[][];
} {
  if (!/^[0-9a-f]{64}$/i.test(input.pubkey_hex)) {
    throw new Error(
      `buildShopProfileEvent: pubkey_hex must be 64 hex chars (got ${input.pubkey_hex.length}).`,
    );
  }
  const content: ShopProfileContent = {
    name: input.name,
    about: input.about ?? "",
    ui: {
      picture: input.picture ?? "",
      banner: input.banner ?? "",
      theme: "",
      darkMode: false,
    },
    merchants: [input.pubkey_hex],
  };
  return {
    kind: SHOP_PROFILE_KIND,
    content: JSON.stringify(content),
    tags: [["d", input.pubkey_hex]],
  };
}

export function parseShopProfileContent(content: string): ShopProfileContent | null {
  try {
    const raw = JSON.parse(content);
    const parsed = ShopProfileContentZ.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// ---- kind:30402 — NIP-99 Classified Listing --------------------------------

export const SHIPPING_OPTIONS = [
  "N/A",
  "Free",
  "Pickup",
  "Free/Pickup",
  "Added Cost",
] as const;
export type ShippingOption = (typeof SHIPPING_OPTIONS)[number];

export type ListingInput = {
  id: string; // becomes the `d` tag
  pubkey_hex: string; // for the `client` tag's a-ref
  name: string;
  summary?: string; // event content; long-form description
  price: number;
  currency: string;
  location?: string;
  shipping: {
    option: ShippingOption;
    cost?: number;
    currency?: string;
  };
  images?: string[];
  categories?: string[]; // surfaced as `t` tags (+ "shopstr" tag is auto-added)
  quantity?: number;
  condition?: string;
  status?: string; // active / sold / etc.
  valid_until?: number; // unix seconds
};

export function buildListingEvent(input: ListingInput): {
  kind: number;
  content: string;
  tags: string[][];
} {
  if (!/^[0-9a-f]{64}$/i.test(input.pubkey_hex)) {
    throw new Error(
      `buildListingEvent: pubkey_hex must be 64 hex chars (got ${input.pubkey_hex.length}).`,
    );
  }
  const tags: string[][] = [
    ["d", input.id],
    ["alt", `Product listing: ${input.name}`],
    // `client` tag — Shopstr's form emits this with a 31990 a-ref. We keep a
    // minimal Shopstr marker; the full a-ref would require co-publishing a
    // 31990 handler event (out of scope for v0.2.0).
    ["client", "marketplace-mcp"],
    ["title", input.name],
    ["summary", input.summary ?? ""],
    ["price", String(input.price), input.currency],
    ["location", input.location ?? ""],
    [
      "shipping",
      input.shipping.option,
      input.shipping.cost !== undefined ? String(input.shipping.cost) : "0",
      input.shipping.currency ?? input.currency,
    ],
  ];
  for (const image of input.images ?? []) {
    tags.push(["image", image]);
  }
  for (const c of input.categories ?? []) {
    tags.push(["t", c.toLowerCase()]);
  }
  // Required Shopstr marker — without this the product won't surface in their
  // marketplace feed even if cached.
  if (!tags.some((t) => t[0] === "t" && t[1] === "shopstr")) {
    tags.push(["t", "shopstr"]);
  }
  if (input.quantity !== undefined) tags.push(["quantity", String(input.quantity)]);
  if (input.condition) tags.push(["condition", input.condition]);
  if (input.status) tags.push(["status", input.status]);
  if (input.valid_until !== undefined) {
    tags.push(["valid_until", String(input.valid_until)]);
  }
  tags.push(["published_at", String(Math.floor(Date.now() / 1000))]);

  return {
    kind: NIP99_PRODUCT_KIND,
    content: input.summary ?? "",
    tags,
  };
}

export function getListingTag(
  tags: string[][],
  name: string,
): string | undefined {
  return tags.find((t) => t[0] === name)?.[1];
}

export function parseListingTags(tags: string[][]): {
  d?: string;
  title?: string;
  summary?: string;
  price?: { amount: number; currency: string };
  location?: string;
  shipping?: { option: string; cost: number; currency: string };
  images: string[];
  categories: string[];
  quantity?: number;
  status?: string;
} {
  const images: string[] = [];
  const categories: string[] = [];
  let price: { amount: number; currency: string } | undefined;
  let shipping:
    | { option: string; cost: number; currency: string }
    | undefined;
  let quantity: number | undefined;
  for (const t of tags) {
    if (t[0] === "image" && t[1]) images.push(t[1]);
    else if (t[0] === "t" && t[1]) categories.push(t[1]);
    else if (t[0] === "price" && t[1] && t[2]) {
      const amt = Number(t[1]);
      if (Number.isFinite(amt)) price = { amount: amt, currency: t[2] };
    } else if (t[0] === "shipping" && t[1]) {
      const cost = Number(t[2] ?? "0");
      shipping = {
        option: t[1],
        cost: Number.isFinite(cost) ? cost : 0,
        currency: t[3] ?? "sat",
      };
    } else if (t[0] === "quantity" && t[1]) {
      const q = Number(t[1]);
      if (Number.isFinite(q)) quantity = q;
    }
  }
  return {
    d: getListingTag(tags, "d"),
    title: getListingTag(tags, "title"),
    summary: getListingTag(tags, "summary"),
    price,
    location: getListingTag(tags, "location"),
    shipping,
    images,
    categories,
    quantity,
    status: getListingTag(tags, "status"),
  };
}
