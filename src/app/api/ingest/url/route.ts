import { NextResponse } from "next/server";
import { enqueueIngestion } from "@/lib/api";
import { urlIngestSchema } from "@/lib/contracts";
import { readJson } from "@/lib/http";

export async function POST(request: Request) {
  const parsed = urlIngestSchema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: "Invalid URL payload", issues: parsed.error.issues }, { status: 400 });
  const jobId = await enqueueIngestion({ type: "url", ...parsed.data }, parsed.data.title ?? parsed.data.url);
  return NextResponse.json({ jobId, status: "queued" }, { status: 202 });
}
