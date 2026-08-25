import { NextResponse } from "next/server";
import { deleteDocument, getDocument } from "@/lib/services/search";
import { validUuid } from "@/lib/http";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!validUuid(id)) return NextResponse.json({ error: "Invalid document ID" }, { status: 400 });
  const rawVersion = new URL(request.url).searchParams.get("version");
  const version = rawVersion == null ? undefined : Number(rawVersion);
  if (version != null && (!Number.isInteger(version) || version < 1)) return NextResponse.json({ error: "Invalid document version" }, { status: 400 });
  const document = await getDocument(id, version);
  return document
    ? NextResponse.json(document)
    : NextResponse.json({ error: "Document not found" }, { status: 404 });
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!validUuid(id)) return NextResponse.json({ error: "Invalid document ID" }, { status: 400 });
  const deleted = await deleteDocument(id);
  return deleted ? NextResponse.json({ deleted: true }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
