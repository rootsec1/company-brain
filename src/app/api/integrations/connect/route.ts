import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeToolkit } from "@/lib/integrations/composio";
import { readJson } from "@/lib/http";

const schema = z.object({ toolkit: z.string().trim().min(1).max(100).regex(/^[a-z0-9_-]+$/i) });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: "Invalid toolkit" }, { status: 400 });
  try {
    return NextResponse.json(await authorizeToolkit(parsed.data.toolkit));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Connection failed" }, { status: 503 });
  }
}
