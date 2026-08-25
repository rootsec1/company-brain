import { randomUUID } from "node:crypto";
import { Suspense } from "react";
import { ResearchWorkspace } from "@/components/research-workspace";

export default async function ResearchPage({ searchParams }: { searchParams: Promise<{ conversation?: string }> }) {
  const { conversation } = await searchParams;
  return <Suspense fallback={<div className="page"><div className="skeleton" style={{height:500}}/></div>}><ResearchWorkspace conversationId={conversation ?? randomUUID()} resume={Boolean(conversation)}/></Suspense>;
}
