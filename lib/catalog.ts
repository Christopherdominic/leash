import type { Product } from "./types";

/**
 * Product search. Uses Channel3's universal product catalog when
 * CHANNEL3_API_KEY is set, otherwise a built-in demo catalog so the app works
 * with no keys at all.
 */

const CHANNEL3_URL = "https://api.trychannel3.com/v1/search";

type C3Price = { price: number; currency: string };
type C3Offer = { url: string; domain: string; price: C3Price; availability?: string };
type C3Product = {
  id: string;
  title: string;
  brands?: { id: string; name: string }[];
  images?: { url: string; cleaned_url?: string | null; is_main_image?: boolean }[];
  category?: { slug: string; title: string; path?: { slug?: string; title?: string }[] } | null;
  offers?: C3Offer[];
};

export function catalogSource() {
  return process.env.CHANNEL3_API_KEY ? "channel3" : "demo";
}

export async function searchProducts(query: string, maxPrice?: number, limit = 6): Promise<Product[]> {
  if (!process.env.CHANNEL3_API_KEY) return searchDemo(query, maxPrice, limit);

  const body: Record<string, unknown> = { query, limit: Math.min(limit, 30) };
  if (maxPrice) body.filters = { price: { max_price: maxPrice } };

  const res = await fetch(CHANNEL3_URL, {
    method: "POST",
    headers: { "x-api-key": process.env.CHANNEL3_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // If the price filter shape is rejected, retry without filters rather than failing the agent.
    if (body.filters && res.status === 422) return searchProducts(query, undefined, limit);
    throw new Error(`Channel3 search failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as { products?: C3Product[] };
  return (data.products ?? []).map(fromChannel3).filter((p): p is Product => p !== null).slice(0, limit);
}

function fromChannel3(p: C3Product): Product | null {
  const offers = p.offers ?? [];
  const offer =
    offers.find((o) => o.price?.currency === "USD" && o.availability !== "OutOfStock") ?? offers[0];
  if (!offer?.price) return null;
  const cats = [
    p.category?.title,
    p.category?.slug,
    ...(p.category?.path ?? []).flatMap((c) => [c.title, c.slug]),
  ]
    .filter((x): x is string => Boolean(x))
    .map((x) => x.toLowerCase().replace(/-/g, " "));
  const img = p.images?.find((i) => i.is_main_image) ?? p.images?.[0];
  return {
    id: `c3_${p.id}`,
    title: p.title,
    brand: p.brands?.[0]?.name,
    categories: Array.from(new Set(cats)),
    price: offer.price.price,
    currency: offer.price.currency,
    url: offer.url,
    merchant: offer.domain,
    image: img?.cleaned_url ?? img?.url,
  };
}

// ---------------------------------------------------------------------------
// Demo catalog (no API key needed). Deliberately includes items that trip
// different rules so the demo shows allow / ask / block.
// ---------------------------------------------------------------------------

const DEMO: Product[] = [
  p("oat-milk", "Oatly Oat Milk, Full Fat, 64 oz", "Oatly", ["grocery", "dairy alternatives"], 5.49),
  p("eggs", "Organic Free-Range Large Eggs, 12 ct", "Vital Farms", ["grocery", "eggs"], 6.99),
  p("rice", "Jasmine Rice, 10 lb Bag", "Royal", ["grocery", "rice & grains"], 14.99),
  p("plantain-chips", "Plantain Chips, Lightly Salted, 6-Pack", "Olu Olu", ["grocery", "snacks"], 11.5),
  p("coffee", "Whole Bean Coffee, Medium Roast, 2 lb", "Kicking Horse", ["grocery", "coffee"], 18.99),
  p("detergent", "Laundry Detergent Pods, 81 ct", "Tide", ["household", "laundry"], 21.99),
  p("paper-towels", "Paper Towels, 12 Double Rolls", "Bounty", ["household", "paper goods"], 32.49),
  p("toothpaste", "Whitening Toothpaste, 3-Pack", "Colgate", ["personal care", "oral care"], 9.97),
  p("notebook", "Hardcover Dotted Notebook, A5", "Leuchtturm1917", ["office", "notebooks"], 24.95),
  p("book-atomic", "Atomic Habits (Hardcover)", "Avery", ["book", "self help"], 16.2),
  p("air-fryer", "5.8 Qt Air Fryer", "Cosori", ["home", "kitchen appliances"], 89.99),
  p("blender", "Professional Blender 1000W", "Ninja", ["home", "kitchen appliances"], 99.99),
  p("headphones", "Wireless Noise Cancelling Headphones", "Sony", ["electronics", "audio"], 278.0),
  p("sneakers", "Air Force 1 '07 Sneakers", "Nike", ["apparel", "shoes"], 115.0),
  p("wine", "Cabernet Sauvignon Red Wine, 750 ml", "Josh Cellars", ["grocery", "wine"], 14.99),
  p("gift-card", "Amazon Gift Card $100", "Amazon", ["gift card"], 100.0),
  p("game", "Video Game Console Bundle", "Nintendo", ["electronics", "gaming"], 349.99),
];

function p(id: string, title: string, brand: string, categories: string[], price: number): Product {
  return { id: `demo_${id}`, title, brand, categories, price, currency: "USD", merchant: "demo-store.example" };
}

function searchDemo(query: string, maxPrice?: number, limit = 6): Product[] {
  const stem = (w: string) => w.replace(/(es|s)$/, "");
  const stop = new Set(["the", "and", "for", "some", "buy", "get", "need", "want", "order", "bottle", "pack"]);
  const words = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2 && !stop.has(w)).map(stem);
  const scored = DEMO.map((prod) => {
    const hay = new Set([prod.title, prod.brand, ...prod.categories].join(" ").toLowerCase().split(/\W+/).map(stem));
    const score = words.reduce((s, w) => s + (hay.has(w) ? 1 : 0), 0);
    return { prod, score };
  })
    .filter((x) => x.score > 0 && (!maxPrice || x.prod.price <= maxPrice))
    .sort((a, b) => b.score - a.score || a.prod.price - b.prod.price);
  return scored.slice(0, limit).map((x) => x.prod);
}
