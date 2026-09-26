import { v } from 'convex/values';
import { query } from './_generated/server';
import { findAccessKey } from './keys';

// Everything a screen needs to draw the book: the title, the cellar's wines,
// the wines in the wild, the drinking log (newest first), and which kind of
// key opened it. Returns null for an unknown or revoked key.
export const get = query({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const accessKey = await findAccessKey(ctx.db, key);
    if (!accessKey) return null;
    const settings = await ctx.db.query('settings').first();
    const wines = await ctx.db.query('wines').collect();
    const wild = await ctx.db.query('wild').collect();
    const drinks = await ctx.db.query('drinks').collect();
    drinks.sort((a, b) => b.date.localeCompare(a.date) || b._creationTime - a._creationTime);
    return { title: settings?.title ?? 'Wine Portraits', kind: accessKey.kind, wines, wild, drinks };
  },
});
