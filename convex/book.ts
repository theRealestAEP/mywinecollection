import { v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import type { DatabaseReader } from './_generated/server';
import { query } from './_generated/server';
import { findEmail } from './auth';
import { findAccessKey } from './keys';

// Everything a screen needs to draw a cellar's book: the title, the cellar's
// wines, the wines tried elsewhere, and the drinking log, newest first.
export async function bookOf(db: DatabaseReader, cellar: Doc<'cellars'>) {
  const [wines, wild, drinks] = await Promise.all([
    db
      .query('wines')
      .withIndex('by_cellar', (q) => q.eq('cellar', cellar._id))
      .collect(),
    db
      .query('wild')
      .withIndex('by_cellar', (q) => q.eq('cellar', cellar._id))
      .collect(),
    db
      .query('drinks')
      .withIndex('by_cellar', (q) => q.eq('cellar', cellar._id))
      .collect(),
  ]);
  drinks.sort((a, b) => b.date.localeCompare(a.date) || b._creationTime - a._creationTime);
  return { title: cellar.title, wines, wild, drinks };
}

// The book that an access key opens, read-only, with no sign-in. Returns
// null for an unknown or revoked key.
export const get = query({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const accessKey = await findAccessKey(ctx.db, key);
    const cellar = accessKey?.cellar && (await ctx.db.get(accessKey.cellar));
    if (!accessKey || !cellar) return null;
    return { ...(await bookOf(ctx.db, cellar)), owner: false };
  },
});

// The book of one of the signed-in person's cellars. Returns null when they
// are not signed in, or the cellar is not theirs.
export const ofCellar = query({
  args: { session: v.string(), cellarId: v.id('cellars') },
  handler: async (ctx, { session, cellarId }) => {
    const email = await findEmail(ctx.db, session);
    const cellar = await ctx.db.get(cellarId);
    if (!email || cellar?.owner !== email) return null;
    return { ...(await bookOf(ctx.db, cellar)), owner: true };
  },
});
