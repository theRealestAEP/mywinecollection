import { v } from 'convex/values';
import { query } from './_generated/server';
import { hashKey } from './keys';

// Everything a screen needs to draw the book: the title, the cellar's wines,
// the wines in the wild, and which kind of key opened it. Returns null for an
// unknown or revoked key.
export const get = query({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const keyHash = await hashKey(key);
    const accessKey = await ctx.db
      .query('accessKeys')
      .withIndex('by_key_hash', (q) => q.eq('keyHash', keyHash))
      .unique();
    if (!accessKey) return null;
    const settings = await ctx.db.query('settings').first();
    const wines = await ctx.db.query('wines').collect();
    const wild = await ctx.db.query('wild').collect();
    return { title: settings?.title ?? 'Wine Portraits', kind: accessKey.kind, wines, wild };
  },
});
