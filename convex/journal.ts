import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import type { DatabaseReader, QueryCtx } from './_generated/server';
import { internalMutation, internalQuery, mutation, query } from './_generated/server';
import { findAccessKey } from './keys';
import { wildFields, wineFields } from './schema';

// The owner's side of the book. On the Sommelier page, the owner sends the
// sommelier (sommelier.ts) photos, videos, voice notes and text; the
// sommelier reads them and changes the book through the internal functions
// below. The page's functions need an owner key.

const file = v.object({
  storageId: v.id('_storage'),
  kind: v.union(v.literal('image'), v.literal('audio'), v.literal('video')),
});

// A wine's own fields, without the bottle count.
const { quantity, ...wineDetails } = wineFields;

async function checkOwner(db: DatabaseReader, key: string) {
  const accessKey = await findAccessKey(db, key);
  if (accessKey?.kind !== 'owner') throw new Error('This link cannot change the book. Use the Sommelier link.');
}

// A message, with a link to each of its files.
async function withLinks(ctx: QueryCtx, message: Doc<'messages'>) {
  const files = await Promise.all(
    (message.files ?? []).map(async (each) => ({ kind: each.kind, url: (await ctx.storage.getUrl(each.storageId)) ?? '' })),
  );
  return { ...message, files };
}

// ---- The Sommelier page ----------------------------------------------------

// A place to upload one photo, video or voice note.
export const uploadUrl = mutation({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    await checkOwner(ctx.db, key);
    return ctx.storage.generateUploadUrl();
  },
});

// Sends the owner's message to the sommelier. The date is the owner's own
// date, YYYY-MM-DD, for the drinking log.
export const send = mutation({
  args: { key: v.string(), text: v.string(), date: v.string(), files: v.array(file) },
  handler: async (ctx, { key, text, date, files }) => {
    await checkOwner(ctx.db, key);
    await ctx.db.insert('messages', { from: 'owner', text, date, files, status: 'waiting' });
    await ctx.scheduler.runAfter(0, internal.sommelier.respond, {});
  },
});

// The latest talk, oldest first.
export const talk = query({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    await checkOwner(ctx.db, key);
    const latest = await ctx.db.query('messages').order('desc').take(50);
    return Promise.all(latest.reverse().map((message) => withLinks(ctx, message)));
  },
});

// ---- The sommelier's own functions -----------------------------------------

// Marks the waiting messages as read, and returns them. The sommelier reads
// one batch at a time: while it reads, newer messages wait for it. A read that
// started over half an hour ago has failed, since an action stops after ten
// minutes.
export const takeWaiting = internalMutation({
  args: {},
  handler: async (ctx) => {
    const withStatus = (status: 'waiting' | 'reading') =>
      ctx.db
        .query('messages')
        .withIndex('by_status', (q) => q.eq('status', status))
        .collect();
    const reading = await withStatus('reading');
    if (reading.some((message) => Date.now() - message._creationTime < 30 * 60_000)) return [];
    for (const message of reading) await ctx.db.patch(message._id, { status: 'failed' });
    const waiting = await withStatus('waiting');
    for (const message of waiting) await ctx.db.patch(message._id, { status: 'reading' });
    return waiting.map((message) => message._id);
  },
});

// The latest talk for the sommelier, oldest first.
export const recentTalk = internalQuery({
  args: {},
  handler: async (ctx) => {
    const latest = await ctx.db.query('messages').order('desc').take(20);
    return Promise.all(latest.reverse().map((message) => withLinks(ctx, message)));
  },
});

// What Deepgram heard in a message's voice notes and videos.
export const setTranscript = internalMutation({
  args: { messageId: v.id('messages'), transcript: v.string() },
  handler: async (ctx, { messageId, transcript }) => {
    await ctx.db.patch(messageId, { transcript });
  },
});

