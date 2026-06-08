import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { NDKFilter } from "@nostr-dev-kit/ndk";
import { z } from "zod";
import { parseProductContent, PRODUCT_KIND } from "../lib/marketplace.js";
import type { NdkClient } from "../ndk-client.js";
import type { AuditLog } from "../safety/audit-log.js";
import { errorResult, textResult } from "./_result.js";

const inputSchema = {
  stall_id: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional stall id (the parent stall's d-tag). When set, only returns products whose parsed `stall_id` matches.",
    ),
  limit: z
    .number()
    .int()
    .positive()
    .max(500)
    .default(100)
    .describe("Max events to fetch. Hard cap 500."),
};

export function registerListMyProducts(server: McpServer, ndk: NdkClient, audit: AuditLog): void {
  server.registerTool(
    "marketplace_list_my_products",
    {
      description:
        "Fetch + parse the current signer's NIP-15 products (kind:30018). Returns each product's event id, created_at, `d` tag, category `t` tags, and parsed JSON (name, description, price, currency, stall_id, etc.). Optionally filter by stall_id (applied client-side after fetch — NOSTR relays don't index the JSON content). Products with non-JSON or schema-invalid content are returned with `parsed: null`.",
      inputSchema,
    },
    async ({ stall_id, limit }) => {
      if (!ndk.hasSigner()) {
        await audit.record({
          tool: "marketplace_list_my_products",
          outcome: "blocked",
          blocked_reason: "no signer (can't determine `me`)",
        });
        return errorResult("No signer configured.");
      }
      try {
        await ndk.ensureSignerReady();
        const self = (await ndk.getSignerPubkeyHex()) ?? "";
        const filter: NDKFilter = {
          kinds: [PRODUCT_KIND],
          authors: [self],
          limit,
        };
        const events = await ndk.ndk.fetchEvents(filter);
        let products = Array.from(events)
          .map((e) => {
            const dTag = e.tags.find((t) => t[0] === "d")?.[1] ?? null;
            const categories = e.tags
              .filter((t) => t[0] === "t" && typeof t[1] === "string")
              .map((t) => t[1] as string);
            return {
              event_id: e.id,
              created_at: e.created_at,
              d_tag: dTag,
              categories,
              parsed: parseProductContent(e.content),
              raw_content: e.content,
            };
          })
          .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
        if (stall_id) {
          products = products.filter((p) => p.parsed?.stall_id === stall_id);
        }
        await audit.record({
          tool: "marketplace_list_my_products",
          outcome: "ok",
          input: { author: self, stall_id_filter: stall_id ?? null, limit },
          result: { count: products.length },
        });
        return textResult({ count: products.length, products });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await audit.record({
          tool: "marketplace_list_my_products",
          outcome: "error",
          error: msg,
        });
        return errorResult(`marketplace_list_my_products failed: ${msg}`);
      }
    },
  );
}
