import { NextResponse } from "next/server";
import { enqueueIngestion } from "@/lib/api";
import { stageUploadedFile } from "@/lib/services/ingestion";
import { config } from "@/lib/config";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Request must be valid multipart form data" }, { status: 400 });
  const files = form.getAll("files").filter((value): value is File => value instanceof File);
  if (!files.length) return NextResponse.json({ error: "Attach at least one file" }, { status: 400 });
  if (files.length > config.ingestion.maxFilesPerRequest) return NextResponse.json({ error: `Upload at most ${config.ingestion.maxFilesPerRequest} files at once` }, { status: 413 });
  if (files.some((file) => !file.size)) return NextResponse.json({ error: "Empty files cannot be ingested" }, { status: 400 });
  if (files.some((file) => file.size > config.ingestion.maxFileBytes)) return NextResponse.json({ error: "A file exceeds the configured per-file limit" }, { status: 413 });
  if (files.reduce((total, file) => total + file.size, 0) > config.ingestion.maxUploadBatchBytes) return NextResponse.json({ error: "Upload batch exceeds the configured total limit" }, { status: 413 });
  const jobs = [];
  for (const file of files) {
    const staged = await stageUploadedFile(file);
    const jobId = await enqueueIngestion({ type: "file", title: file.name, ...staged }, file.name);
    jobs.push({ jobId, name: file.name, status: "queued" });
  }
  return NextResponse.json({ jobs }, { status: 202 });
}
