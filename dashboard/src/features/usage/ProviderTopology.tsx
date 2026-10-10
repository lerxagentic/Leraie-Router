import { useMemo, useState, useEffect, useRef, type ReactNode } from "react";
import {
  ReactFlow,
  Handle,
  Position,
  Controls,
  BaseEdge,
  getBezierPath,
  type Node,
  type Edge,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Radio } from "lucide-react";
import { Badge } from "../../components/ui/badge";
import { Inline } from "../../components/ui/inline";
import { useConsoleLogStream } from "../../hooks/logs";
import { useProviders } from "../../hooks/providers";

/** A dispatch event without a terminal event must never leave a beam lit
 * forever. This also protects against an SSE reconnect snapshot where the
 * old `request_dispatch` row remains but its terminal row has rolled out of
 * the bounded server-side log ring. */
const MAX_LIVE_REQUEST_MS = 90_000;

export interface TopologyProviderMeta {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly icon: string;
  readonly textIcon: string;
}

export const TOPOLOGY_PROVIDER_METAS: Record<string, TopologyProviderMeta> = {
  antigravity: { id: "antigravity", name: "Antigravity", color: "#F59E0B", icon: "/providers/antigravity.png", textIcon: "AG" },
  kiro: { id: "kiro", name: "Kiro AI", color: "#FF6B00", icon: "/providers/kiro.png", textIcon: "KR" },
  codex: { id: "codex", name: "OpenAI Codex", color: "#10A37F", icon: "/providers/codex.png", textIcon: "CX" },
  cb: { id: "cb", name: "CodeBuddy", color: "#3B82F6", icon: "/providers/codebuddy-intl.png", textIcon: "CB" },
  cbcn: { id: "cbcn", name: "CodeBuddy CN", color: "#3B82F6", icon: "/providers/codebuddy-cn.png", textIcon: "CN" },
  workbuddy: { id: "workbuddy", name: "WorkBuddy", color: "#3B82F6", icon: "/providers/workbuddy.png", textIcon: "WB" },
  grok: { id: "grok", name: "Grok CLI", color: "#1DA1F2", icon: "/providers/grok-cli.png", textIcon: "GK" },
  xai: { id: "xai", name: "xAI Grok", color: "#1DA1F2", icon: "/providers/xai.png", textIcon: "XA" },
  dahl: { id: "dahl", name: "Dahl Inference", color: "#A855F7", icon: "/providers/dahl.png", textIcon: "DH" },
  opencode: { id: "opencode", name: "OpenCode Free", color: "#EC4899", icon: "/providers/opencode.png", textIcon: "OC" },
  opencodeft: { id: "opencodeft", name: "OpenCode Free", color: "#EC4899", icon: "/providers/opencode.png", textIcon: "OC" },
  opencodego: { id: "opencodego", name: "OpenCode Go", color: "#EC4899", icon: "/providers/opencode-go.png", textIcon: "OG" },
  opencodezen: { id: "opencodezen", name: "OpenCode Zen", color: "#EC4899", icon: "/providers/opencode-zen.png", textIcon: "OZ" },
  claude: { id: "claude", name: "Claude", color: "#D97757", icon: "/providers/claude.png", textIcon: "CC" },
  gemini: { id: "gemini", name: "Gemini", color: "#4285F4", icon: "/providers/gemini.png", textIcon: "GM" },
  openai: { id: "openai", name: "OpenAI", color: "#10A37F", icon: "/providers/openai.png", textIcon: "OA" },
  pollinations: { id: "pollinations", name: "Pollinations (Flux)", color: "#8B5CF6", icon: "/providers/nanobanana.png", textIcon: "PL" },
};

export function getProviderMeta(providerId: string): TopologyProviderMeta {
  const norm = (providerId || "").toLowerCase().trim();
  return (
    TOPOLOGY_PROVIDER_METAS[norm] || {
      id: norm,
      name: norm ? norm.charAt(0).toUpperCase() + norm.slice(1) : "Unknown",
      color: "#6366F1",
      icon: `/providers/${norm}.png`,
      textIcon: (norm || "PR").slice(0, 2).toUpperCase(),
    }
  );
}

