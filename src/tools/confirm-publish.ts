import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { errorResult } from "./_result.js";
import {
  evaluateAndPublish,
  type AfterPublishHook,
  type PublishDeps,
  type PublishParams,
} from "./evaluate-and-publish.js";
import { SHOPSTR_PRODUCT_TOOL_NAME } from "./shopstr-create-or-update-product.js";
import { SHOPSTR_SHOP_TOOL_NAME } from "./shopstr-create-or-update-shop.js";
import { makeShopstrCacheHook } from "./shopstr-after-publish.js";

const inputSchema = {
  token: z.string().min(1).describe("Confirmation token from a previous create_or_update_* call."),
};

// Tools that need a post-publish Shopstr cache POST. The confirm store only
// remembers the tool name + params; the dispatcher here re-attaches the right
// hook based on the original tool.
const SHOPSTR_CACHE_TOOLS = new Set<string>([
  SHOPSTR_PRODUCT_TOOL_NAME,
  SHOPSTR_SHOP_TOOL_NAME,
]);

export function registerConfirmPublish(server: McpServer, deps: PublishDeps): void {
  server.registerTool(
    "marketplace_confirm_publish",
    {
      description:
        "Execute a previously-prepared marketplace publish, identified by its one-time token. Only meaningful when NOSTR_REQUIRE_CONFIRM=true. Single-use token; the safety pipeline re-runs before signing. For Shopstr-modern tools (kind:30019/30402), the Shopstr cache POST hook is re-attached automatically.",
      inputSchema,
    },
    async ({ token }) => {
      const action = deps.confirm.consume(token);
      if (!action) {
        await deps.audit.record({
          tool: "marketplace_confirm_publish",
          outcome: "blocked",
          input: { token_prefix: token.slice(0, 8) + "..." },
          blocked_reason: "token unknown or expired",
        });
        return errorResult("Token is unknown or expired. Call the original publish tool again.");
      }
      const params = action.params as unknown as PublishParams;
      const afterPublish: AfterPublishHook | undefined =
        SHOPSTR_CACHE_TOOLS.has(action.tool)
          ? makeShopstrCacheHook(deps.config)
          : undefined;
      return evaluateAndPublish(deps, params, {
        skipConfirmGate: true,
        auditTool: "marketplace_confirm_publish",
        confirmActionTool: action.tool,
        summary: `confirmed: ${action.summary}`,
        extraAuditInput: { confirmed_for: action.tool },
        ...(afterPublish ? { afterPublish } : {}),
      });
    },
  );
}
