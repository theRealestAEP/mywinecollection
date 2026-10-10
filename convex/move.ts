import { v } from 'convex/values';
import { internalMutation } from './_generated/server';

// MOVE: run once, after the deploy that adds cellars. It puts the book from
// before cellars into a new cellar that belongs to this email: the title, the
// wines, the wines tried elsewhere, the log, the display and share keys, and
// the talk with the sommelier. It revokes the old owner keys, since sign-in
// takes their place.
//   npx convex run move:toCellars '{"owner": "you@example.com"}'
export const toCellars = internalMutation({
  args: { owner: v.string() },
  handler: async (ctx, args) => {
    const owner = args.owner.trim().toLowerCase();
    const settings = await ctx.db.query('settings').first();
    const cellar = await ctx.db.insert('cellars', { owner, title: settings?.title ?? 'My Cellar' });
    for (const wine of await ctx.db.query('wines').collect()) if (!wine.cellar) await ctx.db.patch(wine._id, { cellar });
    for (const wine of await ctx.db.query('wild').collect()) if (!wine.cellar) await ctx.db.patch(wine._id, { cellar });
    for (const drink of await ctx.db.query('drinks').collect()) if (!drink.cellar) await ctx.db.patch(drink._id, { cellar });
    for (const key of await ctx.db.query('accessKeys').collect()) {
      if (key.kind === 'owner') await ctx.db.delete(key._id);
      else if (!key.cellar) await ctx.db.patch(key._id, { cellar });
    }
    for (const message of await ctx.db.query('messages').collect()) if (!message.owner) await ctx.db.patch(message._id, { owner });
    if (settings) await ctx.db.delete(settings._id);
    return `The book is now the cellar ${cellar}, which belongs to ${owner}.`;
  },
});
