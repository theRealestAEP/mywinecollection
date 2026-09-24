import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { wildFields, wineFields } from './schema';
import { saveTitle } from './settings';

// Admin functions for wines, until the phone app can make these changes.

const wine = v.object(wineFields);

// Loads a collection in the wines.json format: sets the title and adds the
// cellar's wines and the wines in the wild. With `replace`, it deletes the
// book's wines first; without it, it stops if the book already has wines.
// scripts/import-wines.mjs calls this.
export const importCollection = internalMutation({
  args: { title: v.string(), wines: v.array(wine), wild: v.optional(v.array(v.object(wildFields))), replace: v.boolean() },
  handler: async (ctx, { title, wines, wild = [], replace }) => {
    const existing = [...(await ctx.db.query('wines').collect()), ...(await ctx.db.query('wild').collect())];
    if (existing.length && !replace) {
      throw new Error(`The book already has ${existing.length} wines. Import with --replace to replace them.`);
    }
    for (const each of existing) await ctx.db.delete(each._id);
    await saveTitle(ctx.db, title);
    for (const each of wines) await ctx.db.insert('wines', each);
    for (const each of wild) await ctx.db.insert('wild', each);
    return `${wines.length} cellar wines and ${wild.length} wines in the wild imported.`;
  },
});

// The book in the wines.json format, for backups:
//   npx convex run wines:exportCollection > backup.json
export const exportCollection = internalQuery({
  args: {},
  handler: async (ctx) => {
    const settings = await ctx.db.query('settings').first();
    const wines = await ctx.db.query('wines').collect();
    const wild = await ctx.db.query('wild').collect();
    return {
      title: settings?.title ?? 'Wine Portraits',
      wines: wines.map(({ _id, _creationTime, ...fields }) => fields),
      wild: wild.map(({ _id, _creationTime, ...fields }) => fields),
    };
  },
});

// The wines with their IDs, to find a wine to change.
//   npx convex run wines:list
export const list = internalQuery({
  args: {},
  handler: async (ctx) => {
    const wines = await ctx.db.query('wines').collect();
    return wines.map(({ _id, producer, name, vintage, quantity }) => ({ _id, producer, name, vintage, quantity }));
  },
});

export const add = internalMutation({
  args: { wine },
  handler: async (ctx, { wine }) => ctx.db.insert('wines', wine),
});

// Changes some fields of a wine, for example {"quantity": 1}. The schema
// checks the changed wine when it is saved.
export const update = internalMutation({
  args: { wineId: v.id('wines'), changes: v.any() },
  handler: async (ctx, { wineId, changes }) => {
    await ctx.db.patch(wineId, changes);
  },
});
