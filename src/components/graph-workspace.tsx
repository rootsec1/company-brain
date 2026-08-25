"use client";

import { useQuery } from "@tanstack/react-query";
import { Background, Controls, Handle, MiniMap, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { GitBranch, Sparkles } from "lucide-react";
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
    const count=visible.length; const radius=Math.max(250,Math.min(900,count*32));
    const nodes:BrainNode[]=visible.map((node,index)=>({id:node.id,type:"knowledge",data:{title:node.title,kind:node.kind,provenance:node.provenance},position:{x:radius*Math.cos(index/Math.max(1,count)*Math.PI*2),y:radius*Math.sin(index/Math.max(1,count)*Math.PI*2)}}));
    const edges:Edge[]=(data?.edges??[]).filter((edge)=>visibleIds.has(edge.source)&&visibleIds.has(edge.target)).map(edge=>({id:edge.id,source:edge.source,target:edge.target,label:edge.label,animated:edge.provenance === "semantic",style:{stroke:edge.provenance === "semantic"?"rgba(149,134,255,.4)":"rgba(199,243,107,.35)",strokeDasharray:edge.provenance === "semantic"?"5 5":undefined},labelStyle:{fill:"#737b87",fontSize:9}}));
    return {nodes,edges};
  },[data,view]);
  const sourceCount=data?.nodes.filter((node)=>node.provenance==="source").length??0;
  const semanticCount=data?.nodes.filter((node)=>node.provenance==="semantic").length??0;
  return <div className="page" style={{maxWidth:"none"}}><div className="eyebrow">Relationship intelligence</div><h1 className="page-title" style={{fontSize:32}}>Knowledge graph</h1><p className="page-description">Source-derived relationships stay exact. Semantic graph context enriches research without blocking search.</p>
    <div className="graph-toolbar" role="group" aria-label="Graph context layer"><button className={`pill ${view==="source"?"lime":""}`} aria-pressed={view==="source"} onClick={()=>setView("source")}><GitBranch size={10}/>Source · {sourceCount}</button><button className={`pill ${view==="semantic"?"violet":""}`} aria-pressed={view==="semantic"} disabled={!data?.semanticAvailable} onClick={()=>setView("semantic")}><Sparkles size={10}/>{data?.semanticAvailable?`Semantic · ${semanticCount}`:"Semantic graph catching up"}</button>{!documentId&&<button className={`pill ${view==="combined"?"lime":""}`} aria-pressed={view==="combined"} onClick={()=>setView("combined")}>Combined · {(data?.nodes.length??0)}</button>}<span className="graph-summary">Showing {graph.nodes.length} nodes and {graph.edges.length} relationships</span></div>
    <div className="card graph-canvas">{isLoading?<div className="empty"><span>Mapping relationships…</span></div>:error?<div className="empty"><span>{error.message}</span></div>:!graph.nodes.length?<div className="empty"><div><div className="empty-icon"><GitBranch size={18}/></div><strong>No {view} relationships yet</strong><span>{view==="semantic"?"Semantic enrichment is still catching up.":"Ingest linked records or connected-source content to grow the graph."}</span></div></div>:<ReactFlow nodes={graph.nodes} edges={graph.edges} nodeTypes={{knowledge:KnowledgeNode}} fitView fitViewOptions={{padding:.16,maxZoom:.82}} minZoom={.18} maxZoom={1.5} colorMode="dark"><Background color="#252a31" gap={26}/><Controls/><MiniMap pannable zoomable nodeColor={(node)=>node.data.provenance==="semantic"?"#9586ff":"#c7f36b"} maskColor="rgba(10,11,13,.8)"/></ReactFlow>}</div>
  </div>;
}
