import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { wildFields, wineFields } from './schema';

// Admin functions for a cellar's wines. Find a cellar's ID with cellars:list.

const wine = v.object(wineFields);

// Loads a collection in the wines.json format into a cellar: sets the
// cellar's title and adds its wines and its wines in the wild. With
// `replace`, it deletes the cellar's wines first; without it, it stops if
// the cellar already has wines. scripts/import-wines.mjs calls this.
export const importCollection = internalMutation({
  args: { cellarId: v.id('cellars'), title: v.string(), wines: v.array(wine), wild: v.optional(v.array(v.object(wildFields))), replace: v.boolean() },
  handler: async (ctx, { cellarId, title, wines, wild = [], replace }) => {
    const existing = [
      ...(await ctx.db
        .query('wines')
        .withIndex('by_cellar', (q) => q.eq('cellar', cellarId))
        .collect()),
      ...(await ctx.db
        .query('wild')
        .withIndex('by_cellar', (q) => q.eq('cellar', cellarId))
        .collect()),
    ];
    if (existing.length && !replace) {
      throw new Error(`The cellar already has ${existing.length} wines. Import with --replace to replace them.`);
    }
    for (const each of existing) await ctx.db.delete(each._id);
    await ctx.db.patch(cellarId, { title });
    for (const each of wines) await ctx.db.insert('wines', { ...each, cellar: cellarId });
    for (const each of wild) await ctx.db.insert('wild', { ...each, cellar: cellarId });
    return `${wines.length} cellar wines and ${wild.length} wines in the wild imported.`;
  },
});

// A cellar in the wines.json format, for backups:
//   npx convex run wines:exportCollection '{"cellarId": "…"}' > backup.json
export const exportCollection = internalQuery({
  args: { cellarId: v.id('cellars') },
  handler: async (ctx, { cellarId }) => {
    const cellar = await ctx.db.get(cellarId);
    const wines = await ctx.db
      .query('wines')
      .withIndex('by_cellar', (q) => q.eq('cellar', cellarId))
      .collect();
    const wild = await ctx.db
      .query('wild')
      .withIndex('by_cellar', (q) => q.eq('cellar', cellarId))
      .collect();
    return {
      title: cellar?.title ?? '',
      wines: wines.map(({ _id, _creationTime, cellar, ...fields }) => fields),
      wild: wild.map(({ _id, _creationTime, cellar, ...fields }) => fields),
    };
  },
});

// A cellar's wines with their IDs, to find a wine to change.
//   npx convex run wines:list '{"cellarId": "…"}'
export const list = internalQuery({
  args: { cellarId: v.id('cellars') },
  handler: async (ctx, { cellarId }) => {
    const wines = await ctx.db
      .query('wines')
      .withIndex('by_cellar', (q) => q.eq('cellar', cellarId))
      .collect();
    return wines.map(({ _id, producer, name, vintage, quantity }) => ({ _id, producer, name, vintage, quantity }));
  },
});

export const add = internalMutation({
  args: { cellarId: v.id('cellars'), wine },
  handler: async (ctx, { cellarId, wine }) => ctx.db.insert('wines', { ...wine, cellar: cellarId }),
});

// Changes some fields of a wine, for example {"quantity": 1}. The schema
// checks the changed wine when it is saved.
export const update = internalMutation({
  args: { wineId: v.id('wines'), changes: v.any() },
  handler: async (ctx, { wineId, changes }) => {
    await ctx.db.patch(wineId, changes);
  },
});
