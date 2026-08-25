import { and, eq } from "drizzle-orm";
import { config } from "@/lib/config";
import { db } from "@/lib/db";
import { connections, sources } from "@/lib/db/schema";

export async function ensureImportedConnection(toolkit: string, name: string) {
  const existingSource = await db.query.sources.findFirst({
    where: and(eq(sources.workspaceId, config.app.workspaceId), eq(sources.slug, toolkit))
  });
  const [createdSource] = existingSource ? [] : await db.insert(sources).values({
    workspaceId: config.app.workspaceId,
    slug: toolkit,
    name,
    kind: "composio",
    status: "ready",
    metadata: {
      optimized: config.integrationProfiles.includes(toolkit),
      transport: "composio-compatible-import"
    }
  }).onConflictDoNothing().returning();
  const source = existingSource ?? createdSource ?? await db.query.sources.findFirst({
    where: and(eq(sources.workspaceId, config.app.workspaceId), eq(sources.slug, toolkit))
  });
  if (!source) throw new Error(`Unable to create ${toolkit} import source`);

  const values = {
    toolkit,
    composioSessionId: "composio-compatible-import",
    connectedAccountId: `import:${toolkit}`,
    status: "active",
    capabilities: {
      canEnumerate: true,
      canDeltaSync: false,
      canLiveSearch: false,
      attachmentSupport: true,
      imported: true
    },
    lastSyncedAt: new Date(),
    updatedAt: new Date()
  };
  const existingConnection = await db.query.connections.findFirst({ where: eq(connections.sourceId, source.id) });
  const [connection] = existingConnection
    ? await db.update(connections).set(values).where(eq(connections.id, existingConnection.id)).returning()
    : await db.insert(connections).values({ sourceId: source.id, ...values }).returning();
  if (!connection) throw new Error(`Unable to create ${toolkit} import connection`);
  return { source, connection };
}
