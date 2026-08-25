import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "@/lib/config";
import * as schema from "@/lib/db/schema";

const globalForDb = globalThis as unknown as { sql?: ReturnType<typeof postgres> };

export const sql = globalForDb.sql ?? postgres(config.services.postgresUrl, {
  max: process.env.NODE_ENV === "production" ? config.services.postgresPoolMax : Math.min(5, config.services.postgresPoolMax),
  idle_timeout: 20,
  connect_timeout: 5,
  prepare: false
});

if (process.env.NODE_ENV !== "production") globalForDb.sql = sql;

export const db = drizzle(sql, { schema });
