"use client";

import { useQuery } from "@tanstack/react-query";
import { Controls, Handle, MiniMap, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { Graph, Sparkle } from "@phosphor-icons/react";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { api } from "@/lib/client";

type GraphResponse={nodes:Array<{id:string;title:string;kind:string;provenance:string}>;edges:Array<{id:string;source:string;target:string;label:string;provenance:string}>;semanticAvailable?:boolean;warning?:string};
type BrainNode=Node<{title:string;kind:string;provenance:string}>;
function KnowledgeNode({data}:NodeProps<BrainNode>){return <div className={`graph-node ${data.provenance === "semantic" ? "semantic" : ""}`}><Handle type="target" position={Position.Left}/><div className="graph-node-title">{data.title}</div><div className="graph-node-type">{data.provenance} · {data.kind}</div><Handle type="source" position={Position.Right}/></div>}

export function GraphWorkspace(){
  const documentId=useSearchParams().get("documentId")??undefined;
  const [view,setView]=useState<"source"|"semantic"|"combined">(documentId?"source":"combined");
  const {data,isLoading,error}=useQuery({queryKey:["graph",documentId],queryFn:()=>api<GraphResponse>(`/api/graph${documentId?`?documentId=${documentId}`:""}`)});
  const graph=useMemo(()=>{
    const visible=(data?.nodes??[]).filter((node)=>view==="combined"||node.provenance===view);
    const visibleIds=new Set(visible.map((node)=>node.id));
    const count=visible.length; const radius=Math.max(330,Math.min(900,count*40));
    const nodes:BrainNode[]=visible.map((node,index)=>({id:node.id,type:"knowledge",data:{title:node.title,kind:node.kind,provenance:node.provenance},position:{x:radius*Math.cos(index/Math.max(1,count)*Math.PI*2),y:radius*Math.sin(index/Math.max(1,count)*Math.PI*2)}}));
    const edges:Edge[]=(data?.edges??[]).filter((edge)=>visibleIds.has(edge.source)&&visibleIds.has(edge.target)).map(edge=>({id:edge.id,source:edge.source,target:edge.target,label:edge.label,animated:edge.provenance === "semantic",style:{stroke:edge.provenance === "semantic"?"rgba(138,131,223,.58)":"rgba(239,133,111,.48)",strokeDasharray:edge.provenance === "semantic"?"5 5":undefined},labelStyle:{fill:"#858b98",fontSize:9}}));
    return {nodes,edges};
  },[data,view]);
  const sourceCount=data?.nodes.filter((node)=>node.provenance==="source").length??0;
  const semanticCount=data?.nodes.filter((node)=>node.provenance==="semantic").length??0;
  return <div className="page graph-page" style={{maxWidth:"none"}}><div className="page-heading"><div><div className="eyebrow">Relationship intelligence · live map</div><h1 className="page-title">See how the company <em>connects.</em></h1><p className="page-description">Source-derived relationships stay exact. Semantic context enriches research without blocking search.</p></div><div className="page-heading-meta">Source truth<br/>Semantic signal</div></div>
    <div className="graph-toolbar" role="group" aria-label="Graph context layer"><button className={`pill ${view==="source"?"lime":""}`} aria-pressed={view==="source"} onClick={()=>setView("source")}><Graph size={11}/>Source · {sourceCount}</button><button className={`pill ${view==="semantic"?"violet":""}`} aria-pressed={view==="semantic"} disabled={!data?.semanticAvailable} onClick={()=>setView("semantic")}><Sparkle size={11}/>{data?.semanticAvailable?`Semantic · ${semanticCount}`:"Semantic graph catching up"}</button>{!documentId&&<button className={`pill ${view==="combined"?"lime":""}`} aria-pressed={view==="combined"} onClick={()=>setView("combined")}>Combined · {(data?.nodes.length??0)}</button>}<span className="graph-summary">{graph.nodes.length} nodes · {graph.edges.length} relationships</span></div>
    <div className="graph-canvas">{isLoading?<div className="empty"><span>Mapping relationships…</span></div>:error?<div className="empty"><span>{error.message}</span></div>:!graph.nodes.length?<div className="empty"><div><div className="empty-icon"><Graph size={18}/></div><strong>No {view} relationships yet</strong><span>{view==="semantic"?"Semantic enrichment is still catching up.":"Ingest linked records or connected-source content to grow the graph."}</span></div></div>:<ReactFlow nodes={graph.nodes} edges={graph.edges} nodeTypes={{knowledge:KnowledgeNode}} fitView fitViewOptions={{padding:.08,maxZoom:1.08}} minZoom={.18} maxZoom={1.5} colorMode="dark"><Controls/><MiniMap pannable zoomable nodeColor={(node)=>node.data.provenance==="semantic"?"#8a83df":"#ef856f"} maskColor="rgba(11,12,15,.86)"/></ReactFlow>}</div>
  </div>;
}
