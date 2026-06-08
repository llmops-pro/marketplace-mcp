import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { parseStallContent, STALL_KIND } from "../lib/marketplace.js";
import type { NdkClient } from "../ndk-client.js";
import type { AuditLog } from "../safety/audit-log.js";
import { errorResult, textResult } from "./_result.js";

export function registerListMyStalls(server: McpServer, ndk: NdkClient, audit: AuditLog): void {
  server.registerTool(
    "marketplace_list_my_stalls",
    {
      description:
        "Fetch + parse the current signer's NIP-15 stalls (kind:30017). For each stall event found on the configured relays, returns the event id, created_at, `d` tag, and the parsed stall JSON (name, description, currency, shipping). Stalls that don't pass the NIP-15 schema are returned with `parsed: null` so you can see what's wrong.",
    },
    async () => {
      if (!ndk.hasSigner()) {
        await audit.record({
          tool: "marketplace_list_my_stalls",
          outcome: "blocked",
          blocked_reason: "no signer (can't determine `me`)",
        });
        return errorResult(
          "No signer configured — can't determine the author pubkey to query against.",
        );
      }
      try {
        await ndk.ensureSignerReady();
        const self = (await ndk.getSignerPubkeyHex()) ?? "";
        const events = await ndk.ndk.fetchEvents({
          kinds: [STALL_KIND],
          authors: [self],
          limit: 200,
        });
        const stalls = Array.from(events)
          .map((e) => {
            const dTag = e.tags.find((t) => t[0] === "d")?.[1] ?? null;
            return {
              event_id: e.id,
              created_at: e.created_at,
              d_tag: dTag,
              parsed: parseStallContent(e.content),
              raw_content: e.content,
            };
          })
          .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
        await audit.record({
          tool: "marketplace_list_my_stalls",
          outcome: "ok",
          input: { author: self },
          result: { count: stalls.length },
        });
        return textResult({ count: stalls.length, stalls });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await audit.record({
          tool: "marketplace_list_my_stalls",
          outcome: "error",
          error: msg,
        });
        return errorResult(`marketplace_list_my_stalls failed: ${msg}`);
      }
    },
  );
}
