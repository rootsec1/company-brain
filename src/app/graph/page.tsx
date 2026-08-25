import { Suspense } from "react"; import { GraphWorkspace } from "@/components/graph-workspace";
export default function GraphPage(){return <Suspense fallback={<div className="page"><div className="skeleton" style={{height:600}}/></div>}><GraphWorkspace/></Suspense>}
