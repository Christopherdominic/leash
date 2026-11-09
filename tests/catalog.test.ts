import { describe, expect, it } from "vitest";
import { searchProducts } from "../lib/catalog";

describe("demo catalog", () => {
  it("matches whole words (air fryer is not dairy)", async () => {
    const r = await searchProducts("an air fryer");
    expect(r[0].title).toMatch(/Air Fryer/);
    expect(r.some((p) => p.title.includes("Oat Milk"))).toBe(false);
  });
  it("handles plurals and multiword queries", async () => {
    expect((await searchProducts("eggs"))[0].title).toMatch(/Eggs/);
    expect((await searchProducts("noise cancelling headphones"))[0].title).toMatch(/Headphones/);
    expect((await searchProducts("laundry pods"))[0].title).toMatch(/Laundry/);
  });
});
