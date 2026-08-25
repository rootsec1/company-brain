import { NextResponse } from "next/server";
import { findRelated } from "@/lib/services/search";
import { validUuid } from "@/lib/http";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!validUuid(id)) return NextResponse.json({ error: "Invalid document ID" }, { status: 400 });
  return NextResponse.json({ related: await findRelated(id) });
}
