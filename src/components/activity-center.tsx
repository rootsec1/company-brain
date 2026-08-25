"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, Check, CircleAlert, Clock3, Database, LoaderCircle, Network, RefreshCw, Server, Waypoints } from "lucide-react";
import { api, timeAgo } from "@/lib/client";

type Job = { id: string; title?: string; type: string; status: string; progress: number; stage: string; error?: string; createdAt: string; updatedAt: string };
type Service = { service: string; healthy: boolean; latencyMs: number; detail: string };
type ResearchRun = { id: string; name: string; kind: "conversation" | "workflow"; status: string; model: string; stepCount: number; inputTokens: number; outputTokens: number; cost?: number; latencyMs?: number; error?: string; createdAt: string };

export function ActivityCenter() {
  const jobs = useQuery({ queryKey: ["jobs"], queryFn: () => api<{ jobs: Job[]; researchRuns?: ResearchRun[] }>("/api/jobs"), refetchInterval: 2500 });
  const health = useQuery({ queryKey: ["health"], queryFn: () => api<{ status: string; services: Service[] }>("/api/health"), refetchInterval: 15000, retry: 1 });
  const healthy = health.data?.services.filter((item) => item.healthy).length ?? 0;
  const total = health.data?.services.length ?? 0;
  const researchRuns = jobs.data?.researchRuns ?? [];
  const recentTokens = researchRuns.reduce((total, run) => total + run.inputTokens + run.outputTokens, 0);
  const recentCost = researchRuns.reduce((total, run) => total + (run.cost ?? 0), 0);

  return <div className="page">
    <div className="eyebrow">System pulse</div>
    <h1 className="page-title">Everything in motion.</h1>
    <p className="page-description">Follow documents from upload through parsing, indexing, and graph enrichment. Service checks update in the background.</p>
    <div className="metric-grid">
      <div className="card metric"><div className="metric-label"><Server size={13}/> Services</div><div className="metric-value">{healthy}/{total || "—"}</div><div className="metric-foot">Healthy internal dependencies</div></div>
      <div className="card metric"><div className="metric-label"><LoaderCircle size={13}/> Running</div><div className="metric-value">{jobs.data?.jobs.filter((item) => item.status === "active").length ?? 0}</div><div className="metric-foot">Active ingestion jobs</div></div>
      <div className="card metric"><div className="metric-label"><Check size={13}/> Complete</div><div className="metric-value">{jobs.data?.jobs.filter((item) => item.status === "completed").length ?? 0}</div><div className="metric-foot">Recent successful jobs</div></div>
      <div className="card metric"><div className="metric-label"><Waypoints size={13}/> Agent usage</div><div className="metric-value">{recentTokens.toLocaleString()}</div><div className="metric-foot">tokens · ${recentCost.toFixed(4)} reported cost</div></div>
    </div>

    <div className="split-grid" style={{marginTop:28}}>
      <section>
        <div className="section-head" style={{marginTop:0}}><div className="section-title">Ingestion activity</div><button className="button ghost" onClick={() => jobs.refetch()}><RefreshCw size={11}/> Refresh</button></div>
        <div className="card list">
          {jobs.isLoading ? [1,2,3].map((item) => <div className="list-row" key={item}><div className="skeleton" style={{width:34,height:34}}/><div className="skeleton" style={{height:10,width:"50%"}}/></div>)
          : jobs.data?.jobs.length ? jobs.data.jobs.map((job) => <div className="list-row" key={job.id}>
            <div className="list-icon">{job.status === "completed" ? <Check size={15} color="var(--lime)"/> : job.status === "failed" ? <CircleAlert size={15} color="var(--danger)"/> : <Activity size={15}/>}</div>
            <div className="list-main"><div className="list-title">{job.title || job.type}</div><div className="list-meta">{job.stage} · {timeAgo(job.updatedAt)}{job.error ? ` · ${job.error}` : ""}</div><div className="progress"><span style={{width:`${job.progress}%`}}/></div></div>
            <span className={`pill ${job.status === "completed" ? "lime" : job.status === "failed" ? "red" : "orange"}`}>{job.status}</span>
          </div>) : <div className="empty"><div><div className="empty-icon"><Clock3 size={18}/></div><strong>No ingestion activity yet</strong><span>Upload a file or add text from the overview.</span></div></div>}
        </div>
      </section>
      <section>
        <div className="section-head" style={{marginTop:0}}><div className="section-title">Service health</div><span className={`pill ${health.data?.status === "healthy" ? "lime" : "orange"}`}>{health.data?.status ?? "checking"}</span></div>
        <div className="card list">
          {health.data?.services.map((service) => <div className="list-row" key={service.service}>
            <div className="list-icon">{service.service === "postgres" ? <Database size={14}/> : service.service === "lightrag" ? <Network size={14}/> : <Waypoints size={14}/>}</div>
            <div className="list-main"><div className="list-title" style={{textTransform:"capitalize"}}>{service.service}</div><div className="list-meta">{service.detail} · {service.latencyMs}ms</div></div>
            <span className={`status-light ${service.healthy ? "healthy" : "unhealthy"}`}/>
          </div>)}
          {!health.data && <div className="empty" style={{minHeight:180}}><LoaderCircle className="spin" size={20}/></div>}
        </div>
      </section>
    </div>
    <div className="section-head"><div className="section-title">Research activity</div><span className="pill">{researchRuns.length} recent runs</span></div>
    <div className="card list">
      {researchRuns.length ? researchRuns.map((run) => <div className="list-row" key={`${run.kind}-${run.id}`}>
        <div className="list-icon">{run.kind === "workflow" ? <Clock3 size={14}/> : <Waypoints size={14}/>}</div>
        <div className="list-main"><div className="list-title">{run.name}</div><div className="list-meta">{run.model} · {run.stepCount} steps · {(run.inputTokens + run.outputTokens).toLocaleString()} tokens · ${(run.cost ?? 0).toFixed(4)} · {run.latencyMs ?? 0}ms · {timeAgo(run.createdAt)}{run.error ? ` · ${run.error}` : ""}</div></div>
        <span className={`pill ${run.status === "completed" ? "lime" : run.status === "failed" ? "red" : "orange"}`}>{run.status}</span>
      </div>) : <div className="empty" style={{minHeight:160}}><div><div className="empty-icon"><Waypoints size={18}/></div><strong>No research runs yet</strong><span>Ask a question or run a workflow to see token, cost, and latency telemetry.</span></div></div>}
    </div>
  </div>;
}
