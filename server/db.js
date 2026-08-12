import { MongoClient } from "mongodb";

let client;
let db;

export async function connectDb() {
  if (db) return db;
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("Missing MONGODB_URI in environment (.env)");
  }
  client = new MongoClient(uri);
  await client.connect();
  // Users live in the `ava` database
  db = client.db("ava");
  await db.collection("users").createIndex({ email: 1 }, { unique: true });
  return db;
}

export function getDb() {
  if (!db) throw new Error("Database not connected");
  return db;
}

export async function closeDb() {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}
