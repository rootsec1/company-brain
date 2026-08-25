"use client";

import { useChat } from "@ai-sdk/react";
import { useQuery } from "@tanstack/react-query";
import { DefaultChatTransport, type UIMessage } from "ai";
import { ArrowUp, BookOpen, Bot, FileText, Search, Sparkles, Square, WandSparkles } from "lucide-react";
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
  return <div className="tool-event"><Sparkles size={11} style={{display:"inline",marginRight:7,color:"var(--lime)"}}/>{state.includes("output") ? "Used" : "Using"} {name}</div>;
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
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

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

  return <div className="research-shell">
    <section className="conversation">
      <div className="messages">
        {!messages.length && <div style={{maxWidth:760,margin:"12vh auto 0"}}>
          <div className="empty-icon" style={{width:52,height:52,borderRadius:16}}><WandSparkles size={22}/></div>
          <h1 style={{textAlign:"center",fontSize:30,letterSpacing:"-.045em",margin:"15px 0 8px"}}>Research with the whole company in context.</h1>
          <p style={{textAlign:"center",color:"var(--muted)",fontSize:13,lineHeight:1.6,maxWidth:570,margin:"auto"}}>Aperture searches, follows relationships, and reads the underlying evidence before it answers.</p>
          <div style={{display:"grid",gap:8,maxWidth:560,margin:"28px auto"}}>{suggestions.map(suggestion=><button className="card card-hover" style={{textAlign:"left",padding:"13px 15px",color:"var(--muted)",cursor:"pointer"}} key={suggestion} onClick={()=>void sendMessage({text:suggestion})}><Sparkles size={12} style={{display:"inline",marginRight:9,color:"var(--lime)"}}/>{suggestion}</button>)}</div>
        </div>}
        {messages.map((message)=><article className={`message ${message.role}`} key={message.id}>
          {message.role === "assistant" && <div className="message-role"><Bot size={11} style={{display:"inline",marginRight:6}}/>Aperture research</div>}
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
          <textarea value={input} onChange={(event)=>setInput(event.target.value)} placeholder="Ask a question across your company…" onKeyDown={(event)=>{if(event.key==="Enter"&&!event.shiftKey){event.preventDefault();event.currentTarget.form?.requestSubmit();}}}/>
          <div className="composer-foot"><span style={{color:"var(--faint)",fontSize:10}}>Read-only · grounded in indexed evidence</span>{running ? <button type="button" className="button icon-button secondary" onClick={stop} aria-label="Stop"><Square size={13}/></button> : <button className="button icon-button" disabled={!input.trim()} aria-label="Send"><ArrowUp size={15}/></button>}</div>
        </form>
      </div>
    </section>
    <aside className="evidence-panel">
      <div className="evidence-head"><div><div className="section-title">Evidence</div><div className="list-meta">Sources used in this research</div></div><div className="pill lime">{uniqueEvidence.length} found</div></div>
      {uniqueEvidence.length ? uniqueEvidence.slice(0,12).map((hit,index)=><Link href={`/documents/${hit.documentId}`} className="card card-hover" style={{display:"block",padding:13,marginBottom:8}} key={hit.id}>
        <div style={{display:"flex",gap:9}}><div className="list-icon" style={{width:29,height:29}}><FileText size={13}/></div><div style={{minWidth:0}}><div className="list-title">[{index+1}] {hit.title}</div><div className="list-meta">{hit.sourceName} · {hit.kind}</div></div></div>
        <p style={{color:"var(--muted)",fontSize:10,lineHeight:1.55,margin:"10px 0 0"}}>{hit.content.slice(0,170)}…</p>
      </Link>) : <div className="empty" style={{minHeight:210}}><div><div className="empty-icon"><BookOpen size={18}/></div><strong>Evidence will appear here</strong><span>Ask a question to start searching.</span></div></div>}
      {!!recent.data?.conversations.length && <><div className="filter-label" style={{margin:"18px 0 8px"}}>Recent research</div>{recent.data.conversations.slice(0,6).map((conversation) => <Link key={conversation.id} href={`/research?conversation=${conversation.id}`} className="list-row" style={{padding:"9px 4px"}}><div className="list-main"><div className="list-title">{conversation.title}</div><div className="list-meta">{timeAgo(conversation.updatedAt)}</div></div></Link>)}</>}
      {messages.length > 0 && <Link href={`/search?q=${encodeURIComponent(textParts(messages.findLast((message)=>message.role==="user") ?? messages[0]))}`} className="button secondary" style={{width:"100%",justifyContent:"center",marginTop:10}}><Search size={13}/>Open full search</Link>}
    </aside>
  </div>;
}
