import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { DatabaseReader, QueryCtx } from './_generated/server';
import { internalMutation, internalQuery, mutation, query } from './_generated/server';
import { signedIn } from './auth';
import { wildFields, wineFields } from './schema';

// The owner's talk with the sommelier. In the app, a signed-in person sends
// the sommelier (sommelier.ts) photos, videos, voice notes and text. The
// sommelier reads them and answers, and changes that person's cellars through
// the internal functions below. Each of these takes the owner's email, and
// works only on that owner's cellars.

const file = v.object({
  storageId: v.id('_storage'),
  kind: v.union(v.literal('image'), v.literal('audio'), v.literal('video')),
});

// A wine's own fields, without the bottle count.
const { quantity, ...wineDetails } = wineFields;

// A message, with a link to each of its files.
async function withLinks(ctx: QueryCtx, message: Doc<'messages'>) {
  const files = await Promise.all(
    (message.files ?? []).map(async (each) => ({ kind: each.kind, url: (await ctx.storage.getUrl(each.storageId)) ?? '' })),
  );
  return { ...message, files };
}

async function latestTalk(ctx: QueryCtx, owner: string, count: number) {
  const latest = await ctx.db
    .query('messages')
    .withIndex('by_owner', (q) => q.eq('owner', owner))
    .order('desc')
    .take(count);
  return Promise.all(latest.reverse().map((message) => withLinks(ctx, message)));
}

// ---- The app ---------------------------------------------------------------

// A place to upload one photo, video or voice note.
export const uploadUrl = mutation({
  args: { session: v.string() },
  handler: async (ctx, { session }) => {
    await signedIn(ctx.db, session);
    return ctx.storage.generateUploadUrl();
  },
});

// Sends a message to the sommelier. The date is the owner's own date,
// YYYY-MM-DD, for the drinking log.
export const send = mutation({
  args: { session: v.string(), text: v.string(), date: v.string(), files: v.array(file) },
  handler: async (ctx, { session, text, date, files }) => {
    const owner = await signedIn(ctx.db, session);
    await ctx.db.insert('messages', { owner, from: 'owner', text, date, files, status: 'waiting' });
    await ctx.scheduler.runAfter(0, internal.sommelier.respond, { owner });
  },
});

// The latest talk, oldest first.
export const talk = query({
  args: { session: v.string() },
  handler: async (ctx, { session }) => latestTalk(ctx, await signedIn(ctx.db, session), 50),
});

// ---- The sommelier's own functions -----------------------------------------

