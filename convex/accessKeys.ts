import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalAction, internalMutation, internalQuery } from './_generated/server';
import { hashKey } from './keys';

// Admin functions for access keys. A key is shown only once, when it is made;
// open the book at https://…/?key=<key>.
//   npx convex run accessKeys:create '{"kind": "display", "name": "Dining room"}'
//   npx convex run accessKeys:create '{"kind": "share", "name": "For Sam"}'

const kind = v.union(v.literal('display'), v.literal('share'));

export const create = internalAction({
  args: { kind, name: v.string() },
  handler: async (ctx, { kind, name }): Promise<string> => {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const key = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    await ctx.runMutation(internal.accessKeys.insert, { kind, name, keyHash: await hashKey(key) });
    return key;
  },
});

export const insert = internalMutation({
  args: { kind, name: v.string(), keyHash: v.string() },
  handler: async (ctx, accessKey) => {
    await ctx.db.insert('accessKeys', accessKey);
  },
});

// The keys, without their secrets.
export const list = internalQuery({
  args: {},
  handler: async (ctx) => {
    const keys = await ctx.db.query('accessKeys').collect();
    return keys.map(({ _id, kind, name }) => ({ _id, kind, name }));
  },
});

// Stops a key from working. Screens that use it show an error at once.
//   npx convex run accessKeys:revoke '{"accessKeyId": "…"}'
export const revoke = internalMutation({
  args: { accessKeyId: v.id('accessKeys') },
  handler: async (ctx, { accessKeyId }) => {
    await ctx.db.delete(accessKeyId);
  },
});
