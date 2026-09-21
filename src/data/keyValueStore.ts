/**
 * The persistence seam.
 *
 * Repositories are written against this tiny interface rather than against
 * AsyncStorage, which keeps them testable in Node and keeps the door open for a
 * Supabase-backed implementation without touching any calling code (PRD §28).
 */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export class MemoryKeyValueStore implements KeyValueStore {
  private readonly map = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }
  async setItem(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }
  async removeItem(key: string): Promise<void> {
    this.map.delete(key);
  }
}
