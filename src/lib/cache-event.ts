// POST a signed Nostr event to Shopstr's cache-event endpoint.
//
// Shopstr is NOT a relay-reading client — its UI reads only from its own
// Postgres cache. To make a kind:30019 / kind:30402 event visible on
// shopstr.store/marketplace/<npub>, the event must be POSTed to
// /api/db/cache-event after relay publish.
//
// Best-effort by design: a failed cache POST should not roll back the relay
// publish (we can't anyway — Nostr events are immutable). Failures are
// surfaced in the audit log and the tool result.

export type CachePostResult =
  | { ok: true; status: number }
  | { ok: false; status: number; error: string };

export type CacheEventInput = {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
};

export async function postEventToShopstrCache(
  url: string,
  event: CacheEventInput,
  options: { timeoutMs?: number } = {},
): Promise<CachePostResult> {
  const ctrl = new AbortController();
  const timeoutMs = options.timeoutMs ?? 8_000;
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      let body = "";
      try {
        body = (await res.text()).slice(0, 400);
      } catch {
        // swallow
      }
      return { ok: false, status: res.status, error: body || res.statusText };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, error: msg };
  } finally {
    clearTimeout(t);
  }
}
