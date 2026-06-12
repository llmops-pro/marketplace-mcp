#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { hasSigner, loadConfig } from "./config.js";

// Load .env from this binary's directory only (next to dist/). Avoids cross-MCP
// collisions when multiple servers run from the same Claude Code session.
function tryLoadEnvFile(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = resolve(here, "..", ".env");
  try {
    process.loadEnvFile(path);
  } catch {
    // file missing — fine
  }
}
tryLoadEnvFile();

import { NdkClient } from "./ndk-client.js";
import { AuditLog } from "./safety/audit-log.js";
import { ConfirmStore } from "./safety/confirm.js";
import { RateLimiter } from "./safety/rate-limiter.js";
import { registerAllTools } from "./tools/register.js";

async function main(): Promise<void> {
  const config = loadConfig();

  const audit = new AuditLog(config.NOSTR_AUDIT_PATH);
  const rateLimiter = new RateLimiter({ events: config.NOSTR_MAX_EVENTS_PER_MINUTE });
  const confirm = new ConfirmStore();
  const ndk = new NdkClient(config);

  // Connect NDK in the background — never block the MCP handshake on relay
  // reachability. If a relay is slow or down, await-ing connect() can hang the
  // whole server, which makes Claude Code report "still connecting" forever and
  // never registers our tools. Tools that need the relay pool will wait for
  // their own queries; the pool gets populated as relays come online.
  ndk.connect().catch((err) => {
    process.stderr.write(
      `marketplace-mcp: warning: relay pool connect error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  });

  const server = new McpServer(
    { name: "marketplace-mcp", version: "0.2.3" },
    { capabilities: { tools: {} } },
  );

  registerAllTools({ server, config, ndk, audit, rateLimiter, confirm });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  await audit.record({
    tool: "_startup",
    outcome: "ok",
    result: {
      signer_configured: hasSigner(config),
      signer_kind: config.NOSTR_PRIVATE_KEY
        ? "nsec"
        : config.NOSTR_NIP46_URI
          ? "nip46"
          : null,
      relay_count: config.NOSTR_RELAYS.length,
      read_only: config.NOSTR_READ_ONLY,
      require_confirm: config.NOSTR_REQUIRE_CONFIRM,
      shopstr_cache_enabled: config.SHOPSTR_CACHE_ENABLED,
      shopstr_cache_url: config.SHOPSTR_CACHE_ENABLED
        ? config.SHOPSTR_CACHE_URL
        : null,
      rate_limits: rateLimiter.snapshot(),
    },
  });

  const shutdown = async (signal: string): Promise<void> => {
    await audit.record({ tool: "_shutdown", outcome: "ok", result: { signal } });
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  process.stderr.write(`marketplace-mcp: fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
