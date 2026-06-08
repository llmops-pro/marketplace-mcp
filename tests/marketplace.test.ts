import { describe, expect, it } from "vitest";
import {
  buildProductEvent,
  buildStallEvent,
  parseProductContent,
  parseStallContent,
  PRODUCT_KIND,
  STALL_KIND,
} from "../src/lib/marketplace.js";

describe("buildStallEvent", () => {
  it("constructs a kind:30017 event with `d` tag matching content.id", () => {
    const e = buildStallEvent({
      id: "stall-abc",
      name: "Sovereign Goods",
      description: "FOSS Lightning agents and other artifacts.",
      currency: "sat",
      shipping: [{ id: "ww", name: "Worldwide", cost: 0, regions: ["worldwide"] }],
    });
    expect(e.kind).toBe(STALL_KIND);
    expect(e.tags).toEqual([["d", "stall-abc"]]);
    const parsed = JSON.parse(e.content);
    expect(parsed.id).toBe("stall-abc");
    expect(parsed.name).toBe("Sovereign Goods");
    expect(parsed.shipping).toHaveLength(1);
  });
});

describe("buildProductEvent", () => {
  it("constructs a kind:30018 event with d tag + optional category t tags", () => {
    const e = buildProductEvent(
      {
        id: "prod-1",
        stall_id: "stall-abc",
        name: "nwc-mcp",
        description: "Lightning wallet for AI agents.",
        currency: "sat",
        price: 50000,
      },
      { categories: ["software", "lightning"] },
    );
    expect(e.kind).toBe(PRODUCT_KIND);
    expect(e.tags).toContainEqual(["d", "prod-1"]);
    expect(e.tags).toContainEqual(["t", "software"]);
    expect(e.tags).toContainEqual(["t", "lightning"]);
    const parsed = JSON.parse(e.content);
    expect(parsed.stall_id).toBe("stall-abc");
    expect(parsed.price).toBe(50000);
  });

  it("lowercases category tags", () => {
    const e = buildProductEvent(
      {
        id: "p",
        stall_id: "s",
        name: "n",
        currency: "sat",
        price: 1,
      },
      { categories: ["SOFTWARE", "Lightning"] },
    );
    expect(e.tags).toContainEqual(["t", "software"]);
    expect(e.tags).toContainEqual(["t", "lightning"]);
  });
});

describe("parseStallContent", () => {
  it("roundtrips a valid stall", () => {
    const e = buildStallEvent({
      id: "s",
      name: "Test",
      currency: "sat",
      shipping: [{ id: "z", name: "Z", cost: 100 }],
    });
    const back = parseStallContent(e.content);
    expect(back?.id).toBe("s");
    expect(back?.shipping[0]?.cost).toBe(100);
  });

  it("returns null on invalid JSON", () => {
    expect(parseStallContent("{not json")).toBeNull();
  });

  it("returns null on schema mismatch", () => {
    // Missing required `name`.
    expect(parseStallContent(JSON.stringify({ id: "x", currency: "sat" }))).toBeNull();
  });
});

describe("parseProductContent", () => {
  it("roundtrips a valid product", () => {
    const e = buildProductEvent({
      id: "p",
      stall_id: "s",
      name: "Test",
      currency: "sat",
      price: 21,
      specs: [["License", "MIT"]],
    });
    const back = parseProductContent(e.content);
    expect(back?.price).toBe(21);
    expect(back?.specs?.[0]).toEqual(["License", "MIT"]);
  });

  it("returns null on missing required fields", () => {
    // Missing `price` and `stall_id`.
    expect(parseProductContent(JSON.stringify({ id: "p", name: "n", currency: "sat" }))).toBeNull();
  });
});
