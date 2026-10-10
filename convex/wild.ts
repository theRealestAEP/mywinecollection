import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { wildFields } from './schema';

// Admin functions for a cellar's wine in the wild: wines tried somewhere else.
//   npx convex run wild:add '{"cellarId": "…", "wine": {"producer": "…", …, "tasted": "2026-09-20", "where": "…"}}'

export const add = internalMutation({
  args: { cellarId: v.id('cellars'), wine: v.object(wildFields) },
  handler: async (ctx, { cellarId, wine }) => ctx.db.insert('wild', { ...wine, cellar: cellarId }),
});

// A cellar's wines in the wild with their IDs, to find one to change.
export const list = internalQuery({
  args: { cellarId: v.id('cellars') },
  handler: async (ctx, { cellarId }) => {
    const wines = await ctx.db
      .query('wild')
      .withIndex('by_cellar', (q) => q.eq('cellar', cellarId))
      .collect();
    return wines.map(({ _id, producer, name, vintage, tasted, where }) => ({ _id, producer, name, vintage, tasted, where }));
  },
});

// Changes some fields of a wine in the wild. The schema checks the changed
// wine when it is saved.
export const update = internalMutation({
  args: { wildId: v.id('wild'), changes: v.any() },
  handler: async (ctx, { wildId, changes }) => {
    await ctx.db.patch(wildId, changes);
  },
});
