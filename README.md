# marketplace-mcp

**A NOSTR storefront for your LLM agent — speaks both dialects.** MCP server that lets an agent create + update marketplace events on your behalf, in two dialects out of the box:

- **NIP-15** (kind:30017 stalls + kind:30018 products) for NIP-15-native clients (Plebeian Market, etc.).
- **Shopstr-modern** (kind:30019 shop profile + kind:30402 NIP-99 classified listings) — what `shopstr.store` actually renders. Includes an automatic cache-POST so events appear on the storefront, not just on relays.

Seven tools, defense-in-depth safety, MIT licensed.

> **v0.2 — dual-dialect publisher.** v0.1.x shipped NIP-15-only and the listings never appeared on shopstr.store because Shopstr is a Postgres-backed CMS that only renders events from its own DB (populated via `POST /api/db/cache-event`) and its cacheable-event allowlist excludes NIP-15 kinds. v0.2 adds the Shopstr-modern tools and the cache-POST hook so the storefront actually populates. NIP-15 tools left in place for non-Shopstr targets.

---

## Why this server exists

Shopstr (the canonical Bitcoin-Lightning marketplace UI on NOSTR) is **not a relay-reading Nostr client** — it's a Next.js app with a Postgres cache. Its marketplace page renders products from its own DB, populated when clients POST signed events to `/api/db/cache-event`. The cacheable-event allowlist (in `shopstr-eng/shopstr` → `utils/db/cache-event-policy.ts`) excludes NIP-15 stall/product kinds; modern Shopstr uses **kind:30019** (shop profile with `merchants: [<pubkey>]`) and **kind:30402** (NIP-99 Classified Listings, all data in tags). Without a `["t","shopstr"]` tag the listing won't surface; without at least one `["image",<url>]` tag the card silently never renders.

`marketplace-mcp` v0.2 builds the right events, POSTs them to Shopstr's cache after the relay publish, and keeps the legacy NIP-15 tools intact for anyone targeting other clients.

---

## What you can build with this

