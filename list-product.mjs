#!/usr/bin/env node
// list-product.mjs — PERMANENT (not throwaway). Run from marketplace-mcp/ (deps + .env here).
//
//   node list-product.mjs --title "..." --price 2100 --description "..." \
//     --image "https://raw.githubusercontent.com/llmops-pro/nostr-marketplace-assets/main/<name>.jpg" \
//     [--slug custom-d-tag] [--dry-run]
//
// Publishes a Shopstr product card (kind:30402) + a short public advertise note
// (kind:1, "zap N sats -> product by DM") for a new zap-to-unlock product. Prints
// the advertise note's event id to paste into vend-watcher/products.json as
// advertise_note_id, plus the product card's event id for reference. Does NOT
// touch products.json itself or know the delivery secret (asset URL / text) — that
// stays a deliberate manual step (16-multi-product-vend-design.md §3.2), so this
// script never sees or logs the sensitive delivery payload.
//
// Reuses NOSTR_PRIVATE_KEY + NOSTR_RELAYS already in ./.env (the signer that
// publishes every other storefront card in this project). Aborts unless the
// derived pubkey matches the expected npub.

import { readFileSync } from "node:fs";
import { finalizeEvent, SimplePool, nip19 } from "nostr-tools";

const EXPECTED_PUBKEY = "bb5058aa4c762326b2c02390063f99ace7a7e4c34955d810fb5f44b8de48f355";
const SHOPSTR_CACHE_URL = "https://shopstr.store/api/db/cache-event";

function parseArgs(argv) {
  const out = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--title") out.title = argv[++i];
    else if (a === "--price") out.price = Number(argv[++i]);
    else if (a === "--description") out.description = argv[++i];
    else if (a === "--image") out.image = argv[++i];
    else if (a === "--slug") out.slug = argv[++i];
    else if (a === "--dry-run") out.dryRun = true;
  }
  return out;
}

function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

const args = parseArgs(process.argv.slice(2));
if (!args.title || !args.price || !args.description || !args.image) {
  console.error('Usage: node list-product.mjs --title "..." --price <sats> --description "..." --image <url> [--slug <d-tag>] [--dry-run]');
  process.exit(1);
}
if (!Number.isInteger(args.price) || args.price <= 0) {
  console.error("ABORT: --price must be a positive integer (sats)");
  process.exit(1);
}
const slug = args.slug ?? slugify(args.title);

const env = {};
for (const line of readFileSync("./.env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const relays = (env.NOSTR_RELAYS || "").split(",").map((s) => s.trim()).filter(Boolean);
if (!env.NOSTR_PRIVATE_KEY) { console.error("ABORT: NOSTR_PRIVATE_KEY not found in ./.env"); process.exit(1); }
if (relays.length === 0) { console.error("ABORT: NOSTR_RELAYS empty in ./.env"); process.exit(1); }

const sk = env.NOSTR_PRIVATE_KEY.startsWith("nsec")
  ? nip19.decode(env.NOSTR_PRIVATE_KEY).data
  : Uint8Array.from(Buffer.from(env.NOSTR_PRIVATE_KEY, "hex"));

const now = Math.floor(Date.now() / 1000);

// ---- build + sign the product card (kind:30402) ----
const product = finalizeEvent(
  {
    kind: 30402,
    created_at: now,
    content: args.description,
    tags: [
      ["d", slug],
      ["alt", `Product listing: ${args.title}`],
      ["client", "marketplace-mcp"],
      ["title", args.title],
      ["summary", args.description],
      ["price", String(args.price), "sat"],
      ["location", ""],
      ["shipping", "N/A", "0", "sat"],
      ["image", args.image],
      ["t", "mcp"], ["t", "ai"], ["t", "lightning"], ["t", "bitcoin"], ["t", "shopstr"],
      ["status", "active"],
      ["published_at", String(now)],
    ],
  },
  sk,
);

// ---- GUARD: refuse to do anything if the key isn't the expected npub ----
if (product.pubkey !== EXPECTED_PUBKEY) {
  console.error(`ABORT: derived pubkey ${product.pubkey} != expected ${EXPECTED_PUBKEY}`);
  process.exit(1);
}
console.log("✓ pubkey guard OK:", product.pubkey);

// ---- build + sign the advertise note (kind:1) ----
const advertise = finalizeEvent(
  {
    kind: 1,
    created_at: now + 1,
    content: `⚡ zap ${args.price} sats to unlock: ${args.title}\n\n${args.description}\n\nZap this note ${args.price}+ sats from any client — verified on my own node, delivered by DM. No account, no checkout.`,
    tags: [["t", "shopstr"], ["t", "l402"], ["t", "lightning"]],
  },
  sk,
);

if (args.dryRun) {
  console.log("\n=== DRY RUN — nothing published ===");
  console.log("\n--- PRODUCT kind:30402 ---\n" + JSON.stringify(product, null, 2));
  console.log("\n--- ADVERTISE NOTE kind:1 ---\n" + JSON.stringify(advertise, null, 2));
  console.log(`\nrelays: ${relays.join(", ")}`);
  console.log("\nLooks right? Re-run WITHOUT --dry-run to publish.");
  process.exit(0);
}

const pool = new SimplePool();
async function publish(ev, label) {
  console.log(`\n[${label}] id=${ev.id}`);
  const results = await Promise.allSettled(pool.publish(relays, ev));
  results.forEach((res, i) => {
    console.log(`  ${res.status === "fulfilled" ? "OK  " : "FAIL"} ${relays[i]}` +
      (res.status === "rejected" ? ` :: ${res.reason}` : ""));
  });
  return results.filter((r) => r.status === "fulfilled").length;
}

(async () => {
  const okProduct = await publish(product, `PRODUCT kind:30402 "${slug}"`);

  try {
    const resp = await fetch(SHOPSTR_CACHE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(product),
    });
    console.log(`\n[CACHE POST] HTTP ${resp.status} :: ${(await resp.text()).slice(0, 160)}`);
  } catch (e) {
    console.log("[CACHE POST] error:", e.message);
  }

  const okNote = await publish(advertise, "ADVERTISE NOTE kind:1");

  console.log("\n=== SUMMARY ===");
  console.log(`product card:    ${okProduct}/${relays.length} relays, id=${product.id}`);
  console.log(`advertise note:  ${okNote}/${relays.length} relays, id=${advertise.id}`);
  console.log(`\n>>> Paste into vend-watcher/products.json as advertise_note_id: ${advertise.id}`);
  console.log(">>> Remember to add price_sats, name, and delivery {type, value} for this product manually.");

  pool.close(relays);
  setTimeout(() => process.exit(0), 500);
})();
