import { z } from "zod";

const boolish = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const csv = z
  .string()
  .optional()
  .transform((v) =>
    v
      ? v
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
  );

const positiveInt = z.coerce.number().int().positive();

const ConfigSchema = z
  .object({
    // Signer — provide AT MOST ONE. If neither: server runs in forced read-only
    // (list_my_* tools work; create/update tools refuse).
    NOSTR_PRIVATE_KEY: z.string().optional(),
    NOSTR_NIP46_URI: z.string().optional(),

    // Relays — required.
    NOSTR_RELAYS: csv,

    // Optional safety knobs (same patterns as nostr-ops-mcp; KindAllowlist is omitted
    // because the marketplace only ever publishes kinds 30017/30018/30019/30402
    // — kinds are hard-coded in the tool implementations).
    NOSTR_READ_ONLY: boolish,
    NOSTR_REQUIRE_CONFIRM: boolish,
    NOSTR_MAX_EVENTS_PER_MINUTE: positiveInt.default(10),

    // Shopstr cache mirror. shopstr.store's UI does not read from open relays —
    // it reads from its own Postgres DB, populated via HTTP POSTs to
    // /api/db/cache-event. Without this, kind:30019/30402 events are invisible
    // on the storefront. Default URL is the public Shopstr instance.
    SHOPSTR_CACHE_ENABLED: boolish,
    SHOPSTR_CACHE_URL: z
      .string()
      .url()
      .default("https://shopstr.store/api/db/cache-event"),

    // Logging.
    NOSTR_LOG_PATH: z.string().default("./marketplace-mcp.log"),
    NOSTR_AUDIT_PATH: z.string().default("./marketplace-mcp-audit.log"),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.NOSTR_PRIVATE_KEY && cfg.NOSTR_NIP46_URI) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["NOSTR_PRIVATE_KEY"],
        message:
          "Set NOSTR_PRIVATE_KEY or NOSTR_NIP46_URI, not both. NIP-46 is recommended.",
      });
    }
    if (cfg.NOSTR_RELAYS.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["NOSTR_RELAYS"],
        message: "NOSTR_RELAYS must list at least one wss:// relay.",
      });
    }
    for (const url of cfg.NOSTR_RELAYS) {
      if (!url.startsWith("wss://") && !url.startsWith("ws://")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["NOSTR_RELAYS"],
          message: `Relay "${url}" must use ws:// or wss:// scheme.`,
        });
      }
    }
  });

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    process.stderr.write(
      `marketplace-mcp: invalid configuration:\n${issues}\n\nSet the required env vars and try again.\n`,
    );
    process.exit(1);
  }
  if (parsed.data.NOSTR_PRIVATE_KEY) {
    process.stderr.write(
      "marketplace-mcp: NOSTR_PRIVATE_KEY is set (nsec on disk). For production / buyer setups, prefer NOSTR_NIP46_URI.\n",
    );
  }
  return parsed.data;
}

export function hasSigner(config: Config): boolean {
  return Boolean(config.NOSTR_PRIVATE_KEY || config.NOSTR_NIP46_URI);
}
