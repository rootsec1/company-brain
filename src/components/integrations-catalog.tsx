"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Check, Cloud, Link2, LoaderCircle, RefreshCw, Search, ShieldCheck, Unplug } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, timeAgo } from "@/lib/client";

type Toolkit = {
  slug: string;
  name: string;
  description: string;
  logo?: string;
  toolsCount: number;
  categories: string[];
  optimized: boolean;
  noAuth: boolean;
};

type Connection = {
  id: string;
  toolkit: string;
  status: string;
  lastSyncedAt?: string;
  name: string;
  iconUrl?: string;
};

type IntegrationsResponse = { enabled: boolean; toolkits: Toolkit[]; connections: Connection[] };

const localCatalog: Toolkit[] = [
  ["slack", "Slack", "Threads, messages, files, channels, authors, and mentions."],
  ["googledrive", "Google Drive", "Documents, folders, permissions, versions, and comments."],
  ["notion", "Notion", "Pages, databases, blocks, people, and nested workspace context."],
  ["github", "GitHub", "Repositories, issues, pull requests, discussions, and code context."],
  ["confluence", "Confluence", "Spaces, pages, comments, attachments, and page history."],
  ["jira", "Jira", "Projects, issues, comments, relationships, and delivery context."],
  ["linear", "Linear", "Teams, projects, initiatives, issues, and customer requests."],
  ["gmail", "Gmail", "Read-only mail, threads, attachments, labels, and participants."],
  ["sharepoint", "SharePoint", "Sites, libraries, folders, Office files, and metadata."],
  ["onedrive", "OneDrive", "Files, folders, versions, and shared-drive relationships."],
  ["dropbox", "Dropbox", "Files, Paper documents, folders, and sharing metadata."],
  ["box", "Box", "Enterprise files, folders, comments, and version history."]
].map(([slug, name, description]) => ({ slug, name, description, toolsCount: 0, categories: [], optimized: true, noAuth: false }));

