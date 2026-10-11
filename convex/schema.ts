import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

// One Convex deployment holds the cellars of the people on its list. Each
// person signs in with their email and has their own cellars and their own
// talk with the sommelier. Each cellar is a book: its wines, its wines tried
// elsewhere, its drinking log, and the keys that open it on a screen.

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
  // A cellar belongs to one person, by their email. Its title is the name on
  // the book's cover.
  cellars: defineTable({
    owner: v.string(),
    title: v.string(),
  }).index('by_owner', ['owner']),

  // Every wine ever logged in a cellar. A wine with no bottles left stays
  // here, and the book shows it in the archive.
  wines: defineTable({ ...wineFields, cellar: v.id('cellars') }).index('by_cellar', ['cellar']),

  // Wine in the wild: wines tried somewhere else, kept in a cellar's book.
  wild: defineTable({ ...wildFields, cellar: v.id('cellars') }).index('by_cellar', ['cellar']),

  // A cellar's drinking log: one entry for each bottle opened from the
  // cellar, and for each wine tried somewhere else. The date is YYYY-MM-DD.
  drinks: defineTable({
    cellar: v.id('cellars'),
    wine: v.union(v.id('wines'), v.id('wild')),
    date: v.string(),
    where: v.optional(v.string()),
    notes: v.optional(v.string()),
  }).index('by_cellar', ['cellar']),

  // Each person's talk with the sommelier, the agent that keeps their
  // cellars. The owner sends text, photos, videos and voice notes; the
  // sommelier replies. An owner's message waits until the sommelier reads it.
  // The date is the owner's own date when they sent it, YYYY-MM-DD.
  messages: defineTable({
    owner: v.string(),
    from: v.union(v.literal('owner'), v.literal('sommelier')),
    text: v.string(),
    date: v.optional(v.string()),
    files: v.optional(
      v.array(
        v.object({
          storageId: v.id('_storage'),
          kind: v.union(v.literal('image'), v.literal('audio'), v.literal('video')),
        }),
      ),
    ),
    // What the owner was looking at in the app when they sent it.
    context: v.optional(v.string()),
    // What Deepgram heard in the voice notes and videos.
    transcript: v.optional(v.string()),
    status: v.optional(v.union(v.literal('waiting'), v.literal('reading'), v.literal('done'), v.literal('failed'))),
  })
    .index('by_owner', ['owner'])
    .index('by_owner_and_status', ['owner', 'status']),

  // A key opens one cellar's book, read-only, with no sign-in. A "display" is
  // a tablet at home and a "share" is a link for friends. The database keeps
  // a hash of each key, never the key itself.
  accessKeys: defineTable({
    cellar: v.id('cellars'),
    kind: v.union(v.literal('display'), v.literal('share')),
    name: v.string(),
    keyHash: v.string(),
  }).index('by_key_hash', ['keyHash']),

  // Sign-in. A person asks for a link on a device, and the email brings them
  // the link. When they open it, anywhere, the device that asked is signed
  // in: on an iPhone, the home-screen app does not share its storage with
  // Safari, where the link opens. The device made the session secret, and
  // the login keeps its hash until the link is opened. The code is a number
  // that both the device and the link's page show, so that a person can see
  // the link is for their own device.
  logins: defineTable({
    email: v.string(),
    linkHash: v.string(),
    sessionHash: v.string(),
    code: v.string(),
    expires: v.number(),
  }).index('by_link_hash', ['linkHash']),

  // A signed-in device. A session lasts until the person signs out there, or
  // their email leaves the list.
  sessions: defineTable({
    email: v.string(),
    secretHash: v.string(),
  }).index('by_secret_hash', ['secretHash']),
});