// Center Router Node: Leraie
function RouterNode({ data }: { data: { activeCount: number; isCompact?: boolean } }): ReactNode {
  const powering = (data.activeCount || 0) > 0;
  return (
    <div
      className={powering ? "topology-router-core" : ""}
      style={{
        position: "relative",
        zIndex: 10,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "8px",
        padding: data.isCompact ? "7px 12px" : "10px 18px",
        borderRadius: "14px",
        border: powering ? "2px solid #fde047" : "1.5px solid var(--accent)",
        background: powering
          ? "linear-gradient(135deg, rgba(229,106,74,0.3) 0%, rgba(250,204,21,0.25) 50%, rgba(34,211,238,0.25) 100%)"
          : "var(--surface-1)",
        boxShadow: powering
          ? "0 0 24px rgba(253,224,71,0.5), 0 0 40px rgba(34,211,238,0.3)"
          : "0 4px 16px rgba(0,0,0,0.12)",
        minWidth: data.isCompact ? "110px" : "135px",
        cursor: "default",
      }}
    >
      <Handle type="source" position={Position.Top} id="top" style={{ opacity: 0, width: 0, height: 0 }} />
      <Handle type="source" position={Position.Bottom} id="bottom" style={{ opacity: 0, width: 0, height: 0 }} />
      <Handle type="source" position={Position.Left} id="left" style={{ opacity: 0, width: 0, height: 0 }} />
      <Handle type="source" position={Position.Right} id="right" style={{ opacity: 0, width: 0, height: 0 }} />

      <img
        src="/favicon.webp"
        alt="Leraie"
        className={powering ? "topology-router-icon" : ""}
        style={{
          width: data.isCompact ? "20px" : "24px",
          height: data.isCompact ? "20px" : "24px",
          borderRadius: "6px",
          objectFit: "contain",
          display: "block",
        }}
      />
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <span
          className={powering ? "topology-router-label" : ""}
          style={{
            fontSize: data.isCompact ? "12px" : "13.5px",
            fontWeight: 800,
            letterSpacing: "0.02em",
            color: powering ? "#fef08a" : "var(--text-primary)",
          }}
        >
          Leraie
        </span>
        <span style={{ fontSize: "9.5px", color: "var(--text-tertiary)", fontWeight: 500 }}>
          Gateway Core
        </span>
      </div>

      {data.activeCount > 0 ? (
        <span
          className="topology-router-badge"
          style={{
            marginLeft: "2px",
            padding: "1px 6px",
            borderRadius: "999px",
            background: "#facc15",
            color: "#000",
            fontSize: "10.5px",
            fontWeight: 800,
          }}
        >
          {data.activeCount}
        </span>
      ) : null}
    </div>
  );
}

// Peripheral Provider Node
interface ProviderNodeData {
  label: string;
  color: string;
  imageUrl: string;
  textIcon: string;
  active: boolean;
  /** Has at least one `active` credential, so the provider is dispatchable
   * right now even when no request is in flight. */
  available: boolean;
  activeModel?: string;
  accountCount?: number;
  isCompact?: boolean;
}

