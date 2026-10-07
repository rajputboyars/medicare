import mongoose from "mongoose";

const g = globalThis as unknown as { __mongo?: { conn?: typeof mongoose; promise?: Promise<typeof mongoose> } };
const cache = (g.__mongo ??= {});

/** Cached connection (safe for Next.js hot reload and serverless). Used when DATA_SOURCE=mongo. */
export async function connectMongo(): Promise<typeof mongoose> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  if (cache.conn) return cache.conn;
  cache.promise ??= mongoose.connect(uri, { bufferCommands: false, maxPoolSize: 10, serverSelectionTimeoutMS: 8000 });
  cache.conn = await cache.promise;
  return cache.conn;
}
