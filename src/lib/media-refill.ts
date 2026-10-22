// The light product list sends every photo and document as a placeholder —
// { data: "", hasData: true } — and the real bytes load later, per product.
// A form seeded from that light copy carries those placeholders; saving it
// would overwrite the real files with nothing. This refills each placeholder
// from the bytes already in memory (matched by id) before anything is saved.

import type { MediaItem, Product } from "./store";

type Item = MediaItem & { hasData?: boolean };
const isPlaceholder = (m: Item | undefined) => !!m && !m.data && m.hasData === true;

// Every media list on a product: photos/videos in working, documents per slot.
function lists(p: Product): Item[][] {
  const w = (p.working ?? {}) as Partial<Product["working"]>;
  const docs = (p.logistics?.docImages ?? {}) as Record<string, Item[]>;
  return [w.productMedia, w.sampleMedia, w.packagingMedia, ...Object.values(docs)]
    .filter(Array.isArray) as Item[][];
}

// Returns `next` with placeholders refilled from `prev`. A placeholder `prev`
// has no bytes for is left as a placeholder — never turned into fake data.
export function refillStrippedMedia(next: Product, prev: Product): Product {
  const bytes = new Map<string, string>();
  for (const list of lists(prev)) for (const m of list) if (m?.data) bytes.set(m.id, m.data);

  const fix = (list: Item[] | undefined) =>
    Array.isArray(list)
      ? list.map((m) => {
          if (!isPlaceholder(m)) return m;
          const data = bytes.get(m.id);
          if (!data) return m;
          const { hasData: _drop, ...rest } = m;
          void _drop;
          return { ...rest, data };
        })
      : list;

  const w = next.working;
  const docs = next.logistics?.docImages;
  const product: Product = {
    ...next,
    working: w && {
      ...w,
      productMedia: fix(w.productMedia) as MediaItem[],
      sampleMedia: fix(w.sampleMedia) as MediaItem[],
      packagingMedia: fix(w.packagingMedia) as MediaItem[],
    },
    logistics: next.logistics && {
      ...next.logistics,
      docImages: docs
        ? Object.fromEntries(Object.entries(docs).map(([k, v]) => [k, fix(v as Item[]) as MediaItem[]]))
        : docs,
    },
  };
  return product;
}
