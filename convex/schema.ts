import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

// One Convex deployment holds one book: its settings, its wines, and the
// keys that let screens read it.

const level = v.optional(v.number()); // 1 (low) to 5 (high)

// The fields of one wine. They match the wine object in shared/wines.schema.json.
export const wineFields = {
  producer: v.string(),
  name: v.string(),
  vintage: v.optional(v.union(v.number(), v.null())),
  region: v.optional(v.string()),
  country: v.optional(v.string()),
  grapes: v.array(v.string()),
  type: v.union(v.literal('red'), v.literal('white'), v.literal('rosé'), v.literal('sparkling'), v.literal('fortified')),
  alcohol: v.optional(v.number()),
  bottle: v.union(v.literal('bordeaux'), v.literal('burgundy'), v.literal('champagne'), v.literal('flute'), v.literal('port')),
  quantity: v.number(),
  window: v.optional(v.array(v.number())),
  place: v.optional(v.string()),
  history: v.optional(v.string()),
  contents: v.optional(v.string()),
  aromas: v.optional(v.string()),
  structure: v.optional(v.object({ sweetness: level, acidity: level, tannin: level, body: level, finish: level })),
  food: v.optional(v.string()),
  rating: v.optional(v.number()),
  // Your own notes. On the wine's page, they take the place of place,
  // history and contents.
  notes: v.optional(v.string()),
  sketch: v.optional(
    v.object({
      capsule: v.optional(v.string()),
      neck: v.optional(v.string()),
      shoulder: v.optional(v.string()),
      label: v.optional(v.string()),
      glass: v.optional(v.string()),
      base: v.optional(v.string()),
    }),
  ),
};

// A wine tried somewhere else: the same fields, without a bottle count, plus
// when and where you tried it.
const { quantity, ...wildBase } = wineFields;
export const wildFields = {
  ...wildBase,
  tasted: v.optional(v.string()),
  where: v.optional(v.string()),
};

export default defineSchema({
  // One row. The title is the name on the cover, and it can change at any time.
  settings: defineTable({
    title: v.string(),
  }),

  // Every wine ever logged in the cellar. A wine with no bottles left stays
  // here, and the book shows it in the archive.
  wines: defineTable(wineFields),

  // Wine in the wild: wines you tried somewhere else.
  wild: defineTable(wildFields),

  // A key lets one screen read the book, and nothing more. A "display" is a
  // tablet at home; a "share" is a view-only link for friends. The database
  // keeps a hash of each key, never the key itself.
  accessKeys: defineTable({
    kind: v.union(v.literal('display'), v.literal('share')),
    name: v.string(),
    keyHash: v.string(),
  }).index('by_key_hash', ['keyHash']),
});