function ProviderNode({ data }: { data: ProviderNodeData }): ReactNode {
  const { label, color, imageUrl, textIcon, active, available, activeModel, isCompact } = data;
  const [imgError, setImgError] = useState(false);
  // A provider lights up in two distinct ways: `active` means a request is
  // being routed through it this instant, `available` means it holds usable
  // credentials. Rendering them separately is what stops a provider with 191
  // healthy keys from looking dead whenever traffic is idle.
  const lit = active || available;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: isCompact ? "6px" : "9px",
        padding: isCompact ? "6px 10px" : "8px 14px",
        borderRadius: "12px",
        border: active
          ? `2px solid ${color}`
          : available
          ? `1.5px solid ${color}80`
          : "1px solid var(--inner-border)",
        background: "var(--surface-1)",
        boxShadow: active
          ? `0 0 20px ${color}55, 0 4px 14px rgba(0,0,0,0.15)`
          : available
          ? `0 0 10px ${color}22, 0 2px 8px rgba(0,0,0,0.06)`
          : "0 2px 8px rgba(0,0,0,0.06)",
        minWidth: isCompact ? "120px" : "155px",
        maxWidth: isCompact ? "180px" : "240px",
        transition: "all 0.25s ease",
        cursor: "default",
      }}
    >
      <Handle type="target" position={Position.Top} id="top" style={{ opacity: 0, width: 0, height: 0 }} />
      <Handle type="target" position={Position.Bottom} id="bottom" style={{ opacity: 0, width: 0, height: 0 }} />
      <Handle type="target" position={Position.Left} id="left" style={{ opacity: 0, width: 0, height: 0 }} />
      <Handle type="target" position={Position.Right} id="right" style={{ opacity: 0, width: 0, height: 0 }} />

      {/* Provider Icon */}
      <div
        style={{
          width: isCompact ? "24px" : "28px",
          height: isCompact ? "24px" : "28px",
          borderRadius: "7px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          backgroundColor: `${color}18`,
          border: `1px solid ${color}35`,
          overflow: "hidden",
        }}
      >
        {imageUrl && !imgError ? (
          <img
            src={imageUrl}
            alt={label}
            style={{ width: isCompact ? "16px" : "18px", height: isCompact ? "16px" : "18px", objectFit: "contain" }}
            onError={() => setImgError(true)}
          />
        ) : (
          <span style={{ fontSize: isCompact ? "9.5px" : "11px", fontWeight: 800, color }}>{textIcon}</span>
        )}
      </div>

      {/* Provider Details */}
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
          <span
            style={{
              fontSize: isCompact ? "11px" : "12px",
              fontWeight: 700,
              color: lit ? color : "var(--text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </span>
          {active ? (
            <span style={{ display: "inline-flex", position: "relative", width: "6px", height: "6px", flexShrink: 0 }}>
              <span
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: "50%",
                  backgroundColor: color,
                  opacity: 0.75,
                  animation: "ping 1s cubic-bezier(0,0,0.2,1) infinite",
                }}
              />
              <span style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: color }} />
            </span>
          ) : null}
        </div>

        {activeModel ? (
          <span
            style={{
              fontSize: "10px",
              fontFamily: "var(--font-mono)",
              color: active ? "#22d3ee" : "var(--text-tertiary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontWeight: 600,
            }}
            title={activeModel}
          >
            {activeModel}
          </span>
        ) : (
          <span style={{ fontSize: "9.5px", color: "var(--text-tertiary)" }}>
            {available
              ? data.accountCount
                ? `${data.accountCount} active keys`
                : "Ready"
              : "No active keys"}
          </span>
        )}
      </div>
    </div>
  );
}

// Active Electric Kame Edge
function TopologyEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  data,
}: {
  id: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
  style?: React.CSSProperties;
  data?: { active?: boolean; color?: string };
}): ReactNode {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const active = Boolean(data?.active);
  const color = data?.color || "#22d3ee";
  const stroke = style.stroke || "var(--inner-border)";
  const filterId = `topo-electric-${id}`;

  if (!active) {
    return <BaseEdge id={id} path={edgePath} style={{ ...style, stroke, strokeWidth: 1.5, opacity: 0.5 }} />;
  }

  return (
    <g className="topology-edge-electric">
      <defs>
        <filter id={filterId} x="-40%" y="-40%" width="180%" height="180%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="2" result="noise">
            <animate attributeName="baseFrequency" values="0.8;1.4;0.8" dur="0.25s" repeatCount="indefinite" />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="3.5" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>

      {/* Outer electric halo */}
      <path
        d={edgePath}
        fill="none"
        stroke={color}
        strokeWidth={10}
        strokeOpacity={0.35}
        strokeLinecap="round"
        filter={`url(#${filterId})`}
        className="topology-edge-halo"
      />

      {/* Mid plasma */}
      <path
        d={edgePath}
        fill="none"
        stroke="#4ade80"
        strokeWidth={4.5}
        strokeOpacity={0.85}
        strokeLinecap="round"
        filter={`url(#${filterId})`}
        className="topology-edge-plasma"
      />

      {/* Hot white core */}
      <BaseEdge
        id={id}
        path={edgePath}
        style={{ stroke: "#ffffff", strokeWidth: 2, opacity: 1 }}
        className="topology-edge-kame"
      />

      {/* Moving Energy Orbs */}
      {[0, 1, 2, 3, 4].map((i) => (
        <circle
          key={`${id}-p-${i}`}
          r={i % 2 === 0 ? 3.5 : 2}
          fill={i % 3 === 0 ? "#fde047" : i % 3 === 1 ? color : "#ffffff"}
          opacity={0.95}
          style={{ filter: `drop-shadow(0 0 5px ${color})` }}
        >
          <animateMotion
            dur={`${0.45 + i * 0.1}s`}
            repeatCount="indefinite"
            path={edgePath}
            begin={`${i * 0.12}s`}
          />
        </circle>
      ))}

      {/* Electric Sparks */}
      {[0, 1, 2].map((i) => (
        <circle key={`${id}-s-${i}`} r={1.5} fill="#e0f2fe" opacity={0}>
          <animate
            attributeName="opacity"
            values="0;1;0;0;1;0"
            dur={`${0.3 + i * 0.1}s`}
            begin={`${i * 0.08}s`}
            repeatCount="indefinite"
          />
          <animateMotion
            dur={`${0.3 + i * 0.08}s`}
            repeatCount="indefinite"
            path={edgePath}
            begin={`${i * 0.15}s`}
          />
        </circle>
      ))}
    </g>
  );
}