- **A self-driving Shopstr storefront** — agent generates shop profile + product listings from a config file, republishes whenever metadata changes, drops fresh `t`-tag categories per product for discoverability. Same call publishes to relays AND mirrors to Shopstr's cache.
- **A sales-channel multiplexer** — the same product events propagate to every NIP-15- or NIP-99-aware client (Shopstr, Plebeian Market, etc.) by virtue of being on shared relays. Pick your dialect per-tool; publish to both if your audience spans clients.
- **A listing-as-code workflow** — version-control your product JSON in git; CI calls `shopstr_create_or_update_product` to deploy. Republish with the same `id` = idempotent update (parameterized-replaceable events).
- **Cross-server identity** — pair with [`nostr-ops-mcp`](https://npmjs.com/package/nostr-ops-mcp) and [`nwc-mcp`](https://npmjs.com/package/nwc-mcp) to wire identity + commerce. Same signer, same npub, three specialized tool surfaces.

---

## The seven tools

### Shopstr-modern (new in v0.2) — required for shopstr.store visibility

| Tool | Kind | Purpose |
|---|---|---|
| `shopstr_create_or_update_shop` | 30019 | Publish the seller's shop profile (`name`, `about`, `picture`, `banner`). The `d` tag is the seller's pubkey hex — one shop per pubkey. After relay publish, POSTs to Shopstr's cache so the storefront UI surfaces the shop. |
| `shopstr_create_or_update_product` | 30402 | Publish a NIP-99 Classified Listing. All product data in tags (`title`, `summary`, `price`, `location`, `shipping`, `image` × N, `t` × N, `quantity`, `condition`, `status`, `valid_until`). Auto-adds `["t","shopstr"]` so the product surfaces in Shopstr's marketplace feed. Cache-POST included. |

### NIP-15 legacy — for NIP-15-native clients (not Shopstr)

| Tool | Kind | Purpose |
|---|---|---|
| `marketplace_create_or_update_stall` | 30017 | NIP-15 stall (`id`, `name`, `description`, `currency`, `shipping[]`). The `id` is the `d` tag — same id = replace. Relay publish only; no Shopstr cache POST (would be 400'd anyway, kind not allowlisted). |
| `marketplace_create_or_update_product` | 30018 | NIP-15 product (`stall_id`, `name`, `description`, `images`, `price`, `quantity`, `specs`, `shipping`, `categories`). Relay publish only. |

### Common

| Tool | Kind | Purpose |
|---|---|---|
| `marketplace_list_my_stalls` | — | Fetch + parse your own NIP-15 stalls. Returns event id, created_at, `d` tag, parsed JSON. |
| `marketplace_list_my_products` | — | Same for NIP-15 products. Optional `stall_id` filter (client-side; relays don't index JSON content). |
| `marketplace_confirm_publish` | — | Two-step confirm dispatcher. Routes by tool name so Shopstr-modern publishes re-attach the cache-POST hook automatically. |

---

## Requirements

- Node 20+
- A NOSTR signer — strongly preferred: a NIP-46 bunker URI from Amber, nsec.app, or any NIP-46 implementation. Dev path: raw `nsec` in `.env`.
- Relays your audience reads from. Sensible defaults in `.env.example` (`relay.damus.io`, `nos.lol`, `relay.nostr.band`, `relay.primal.net`).
- For Shopstr-modern publishes: outbound HTTPS to `shopstr.store` (or your own Shopstr deployment).

## Install

```bash
# From npm
npx -y marketplace-mcp

# From source
git clone <repo>
cd marketplace-mcp
corepack enable pnpm
pnpm install
pnpm build
```

## Configure

```bash
cp .env.example .env
# edit .env: set NOSTR_NIP46_URI OR NOSTR_PRIVATE_KEY
#           set NOSTR_RELAYS (comma-separated wss://)
#           set SHOPSTR_CACHE_ENABLED=true (default) for shopstr.store visibility
```

The server auto-loads `.env` from this binary's own directory (next to `dist/`) — deliberately NOT from cwd, to avoid env-var collision when multiple MCP servers run in the same Claude Code session.

### Required

| Var | Purpose |
|---|---|
| `NOSTR_RELAYS` | Comma-separated `wss://` relays. Server refuses to start if empty. |

### Signer — provide AT MOST one (without a signer the server runs read-only)

| Var | Purpose |
|---|---|
| `NOSTR_NIP46_URI` | `bunker://...` URI. **Recommended.** Pair with Amber (Android) or nsec.app (web). |
| `NOSTR_PRIVATE_KEY` | Raw `nsec1...`. Dev/legacy only. Server warns at startup. |

### Shopstr cache mirror (new in v0.2)

shopstr.store reads from its own Postgres DB, not from open relays. After kind:30019/30402 events publish to relays, the server POSTs them to the configured cache URL so the storefront surfaces them. Failures are logged in the audit log but never roll back the relay publish (a Nostr event already broadcast can't be rolled back anyway).

| Var | Default | Purpose |
|---|---|---|
| `SHOPSTR_CACHE_ENABLED` | unset (`false`) — set `true` in `.env` to enable | Controls whether the cache POST runs at all. |
| `SHOPSTR_CACHE_URL` | `https://shopstr.store/api/db/cache-event` | Override to mirror to a self-hosted Shopstr deployment. |

The NIP-15 tools (kind:30017/30018) ignore these — those kinds aren't on Shopstr's cacheable allowlist anyway.

### Optional safety knobs

| Var | Default | Purpose |
|---|---|---|
| `NOSTR_READ_ONLY` | `false` | Disables all publish tools (list_my_* still work). |
| `NOSTR_REQUIRE_CONFIRM` | `false` | Two-step confirm — create/update returns a token; `marketplace_confirm_publish` actually broadcasts. |
| `NOSTR_MAX_EVENTS_PER_MINUTE` | `10` | Rolling 60s rate limit on publishes. |
| `NOSTR_LOG_PATH` | `./marketplace-mcp.log` | Server log. |
| `NOSTR_AUDIT_PATH` | `./marketplace-mcp-audit.log` | Append-only JSON-line audit log. |

---

## Quickstart: publish your first storefront on shopstr.store

```
1. agent: shopstr_create_or_update_shop({
     name: "My Shop",
     about: "Hand-crafted MCP servers and other Lightning-priced goods.",
     picture: "https://example.com/avatar.png",
     banner: "https://example.com/banner.png"
   })
   → returns { event_id, kind: 30019, relays_accepted: [...],
                after_publish: { shopstr_cache: { ok: true, status: 200 } } }

2. agent: shopstr_create_or_update_product({
     id: "some-product",
     name: "Some Product",
     summary: "Long-form description goes here. Becomes the event `content`.",
     price: 50000,
     currency: "sat",
     location: "online",
     shipping_option: "Free",
     shipping_cost: 0,
     images: ["https://example.com/card.jpg"],   // REQUIRED — Shopstr drops cards with zero images
     categories: ["software", "lightning", "mcp"]
   })
   → returns { event_id, kind: 30402, relays_accepted: [...],
                after_publish: { shopstr_cache: { ok: true, status: 200 } } }
```

Visit `https://shopstr.store/marketplace/<your-npub>` to see your storefront. (If you've registered a Shopstr profile slug for your npub, the URL canonicalises to `/marketplace/<your-slug>`.) Browsers buy through Shopstr's invoice-generation flow → sats land in the Lightning wallet linked to your Shopstr profile.

### NIP-15 alternative (for non-Shopstr clients)

If you're targeting NIP-15-native clients instead of (or in addition to) Shopstr, the legacy tools still work:

```
agent: marketplace_create_or_update_stall({
  id: "my-shop", name: "My Shop",
  shipping: [{ id: "digital", name: "Digital", cost: 0 }]
})
agent: marketplace_create_or_update_product({
  id: "p1", stall_id: "my-shop", name: "Some Product",
  price: 50000, currency: "sat",
  shipping: [{ id: "digital", cost: 0 }]
})
```

You can publish both dialects for the same product to maximise client coverage; they don't collide.

---

## Wire into an MCP client

```json
{
  "mcpServers": {
    "marketplace": {
      "command": "npx",
      "args": ["-y", "marketplace-mcp"],
      "env": {}
    }
  }
}
```

Same `.env`-via-binary-dir pattern as the rest of the substrate — leave the `env` block empty in client config; secrets stay in `marketplace-mcp/.env`.

---

## Safety model

The publish pipeline runs in this order, for both NIP-15 and Shopstr-modern tools:

1. **`NOSTR_READ_ONLY` gate.**
2. **Signer presence** — refuse if no signer.
3. **RateLimiter** — rolling `events` bucket (`NOSTR_MAX_EVENTS_PER_MINUTE`).
4. **Confirm gate** — if `NOSTR_REQUIRE_CONFIRM=true`, returns a token; `marketplace_confirm_publish` executes. The confirm dispatcher routes by tool name so Shopstr-modern publishes re-attach their cache-POST hook automatically.
5. **Sign + publish** via NDK.
6. **`afterPublish` hook** *(Shopstr-modern only)* — POST the signed event to `SHOPSTR_CACHE_URL`. Failures logged in audit (`after_publish.shopstr_cache.{ok, status, error}`) but never roll back the relay publish.
7. **Audit log** entry.

KindAllowlist is omitted because the kinds (30017/30018/30019/30402) are hard-coded in the tool implementations — there's no agent-supplied `kind` to validate.

If you want stricter behavior, pair with [`nostr-ops-mcp`](https://npmjs.com/package/nostr-ops-mcp) and use its kind allowlist on the same npub — but most users find that overhead unnecessary for a single-purpose marketplace server.

---

## Testing

```bash
pnpm typecheck
pnpm test        # 19 vitest cases (NIP-15 builders/parsers + Shopstr-modern builders/parsers + roundtrips)
pnpm build       # ~37 KB ESM bundle
```

---

## Companion servers

- [`nwc-mcp`](https://npmjs.com/package/nwc-mcp) — Lightning wallet. The "payment" side of selling.
- [`nostr-ops-mcp`](https://npmjs.com/package/nostr-ops-mcp) — General NOSTR primitives. The marketplace MCP is the specialized cousin; nostr-ops-mcp is the generalist.
- [`albyhub-admin-mcp`](https://npmjs.com/package/albyhub-admin-mcp) — Hub-level admin via Alby Hub's HTTP API. The other half of the wallet story (NWC handles payments, this handles node/channel/sub-wallet ops).

---

## License

MIT — see [`LICENSE`](./LICENSE).

## Contact / Issues

Built by **LLMOps.Pro**.

- **NOSTR:** [`npub1hdg932jvwc3jdvkqywgqv0ue4nn60exrf92asy8mtazt3hjg7d2s2yw0nw`](https://njump.me/npub1hdg932jvwc3jdvkqywgqv0ue4nn60exrf92asy8mtazt3hjg7d2s2yw0nw) — follow, DM, zap.
- **Lightning Address:** `sovereigncitizens@getalby.com` — for support zaps and "this was useful" tips.
- **Bug reports / feature requests:** open a GitHub issue (link forthcoming).
- **Security issues:** please disclose privately via NOSTR DM before opening a public issue.
