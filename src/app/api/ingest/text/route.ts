import { NextResponse } from "next/server";
import { enqueueIngestion } from "@/lib/api";
import { textIngestSchema } from "@/lib/contracts";
import { readJson } from "@/lib/http";

export async function POST(request: Request) {
  const parsed = textIngestSchema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: "Invalid text payload", issues: parsed.error.issues }, { status: 400 });
  const jobId = await enqueueIngestion({ type: "text", ...parsed.data }, parsed.data.title);
  return NextResponse.json({ jobId, status: "queued" }, { status: 202 });
}