const nodeTypes = { provider: ProviderNode, router: RouterNode };
const edgeTypes = { topology: TopologyEdge };

// Layout calculation
function buildLayout(
  providers: readonly string[],
  activeMap: Map<string, { model?: string; active: boolean }>,
  accountCounts: Record<string, number>,
  availableProviders: ReadonlySet<string>,
  containerWidth: number,
): { nodes: Node[]; edges: Edge[] } {
  const isCompact = containerWidth > 0 && containerWidth < 640;
  const nodeW = isCompact ? 135 : 175;
  const nodeH = isCompact ? 30 : 34;
  const routerW = isCompact ? 115 : 140;
  const routerH = isCompact ? 42 : 48;
  const nodeGap = isCompact ? 14 : 22;

  const count = providers.length;
  if (count === 0) {
    return {
      nodes: [
        {
          id: "router",
          type: "router",
          position: { x: 0, y: 0 },
          data: { activeCount: 0, isCompact },
          draggable: false,
        },
      ],
      edges: [],
    };
  }

  // Adaptive radius based on container width
  const minRx = ((nodeW + nodeGap) * count) / (2 * Math.PI);
  const baseRx = isCompact ? Math.max(160, Math.min(220, (containerWidth - 60) / 2)) : Math.max(280, minRx);
  const rx = baseRx;
  const ry = isCompact ? Math.max(130, rx * 0.72) : Math.max(170, rx * 0.55);

  let activeCount = 0;
  for (const v of activeMap.values()) {
    if (v.active) activeCount++;
  }

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  nodes.push({
    id: "router",
    type: "router",
    position: { x: -routerW / 2, y: -routerH / 2 },
    data: { activeCount, isCompact },
    draggable: false,
  });

  providers.forEach((providerId, i) => {
    const meta = getProviderMeta(providerId);
    const activeInfo = activeMap.get(providerId.toLowerCase());
    const active = Boolean(activeInfo?.active);
    const activeModel = activeInfo?.model;
    const accountCount = accountCounts[providerId.toLowerCase()] ?? 0;
    // Dispatchable = holds at least one active credential, needs no credential
    // at all, or is known-configured on a backend that does not report counts.
    const available = accountCount > 0 || availableProviders.has(providerId.toLowerCase());
    const lit = active || available;

    const nodeId = `provider-${providerId}`;
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / count;
    const cx = rx * Math.cos(angle);
    const cy = ry * Math.sin(angle);

    let sourceHandle: string;
    let targetHandle: string;
    if (Math.abs(angle + Math.PI / 2) < Math.PI / 4 || Math.abs(angle - (3 * Math.PI) / 2) < Math.PI / 4) {
      sourceHandle = "top";
      targetHandle = "bottom";
    } else if (Math.abs(angle - Math.PI / 2) < Math.PI / 4) {
      sourceHandle = "bottom";
      targetHandle = "top";
    } else if (cx > 0) {
      sourceHandle = "right";
      targetHandle = "left";
    } else {
      sourceHandle = "left";
      targetHandle = "right";
    }

    nodes.push({
      id: nodeId,
      type: "provider",
      position: { x: cx - nodeW / 2, y: cy - nodeH / 2 },
      data: {
        label: meta.name,
        color: meta.color,
        imageUrl: meta.icon,
        textIcon: meta.textIcon,
        active,
        available,
        activeModel,
        accountCount,
        isCompact,
      },
      draggable: false,
    });

    edges.push({
      id: `e-${nodeId}`,
      type: "topology",
      source: "router",
      sourceHandle,
      target: nodeId,
      targetHandle,
      animated: false,
      data: { active: lit, color: meta.color },
      style: {
        stroke: lit ? meta.color : "var(--inner-border)",
        strokeWidth: active ? 3 : lit ? 2 : 1.5,
        opacity: active ? 1 : lit ? 0.75 : 1,
      },
    });
  });

  return { nodes, edges };
}

