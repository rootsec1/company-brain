"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Database, FileText, Graph, Link as LinkIcon, MagnifyingGlass, Plus, Robot, ShareNetwork, Sparkle, SpinnerGap, UploadSimple, X } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { api, formatCount, timeAgo } from "@/lib/client";

type Dashboard = {
  documentCount: number;
  chunkCount: number;
  sources: Array<{ id: string; name: string; kind: string; status: string }>;
  recentDocuments: Array<{ id: string; title: string; kind: string; updatedAt: string; authors: string[] }>;
};

export function HomeDashboard() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [uploading, setUploading] = useState(false);
  const [ingestMode, setIngestMode] = useState<"text"|"url"|null>(null);
  const [ingestTitle, setIngestTitle] = useState("");
  const [ingestBody, setIngestBody] = useState("");
  const [ingestError, setIngestError] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<Dashboard>("/api/dashboard"),
    retry: 1
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (query.trim()) router.push(`/search?q=${encodeURIComponent(query.trim())}`);
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setIngestError("");
    try {
      const body = new FormData();
      [...files].forEach((file) => body.append("files", file));
      await api("/api/ingest/files", { method: "POST", body });
      router.push("/activity");
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (error) {
      setIngestError(error instanceof Error ? error.message : "Upload failed");
    } finally { setUploading(false); }
  }

  async function ingest() {
    if (!ingestMode || !ingestBody.trim()) return;
    setUploading(true);
    setIngestError("");
    try {
      await api(`/api/ingest/${ingestMode}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(ingestMode === "text" ? { title: ingestTitle || "Untitled note", text: ingestBody, kind: "note" } : { title: ingestTitle || undefined, url: ingestBody }) });
      setIngestMode(null); setIngestTitle(""); setIngestBody(""); router.push("/activity");
    } catch (error) {
      setIngestError(error instanceof Error ? error.message : "Ingestion failed");
    } finally { setUploading(false); }
  }

  const metrics = [
    { label: "Documents", value: data?.documentCount ?? 0, foot: "Current indexed versions", icon: FileText },
    { label: "Context chunks", value: data?.chunkCount ?? 0, foot: "Hybrid-search ready", icon: Database },
    { label: "Sources", value: data?.sources.length ?? 0, foot: "Local and connected", icon: ShareNetwork },
    { label: "Graph", value: "Active", foot: "Structural + semantic", icon: Graph, accent: true }
  ];

  return <div className="page home-page">
    {ingestError && <div className="notice">{ingestError}</div>}
    <section className="home-lens">
      <div className="home-paper">
        <div className="eyebrow">Company intelligence · grounded</div>
        <h1 className="page-title">Ask the company.<br/><em>See the evidence.</em></h1>
        <p className="page-description">Search every document, decision, and conversation—or let a research agent trace the exact relationships behind an answer.</p>
        <form className="command command-paper" onSubmit={submit}>
          <MagnifyingGlass size={21} weight="thin" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ask about a project, decision, person, or policy…" autoFocus />
          <span className="key-hint">Enter</span>
          <button className="command-button" type="submit">Open lens <ArrowRight size={14}/></button>
        </form>
        <div className="home-proof"><span>Lexical · 24ms p95</span><span>Hybrid · 1.2s p95</span><span>Claims · cited</span></div>
      </div>
      <aside className="home-signal">
        <div className="home-signal-head"><span>Workspace signal</span><span className="status-dot" /></div>
        <div className="metric-grid">
          {metrics.map((metric) => <div className="metric" key={metric.label}>
            <div className="metric-label"><metric.icon size={14} weight="thin"/>{metric.label}</div>
            <div className="metric-value">{typeof metric.value === "number" ? formatCount(metric.value) : metric.value}</div>
            <div className="metric-foot">{metric.foot}</div>
          </div>)}
        </div>
        <Link className="signal-link" href="/graph"><Graph size={15} weight="thin"/>Trace the knowledge graph<ArrowRight size={13}/></Link>
      </aside>
    </section>

    <div className="section-head"><div><div className="eyebrow">Latest context</div><div className="section-title">Workspace pulse</div></div><Link href="/activity" className="text-link">View activity <ArrowRight size={11}/></Link></div>
    <div className="split-grid">
      <div className="context-ledger list">
        {isLoading ? [1,2,3,4].map((item) => <div className="list-row" key={item}><div className="skeleton" style={{width:34,height:34}}/><div style={{flex:1}}><div className="skeleton" style={{height:10,width:"52%"}}/><div className="skeleton" style={{height:8,width:"28%",marginTop:8}}/></div></div>)
        : data?.recentDocuments.length ? data.recentDocuments.map((document, index) => <Link className="list-row" href={`/documents/${document.id}`} key={document.id}>
          <span className="ledger-index">{String(index + 1).padStart(2,"0")}</span><div className="list-main"><div className="list-title">{document.title}</div><div className="list-meta">{document.kind} · {timeAgo(document.updatedAt)}</div></div><ArrowRight size={13}/>
        </Link>) : <div className="empty"><div><div className="empty-icon"><Sparkle size={19}/></div><strong>Your brain is ready to learn</strong><span>Add a document or connect a source to begin.</span></div></div>}
      </div>
      <aside className="ingest-panel">
        <div className="ingest-panel-index">Context / 01</div>
        <Robot size={26} weight="thin"/>
        <h2>Bring the work in.</h2>
        <p>Drop files or connect the tools where your company already works. Every thread and attachment keeps its provenance.</p>
        <input ref={fileRef} type="file" multiple hidden onChange={(event) => void upload(event.target.files)}/>
        <div className="ingest-actions">
          <button className="button" disabled={uploading} onClick={() => fileRef.current?.click()}><UploadSimple size={14}/>{uploading ? "Uploading…" : "Upload documents"}</button>
          <div><button className="button secondary" onClick={() => setIngestMode("text")}><FileText size={13}/>Add text</button><button className="button secondary" onClick={() => setIngestMode("url")}><LinkIcon size={13}/>Import URL</button></div>
          <Link className="button secondary" href="/integrations"><Plus size={14}/>Connect a source</Link>
        </div>
      </aside>
    </div>
    {ingestMode && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setIngestMode(null); }}><div className="card modal"><div className="modal-head"><div><div className="eyebrow">Add knowledge</div><h2>{ingestMode === "text" ? "Paste text or Markdown" : "Import a document URL"}</h2></div><button className="button ghost icon-button" onClick={() => setIngestMode(null)}><X size={14}/></button></div><label className="field-label">Title<input value={ingestTitle} onChange={(event) => setIngestTitle(event.target.value)} placeholder="Optional title"/></label><label className="field-label">{ingestMode === "text" ? "Content" : "URL"}{ingestMode === "text" ? <textarea autoFocus value={ingestBody} onChange={(event) => setIngestBody(event.target.value)} placeholder={"# Decision\n\nPaste company context here…"}/> : <input autoFocus type="url" value={ingestBody} onChange={(event) => setIngestBody(event.target.value)} placeholder="https://…"/>}</label><div className="modal-foot"><span>{ingestMode === "text" ? "Indexed directly as Markdown" : "Parsed with Reducto"}</span><button className="button" disabled={!ingestBody.trim() || uploading} onClick={() => void ingest()}>{uploading ? <SpinnerGap size={13} className="spin"/> : <Plus size={13}/>}Add to brain</button></div></div></div>}
  </div>;
}