export function IntegrationsCatalog() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["integrations"],
    queryFn: () => api<IntegrationsResponse>("/api/integrations"),
    retry: 1
  });
  const connect = useMutation({
    mutationFn: (toolkit: string) => api<{ redirectUrl?: string; status: string }>("/api/integrations/connect", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ toolkit })
    }),
    onSuccess: async (result) => {
      if (result.redirectUrl) {
        try {
          const redirect = new URL(result.redirectUrl);
          if (!["http:", "https:"].includes(redirect.protocol)) throw new Error("Unsupported OAuth redirect");
          window.location.assign(redirect.href);
        } catch { setError("Composio returned an invalid OAuth redirect URL"); }
      }
      await queryClient.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: (reason) => setError(reason instanceof Error ? reason.message : "Connection failed")
  });
  const disconnect = useMutation({
    mutationFn: (id: string) => api(`/api/integrations/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["integrations"] })
  });
  const sync = useMutation({
    mutationFn: (id: string) => api(`/api/integrations/${id}/sync`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["integrations"] }),
    onError: (reason) => setError(reason instanceof Error ? reason.message : "Sync failed")
  });

  const catalog = data?.toolkits.length ? data.toolkits : localCatalog;
  const filtered = useMemo(() => {
    const needle = query.toLowerCase().trim();
    return catalog.filter((item) => !needle || `${item.name} ${item.description} ${item.categories.join(" ")}`.toLowerCase().includes(needle));
  }, [catalog, query]);
  const catalogRows = useMemo(() => Array.from({ length: Math.ceil(filtered.length / 3) }, (_, index) => filtered.slice(index * 3, index * 3 + 3)), [filtered]);
  const catalogViewport = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: catalogRows.length,
    getScrollElement: () => catalogViewport.current,
    estimateSize: () => 194,
    overscan: 3,
    getItemKey: (index) => catalogRows[index]?.[0]?.slug ?? index
  });
  useEffect(() => { if (catalogRows.length) virtualizer.scrollToIndex(0); }, [query, catalogRows.length, virtualizer]);
  const connected = new Map(data?.connections.map((item) => [item.toolkit.toLowerCase(), item]));

  return <div className="page">
    <div className="eyebrow">Connected context</div>
    <h1 className="page-title">Bring your company with you.</h1>
    <p className="page-description">Connect the tools where work happens. Aperture imports read-only context and preserves threads, attachments, authors, folders, links, and versions.</p>

    {!data?.enabled && <div className="notice"><strong>Integrations are ready, but not enabled.</strong> Add <code>COMPOSIO_API_KEY</code> to <code>.env</code> and restart the web service. The rest of the product remains fully available.</div>}
    {error && <div className="notice">{error}</div>}

    {!!data?.connections.length && <>
      <div className="section-head"><div className="section-title">Connected sources</div><span className="pill lime"><ShieldCheck size={10}/> Read only</span></div>
      <div className="card list">
        {data.connections.map((item) => <div className="list-row" key={item.id}>
          <div className="list-icon"><Cloud size={15}/></div>
          <div className="list-main"><div className="list-title">{item.name}</div><div className="list-meta">{item.status} · {item.lastSyncedAt ? `synced ${timeAgo(item.lastSyncedAt)}` : "awaiting first sync"}</div></div>
          <span className={`pill ${item.status === "active" ? "lime" : "orange"}`}>{item.status}</span>
          <button className="button ghost" disabled={sync.isPending} onClick={() => sync.mutate(item.id)}><RefreshCw size={12} className={sync.isPending && sync.variables === item.id ? "spin" : ""}/>Sync</button>
          <button className="button ghost icon-button" aria-label={`Disconnect ${item.name}`} onClick={() => disconnect.mutate(item.id)}><Unplug size={13}/></button>
        </div>)}
      </div>
    </>}

    <div className="section-head"><div className="section-title">Source catalog</div><span className="pill">Powered by Composio</span></div>
    <div className="command" style={{minHeight:54,marginTop:0}}><Search size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search more than 1,000 supported toolkits…"/></div>
    {isLoading ? <div className="integration-grid">{[1,2,3,4,5,6].map((item) => <div className="card integration" key={item}><div className="skeleton" style={{width:38,height:38}}/><div className="skeleton" style={{height:11,width:"46%",marginTop:14}}/><div className="skeleton" style={{height:8,width:"88%",marginTop:15}}/></div>)}</div>
    : filtered.length ? <div ref={catalogViewport} style={{height:"min(68vh, 860px)",overflow:"auto",marginTop:20,contain:"strict"}}>
      <div style={{height:virtualizer.getTotalSize(),position:"relative"}}>
        {virtualizer.getVirtualItems().map((row) => <div key={row.key} data-index={row.index} ref={virtualizer.measureElement} style={{position:"absolute",top:0,left:0,width:"100%",transform:`translateY(${row.start}px)`,paddingBottom:12}}>
          <div className="integration-grid" style={{marginTop:0}}>{catalogRows[row.index]?.map((item) => {
            const connection = connected.get(item.slug.toLowerCase());
            return <article className="card card-hover integration" key={item.slug}>
              <div className="integration-head">
                {item.logo ? <img className="integration-logo" src={item.logo} alt="" loading="lazy" referrerPolicy="no-referrer"/> : <div className="integration-logo" style={{display:"grid",placeItems:"center",color:"#16191e"}}><Link2 size={18}/></div>}
                <div><div style={{fontSize:13,fontWeight:620}}>{item.name}</div><div style={{fontSize:9,color:"var(--faint)",marginTop:3}}>{item.toolsCount ? `${item.toolsCount} tools` : "Optimized profile"}</div></div>
              </div>
              <p className="integration-description">{item.description || "Connect this source for read-only search and research context."}</p>
              <div className="integration-foot">
                {item.optimized ? <span className="pill lime"><Check size={9}/> Optimized</span> : <span className="pill">Adaptive</span>}
                {connection ? <span className="pill lime">Connected</span> : <button className="button secondary" disabled={!data?.enabled || connect.isPending} onClick={() => connect.mutate(item.slug)}>
                  {connect.isPending && connect.variables === item.slug ? <LoaderCircle size={12} className="spin"/> : <ArrowUpRight size={12}/>} Connect
                </button>}
              </div>
            </article>;
          })}</div>
        </div>)}
      </div>
    </div> : <div className="card empty"><div><div className="empty-icon"><Search size={18}/></div><strong>No matching toolkit</strong><span>Try a broader source or category.</span></div></div>}
  </div>;
}
