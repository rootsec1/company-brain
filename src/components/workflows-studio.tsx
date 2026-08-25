"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDots, CheckCircle, Clock, DownloadSimple, FileText, MagicWand, Pause, Play, Plus, Sparkle, SpinnerGap, Trash, XCircle } from "@phosphor-icons/react";
import { useState, type FormEvent } from "react";
import { api, timeAgo } from "@/lib/client";

type Draft = { name: string; description: string; prompt: string; schedule: string | null; timezone: string; output?: "answer" | "markdown" | "json" };
type Run = { id: string; status: string; trigger: string; answer?: string; error?: string; createdAt: string; latencyMs?: number; artifact?: { format: string; filename: string } };
type Workflow = Draft & { id: string; enabled: boolean; status: string; lastRunAt?: string; nextRunAt?: string; runs: Run[] };

export function WorkflowsStudio() {
  const queryClient = useQueryClient();
  const [instruction, setInstruction] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const workflows = useQuery({ queryKey: ["workflows"], queryFn: () => api<{ workflows: Workflow[] }>("/api/workflows"), refetchInterval: 5000 });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["workflows"] });
  const createDraft = useMutation({
    mutationFn: () => api<{ draft: Draft }>("/api/workflows/draft", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ instruction }) }),
    onSuccess: ({ draft }) => { setDraft(draft); setError(""); }, onError: (reason) => setError(reason instanceof Error ? reason.message : "Draft failed")
  });
  const create = useMutation({
    mutationFn: (value: Draft) => api("/api/workflows", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) }),
    onSuccess: async () => { setDraft(null); setInstruction(""); await invalidate(); }, onError: (reason) => setError(reason instanceof Error ? reason.message : "Creation failed")
  });
  const mutate = useMutation({
    mutationFn: ({ id, method, body }: { id: string; method: "PATCH" | "DELETE" | "RUN"; body?: unknown }) => api(`/api/workflows/${id}${method === "RUN" ? "/run" : ""}`, {
      method: method === "RUN" ? "POST" : method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined
    }), onSuccess: invalidate, onError: (reason) => setError(reason instanceof Error ? reason.message : "Action failed")
  });

  function submit(event: FormEvent) { event.preventDefault(); if (instruction.trim()) createDraft.mutate(); }
  const suggestions = ["Every weekday at 9am, summarize new product decisions and contradictions", "Every Monday at 8:30am, brief me on customer issues and recurring themes", "Daily at 5pm, find stale policies superseded by newer documents"];

  return <div className="page">
    <div className="page-heading"><div><div className="eyebrow">Background intelligence · bounded agents</div><h1 className="page-title">Put the brain to <em>work.</em></h1><p className="page-description">Describe recurring research in plain language. Aperture creates bounded, read-only agents that run in the background and keep a complete evidence trail.</p></div><div className="page-heading-meta">Review first<br/>Evidence always</div></div>
    <form className="command workflow-command" onSubmit={submit}>
      <MagicWand size={19} weight="thin"/><input value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="Every weekday at 9, summarize new launch risks…"/>
      <button className="button" disabled={!instruction.trim() || createDraft.isPending}>{createDraft.isPending ? <SpinnerGap className="spin" size={13}/> : <Sparkle size={13}/>}Draft workflow</button>
    </form>
    <div className="suggestion-row">{suggestions.map((value) => <button className="pill" key={value} onClick={() => setInstruction(value)}>{value}</button>)}</div>
    {error && <div className="notice">{error}</div>}
    {draft && <section className="card workflow-draft">
      <div className="workflow-draft-head"><div><div className="eyebrow">Review before creating</div><h2>{draft.name}</h2></div><div style={{display:"flex",gap:7}}>{draft.output && draft.output !== "answer" && <span className="pill"><FileText size={10}/>{draft.output} artifact</span>}<span className="pill lime"><CalendarDots size={10}/>{draft.schedule ?? "Manual"}</span></div></div>
      <p>{draft.description}</p><label className="field-label">Research objective<textarea value={draft.prompt} onChange={(event) => setDraft({ ...draft, prompt: event.target.value })}/></label>
      <div className="workflow-draft-foot"><span>Timezone · {draft.timezone} · Read-only company knowledge</span><div><button className="button ghost" onClick={() => setDraft(null)}>Cancel</button><button className="button" onClick={() => create.mutate(draft)} disabled={create.isPending}><Plus size={13}/>Create</button></div></div>
    </section>}

    <div className="section-head"><div className="section-title">Your workflows</div><span className="pill">{workflows.data?.workflows.length ?? 0} total</span></div>
    <div className="workflow-grid">
      {workflows.isLoading ? [1,2,3].map((item) => <div className="card workflow-card" key={item}><div className="skeleton" style={{height:12,width:"55%"}}/><div className="skeleton" style={{height:9,width:"88%",marginTop:15}}/></div>)
      : workflows.data?.workflows.length ? workflows.data.workflows.map((workflow) => <article className="card workflow-card" key={workflow.id}>
        <div className="workflow-card-head"><div className={`workflow-state ${workflow.enabled ? "on" : ""}`}><Sparkle size={14}/></div><div><h3>{workflow.name}</h3><div className="list-meta">{workflow.schedule ?? "Manual"} · {workflow.timezone}{workflow.nextRunAt ? ` · next ${timeAgo(workflow.nextRunAt)}` : ""}</div></div><span className={`pill ${workflow.enabled ? "lime" : ""}`}>{workflow.status}</span></div>
        <p>{workflow.prompt}</p>
        <div className="run-list">{workflow.runs.length ? workflow.runs.slice(0,3).map((run) => <div className="run-row" key={run.id}>{run.status === "completed" ? <CheckCircle size={12} color="var(--accent)"/> : run.status === "failed" ? <XCircle size={12} color="var(--danger)"/> : <Clock size={12} color="var(--orange)"/>}<span>{run.status} · {timeAgo(run.createdAt)}</span>{run.latencyMs && <span>{(run.latencyMs/1000).toFixed(1)}s</span>}{run.artifact && <a href={`/api/workflows/runs/${run.id}/artifact`} className="pill lime" download><DownloadSimple size={9}/>{run.artifact.format}</a>}</div>) : <div className="run-row"><Clock size={12}/><span>No runs yet</span></div>}</div>
        <div className="workflow-actions"><button className="button secondary" onClick={() => mutate.mutate({ id: workflow.id, method: "RUN" })}><Play size={12}/>Run now</button><button className="button ghost" onClick={() => mutate.mutate({ id: workflow.id, method: "PATCH", body: { enabled: !workflow.enabled } })}>{workflow.enabled ? <Pause size={12}/> : <CalendarDots size={12}/>}{workflow.enabled ? "Pause" : "Activate"}</button><button className="button ghost icon-button" aria-label={`Delete ${workflow.name}`} onClick={() => mutate.mutate({ id: workflow.id, method: "DELETE" })}><Trash size={12}/></button></div>
      </article>) : <div className="card empty" style={{gridColumn:"1/-1"}}><div><div className="empty-icon"><CalendarDots size={19}/></div><strong>No background workflows</strong><span>Describe one above. Nothing activates without your review.</span></div></div>}
    </div>
  </div>;
}
