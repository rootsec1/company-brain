"use client";

import { useChat } from "@ai-sdk/react";
import { useQuery } from "@tanstack/react-query";
import { DefaultChatTransport, type UIMessage } from "ai";
import { ArrowUp, BookOpenText, FileText, MagicWand, MagnifyingGlass, Robot, Sparkle, Stop } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { SearchHit } from "@/lib/contracts";
import { api, timeAgo } from "@/lib/client";

function textParts(message: UIMessage) {
  return message.parts.filter((part): part is Extract<typeof part, {type:"text"}> => part.type === "text").map((part)=>part.text).join("");
}

function ToolPart({ part }: { part: UIMessage["parts"][number] }) {
  const value = part as unknown as Record<string, unknown>;
  if (!String(value.type).startsWith("tool-") && value.type !== "dynamic-tool") return null;
  const name = String(value.toolName ?? String(value.type).replace("tool-", "")).replaceAll("_", " ");
  const state = String(value.state ?? "working");
  return <div className={`tool-event ${state.includes("output") ? "complete" : "active"}`}><span className="tool-dot"/><Sparkle size={11} weight="thin"/>{state.includes("output") ? "Used" : "Using"} {name}</div>;
}

type ConversationSummary = { id: string; title: string; updatedAt: string };

export function ResearchWorkspace({ conversationId, resume }: { conversationId: string; resume: boolean }) {
  const params = useSearchParams();
  const router = useRouter();
  const initial = params.get("q") ?? "";
  const transport = useMemo(() => new DefaultChatTransport({ api: "/api/ask" }), []);
  const { messages, sendMessage, setMessages, status, stop, error } = useChat({ id: conversationId, transport, throttle: 35 });
  const [input, setInput] = useState("");
  const sentInitial = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const running = status === "submitted" || status === "streaming";
  const recent = useQuery({ queryKey: ["conversations"], queryFn: () => api<{ conversations: ConversationSummary[] }>("/api/conversations"), retry: 1 });

  useEffect(() => {
    if (resume) void api<{ messages: UIMessage[] }>(`/api/conversations?id=${conversationId}`).then((value) => setMessages(value.messages)).catch(() => undefined);
  }, [conversationId, resume, setMessages]);
  useEffect(() => {
    if (initial && !sentInitial.current) { sentInitial.current = true; router.replace(`/research?conversation=${conversationId}`); void sendMessage({ text: initial }); }
  }, [conversationId, initial, router, sendMessage]);
  useEffect(() => { if (running) bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, running]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || running) return;
    setInput(""); router.replace(`/research?conversation=${conversationId}`); void sendMessage({ text });
  }

  const evidence: SearchHit[] = [];
  for (const message of messages) for (const part of message.parts) {
    const value = part as unknown as { type?: string; output?: unknown };
    if (value.type === "tool-search_chunks" && Array.isArray(value.output)) evidence.push(...value.output as SearchHit[]);
  }
  const uniqueEvidence = [...new Map(evidence.map((hit)=>[hit.id, hit])).values()];
  const suggestions = [
    "What changed in our latest product decisions?",
    "Find related discussions and documents for this project",
    "Summarize the strongest evidence and any contradictions"
  ];

  return <div className={`research-shell ${running ? "is-running" : ""}`}>
    <section className="conversation research-paper">
      <div className="research-paper-meta"><span>Research / {messages.length ? "Project context" : "New investigation"}</span><span>{running ? "Agent active" : messages.length ? `${uniqueEvidence.length} verified sources` : "Ready"}</span></div>
      <div className="messages">
        {!messages.length && <div className="research-empty">
          <MagicWand size={24} weight="thin"/>
          <div className="eyebrow">Ask with the whole company in context</div>
          <h1>What do you need to <em>understand?</em></h1>
          <p>Aperture searches, follows relationships, and reads the underlying evidence before it answers.</p>
          <div className="research-suggestions">{suggestions.map((suggestion, index)=><button key={suggestion} onClick={()=>void sendMessage({text:suggestion})}><span>{String(index + 1).padStart(2,"0")}</span>{suggestion}<ArrowUp size={12}/></button>)}</div>
        </div>}
        {messages.map((message)=><article className={`message ${message.role}`} key={message.id}>
          {message.role === "assistant" && <div className="message-role"><Robot size={12} weight="thin"/>Aperture research · grounded answer</div>}
          <div className={message.role === "user" ? "bubble" : "message-copy"}>
            {message.parts.map((part,index)=>part.type === "text"
              ? message.role === "assistant"
                ? <div className="markdown" key={index}><ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown></div>
                : <p key={index} style={{whiteSpace:"pre-wrap"}}>{part.text}</p>
              : <ToolPart key={index} part={part}/>)}
          </div>
        </article>)}
        {error && <div className="notice" style={{maxWidth:760,margin:"0 auto"}}>Research stopped: {error.message}</div>}
        <div ref={bottomRef}/>
      </div>
      <div className="composer-wrap">
        <form className="composer" onSubmit={submit}>
          <div className="composer-orbit"><Robot size={19} weight="thin"/></div>
          <textarea value={input} onChange={(event)=>setInput(event.target.value)} placeholder="Ask a follow-up…" onKeyDown={(event)=>{if(event.key==="Enter"&&!event.shiftKey){event.preventDefault();event.currentTarget.form?.requestSubmit();}}}/>
          <div className="composer-foot"><span>Scope · whole company &nbsp; / &nbsp; Depth · standard</span>{running ? <button type="button" className="button icon-button secondary" onClick={stop} aria-label="Stop"><Stop size={13}/></button> : <button className="button icon-button" disabled={!input.trim()} aria-label="Send"><ArrowUp size={15}/></button>}</div>
        </form>
      </div>
    </section>
    <aside className="evidence-panel evidence-map">
      <div className="evidence-head"><div><div className="eyebrow">Evidence map</div><div className="section-title">{uniqueEvidence.length || 0} verified sources</div></div><span className="evidence-pulse">Live</span></div>
      <div className="evidence-stack">
        {uniqueEvidence.length ? uniqueEvidence.slice(0,12).map((hit,index)=><Link href={`/documents/${hit.documentId}`} className="evidence-card" key={hit.id}>
          <span className="evidence-index">{index+1}</span><div className="evidence-card-copy"><div className="list-title">{hit.title}</div><div className="list-meta">{hit.sourceName} · {hit.kind}</div><p>{hit.content.slice(0,170)}…</p><span className="evidence-open">View source <ArrowUp size={10}/></span></div>
        </Link>) : <div className="evidence-empty"><BookOpenText size={24} weight="thin"/><strong>Evidence will map here</strong><span>Ask a question to trace claims back to their sources.</span></div>}
      </div>
      {!!recent.data?.conversations.length && <div className="recent-research"><div className="filter-label">Recent investigations</div>{recent.data.conversations.slice(0,4).map((conversation) => <Link key={conversation.id} href={`/research?conversation=${conversation.id}`}><span>{conversation.title}</span><small>{timeAgo(conversation.updatedAt)}</small></Link>)}</div>}
      {messages.length > 0 && <Link href={`/search?q=${encodeURIComponent(textParts(messages.findLast((message)=>message.role==="user") ?? messages[0]))}`} className="text-link evidence-search"><MagnifyingGlass size={13}/>Open full search</Link>}
    </aside>
  </div>;
}
