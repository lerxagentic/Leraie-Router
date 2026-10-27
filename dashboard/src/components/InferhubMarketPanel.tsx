import { RefreshCw, TrendingDown } from "lucide-react";
import type { ReactNode } from "react";
import { useInferhubSummary } from "../hooks/inferhub";
import { Button } from "./ui/button";
import { Card, CardBody, CardHeader } from "./ui/card";
import { ErrorState, LoadingState } from "./ui/state";

const money=(n:number|null)=>n===null?"—":`$${n.toFixed(n<1?2:2)}`;
export function InferhubMarketPanel():ReactNode{
 const q=useInferhubSummary();
 if(q.isPending)return <LoadingState label="Loading InferHub market…"/>;
 if(q.isError||!q.data)return <ErrorState message="InferHub market unavailable" onRetry={()=>void q.refetch()}/>;
 const d=q.data;
 return <Card><CardHeader title="InferHub live market" subtitle={`${d.models.length} models · ${d.meta.stale?"stale snapshot":`${d.meta.ageSeconds}s old`}`} icon={<TrendingDown size={16}/>} action={<Button size="sm" variant="secondary" icon={<RefreshCw size={13}/>} onClick={()=>void q.refetch()}>Refresh</Button>}/><CardBody>
  {d.error?<p role="status">{d.error==="no_config_key"?"Configure an InferHub config_read key to load pricing.":"Upstream unavailable; showing the last snapshot."}</p>:null}
  <div style={{display:"grid",gap:8}}>{d.models.map(m=><div key={m.id} style={{padding:10,border:"1px solid var(--inner-border)",borderRadius:10}}><strong>{m.family} / {m.id}</strong><div style={{fontSize:12,color:"var(--text-secondary)"}}>Input {money(m.minAskIn)} · Output {money(m.minAskOut)} per Mtok · {m.providersLive} live · {m.routable?"Routable":"Unavailable"}</div></div>)}</div>
  {d.providers.length?<div style={{marginTop:12}}><strong>Availability</strong>{d.providers.map(p=><p key={p.prefix} style={{fontSize:12}}>{p.family}: {p.availability24hPct===null?"—":`${p.availability24hPct}%`} (24h) · {p.availability7dPct===null?"—":`${p.availability7dPct}%`} (7d)</p>)}</div>:null}
 </CardBody></Card>;
}
