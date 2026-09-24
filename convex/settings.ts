import { v } from 'convex/values';
import type { DatabaseWriter } from './_generated/server';
import { internalMutation } from './_generated/server';

// Saves the name on the cover in the one settings row.
export async function saveTitle(db: DatabaseWriter, title: string) {
  const settings = await db.query('settings').first();
  if (settings) await db.patch(settings._id, { title });
  else await db.insert('settings', { title });
}

// Changes the name on the cover. Open screens show the new name right away.
//   npx convex run settings:setTitle '{"title": "The Cellar"}'
export const setTitle = internalMutation({
  args: { title: v.string() },
  handler: async (ctx, { title }) => {
    await saveTitle(ctx.db, title);
  },
});
