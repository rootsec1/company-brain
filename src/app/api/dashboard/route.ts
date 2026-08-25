import { NextResponse } from "next/server";
import { getDashboardData } from "@/lib/services/search";

export async function GET() {
  return NextResponse.json(await getDashboardData());
}
