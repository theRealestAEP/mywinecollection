import { internalMutation } from './_generated/server';

// MOVE: run once, after the deploy that adds chats. It puts each person's talk
// from before chats into one chat, "Earlier talk".
//   npx convex run move:toChats
export const toChats = internalMutation({
  args: {},
  handler: async (ctx) => {
    const messages = (await ctx.db.query('messages').collect()).filter((message) => !message.chat);
    const owners = [...new Set(messages.map((message) => message.owner))];
    for (const owner of owners) {
      const theirs = messages.filter((message) => message.owner === owner);
      const updated = Math.max(...theirs.map((message) => message._creationTime));
      const chat = await ctx.db.insert('chats', { owner, title: 'Earlier talk', updated });
      for (const message of theirs) await ctx.db.patch(message._id, { chat });
    }
    return `Moved ${messages.length} messages into ${owners.length} chats.`;
  },
});
