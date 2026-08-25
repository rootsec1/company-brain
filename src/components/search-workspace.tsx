"use client";

import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowRight, Bot, Clock3, FileText, Search, SlidersHorizontal, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";
import type { SearchHit } from "@/lib/contracts";
import { api, timeAgo } from "@/lib/client";

type SearchResponse = { hits: SearchHit[]; tookMs: number; mode: string };

function HighlightedSnippet({ value }: { value: string }) {
  const parts = value.split(/(<mark>|<\/mark>)/gi);
  let marked = false;
  return <>{parts.map((part, index) => {
    if (part.toLowerCase() === "<mark>") { marked = true; return <Fragment key={index}/>; }
    if (part.toLowerCase() === "</mark>") { marked = false; return <Fragment key={index}/>; }
    const clean = part.replace(/<[^>]*>/g, "");
    return marked ? <mark key={index}>{clean}</mark> : <Fragment key={index}>{clean}</Fragment>;
  })}</>;
}

export function SearchWorkspace() {
  const params = useSearchParams();
  const router = useRouter();
  const initial = params.get("q") ?? "";
  const [input, setInput] = useState(initial);
  const [query, setQuery] = useState(initial);
  const [mode, setMode] = useState<"lexical"|"hybrid">("hybrid");
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [kinds, setKinds] = useState<string[]>([]);
  const [authors, setAuthors] = useState<string[]>([]);
  const [thisMonth, setThisMonth] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setInput(initial); setQuery(initial); }, [initial]);
  useEffect(() => {
    const next = input.trim();
    if (next === query) return;
    const timer = setTimeout(() => setQuery(next), 180);
    return () => clearTimeout(timer);
  }, [input, query]);
  const filters = { sourceIds: sourceIds.length ? sourceIds : undefined, kinds: kinds.length ? kinds : undefined, authors: authors.length ? authors : undefined, dateFrom: thisMonth ? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString() : undefined };
  const lexical = useQuery({
    queryKey: ["search", query, "lexical", filters],
    queryFn: () => api<SearchResponse>("/api/search", {
      method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ query, mode: "lexical", limit: 24, ...filters })
    }),
    enabled: query.length > 0
  });
  const hybrid = useQuery({
    queryKey: ["search", query, "hybrid", filters],
    queryFn: () => api<SearchResponse>("/api/search", {
      method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ query, mode: "hybrid", limit: 24, ...filters })
    }),
    enabled: query.length > 0 && mode === "hybrid"
  });
  const data = mode === "hybrid" ? (hybrid.data ?? lexical.data) : lexical.data;
  const hits = data?.hits ?? [];
  const provisionalRanking = mode === "hybrid" && !hybrid.data && Boolean(lexical.data);
  const virtualizer = useVirtualizer({ count:hits.length, getScrollElement:()=>resultsRef.current, estimateSize:()=>154, overscan:5 });
  const isFetching = lexical.isFetching || (mode === "hybrid" && hybrid.isFetching);
  const error = lexical.error ?? hybrid.error;
  const sourceOptions = [...new Map([...sourceIds.map((id) => [id, id] as const), ...(data?.hits ?? []).map((hit) => [hit.sourceId, hit.sourceName] as const)]).entries()];
  const kindOptions = [...new Set([...kinds, ...(data?.hits ?? []).map((hit) => hit.kind)])];
  const authorOptions = [...new Set([...authors, ...(data?.hits ?? []).flatMap((hit) => hit.authors)])];
  function toggle(list: string[], value: string, set: (next: string[]) => void) { set(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]); }
  function submit(event: FormEvent) {
    event.preventDefault();
    const next = input.trim();
    if (!next) return;
    setQuery(next); router.replace(`/search?q=${encodeURIComponent(next)}`);
  }
  return <div className="page">
    <div className="eyebrow">Universal search</div>
    <h1 className="page-title" style={{fontSize:32}}>Find the exact context.</h1>
    <form className="command" onSubmit={submit} style={{marginTop:20,minHeight:64}}>
      <Search size={18} color="var(--muted)"/><input value={input} onChange={(event)=>setInput(event.target.value)} placeholder="Search the company brain…" autoFocus/>
      <button className="button secondary" type="button" onClick={()=>setMode(mode === "hybrid" ? "lexical" : "hybrid")}><Sparkles size={13}/>{mode === "hybrid" ? "Hybrid" : "Keyword"}</button>
    </form>
    <div className="search-layout">
      <aside className="filters">
        <div className="filter-label"><SlidersHorizontal size={11} style={{display:"inline",marginRight:6}}/>Refine</div>
        <div className="filter-group"><div className="filter-label">Source</div>{sourceOptions.map(([id,name])=><label className="filter-option" key={id}><input type="checkbox" checked={sourceIds.includes(id)} onChange={()=>toggle(sourceIds,id,setSourceIds)}/> {name}</label>)}</div>
        <div className="filter-group"><div className="filter-label">Content type</div>{kindOptions.slice(0,8).map((kind)=><label className="filter-option" key={kind}><input type="checkbox" checked={kinds.includes(kind)} onChange={()=>toggle(kinds,kind,setKinds)}/> {kind}</label>)}</div>
        <div className="filter-group"><div className="filter-label">Author</div>{authorOptions.length ? authorOptions.slice(0,8).map((author)=><label className="filter-option" key={author}><input type="checkbox" checked={authors.includes(author)} onChange={()=>toggle(authors,author,setAuthors)}/> {author}</label>) : <span className="filter-option">Anyone</span>}</div>
        <div className="filter-group"><div className="filter-label">Updated</div><label className="filter-option"><input type="checkbox" checked={thisMonth} onChange={(event)=>setThisMonth(event.target.checked)}/> This month</label></div>
      </aside>
      <section>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",height:30,marginBottom:10}}>
          <span style={{color:"var(--muted)",fontSize:11}}>{query ? `${data?.hits.length ?? 0} results${data ? ` in ${data.tookMs} ms` : ""}${mode === "hybrid" && hybrid.isFetching && lexical.data ? " · improving ranking…" : ""}` : "Start typing to search"}</span>
          {query && <Link href={`/research?q=${encodeURIComponent(query)}`} className="pill lime"><Bot size={10}/>Research this</Link>}
        </div>
        {isFetching && !data ? [1,2,3,4].map(i=><div className="card result" key={i}><div className="skeleton" style={{height:12,width:"42%"}}/><div className="skeleton" style={{height:9,width:"90%",marginTop:15}}/><div className="skeleton" style={{height:9,width:"68%",marginTop:8}}/></div>)
        : error ? <div className="card empty"><div><div className="empty-icon"><Search size={18}/></div><strong>Search is unavailable</strong><span>{error.message}</span></div></div>
        : !query ? <div className="card empty"><div><div className="empty-icon"><Search size={18}/></div><strong>Everything is within reach</strong><span>Try a person, project, decision, or exact phrase.</span></div></div>
        : hits.length ? <div className="results-viewport" ref={resultsRef}><div style={{height:virtualizer.getTotalSize(),position:"relative"}}>{virtualizer.getVirtualItems().map((row)=>{const hit=hits[row.index]!;return <div key={hit.id} data-index={row.index} ref={virtualizer.measureElement} className="virtual-result" style={{transform:`translateY(${row.start}px)`}}><Link href={`/documents/${hit.documentId}`} className="card card-hover result">
          <div className="result-head"><div className="list-icon"><FileText size={15}/></div><div style={{minWidth:0,flex:1}}><h3>{hit.title}</h3><div className="list-meta">{hit.sourceName} · {hit.kind}</div></div><div className="pill">{provisionalRanking?"Keyword":`${Math.max(0,Math.min(100,Math.round(hit.score*100)))}%`}</div></div>
          <p><HighlightedSnippet value={hit.snippet}/></p>
          <div className="result-foot"><Clock3 size={11}/>{hit.updatedAt ? timeAgo(hit.updatedAt) : "Unknown date"}<span>·</span><span>{hit.authors.join(", ") || "Company knowledge"}</span><ArrowRight size={11} style={{marginLeft:"auto"}}/></div>
        </Link></div>})}</div></div> : <div className="card empty"><div><div className="empty-icon"><Search size={18}/></div><strong>No matching context</strong><span>Try fewer words, a related term, or connect another source.</span></div></div>}
      </section>
    </div>
  </div>;
}
