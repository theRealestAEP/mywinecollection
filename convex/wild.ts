import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { wildFields } from './schema';

// Admin functions for wine in the wild: wines you tried somewhere else.
//   npx convex run wild:add '{"wine": {"producer": "…", …, "tasted": "2026-09-20", "where": "…"}}'

export const add = internalMutation({
  args: { wine: v.object(wildFields) },
  handler: async (ctx, { wine }) => ctx.db.insert('wild', wine),
});

// The wines in the wild with their IDs, to find one to change.
export const list = internalQuery({
  args: {},
  handler: async (ctx) => {
    const wines = await ctx.db.query('wild').collect();
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
