import { NextResponse } from "next/server";
import { enqueueConnectionSync } from "@/lib/integrations/sync";
import { validUuid } from "@/lib/http";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!validUuid(id)) return NextResponse.json({ error: "Invalid connection ID" }, { status: 400 });
  try { return NextResponse.json({ run: await enqueueConnectionSync(id) }, { status: 202 }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to start sync" }, { status: 404 }); }
}