// Marks the owner's waiting messages as read, and returns them. The sommelier
// reads one batch at a time for each owner: while it reads, newer messages
// wait for it. A read that started over half an hour ago has failed, since an
// action stops after ten minutes.
export const takeWaiting = internalMutation({
  args: { owner: v.string() },
  handler: async (ctx, { owner }) => {
    const withStatus = (status: 'waiting' | 'reading') =>
      ctx.db
        .query('messages')
        .withIndex('by_owner_and_status', (q) => q.eq('owner', owner).eq('status', status))
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
  args: { owner: v.string() },
  handler: async (ctx, { owner }) => latestTalk(ctx, owner, 20),
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
  args: { owner: v.string(), text: v.string(), read: v.array(v.id('messages')), failed: v.boolean() },
  handler: async (ctx, { owner, text, read, failed }) => {
    for (const messageId of read) await ctx.db.patch(messageId, { status: failed ? 'failed' : 'done' });
    await ctx.db.insert('messages', { owner, from: 'sommelier', text });
  },
});

// ---- The sommelier's tools -------------------------------------------------

async function ownCellar(db: DatabaseReader, owner: string, cellarId: Id<'cellars'>) {
  const cellar = await db.get(cellarId);
  if (cellar?.owner !== owner) throw new Error('No cellar of yours has this id. Call list_cellars to see them.');
  return cellar;
}

async function ownWine<T extends 'wines' | 'wild'>(db: DatabaseReader, owner: string, wineId: Id<T>) {
  const wine = await db.get(wineId);
  if (!wine?.cellar) throw new Error('No wine has this id. Look for it with find_wines.');
  const cellar = await ownCellar(db, owner, wine.cellar);
  return { wine, cellar };
}

async function cellarsOf(db: DatabaseReader, owner: string) {
  return db
    .query('cellars')
    .withIndex('by_owner', (q) => q.eq('owner', owner))
    .collect();
}

// Lower case and without accents, so that "chateau" finds "Château".
function plain(text: string) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// All the words about a wine, for search: the same words as the book's search.
function searchText(wine: Doc<'wines'> | Doc<'wild'>) {
  const words = [
    wine.producer,
    wine.name,
    wine.vintage ?? 'NV',
    wine.region,
    wine.country,
    ...wine.grapes,
    wine.type,
    wine.place,
    wine.history,
    wine.contents,
    wine.aromas,
    wine.food,
    wine.notes,
    'tasted' in wine ? wine.tasted : undefined,
    'where' in wine ? wine.where : undefined,
  ];
  return plain(words.filter(Boolean).join(' '));
}

export const listCellars = internalQuery({
  args: { owner: v.string() },
  handler: async (ctx, { owner }) => {
    const cellars = await cellarsOf(ctx.db, owner);
    return Promise.all(
      cellars.map(async (cellar) => {
        const wines = await ctx.db
          .query('wines')
          .withIndex('by_cellar', (q) => q.eq('cellar', cellar._id))
          .collect();
        const stocked = wines.filter((wine) => wine.quantity);
        return { id: cellar._id, title: cellar.title, wines_with_bottles: stocked.length, bottles: stocked.reduce((sum, wine) => sum + wine.quantity, 0) };
      }),
    );
  },
});

export const createCellar = internalMutation({
  args: { owner: v.string(), title: v.string() },
  handler: async (ctx, { owner, title }) => {
    const cellarId = await ctx.db.insert('cellars', { owner, title });
    return `Made the cellar "${title}". Its id is ${cellarId}.`;
  },
});

export const renameCellar = internalMutation({
  args: { owner: v.string(), cellarId: v.id('cellars'), title: v.string() },
  handler: async (ctx, { owner, cellarId, title }) => {
    await ownCellar(ctx.db, owner, cellarId);
    await ctx.db.patch(cellarId, { title });
    return 'Renamed.';
  },
});

// The wines, in one cellar or in all the owner's cellars, that hold every
// word of the query in any of their fields. An empty query finds every wine.
export const findWines = internalQuery({
  args: { owner: v.string(), query: v.string(), cellarId: v.optional(v.id('cellars')) },
  handler: async (ctx, { owner, query, cellarId }) => {
    const cellars = cellarId ? [await ownCellar(ctx.db, owner, cellarId)] : await cellarsOf(ctx.db, owner);
    const words = plain(query).split(/\s+/).filter(Boolean);
    const matches = (wine: Doc<'wines'> | Doc<'wild'>) => {
      const text = searchText(wine);
      return words.every((word) => text.includes(word));
    };
    const found = [];
    for (const cellar of cellars) {
      const wines = await ctx.db
        .query('wines')
        .withIndex('by_cellar', (q) => q.eq('cellar', cellar._id))
        .collect();
      const wild = await ctx.db
        .query('wild')
        .withIndex('by_cellar', (q) => q.eq('cellar', cellar._id))
        .collect();
      for (const wine of wines.filter(matches)) {
        found.push({ id: wine._id, cellar: cellar.title, list: wine.quantity ? 'cellar' : 'archive', producer: wine.producer, name: wine.name, vintage: wine.vintage ?? null, bottles: wine.quantity });
      }
      for (const wine of wild.filter(matches)) {
        found.push({ id: wine._id, cellar: cellar.title, list: 'tried elsewhere', producer: wine.producer, name: wine.name, vintage: wine.vintage ?? null, tasted: wine.tasted, where: wine.where });
      }
    }
    return found;
  },
});

// Everything about one wine, with its cellar and its entries in the log.
export const getWine = internalQuery({
  args: { owner: v.string(), wineId: v.union(v.id('wines'), v.id('wild')) },
  handler: async (ctx, { owner, wineId }) => {
    const { wine, cellar } = await ownWine(ctx.db, owner, wineId);
    const log = (
      await ctx.db
        .query('drinks')
        .withIndex('by_cellar', (q) => q.eq('cellar', cellar._id))
        .collect()
    ).filter((drink) => drink.wine === wineId);
    const { _id, _creationTime, cellar: _, ...fields } = wine;
    return { id: _id, cellar: cellar.title, ...fields, log: log.map(({ date, where, notes }) => ({ date, where, notes })) };
  },
});

// The drinking log, newest first, in one cellar or in all the owner's
// cellars, from and to a date (YYYY-MM-DD) when given.
export const readLog = internalQuery({
  args: { owner: v.string(), cellarId: v.optional(v.id('cellars')), from: v.optional(v.string()), to: v.optional(v.string()) },
  handler: async (ctx, { owner, cellarId, from = '', to = '9999' }) => {
    const cellars = cellarId ? [await ownCellar(ctx.db, owner, cellarId)] : await cellarsOf(ctx.db, owner);
    const entries = [];
    for (const cellar of cellars) {
      const drinks = await ctx.db
        .query('drinks')
        .withIndex('by_cellar', (q) => q.eq('cellar', cellar._id))
        .collect();
      for (const drink of drinks.filter((each) => each.date >= from && each.date <= to)) {
        const wine = await ctx.db.get(drink.wine);
        entries.push({ date: drink.date, cellar: cellar.title, wine_id: drink.wine, wine: wine && `${wine.producer}, ${wine.name}, ${wine.vintage ?? 'NV'}`, where: drink.where, notes: drink.notes });
      }
    }
    return entries.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100);
  },
});