// The sommelier's reply. The messages it read are done, or failed.
export const reply = internalMutation({
  args: { text: v.string(), read: v.array(v.id('messages')), failed: v.boolean() },
  handler: async (ctx, { text, read, failed }) => {
    for (const messageId of read) await ctx.db.patch(messageId, { status: failed ? 'failed' : 'done' });
    await ctx.db.insert('messages', { from: 'sommelier', text });
  },
});

// ---- The sommelier's tools -------------------------------------------------

// Lower case and without accents, so that "chateau" finds "Château".
function plain(text: string) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// The wines whose producer, name, vintage or region hold every word of the
// query. An empty query finds every wine.
export const findWines = internalQuery({
  args: { query: v.string() },
  handler: async (ctx, { query }) => {
    const words = plain(query).split(/\s+/).filter(Boolean);
    const matches = (wine: Doc<'wines'> | Doc<'wild'>) =>
      words.every((word) => plain(`${wine.producer} ${wine.name} ${wine.vintage ?? 'NV'} ${wine.region ?? ''}`).includes(word));
    const cellar = (await ctx.db.query('wines').collect()).filter(matches);
    const tried = (await ctx.db.query('wild').collect()).filter(matches);
    return [
      ...cellar.map((wine) => ({ id: wine._id, list: 'cellar', producer: wine.producer, name: wine.name, vintage: wine.vintage ?? null, bottles: wine.quantity })),
      ...tried.map((wine) => ({ id: wine._id, list: 'tried elsewhere', producer: wine.producer, name: wine.name, vintage: wine.vintage ?? null })),
    ];
  },
});

export const addToCellar = internalMutation({
  args: { wine: v.object(wineDetails), bottles: v.number() },
  handler: async (ctx, { wine, bottles }) => {
    const wineId = await ctx.db.insert('wines', { ...wine, quantity: bottles });
    return `Added to the cellar with ${bottles} bottles. Its id is ${wineId}.`;
  },
});

export const addBottles = internalMutation({
  args: { wineId: v.id('wines'), bottles: v.number() },
  handler: async (ctx, { wineId, bottles }) => {
    const wine = await ctx.db.get(wineId);
    if (!wine) throw new Error('No wine in the cellar has this id.');
    await ctx.db.patch(wineId, { quantity: wine.quantity + bottles });
    return `The cellar now has ${wine.quantity + bottles} bottles of this wine.`;
  },
});

// Takes one bottle off the count, and logs it. A wine with no bottles left
// stays in the book, in the archive.
export const openBottle = internalMutation({
  args: { wineId: v.id('wines'), date: v.string(), where: v.optional(v.string()), notes: v.optional(v.string()) },
  handler: async (ctx, { wineId, ...drink }) => {
    const wine = await ctx.db.get(wineId);
    if (!wine) throw new Error('No wine in the cellar has this id.');
    if (wine.quantity < 1) throw new Error('The cellar has no bottles of this wine left.');
    await ctx.db.patch(wineId, { quantity: wine.quantity - 1 });
    await ctx.db.insert('drinks', { wine: wineId, ...drink });
    return `Logged. ${wine.quantity - 1} bottles left.`;
  },
});

// Logs a wine tried somewhere else. A wine not yet in the book is added to
// the wines tried elsewhere.
export const logTried = internalMutation({
  args: {
    wineId: v.optional(v.union(v.id('wines'), v.id('wild'))),
    wine: v.optional(v.object(wildFields)),
    date: v.string(),
    where: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { wineId, wine, ...drink }) => {
    const id = wineId ?? (wine && (await ctx.db.insert('wild', { ...wine, tasted: drink.date, where: drink.where })));
    if (!id) throw new Error('Give the id of a wine in the book, or the wine to add.');
    await ctx.db.insert('drinks', { wine: id, ...drink });
    return `Logged. The wine's id is ${id}.`;
  },
});

// Changes some fields of a wine. The schema checks the changed wine.
export const updateWine = internalMutation({
  args: { wineId: v.union(v.id('wines'), v.id('wild')), changes: v.any() },
  handler: async (ctx, { wineId, changes }) => {
    await ctx.db.patch(wineId, changes);
    return 'Changed.';
  },
});
