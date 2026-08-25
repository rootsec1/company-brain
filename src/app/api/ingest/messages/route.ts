import { NextResponse } from "next/server";
import { z } from "zod";
import { enqueueIngestion } from "@/lib/api";
import { normalizeComposioResponse } from "@/lib/integrations/normalizers";
import { ensureImportedConnection } from "@/lib/integrations/import-bridge";
import { config } from "@/lib/config";
import { readJson } from "@/lib/http";

const schema = z.object({
  channel: z.string().min(1).max(200),
  messages: z.array(z.object({
    id: z.string().min(1), text: z.string().max(config.ingestion.maxMessageCharacters), user: z.string().optional(), userName: z.string().optional(), timestamp: z.string().optional(),
    threadId: z.string().optional(), sourceUrl: z.url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "Only HTTP(S) source URLs are supported").optional(),
    attachments: z.array(z.object({ id: z.string(), name: z.string(), url: z.url().optional(), mimeType: z.string().optional(), size: z.number().nonnegative().optional() })).default([])
  })).min(1).max(1000)
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: "Invalid message batch", issues: parsed.error.issues }, { status: 400 });
  const { source } = await ensureImportedConnection("slack", "Slack");
  const response = {
    successful: true as const, error: null, data: { messages: parsed.data.messages.map((message) => ({
      ts: message.timestamp ?? message.id, id: message.id, text: message.text, user: message.user, user_name: message.userName,
      channel: parsed.data.channel, channel_name: parsed.data.channel, thread_ts: message.threadId, permalink: message.sourceUrl,
      files: message.attachments.map((attachment) => ({ id: attachment.id, name: attachment.name, mimetype: attachment.mimeType, size: attachment.size, url_private: attachment.url }))
    })) }
  };
  const records = normalizeComposioResponse("slack", source.id, response);
  // Raw-message imports can provide public attachment URLs directly. Composio-backed
  // imports use their authenticated download tool instead and attach a rawObjectKey.
  for (const record of records) {
    if (record.metadata.downloadRequired === true && record.sourceUrl) {
      record.metadata = { ...record.metadata, parseUrl: record.sourceUrl };
    }
  }
  const jobs = await Promise.all(records.map(async (record) => ({ jobId: await enqueueIngestion({ type: "record", record }, record.title), externalId: record.externalId })));
  return NextResponse.json({ jobs }, { status: 202 });
}
