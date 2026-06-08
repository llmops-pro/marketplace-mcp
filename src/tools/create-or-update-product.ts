import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { buildProductEvent, PRODUCT_KIND } from "../lib/marketplace.js";
import { evaluateAndPublish, type PublishDeps } from "./evaluate-and-publish.js";

const inputSchema = {
  id: z
    .string()
    .min(1)
    .max(120)
    .describe(
      "Stable product identifier — becomes the `d` tag. Republishing with the same id REPLACES the prior product.",
    ),
  stall_id: z
    .string()
    .min(1)
    .describe(
      "The `id` of the parent stall (kind:30017 d-tag). Establishes the product → stall relationship that Shopstr uses to group listings.",
    ),
  name: z.string().min(1).describe("Product display name."),
  description: z.string().optional(),
  images: z.array(z.string().url()).optional().describe("Product image URLs."),
  currency: z.string().default("sat"),
  price: z.number().positive().describe("Price in the stall's currency."),
  quantity: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Available units. Omit for unlimited (digital goods)."),
  specs: z
    .array(z.array(z.string()).length(2))
    .optional()
    .describe('Key/value spec pairs (e.g. `[["License", "MIT"], ["Format", "npm package"]]`).'),
  shipping: z
    .array(
      z.object({
        id: z.string().min(1).describe("Must reference a shipping zone defined in the parent stall."),
        cost: z
          .number()
          .nonnegative()
          .optional()
          .describe("Optional per-product override of the zone's base cost."),
      }),
    )
    .optional(),
  categories: z
    .array(z.string())
    .optional()
    .describe(
      'Free-form category tags (added as `t` tags on the event). Lowercase recommended (e.g. ["software", "lightning"]).',
    ),
};

export function registerCreateOrUpdateProduct(server: McpServer, deps: PublishDeps): void {
  server.registerTool(
    "marketplace_create_or_update_product",
    {
      description:
        "Create or update a NIP-15 product (kind:30018) within a stall. The `stall_id` must match an existing stall's `id`. The `id` is the product's parameterized-replaceable d-tag — republishing with the same id replaces it. `categories` are surfaced as `t` tags for discoverability. Runs the safety pipeline (read-only, signer, rate limit, optional confirm).",
      inputSchema,
    },
    async (args) => {
      const event = buildProductEvent(
        {
          id: args.id,
          stall_id: args.stall_id,
          name: args.name,
          description: args.description,
          images: args.images,
          currency: args.currency,
          price: args.price,
          quantity: args.quantity,
          specs: args.specs,
          shipping: args.shipping,
        },
        { categories: args.categories },
      );
      return evaluateAndPublish(deps, event, {
        auditTool: "marketplace_create_or_update_product",
        summary: `publish/update product "${args.name}" (kind:${PRODUCT_KIND}, d=${args.id}, stall=${args.stall_id}, price ${args.price} ${args.currency})`,
        extraAuditInput: {
          product_id: args.id,
          stall_id: args.stall_id,
          product_name: args.name,
          price: args.price,
          currency: args.currency,
        },
      });
    },
  );
}
