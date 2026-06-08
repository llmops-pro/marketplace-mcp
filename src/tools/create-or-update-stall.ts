import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { buildStallEvent, STALL_KIND } from "../lib/marketplace.js";
import { evaluateAndPublish, type PublishDeps } from "./evaluate-and-publish.js";

const inputSchema = {
  id: z
    .string()
    .min(1)
    .max(120)
    .describe(
      "Stable identifier for this stall. Becomes the `d` tag — republishing with the same id REPLACES the prior stall (parameterized-replaceable). Use a UUID, slug, or any stable string.",
    ),
  name: z.string().min(1).describe("Display name of the stall."),
  description: z.string().optional().describe("Long-form description (Markdown is fine for Shopstr)."),
  currency: z
    .string()
    .default("sat")
    .describe("Currency code. Default `sat`. Shopstr also accepts ISO 4217 codes (USD, EUR, …)."),
  shipping: z
    .array(
      z.object({
        id: z
          .string()
          .min(1)
          .describe("Shipping zone id — products will reference this to attach their own per-zone cost."),
        name: z.string().min(1),
        cost: z
          .number()
          .nonnegative()
          .describe("Base shipping cost in the stall's currency."),
        regions: z
          .array(z.string())
          .optional()
          .describe(
            "Optional list of regions/countries served by this zone. Free-form strings (e.g. `worldwide`, `EU`, `US`).",
          ),
      }),
    )
    .default([])
    .describe("Shipping zones available from this stall."),
};

export function registerCreateOrUpdateStall(server: McpServer, deps: PublishDeps): void {
  server.registerTool(
    "marketplace_create_or_update_stall",
    {
      description:
        "Create or update a NIP-15 marketplace stall (kind:30017). The `id` field is the parameterized-replaceable identifier — publishing with the same id replaces the prior stall on relays that honor replaceability. Shopstr is the canonical UI for these events. Runs the safety pipeline (read-only, signer, rate limit, optional confirm).",
      inputSchema,
    },
    async (args) => {
      const event = buildStallEvent({
        id: args.id,
        name: args.name,
        description: args.description,
        currency: args.currency,
        shipping: args.shipping,
      });
      return evaluateAndPublish(deps, event, {
        auditTool: "marketplace_create_or_update_stall",
        summary: `publish/update stall "${args.name}" (kind:${STALL_KIND}, d=${args.id}, ${args.shipping.length} shipping zones)`,
        extraAuditInput: {
          stall_id: args.id,
          stall_name: args.name,
          shipping_zone_count: args.shipping.length,
        },
      });
    },
  );
}
