import { NextResponse } from "next/server";
import { z } from "zod";
import { enqueueIngestion } from "@/lib/api";
import { readJson } from "@/lib/http";
import { ensureImportedConnection } from "@/lib/integrations/import-bridge";
import { composioToolResponseSchema, normalizeComposioResponse } from "@/lib/integrations/normalizers";

const schema = z.object({
  toolkit: z.string().trim().min(1).max(100).regex(/^[a-z0-9_-]+$/i).transform((value) => value.toLowerCase()),
  sourceName: z.string().trim().min(1).max(200),
  response: composioToolResponseSchema
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: "Invalid Composio-compatible payload", issues: parsed.error.issues }, { status: 400 });
  const { source, connection } = await ensureImportedConnection(parsed.data.toolkit, parsed.data.sourceName);
  const records = normalizeComposioResponse(parsed.data.toolkit, source.id, parsed.data.response);
  if (records.length > 5_000) return NextResponse.json({ error: "Import pages are limited to 5,000 normalized records" }, { status: 413 });
  const jobs = await Promise.all(records.map(async (record) => ({
    jobId: await enqueueIngestion({ type: "record", record }, record.title),
    externalId: record.externalId,
    kind: record.kind
  })));
  return NextResponse.json({ sourceId: source.id, connectionId: connection.id, records: records.length, jobs }, { status: 202 });
}
