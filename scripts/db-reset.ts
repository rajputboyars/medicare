/** Wipes the MongoDB database named in MONGODB_URI and loads the demo seed. Usage: npm run db:reset */
import mongoose from "mongoose";
import { resetMongoStore } from "../src/server/persistence";
import { db } from "../src/server/store";

/** Never print credentials: mongodb+srv://user:password@host/... becomes mongodb+srv://***@host/... */
const redact = (u: string) => u.replace(/\/\/[^@/]*@/, "//***@");

async function main() {
  const uri = process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/medicare";
  if (/prod/i.test(uri) && process.env.FORCE !== "1") throw new Error(`Refusing to reset what looks like a production database (${redact(uri)}). Set FORCE=1 to override.`);
  await resetMongoStore();
  const d = db();
  console.log(`Seeded ${redact(uri)}: ${d.medicines.length} medicines, ${d.pharmacies.length} pharmacies, ${d.users.length} users, ${d.orders.length} orders.`);
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
