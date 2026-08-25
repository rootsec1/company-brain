import { Suspense } from "react";
import { SearchWorkspace } from "@/components/search-workspace";

export default function SearchPage() {
  return <Suspense fallback={<div className="page"><div className="skeleton" style={{height:64}}/></div>}><SearchWorkspace/></Suspense>;
}
