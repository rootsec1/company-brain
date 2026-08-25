import { NextResponse } from "next/server";
import { composioEnabled, listConnections, listToolkits } from "@/lib/integrations/composio";

export async function GET() {
  const [toolkits, connections] = composioEnabled()
    ? await Promise.all([listToolkits(), listConnections()])
    : [[], await listConnections()];
  return NextResponse.json({ enabled: composioEnabled(), toolkits, connections });
}
