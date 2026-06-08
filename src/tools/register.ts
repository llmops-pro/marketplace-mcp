import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../config.js";
import type { NdkClient } from "../ndk-client.js";
import type { AuditLog } from "../safety/audit-log.js";
import type { ConfirmStore } from "../safety/confirm.js";
import type { RateLimiter } from "../safety/rate-limiter.js";
import { registerConfirmPublish } from "./confirm-publish.js";
import { registerCreateOrUpdateProduct } from "./create-or-update-product.js";
import { registerCreateOrUpdateStall } from "./create-or-update-stall.js";
import { registerListMyProducts } from "./list-my-products.js";
import { registerListMyStalls } from "./list-my-stalls.js";
import { registerShopstrCreateOrUpdateProduct } from "./shopstr-create-or-update-product.js";
import { registerShopstrCreateOrUpdateShop } from "./shopstr-create-or-update-shop.js";

export type ToolDeps = {
  server: McpServer;
  config: Config;
  ndk: NdkClient;
  audit: AuditLog;
  rateLimiter: RateLimiter;
  confirm: ConfirmStore;
};

export function registerAllTools(deps: ToolDeps): void {
  const { server, ndk, audit } = deps;
  const publishDeps = {
    config: deps.config,
    ndk: deps.ndk,
    audit: deps.audit,
    rateLimiter: deps.rateLimiter,
    confirm: deps.confirm,
  };

  // NIP-15 write tools (kind:30017 stalls + kind:30018 products) — original
  // v0.1.x surface. Honored by NIP-15-native clients (e.g. Plebeian Market).
  registerCreateOrUpdateStall(server, publishDeps);
  registerCreateOrUpdateProduct(server, publishDeps);

  // Shopstr-modern write tools (kind:30019 shop profile + kind:30402 NIP-99
  // listing). Required for shopstr.store visibility. Includes a best-effort
  // POST to SHOPSTR_CACHE_URL after relay publish.
  registerShopstrCreateOrUpdateShop(server, publishDeps);
  registerShopstrCreateOrUpdateProduct(server, publishDeps);

  // Two-step confirm dispatcher — handles both NIP-15 and Shopstr-modern paths.
  registerConfirmPublish(server, publishDeps);

  // Read tools — query the signer's own listings.
  registerListMyStalls(server, ndk, audit);
  registerListMyProducts(server, ndk, audit);
}