export const addToCellar = internalMutation({
  args: { owner: v.string(), cellarId: v.id('cellars'), wine: v.object(wineDetails), bottles: v.number() },
  handler: async (ctx, { owner, cellarId, wine, bottles }) => {
    const cellar = await ownCellar(ctx.db, owner, cellarId);
    const wineId = await ctx.db.insert('wines', { ...wine, quantity: bottles, cellar: cellarId });
    return `Added to ${cellar.title} with ${bottles} bottles. Its id is ${wineId}.`;
  },
});

export const addBottles = internalMutation({
  args: { owner: v.string(), wineId: v.id('wines'), bottles: v.number() },
  handler: async (ctx, { owner, wineId, bottles }) => {
    const { wine, cellar } = await ownWine(ctx.db, owner, wineId);
    await ctx.db.patch(wineId, { quantity: wine.quantity + bottles });
    return `${cellar.title} now has ${wine.quantity + bottles} bottles of this wine.`;
  },
});

// Takes one bottle off the count, and logs it. A wine with no bottles left
// stays in the book, in the archive.
export const openBottle = internalMutation({
  args: { owner: v.string(), wineId: v.id('wines'), date: v.string(), where: v.optional(v.string()), notes: v.optional(v.string()) },
  handler: async (ctx, { owner, wineId, ...drink }) => {
    const { wine, cellar } = await ownWine(ctx.db, owner, wineId);
    if (wine.quantity < 1) throw new Error('This cellar has no bottles of this wine left.');
    await ctx.db.patch(wineId, { quantity: wine.quantity - 1 });
    await ctx.db.insert('drinks', { cellar: cellar._id, wine: wineId, ...drink });
    return `Logged. ${wine.quantity - 1} bottles left in ${cellar.title}.`;
  },
});

// Logs a wine tried somewhere else. A wine already in the book is logged by
// its id; a new one is added to the cellar's wines tried elsewhere.
export const logTried = internalMutation({
  args: {
    owner: v.string(),
    cellarId: v.optional(v.id('cellars')),
    wineId: v.optional(v.union(v.id('wines'), v.id('wild'))),
    wine: v.optional(v.object(wildFields)),
    date: v.string(),
    where: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { owner, cellarId, wineId, wine, ...drink }) => {
    if (wineId) {
      const { cellar } = await ownWine(ctx.db, owner, wineId);
      await ctx.db.insert('drinks', { cellar: cellar._id, wine: wineId, ...drink });
      return `Logged in ${cellar.title}.`;
    }
    if (!wine || !cellarId) throw new Error('Give the id of a wine in the book, or the wine to add and the cellar to log it in.');
    const cellar = await ownCellar(ctx.db, owner, cellarId);
    const id = await ctx.db.insert('wild', { ...wine, tasted: drink.date, where: drink.where, cellar: cellarId });
    await ctx.db.insert('drinks', { cellar: cellarId, wine: id, ...drink });
    return `Logged in ${cellar.title}. The wine's id is ${id}.`;
  },
});

// Changes some fields of a wine. The schema checks the changed wine.
export const updateWine = internalMutation({
  args: { owner: v.string(), wineId: v.union(v.id('wines'), v.id('wild')), changes: v.any() },
  handler: async (ctx, { owner, wineId, changes }) => {
    await ownWine(ctx.db, owner, wineId);
    if ('cellar' in changes) throw new Error('A wine cannot move to another cellar.');
    await ctx.db.patch(wineId, changes);
    return 'Changed.';
  },
});
