import type { DatabaseReader } from './_generated/server';

// Access keys are random secrets. The database stores only their SHA-256 hash.
export async function hashKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// The access key that a key opens, or null for an unknown or revoked key.
export async function findAccessKey(db: DatabaseReader, key: string) {
  const keyHash = await hashKey(key);
  return db
    .query('accessKeys')
    .withIndex('by_key_hash', (q) => q.eq('keyHash', keyHash))
    .unique();
}
