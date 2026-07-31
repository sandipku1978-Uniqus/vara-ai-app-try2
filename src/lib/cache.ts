import { kv } from '@vercel/kv';

export interface CacheOptions {
  ex?: number; // Expiration time in seconds
}

export const cacheService = {
  async get<T>(key: string): Promise<T | null> {
    try {
      const data = await kv.get<T>(key);
      return data;
    } catch (error) {
      console.error(`KV GET Error for key ${key}:`, error);
      return null;
    }
  },

  async set<T>(key: string, value: T, options?: CacheOptions): Promise<void> {
    try {
      if (options?.ex) {
        await kv.set(key, value, { ex: options.ex });
      } else {
        await kv.set(key, value);
      }
    } catch (error) {
      console.error(`KV SET Error for key ${key}:`, error);
    }
  },

  async invalidate(key: string): Promise<void> {
    try {
      await kv.del(key);
    } catch (error) {
      console.error(`KV INVAL Error for key ${key}:`, error);
    }
  }
};
