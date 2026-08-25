"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, CalendarBlank, ClockCounterClockwise, FileText, Graph, Link as LinkIcon, UserCircle } from "@phosphor-icons/react";
import Link from "next/link";
import { type ReactNode, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, timeAgo } from "@/lib/client";

type DocumentData = {
  id: string; title: string; kind: string; markdown: string; version: number; currentVersion: number; sourceUrl?: string; authors: string[];
  updatedAt: string; viewedVersionCreatedAt: string; metadata: Record<string,unknown>;
  versions: Array<{version:number;parser:string;createdAt:string;metadata:Record<string,unknown>}>;
  related: Array<{id:string;title:string;kind:string;edge?:{type:string}}>
};

function pageAwareMarkdown(markdown: string) {
  return markdown
    .replace(/^\[\[START OF PAGE (\d+)\]\]$/gm, "###### Page $1")
    .replace(/^\[\[END OF PAGE \d+\]\]$/gm, "");
}

function PageHeading({ children }: { children?: ReactNode }) {
  const label = String(children);
  const page = label.match(/^Page (\d+)$/)?.[1];

  return page ? (
    <div id={`page-${page}`} className="page-anchor">
      Page {page}
    </div>
  ) : (
    <h6>{children}</h6>
  );
}

export function DocumentViewer({ id }: { id: string }) {
  const [selectedVersion,setSelectedVersion]=useState<number>();
  const {data,error,isLoading}=useQuery({queryKey:["document",id,selectedVersion],queryFn:()=>api<DocumentData>(`/api/documents/${id}${selectedVersion?`?version=${selectedVersion}`:""}`)});
  const pages=useMemo(()=>data?[...data.markdown.matchAll(/^\[\[START OF PAGE (\d+)\]\]$/gm)].map(match=>Number(match[1])):[],[data]);
  if(isLoading) return <div className="page"><div className="skeleton" style={{height:40,width:"40%"}}/><div className="skeleton" style={{height:600,marginTop:24}}/></div>;
  if(error||!data) return <div className="page"><div className="card empty"><div><div className="empty-icon"><FileText size={18}/></div><strong>Document unavailable</strong><span>{error?.message}</span></div></div></div>;
  return <div className="page">
    <div className="page-heading"><div><div className="eyebrow">{data.kind} · source record</div><h1 className="page-title">{data.title}</h1></div><div className="page-heading-meta">Version · {data.version}<br/>{data.version===data.currentVersion?"Current truth":"Historical view"}</div></div>
    <div style={{display:"flex",gap:8,alignItems:"center",margin:"14px 0 24px",flexWrap:"wrap"}}><span className={`pill ${data.version===data.currentVersion?"lime":""}`}>{data.version===data.currentVersion?"Current":"Historical"} · v{data.version}</span><span className="pill">Saved {timeAgo(data.viewedVersionCreatedAt)}</span>{data.sourceUrl&&<a href={data.sourceUrl} target="_blank" rel="noreferrer" className="pill">Original <ArrowUpRight size={9}/></a>}</div>
    <div className="document-layout"><article className="document-paper"><div className="document-registration"><span>Normalized markdown</span><span>Page 1 / {Math.max(1,pages.length)}</span></div><div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{h6:PageHeading}}>{pageAwareMarkdown(data.markdown)}</ReactMarkdown></div></article>
      <aside className="details"><div className="eyebrow">Context details</div><div className="section-title">Provenance</div>
        <div className="detail-row"><div className="detail-key"><CalendarBlank size={10} style={{display:"inline",marginRight:5}}/>Updated</div><div className="detail-value">{new Date(data.updatedAt).toLocaleString()}</div></div>
        <div className="detail-row"><div className="detail-key"><UserCircle size={10} style={{display:"inline",marginRight:5}}/>Authors</div><div className="detail-value">{data.authors.join(", ")||"Unknown"}</div></div>
        <div className="detail-row"><div className="detail-key"><LinkIcon size={10} style={{display:"inline",marginRight:5}}/>Source</div><div className="detail-value">{data.sourceUrl||"Local knowledge"}</div></div>
        <div className="detail-row"><label className="detail-key" htmlFor="document-version"><ClockCounterClockwise size={10} style={{display:"inline",marginRight:5}}/>Version history</label><select id="document-version" className="select" value={data.version} onChange={(event)=>setSelectedVersion(Number(event.target.value))} style={{width:"100%",marginTop:8}}>{data.versions.map(item=><option key={item.version} value={item.version}>v{item.version}{item.version===data.currentVersion?" · current":""} · {new Date(item.createdAt).toLocaleString()}</option>)}</select></div>
        {!!pages.length&&<div className="detail-row"><div className="detail-key">Page anchors</div><div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:8}}>{pages.map(page=><a className="pill" href={`#page-${page}`} key={page}>Page {page}</a>)}</div></div>}
        <div className="detail-row"><div className="detail-key"><Graph size={10} style={{display:"inline",marginRight:5}}/>Related context</div><div className="related-list">{data.related.length?data.related.map((item,index)=><Link key={item.id} href={`/documents/${item.id}`}><span>{String(index+1).padStart(2,"0")}</span><div><div className="list-title">{item.title}</div><div className="list-meta">{item.edge?.type.replaceAll("_"," ")} · {item.kind}</div></div></Link>):<div className="detail-value">No direct relationships yet.</div>}</div></div>
        <Link href={`/graph?documentId=${data.id}`} className="button secondary" style={{justifyContent:"center",width:"100%",marginTop:12}}><Graph size={13}/>Explore graph</Link>
      </aside>
    </div>
  </div>;
}
