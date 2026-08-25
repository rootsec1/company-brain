import { migrate } from "drizzle-orm/postgres-js/migrator";
import { resolve } from "node:path";
import { config } from "../src/lib/config";
import { db, sql } from "../src/lib/db";
import { workspaces } from "../src/lib/db/schema";
import { ensureBucket } from "../src/lib/services/storage";
import { ensureTypesenseCollection } from "../src/lib/services/typesense";

async function bootstrap() {
  console.info("[bootstrap] applying database migrations");
  await migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  await db.insert(workspaces).values({
    id: config.app.workspaceId,
    name: config.app.name
  }).onConflictDoNothing();
  console.info("[bootstrap] creating object storage bucket");
  await ensureBucket();
  console.info("[bootstrap] creating search collections");
  await ensureTypesenseCollection();
  console.info("[bootstrap] ready");
}

bootstrap()
  .then(() => sql.end())
  .catch(async (error) => {
    console.error("[bootstrap] failed", error);
    await sql.end();
    process.exit(1);
  });
