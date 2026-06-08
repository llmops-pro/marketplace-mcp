import { describe, expect, it } from "vitest";
import {
  buildListingEvent,
  buildShopProfileEvent,
  NIP99_PRODUCT_KIND,
  parseListingTags,
  parseShopProfileContent,
  SHOP_PROFILE_KIND,
} from "../src/lib/shopstr.js";

// LLMOps.Pro pubkey (hex form of npub1hdg932jvwc3jdvkqywgqv0ue4nn60exrf92asy8mtazt3hjg7d2s2yw0nw).
const TEST_PUBKEY = "bb5058aa4c762326b2c02390063f99ace7a7e4c34955d810fb5f44b8de48f355";

describe("buildShopProfileEvent", () => {
  it("constructs a kind:30019 event with d=<pubkey hex>", () => {
    const e = buildShopProfileEvent({
      pubkey_hex: TEST_PUBKEY,
      name: "LLMOps.Pro",
      about: "Sovereign AI agent tools.",
    });
    expect(e.kind).toBe(SHOP_PROFILE_KIND);
    expect(e.tags).toEqual([["d", TEST_PUBKEY]]);
    const parsed = JSON.parse(e.content);
    expect(parsed.name).toBe("LLMOps.Pro");
    expect(parsed.merchants).toEqual([TEST_PUBKEY]);
    expect(parsed.ui).toEqual({
      picture: "",
      banner: "",
      theme: "",
      darkMode: false,
    });
  });

  it("includes picture and banner in ui when supplied", () => {
    const e = buildShopProfileEvent({
      pubkey_hex: TEST_PUBKEY,
      name: "x",
      picture: "https://example.com/p.png",
      banner: "https://example.com/b.png",
    });
    const parsed = JSON.parse(e.content);
    expect(parsed.ui.picture).toBe("https://example.com/p.png");
    expect(parsed.ui.banner).toBe("https://example.com/b.png");
  });

  it("rejects a non-64-hex pubkey", () => {
    expect(() =>
      buildShopProfileEvent({ pubkey_hex: "abc", name: "x" }),
    ).toThrow(/64 hex/);
  });
});

describe("parseShopProfileContent", () => {
  it("roundtrips the built content", () => {
    const e = buildShopProfileEvent({
      pubkey_hex: TEST_PUBKEY,
      name: "Test",
      about: "About",
    });
    const back = parseShopProfileContent(e.content);
    expect(back?.name).toBe("Test");
    expect(back?.merchants).toEqual([TEST_PUBKEY]);
  });

  it("returns null when merchants is missing", () => {
    expect(parseShopProfileContent(JSON.stringify({ name: "x" }))).toBeNull();
  });
});

describe("buildListingEvent", () => {
  it("constructs a kind:30402 event with required NIP-99 tags", () => {
    const e = buildListingEvent({
      id: "nwc-mcp",
      pubkey_hex: TEST_PUBKEY,
      name: "nwc-mcp",
      summary: "A Lightning wallet for AI agents.",
      price: 50000,
      currency: "sat",
      location: "online",
      shipping: { option: "Free", cost: 0, currency: "sat" },
      images: ["https://example.com/img.png"],
      categories: ["software", "lightning"],
    });
    expect(e.kind).toBe(NIP99_PRODUCT_KIND);
    expect(e.content).toBe("A Lightning wallet for AI agents.");
    expect(e.tags).toContainEqual(["d", "nwc-mcp"]);
    expect(e.tags).toContainEqual(["title", "nwc-mcp"]);
    expect(e.tags).toContainEqual([
      "summary",
      "A Lightning wallet for AI agents.",
    ]);
    expect(e.tags).toContainEqual(["price", "50000", "sat"]);
    expect(e.tags).toContainEqual(["location", "online"]);
    expect(e.tags).toContainEqual(["shipping", "Free", "0", "sat"]);
    expect(e.tags).toContainEqual(["image", "https://example.com/img.png"]);
    expect(e.tags).toContainEqual(["t", "software"]);
    expect(e.tags).toContainEqual(["t", "lightning"]);
    // Shopstr feed marker.
    expect(e.tags).toContainEqual(["t", "shopstr"]);
    // `published_at` is always added.
    expect(e.tags.some((t) => t[0] === "published_at")).toBe(true);
  });

  it("lowercases category tags", () => {
    const e = buildListingEvent({
      id: "p",
      pubkey_hex: TEST_PUBKEY,
      name: "n",
      price: 1,
      currency: "sat",
      shipping: { option: "N/A" },
      categories: ["SOFTWARE", "Lightning"],
    });
    expect(e.tags).toContainEqual(["t", "software"]);
    expect(e.tags).toContainEqual(["t", "lightning"]);
  });

  it("does not duplicate the shopstr marker if already present", () => {
    const e = buildListingEvent({
      id: "p",
      pubkey_hex: TEST_PUBKEY,
      name: "n",
      price: 1,
      currency: "sat",
      shipping: { option: "N/A" },
      categories: ["shopstr"],
    });
    const shopstrTags = e.tags.filter(
      (t) => t[0] === "t" && t[1] === "shopstr",
    );
    expect(shopstrTags).toHaveLength(1);
  });

  it("omits optional tags when their inputs are absent", () => {
    const e = buildListingEvent({
      id: "p",
      pubkey_hex: TEST_PUBKEY,
      name: "n",
      price: 1,
      currency: "sat",
      shipping: { option: "N/A" },
    });
    expect(e.tags.some((t) => t[0] === "quantity")).toBe(false);
    expect(e.tags.some((t) => t[0] === "condition")).toBe(false);
    expect(e.tags.some((t) => t[0] === "status")).toBe(false);
    expect(e.tags.some((t) => t[0] === "valid_until")).toBe(false);
  });

  it("rejects a non-64-hex pubkey", () => {
    expect(() =>
      buildListingEvent({
        id: "p",
        pubkey_hex: "abc",
        name: "n",
        price: 1,
        currency: "sat",
        shipping: { option: "N/A" },
      }),
    ).toThrow(/64 hex/);
  });
});

describe("parseListingTags", () => {
  it("extracts the common fields", () => {
    const e = buildListingEvent({
      id: "p",
      pubkey_hex: TEST_PUBKEY,
      name: "Product",
      summary: "desc",
      price: 21,
      currency: "sat",
      location: "online",
      shipping: { option: "Free", cost: 0 },
      images: ["https://a.example/x.png", "https://a.example/y.png"],
      categories: ["a", "b"],
      quantity: 5,
      status: "active",
    });
    const parsed = parseListingTags(e.tags);
    expect(parsed.d).toBe("p");
    expect(parsed.title).toBe("Product");
    expect(parsed.summary).toBe("desc");
    expect(parsed.price).toEqual({ amount: 21, currency: "sat" });
    expect(parsed.location).toBe("online");
    expect(parsed.shipping).toEqual({
      option: "Free",
      cost: 0,
      currency: "sat",
    });
    expect(parsed.images).toEqual([
      "https://a.example/x.png",
      "https://a.example/y.png",
    ]);
    // categories includes "shopstr" because the builder auto-adds it.
    expect(parsed.categories).toContain("a");
    expect(parsed.categories).toContain("b");
    expect(parsed.categories).toContain("shopstr");
    expect(parsed.quantity).toBe(5);
    expect(parsed.status).toBe("active");
  });
});
