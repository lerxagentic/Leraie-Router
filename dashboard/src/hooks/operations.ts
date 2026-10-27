import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { consoleRequest } from "../data/api";
import { queryKeys } from "../data/query-keys";

export interface DataUsage { readonly buckets: readonly { id:string; label:string; bytes:number; files:number; note:string; reclaimableBytes:number|null; reclaimableFiles:number|null }[]; readonly totalBytes:number; readonly retentionDays:number; readonly payloadRetentionMs:number; readonly healthEventCount?:number }
export type RemoteTool = "cloudflared"|"tailscale";
export interface RemoteStatus { readonly active:RemoteTool|null; readonly url:string|null; readonly blocker:string|null; readonly message:string|null; readonly port:number; readonly installed:Readonly<Record<RemoteTool,boolean>> }
export interface Release { readonly tag_name:string; readonly html_url?:string; readonly name?:string }

export function useDataUsage(){ return useQuery({queryKey:queryKeys.operations.dataUsage,queryFn:()=>consoleRequest<DataUsage>("/data-management/usage")}); }
export function useRemoteSupport(){ return useQuery({queryKey:queryKeys.operations.remoteSupport,queryFn:()=>consoleRequest<RemoteStatus>("/remote-support/status")}); }
export function useRelease(){ return useQuery({queryKey:queryKeys.operations.release,queryFn:()=>consoleRequest<Release|null>("/updates/release"),staleTime:300_000}); }
export function useOperationMutation<T>(path:string, body?:unknown){ const client=useQueryClient(); return useMutation({mutationFn:()=>consoleRequest<T>(path,{method:"POST",body:body===undefined?undefined:JSON.stringify(body)}),onSuccess:()=>client.invalidateQueries({queryKey:["console"]})}); }
