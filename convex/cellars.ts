import { v } from 'convex/values';
import { internalMutation, internalQuery, query } from './_generated/server';
import { findEmail } from './auth';

// The signed-in person's home in the app: their email and their cellars, each
// with its bottle count, and a few wines to draw on the welcome page. Returns
// null when no one is signed in.
export const home = query({
  args: { session: v.string() },
  handler: async (ctx, { session }) => {
    const email = await findEmail(ctx.db, session);
    if (!email) return null;
    const cellars = await ctx.db
      .query('cellars')
      .withIndex('by_owner', (q) => q.eq('owner', email))
      .collect();
    const shelves = await Promise.all(
      cellars.map(async (cellar) => {
        const wines = await ctx.db
          .query('wines')
          .withIndex('by_cellar', (q) => q.eq('cellar', cellar._id))
          .collect();
        const stocked = wines.filter((wine) => wine.quantity);
        return {
          _id: cellar._id,
          title: cellar.title,
          wines: stocked.length,
          bottles: stocked.reduce((sum, wine) => sum + wine.quantity, 0),
          plates: stocked.slice(0, 10).map(({ producer, name, vintage, bottle, type }) => ({ producer, name, vintage, bottle, type })),
        };
      }),
    );
    return { email, cellars: shelves.map(({ plates, ...shelf }) => shelf), plates: shelves.flatMap((shelf) => shelf.plates) };
  },
});

// Admin functions for cellars. The owner is the email of the person it
// belongs to; the sommelier can also make and rename cellars.
//   npx convex run cellars:create '{"owner": "you@example.com", "title": "The Cellar"}'
//   npx convex run cellars:rename '{"cellarId": "…", "title": "The Cellar"}'
//   npx convex run cellars:setOwner '{"cellarId": "…", "owner": "you@example.com"}'

export const create = internalMutation({
  args: { owner: v.string(), title: v.string() },
  handler: async (ctx, { owner, title }) => ctx.db.insert('cellars', { owner: owner.trim().toLowerCase(), title }),
});

export const list = internalQuery({
  args: {},
  handler: async (ctx) => {
    const cellars = await ctx.db.query('cellars').collect();
    return cellars.map(({ _id, owner, title }) => ({ _id, owner, title }));
  },
});

export const rename = internalMutation({
  args: { cellarId: v.id('cellars'), title: v.string() },
  handler: async (ctx, { cellarId, title }) => {
    await ctx.db.patch(cellarId, { title });
  },
});

// Gives a cellar to another person, by their email.
export const setOwner = internalMutation({
  args: { cellarId: v.id('cellars'), owner: v.string() },
  handler: async (ctx, { cellarId, owner }) => {
    await ctx.db.patch(cellarId, { owner: owner.trim().toLowerCase() });
  },
});