export interface ProviderTopologyProps {
  readonly recentRequests?: Array<{
    readonly providerId?: string;
    readonly model?: string;
    readonly startedAt?: string;
  }>;
  readonly onSelectProvider?: (providerId: string) => void;
}

export default function ProviderTopology({
}: ProviderTopologyProps): ReactNode {
  // Connect to live console logs stream for 100% REALTIME detection!
  const { lines, status: streamStatus } = useConsoleLogStream();

  // The node set is the tenant's real provider catalog, not a fixed list: any
  // provider that holds active credentials appears automatically, so adding a
  // key in the console lights up a node here without a code change.
  const providersQuery = useProviders();
  const catalog = useMemo(() => providersQuery.data ?? [], [providersQuery.data]);

  const providerList = useMemo(
    () =>
      catalog
        .filter((provider) => provider.enabled)
        .filter(
          (provider) =>
            (provider.activeAccountCount ?? 0) > 0 ||
            provider.requiresAccount === false ||
            // An older backend omits `activeAccountCount`; fall back to the
            // `configured` flag so providers with credentials stay visible
            // instead of the topology emptying out against a stale binary.
            provider.configured === true,
        )
        .map((provider) => provider.providerId),
    [catalog],
  );

  // Live credential counts straight from the catalog response.
  const accountCounts = useMemo<Record<string, number>>(() => {
    const counts: Record<string, number> = {};
    for (const provider of catalog) counts[provider.providerId.toLowerCase()] = provider.activeAccountCount ?? 0;
    return counts;
  }, [catalog]);

  // Providers that are dispatchable even without a countable credential: a
  // provider needing no key at all, or one whose count the backend did not
  // report but that is known to have accounts configured.
  const availableProviders = useMemo<ReadonlySet<string>>(
    () =>
      new Set(
        catalog
          .filter(
            (p) =>
              p.requiresAccount === false ||
              (p.activeAccountCount ?? 0) > 0 ||
              (p.activeAccountCount === undefined && p.configured === true),
          )
          .map((p) => p.providerId.toLowerCase()),
      ),
    [catalog],
  );

  // Active status per provider with linger decay
  const [activeMap, setActiveMap] = useState<Map<string, { model?: string; active: boolean }>>(new Map());
  /** Live requests keyed by requestId → the provider they are bound to.
   *  Populated on `request_dispatch` (provider known) and cleared on
   *  `request_complete`/`request_error`, so a beam is lit for exactly the
   *  duration of the request rather than only after it finishes. */
  const liveRequestsRef = useRef<
    Map<string, { providerId: string; model: string; dispatchedAt: number }>
  >(new Map());
  const processedIdsRef = useRef<Set<string>>(new Set());

  // Track container width for responsive layout
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const rfInstanceRef = useRef<ReactFlowInstance | null>(null);

  // Realtime request lifecycle. On refresh/reconnect `lines` contains a whole
  // log snapshot, not just new events. Resolve terminal events in that batch
  // FIRST, then retain only dispatches that have no terminal counterpart. This
  // prevents completed historical requests from replaying their animation every
  // time the page refreshes.
  useEffect(() => {
    if (lines.length === 0) return;

    const unseen = lines.filter((line) => {
      const key = `${line.event ?? "line"}|${line.requestId ?? line.id}`;
      if (processedIdsRef.current.has(key)) return false;
      processedIdsRef.current.add(key);
      return true;
    });
    if (processedIdsRef.current.size > 4000) {
      processedIdsRef.current = new Set([...processedIdsRef.current].slice(-2000));
    }
    if (unseen.length === 0) return;

    const terminalIds = new Set(
      unseen
        .filter((line) => (line.event === "request_complete" || line.event === "request_error") && line.requestId)
        .map((line) => line.requestId as string),
    );

    for (const line of unseen) {
      const requestId = line.requestId ?? line.id;
      const pid = line.providerId?.toLowerCase();
      const model = line.model || line.routedModel || "";

      if (line.event === "request_dispatch" && pid) {
        const occurredAt = Date.parse(line.ts);
        const dispatchedAt = Number.isFinite(occurredAt) ? occurredAt : Date.now();
        // Skip completed entries from the same replayed snapshot and stale
        // entries whose terminal row has already rolled out of the log ring.
        if (terminalIds.has(requestId) || Date.now() - dispatchedAt > MAX_LIVE_REQUEST_MS) continue;
        liveRequestsRef.current.set(requestId, { providerId: pid, model, dispatchedAt });
      } else if ((line.event === "request_complete" || line.event === "request_error") && line.requestId) {
        liveRequestsRef.current.delete(line.requestId);
      }
    }

    // Derive the visual state only from genuinely live request ids. A completed
    // request turns off immediately, while concurrent calls to the same provider
    // remain lit until the final one terminates.
    const next = new Map<string, { model?: string; active: boolean }>();
    for (const request of liveRequestsRef.current.values()) {
      next.set(request.providerId, { model: request.model, active: true });
    }
    setActiveMap(next);
  }, [lines]);

  // Safety backstop: a missing terminal frame must not keep a provider lit
  // forever. Normal request completion is handled immediately by the SSE
  // lifecycle effect above; this only handles disconnect/restart edge cases.
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      let expired = false;
      for (const [requestId, request] of liveRequestsRef.current.entries()) {
        if (now - request.dispatchedAt >= MAX_LIVE_REQUEST_MS) {
          liveRequestsRef.current.delete(requestId);
          expired = true;
        }
      }
      if (!expired) return;
      const next = new Map<string, { model?: string; active: boolean }>();
      for (const request of liveRequestsRef.current.values()) {
        next.set(request.providerId, { model: request.model, active: true });
      }
      setActiveMap(next);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Measure container width responsively with ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        if (width > 0) {
          setContainerWidth(width);
          rfInstanceRef.current?.fitView({ padding: 0.14, duration: 200 });
        }
      }
    });
    ro.observe(el);
    setContainerWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const { nodes, edges } = useMemo(
    () => buildLayout(providerList, activeMap, accountCounts, availableProviders, containerWidth),
    [providerList, activeMap, accountCounts, availableProviders, containerWidth],
  );

  const availableCount = useMemo(
    () => providerList.filter((id) => availableProviders.has(id.toLowerCase())).length,
    [providerList, availableProviders],
  );

  const fitOpts = { padding: 0.14, duration: 250 };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        width: "100%",
        minWidth: 0,
      }}
    >
      {/* Top Banner Bar */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
        <Inline gap="8px" style={{ alignItems: "center", flexWrap: "wrap" }}>
          <Radio size={15} color="var(--accent)" />
          <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-primary)" }}>
            Live Provider Connection Topology
          </span>
          <Badge tone={activeMap.size > 0 ? "ok" : "default"} dot={activeMap.size > 0 || streamStatus === "live"}>
            {activeMap.size > 0
              ? `${activeMap.size} Active Routing Beams`
              : streamStatus === "live"
              ? "Realtime Log Stream Active"
              : "Monitoring Gateway Traffic"}
          </Badge>
        </Inline>

        {/* Live node summary: how many providers are dispatchable right now,
            and how many are actually serving a request this instant. */}
        <Inline gap="6px" style={{ alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>
            {providerList.length} providers · {availableCount} with keys
            {activeMap.size > 0 ? ` · ${activeMap.size} serving` : ""}
          </span>
        </Inline>
      </div>

      {/* ReactFlow Interactive Canvas */}
      <div
        ref={containerRef}
        className="topology-canvas-container"
        style={{
          height: containerWidth < 640 ? "320px" : "420px",
          width: "100%",
          borderRadius: "12px",
          border: "1px solid var(--inner-border)",
          overflow: "hidden",
          position: "relative",
          transition: "height 0.2s ease",
        }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={fitOpts}
          minZoom={0.2}
          maxZoom={1.8}
          onInit={(instance) => {
            rfInstanceRef.current = instance;
            setTimeout(() => instance.fitView(fitOpts), 60);
          }}
          proOptions={{ hideAttribution: true }}
          panOnDrag
          zoomOnScroll
          zoomOnPinch
          preventScrolling={false}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
        >
          <Controls showInteractive={false} className="react-flow-controls-custom" />
        </ReactFlow>
      </div>
    </div>
  );
}
