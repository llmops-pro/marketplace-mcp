// Shared safety pipeline for stall + product publishes.
//
// Order: NOSTR_READ_ONLY → signer presence → RateLimiter → optional confirm →
// sign + publish → audit. Kind allowlist is omitted because the kinds (30017
// and 30018) are hard-coded in the tool implementations; we'd just be checking
// them against ourselves.

import { NDKEvent } from "@nostr-dev-kit/ndk";
import type { Config } from "../config.js";
import type { NdkClient } from "../ndk-client.js";
import type { AuditLog } from "../safety/audit-log.js";
import type { ConfirmStore } from "../safety/confirm.js";
import type { RateLimiter } from "../safety/rate-limiter.js";
import { errorResult, textResult } from "./_result.js";

export type PublishDeps = {
  config: Config;
  ndk: NdkClient;
  audit: AuditLog;
  rateLimiter: RateLimiter;
  confirm: ConfirmStore;
};

export type PublishParams = {
  kind: number;
  content: string;
  tags: string[][];
};

export type SignedEvent = {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
};

export type AfterPublishResult = Record<string, unknown>;

export type AfterPublishHook = (
  event: SignedEvent,
) => Promise<AfterPublishResult>;

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export async function evaluateAndPublish(
  deps: PublishDeps,
  params: PublishParams,
  opts: {
    auditTool: string;
    skipConfirmGate?: boolean;
    summary: string;
    extraAuditInput?: Record<string, unknown>;
    afterPublish?: AfterPublishHook;
    /**
     * When the confirm path resumes a publish, the `tool` stored on the
     * confirm action drives any tool-name-specific routing (e.g. choosing the
     * right `afterPublish` hook). Defaulted to `auditTool` for direct calls.
     */
    confirmActionTool?: string;
  },
): Promise<ToolResult> {
  const inputForAudit = {
    kind: params.kind,
    content_length: params.content.length,
    tag_count: params.tags.length,
    ...(opts.extraAuditInput ?? {}),
  };

  if (deps.config.NOSTR_READ_ONLY) {
    await deps.audit.record({
      tool: opts.auditTool,
      outcome: "blocked",
      input: inputForAudit,
      blocked_reason: "NOSTR_READ_ONLY=true — publish tools are disabled",
    });
    return errorResult("NOSTR_READ_ONLY=true — publish tools are disabled");
  }
  if (!deps.ndk.hasSigner()) {
    await deps.audit.record({
      tool: opts.auditTool,
      outcome: "blocked",
      input: inputForAudit,
      blocked_reason: "no signer configured",
    });
    return errorResult(
      "No signer configured. Set NOSTR_PRIVATE_KEY (dev) or NOSTR_NIP46_URI (recommended).",
    );
  }
  const rate = deps.rateLimiter.take("events");
  if (!rate.ok) {
    await deps.audit.record({
      tool: opts.auditTool,
      outcome: "blocked",
      input: inputForAudit,
      blocked_reason: rate.reason,
    });
    return errorResult(rate.reason);
  }

  if (deps.config.NOSTR_REQUIRE_CONFIRM && !opts.skipConfirmGate) {
    const { token, expires_at } = deps.confirm.prepare({
      tool: opts.confirmActionTool ?? opts.auditTool,
      params: params as unknown as Record<string, unknown>,
      summary: opts.summary,
    });
    await deps.audit.record({
      tool: opts.auditTool,
      outcome: "ok",
      input: inputForAudit,
      result: { confirmation_required: true, token },
    });
    return textResult({
      status: "confirmation_required",
      token,
      expires_at: new Date(expires_at).toISOString(),
      summary: opts.summary,
      next_step: `Call marketplace_confirm_publish with token "${token}" to broadcast.`,
    });
  }

  try {
    await deps.ndk.ensureSignerReady();
    const event = new NDKEvent(deps.ndk.ndk, {
      kind: params.kind,
      content: params.content,
      tags: params.tags,
      created_at: Math.floor(Date.now() / 1000),
      pubkey: (await deps.ndk.getSignerPubkeyHex()) ?? "",
    });
    await event.sign();
    const accepted = await event.publish();
    const acceptedUrls = Array.from(accepted).map((r) => r.url);

    let afterPublishResult: AfterPublishResult | undefined;
    if (opts.afterPublish) {
      try {
        const signed: SignedEvent = {
          id: event.id,
          pubkey: event.pubkey,
          created_at: event.created_at ?? Math.floor(Date.now() / 1000),
          kind: event.kind ?? params.kind,
          tags: event.tags,
          content: event.content,
          sig: event.sig ?? "",
        };
        afterPublishResult = await opts.afterPublish(signed);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        afterPublishResult = { after_publish_error: msg };
      }
    }

    await deps.audit.record({
      tool: opts.auditTool,
      outcome: "ok",
      input: inputForAudit,
      result: {
        event_id: event.id,
        relays_accepted: acceptedUrls,
        relays_accepted_count: acceptedUrls.length,
        ...(afterPublishResult ? { after_publish: afterPublishResult } : {}),
      },
    });
    return textResult({
      event_id: event.id,
      kind: params.kind,
      pubkey: event.pubkey,
      created_at: event.created_at,
      relays_accepted: acceptedUrls,
      ...(afterPublishResult ? { after_publish: afterPublishResult } : {}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await deps.audit.record({
      tool: opts.auditTool,
      outcome: "error",
      input: inputForAudit,
      error: msg,
    });
    return errorResult(`${opts.auditTool} failed: ${msg}`);
  }
}
