import { NextResponse } from "next/server";
import { z } from "zod";
import { draftWorkflow } from "@/lib/services/workflows";
import { readJson } from "@/lib/http";

const schema = z.object({ instruction: z.string().trim().min(3).max(5000) });
export async function POST(request: Request) {
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: "Describe the workflow you want" }, { status: 400 });
  return NextResponse.json({ draft: await draftWorkflow(parsed.data.instruction) });
}
