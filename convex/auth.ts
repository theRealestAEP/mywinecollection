import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import type { DatabaseReader } from './_generated/server';
import { action, internalMutation, mutation, query } from './_generated/server';
import { hashKey, randomKey } from './keys';

// Sign-in by email (see the logins and sessions tables in schema.ts).
// It needs these environment variables in Convex:
//   ALLOWED_EMAILS  the emails that can sign in, with commas between them
//   SITE_URL        the site's address, for the link, for example https://….workers.dev
//   RESEND_API_KEY  sends the email. Without it, the link goes to the Convex logs.
//   EMAIL_FROM      optional: the sender, for example Wine Journal <journal@example.com>

// A link works once, for 15 minutes.
const LINK_LIFE = 15 * 60_000;

function allowed(email: string) {
  const list = (process.env.ALLOWED_EMAILS ?? '').split(',').map((each) => each.trim().toLowerCase());
  return list.includes(email);
}

// The email of the person signed in with this session secret, or null.
export async function findEmail(db: DatabaseReader, session: string): Promise<string | null> {
  const secretHash = await hashKey(session);
  const row = await db
    .query('sessions')
    .withIndex('by_secret_hash', (q) => q.eq('secretHash', secretHash))
    .unique();
  return row && allowed(row.email) ? row.email : null;
}

// The same, for a change: it stops when no one is signed in.
export async function signedIn(db: DatabaseReader, session: string): Promise<string> {
  const email = await findEmail(db, session);
  if (!email) throw new ConvexError('Sign in again.');
  return email;
}

// Emails a sign-in link. The device sends the session secret that it made;
// when the link is opened, that secret signs the device in. Returns the code
// for the device to show, or a problem to show instead.
export const sendLink = action({
  args: { email: v.string(), session: v.string() },
  handler: async (ctx, args): Promise<{ code: string } | { problem: string }> => {
    const email = args.email.trim().toLowerCase();
    if (!allowed(email)) return { problem: 'This email cannot sign in to this wine journal.' };
    const link = randomKey();
    const code = String(1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000));
    await ctx.runMutation(internal.auth.saveLogin, {
      email,
      linkHash: await hashKey(link),
      sessionHash: await hashKey(args.session),
      code,
      expires: Date.now() + LINK_LIFE,
    });
    const url = `${process.env.SITE_URL}/?login=${link}`;
    if (!process.env.RESEND_API_KEY) {
      console.log(`There is no RESEND_API_KEY, so no email went out. The sign-in link for ${email}: ${url}`);
      return { code };
    }
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM ?? 'Wine Journal <onboarding@resend.dev>',
        to: [email],
        subject: 'Sign in to your wine journal',
        text: `Open this link to sign in to your wine journal:\n\n${url}\n\nThe link works once, for 15 minutes. If you did not ask to sign in, you can ignore this email.`,
      }),
    });
    if (!response.ok) {
      console.error(`Resend could not send the email: ${response.status} ${await response.text()}`);
      return { problem: 'The email did not go out. Try again in a minute.' };
    }
    return { code };
  },
});

export const saveLogin = internalMutation({
  args: { email: v.string(), linkHash: v.string(), sessionHash: v.string(), code: v.string(), expires: v.number() },
  handler: async (ctx, login) => {
    await ctx.db.insert('logins', login);
  },
});

async function findLogin(db: DatabaseReader, link: string) {
  const linkHash = await hashKey(link);
  const login = await db
    .query('logins')
    .withIndex('by_link_hash', (q) => q.eq('linkHash', linkHash))
    .unique();
  return login && login.expires > Date.now() ? login : null;
}

// What the link's page shows: whose link it is, and the device's code. Null
// for a link that was used or is too old.
export const login = query({
  args: { link: v.string() },
  handler: async (ctx, { link }) => {
    const login = await findLogin(ctx.db, link);
    return login && { email: login.email, code: login.code };
  },
});

// Signs in the device that asked for the link. Returns false for a link that
// was used or is too old.
export const approve = mutation({
  args: { link: v.string() },
  handler: async (ctx, { link }) => {
    const login = await findLogin(ctx.db, link);
    if (!login) return false;
    await ctx.db.insert('sessions', { email: login.email, secretHash: login.sessionHash });
    await ctx.db.delete(login._id);
    return true;
  },
});

export const signOut = mutation({
  args: { session: v.string() },
  handler: async (ctx, { session }) => {
    const secretHash = await hashKey(session);
    const row = await ctx.db
      .query('sessions')
      .withIndex('by_secret_hash', (q) => q.eq('secretHash', secretHash))
      .unique();
    if (row) await ctx.db.delete(row._id);
  },
});
