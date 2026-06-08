import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  buildListingEvent,
  NIP99_PRODUCT_KIND,
  SHIPPING_OPTIONS,
} from "../lib/shopstr.js";
import { errorResult } from "./_result.js";
import {
  evaluateAndPublish,
  type PublishDeps,
} from "./evaluate-and-publish.js";
import { makeShopstrCacheHook } from "./shopstr-after-publish.js";

const inputSchema = {
  id: z
    .string()
    .min(1)
    .max(120)
    .describe(
      "Stable product identifier — becomes the `d` tag. Republishing with the same id REPLACES the prior product.",
    ),
  name: z.string().min(1).describe("Product display name (becomes the `title` tag)."),
  summary: z
    .string()
    .optional()
    .describe(
      "Long-form product description. Goes into the event `content` AND a duplicated `summary` tag (Shopstr surfaces both).",
    ),
  price: z.number().positive().describe("Price as a number."),
  currency: z.string().default("sat").describe("Currency code. `sat` or ISO 4217."),
  location: z
    .string()
    .optional()
    .describe("Optional location string. Shopstr renders this as the seller's region/city."),
  shipping_option: z
    .enum(SHIPPING_OPTIONS)
    .describe("Shipping mode required by Shopstr: N/A, Free, Pickup, Free/Pickup, or Added Cost."),
  shipping_cost: z
    .number()
    .nonnegative()
    .optional()
    .describe("Shipping cost. Required when shipping_option is `Added Cost`; ignored for `Free` / `N/A`."),
  images: z.array(z.string().url()).optional().describe("Product image URLs."),
  categories: z
    .array(z.string())
    .optional()
    .describe(
      "Category tags (added as `t` tags, lowercased). A `t=shopstr` tag is auto-added for Shopstr feed visibility.",
    ),
  quantity: z.number().int().nonnegative().optional(),
  condition: z
    .string()
    .optional()
    .describe("Product condition (e.g. New, Used, Refurbished). Free-form."),
  status: z
    .string()
    .optional()
    .describe("Listing status (e.g. active, sold)."),
  valid_until: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Optional expiration as unix-seconds."),
};

const TOOL_NAME = "shopstr_create_or_update_product";

export function registerShopstrCreateOrUpdateProduct(
  server: McpServer,
  deps: PublishDeps,
): void {
  server.registerTool(
    TOOL_NAME,
    {
      description:
        "Create or update a Shopstr-compatible product as a NIP-99 Classified Listing (kind:30402). All product data lives in tags; `summary` is the event content. The `d` tag is the supplied `id` — republishing replaces the prior listing. After relay publish, POSTs to Shopstr's cache (SHOPSTR_CACHE_URL) so the storefront UI surfaces the product. Runs the safety pipeline (read-only, signer, rate limit, optional confirm).",
      inputSchema,
    },
    async (args) => {
      try {
        await deps.ndk.ensureSignerReady();
      } catch (err) {
        return errorResult(
          `Signer not ready: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      const pubkeyHex = await deps.ndk.getSignerPubkeyHex();
      if (!pubkeyHex) {
        return errorResult(
          "Could not resolve signer pubkey. Configure NOSTR_PRIVATE_KEY or NOSTR_NIP46_URI.",
        );
      }
      const event = buildListingEvent({
        id: args.id,
        pubkey_hex: pubkeyHex,
        name: args.name,
        summary: args.summary,
        price: args.price,
        currency: args.currency,
        location: args.location,
        shipping: {
          option: args.shipping_option,
          cost: args.shipping_cost,
          currency: args.currency,
        },
        images: args.images,
        categories: args.categories,
        quantity: args.quantity,
        condition: args.condition,
        status: args.status,
        valid_until: args.valid_until,
      });
      return evaluateAndPublish(deps, event, {
        auditTool: TOOL_NAME,
        confirmActionTool: TOOL_NAME,
        summary: `publish/update Shopstr listing "${args.name}" (kind:${NIP99_PRODUCT_KIND}, d=${args.id}, price ${args.price} ${args.currency})`,
        extraAuditInput: {
          product_id: args.id,
          product_name: args.name,
          price: args.price,
          currency: args.currency,
          shipping_option: args.shipping_option,
          categories: args.categories ?? [],
        },
        afterPublish: makeShopstrCacheHook(deps.config),
      });
    },
  );
}

export const SHOPSTR_PRODUCT_TOOL_NAME = TOOL_NAME;
