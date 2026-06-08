import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  buildShopProfileEvent,
  SHOP_PROFILE_KIND,
} from "../lib/shopstr.js";
import { errorResult } from "./_result.js";
import {
  evaluateAndPublish,
  type PublishDeps,
} from "./evaluate-and-publish.js";
import { makeShopstrCacheHook } from "./shopstr-after-publish.js";

const inputSchema = {
  name: z.string().min(1).describe("Shop display name (the storefront header)."),
  about: z.string().optional().describe("Long-form 'about this shop' copy."),
  picture: z
    .string()
    .url()
    .optional()
    .describe("Shop avatar/picture URL."),
  banner: z
    .string()
    .url()
    .optional()
    .describe("Shop banner image URL."),
};

const TOOL_NAME = "shopstr_create_or_update_shop";

export function registerShopstrCreateOrUpdateShop(
  server: McpServer,
  deps: PublishDeps,
): void {
  server.registerTool(
    TOOL_NAME,
    {
      description:
        "Create or update the seller's Shopstr shop profile (kind:30019). The `d` tag is the seller's pubkey hex — one shop per pubkey. After relay publish, POSTs the event to Shopstr's cache (SHOPSTR_CACHE_URL) so the storefront UI surfaces it. Runs the safety pipeline (read-only, signer, rate limit, optional confirm).",
      inputSchema,
    },
    async (args) => {
      // We need the signer pubkey at builder time (it's the `d` tag).
      // ensureSignerReady is also called inside evaluateAndPublish; calling it
      // here is fine and lets us fail fast with a clean error if the bunker
      // never connected.
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
      const event = buildShopProfileEvent({
        pubkey_hex: pubkeyHex,
        name: args.name,
        about: args.about,
        picture: args.picture,
        banner: args.banner,
      });
      return evaluateAndPublish(deps, event, {
        auditTool: TOOL_NAME,
        confirmActionTool: TOOL_NAME,
        summary: `publish/update Shopstr shop "${args.name}" (kind:${SHOP_PROFILE_KIND}, d=<pubkey>)`,
        extraAuditInput: {
          shop_name: args.name,
          has_about: Boolean(args.about),
          has_picture: Boolean(args.picture),
          has_banner: Boolean(args.banner),
        },
        afterPublish: makeShopstrCacheHook(deps.config),
      });
    },
  );
}

export const SHOPSTR_SHOP_TOOL_NAME = TOOL_NAME;
