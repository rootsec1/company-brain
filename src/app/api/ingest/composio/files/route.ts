import { NextResponse } from "next/server";
import { z } from "zod";
import { enqueueIngestion } from "@/lib/api";
import { config } from "@/lib/config";
import { ensureImportedConnection } from "@/lib/integrations/import-bridge";
import { stageUploadedFile } from "@/lib/services/ingestion";

export const runtime = "nodejs";

const fieldSchema = z.object({
  toolkit: z.string().trim().min(1).max(100).regex(/^[a-z0-9_-]+$/i).transform((value) => value.toLowerCase()),
  sourceName: z.string().trim().min(1).max(200),
  externalId: z.string().trim().min(1).max(500),
  parentExternalId: z.string().trim().min(1).max(500).optional(),
  sourceUrl: z.string().url().optional(),
  authors: z.string().optional()
});

/**
 * Trusted import bridge for binaries already downloaded through an official
 * connector. The record keeps the external source identity and relationship;
 * Reducto parsing still happens asynchronously in the normal ingestion worker.
 */
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Request must be valid multipart form data" }, { status: 400 });
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) return NextResponse.json({ error: "Attach one non-empty file" }, { status: 400 });
  if (file.size > config.ingestion.maxFileBytes) return NextResponse.json({ error: "File exceeds the configured limit" }, { status: 413 });
  const parsed = fieldSchema.safeParse({
    toolkit: form.get("toolkit"), sourceName: form.get("sourceName"), externalId: form.get("externalId"),
    parentExternalId: form.get("parentExternalId") || undefined, sourceUrl: form.get("sourceUrl") || undefined,
    authors: form.get("authors") || undefined
  });
  if (!parsed.success) return NextResponse.json({ error: "Invalid connector file metadata", issues: parsed.error.issues }, { status: 400 });
  const { source, connection } = await ensureImportedConnection(parsed.data.toolkit, parsed.data.sourceName);
  const staged = await stageUploadedFile(file);
  const record = {
    sourceId: source.id,
    externalId: parsed.data.externalId,
    kind: file.type || "application/octet-stream",
    title: file.name,
    bodyMarkdown: `# ${file.name}\n\nConnector attachment queued for document parsing.`,
    sourceUrl: parsed.data.sourceUrl,
    authors: parsed.data.authors?.split(",").map((value) => value.trim()).filter(Boolean) ?? [],
    metadata: { mimeType: file.type || "application/octet-stream", size: file.size, rawObjectKey: staged.objectKey, connectorImport: true },
    attachments: [],
    relationships: parsed.data.parentExternalId ? [{
      fromExternalId: parsed.data.externalId,
      toExternalId: parsed.data.parentExternalId,
      type: "attached_to" as const,
      label: `Attached to ${parsed.data.toolkit} record`,
      metadata: {}
    }] : []
  };
  const jobId = await enqueueIngestion({ type: "record", record }, file.name);
  return NextResponse.json({ sourceId: source.id, connectionId: connection.id, jobId, externalId: record.externalId }, { status: 202 });
}
