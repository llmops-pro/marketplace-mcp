// NIP-15 stall + product schemas and event builders.
//
// Stall:    kind 30017 (addressable). `content` = JSON, `d` tag = stall id.
// Product:  kind 30018 (addressable). `content` = JSON, `d` tag = product id,
//           `stall_id` inside the content references the stall.
//
// We follow Shopstr's shape because that's the canonical marketplace UI for
// these events (per CLAUDE.md §1). Some clients add `t` tags for categories;
// we surface that through the optional `categories` input but keep the core
// payload minimal.

import { z } from "zod";

export const STALL_KIND = 30017;
export const PRODUCT_KIND = 30018;

const ShippingZ = z.object({
  id: z.string().min(1).describe("Shipping zone identifier — referenced by products."),
  name: z.string().min(1),
  cost: z.number().nonnegative(),
  regions: z.array(z.string()).optional(),
});
export type Shipping = z.infer<typeof ShippingZ>;

export const StallContentZ = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  currency: z.string().default("sat"),
  shipping: z.array(ShippingZ).default([]),
});
export type StallContent = z.infer<typeof StallContentZ>;

const ProductShippingZ = z.object({
  id: z.string().min(1).describe("Must match a shipping.id from the parent stall."),
  cost: z.number().nonnegative().optional(),
});

export const ProductContentZ = z.object({
  id: z.string().min(1),
  stall_id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  images: z.array(z.string().url()).optional(),
  currency: z.string().default("sat"),
  price: z.number().positive(),
  quantity: z.number().int().nonnegative().optional(),
  specs: z.array(z.array(z.string()).length(2)).optional(),
  shipping: z.array(ProductShippingZ).optional(),
});
export type ProductContent = z.infer<typeof ProductContentZ>;

export function buildStallEvent(content: StallContent): {
  kind: number;
  content: string;
  tags: string[][];
} {
  return {
    kind: STALL_KIND,
    content: JSON.stringify(content),
    tags: [["d", content.id]],
  };
}

export function buildProductEvent(
  content: ProductContent,
  options: { categories?: string[] } = {},
): { kind: number; content: string; tags: string[][] } {
  const tags: string[][] = [["d", content.id]];
  for (const c of options.categories ?? []) {
    tags.push(["t", c.toLowerCase()]);
  }
  // Also tag the parent stall via `a` (NIP-19 addressable reference) — many
  // clients use this to surface "products in this stall" without scanning all
  // events. The author pubkey is unknown at builder-time; the tool fills it.
  return {
    kind: PRODUCT_KIND,
    content: JSON.stringify(content),
    tags,
  };
}

// Parse the `content` JSON out of a fetched event back into the typed shape.
// Returns null if the JSON doesn't validate against the schema.
export function parseStallContent(content: string): StallContent | null {
  try {
    const raw = JSON.parse(content);
    const parsed = StallContentZ.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function parseProductContent(content: string): ProductContent | null {
  try {
    const raw = JSON.parse(content);
    const parsed = ProductContentZ.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
