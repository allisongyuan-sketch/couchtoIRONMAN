/**
 * Small, dependency-free id generator.
 *
 * Deliberately not `crypto.randomUUID`: that is unavailable in some React Native
 * runtimes without a polyfill, and the core must stay platform-agnostic.
 * Collision resistance here only needs to hold within a single user's device.
 */
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function createId(prefix: string): string {
  let out = '';
  for (let i = 0; i < 12; i += 1) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return `${prefix}_${Date.now().toString(36)}${out}`;
}

/** Canonical key used to dedupe movements across workouts (see Exercise catalog). */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
