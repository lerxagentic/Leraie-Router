import { useEffect, useState, type ReactNode } from "react";
import { Gauge } from "lucide-react";
import { Card, CardBody, CardHeader } from "../../../components/ui/card";
import { consoleRequest } from "../../../data/api";

function formatMs(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  if (v < 1000) return `${Math.round(v)}ms`;
  return `${(v / 1000).toFixed(2)}s`;
}

interface LatencyData {
  period: string;
  samples: number;
  ttft: { samples: number; p50: number | null; p95: number | null };
  total: { samples: number; p50: number | null; p95: number | null };
  byProvider: Record<
    string,
    { samples: number; totalP50: number | null; totalP95: number | null; ttftP50: number | null }
  >;
}

export function LatencyCard({ period = "24h" }: { readonly period?: string }): ReactNode {
  const [data, setData] = useState<LatencyData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    consoleRequest<LatencyData>(`/system/usage/latency?period=${encodeURIComponent(period)}`)
      .then((res) => {
        if (active) {
          setData(res);
          setError(null);
        }
      })
      .catch(() => {
        if (active) setError("Latency metrics unavailable");
      });
    return () => {
      active = false;
    };
  }, [period]);

  const providers = data
    ? Object.entries(data.byProvider || {})
        .sort((a, b) => b[1].samples - a[1].samples)
        .slice(0, 5)
    : [];

  return (
    <Card>
      <CardHeader
        title="Latency & Response Timing"
        subtitle="TTFT (Time to First Token) and total latency distributions (p50 / p95) from completed telemetry events"
        icon={<Gauge size={16} />}
      />
      <CardBody>
        {error && <div style={{ fontSize: "12px", color: "var(--red)" }}>{error}</div>}
        {!data && !error && (
          <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>Loading latency data…</div>
        )}
        {data && data.samples === 0 && (
          <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
            No completed requests in this period to measure latency.
          </div>
        )}
        {data && data.samples > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
                gap: "10px",
              }}
            >
              <div style={{ padding: "8px 12px", borderRadius: "8px", background: "var(--surface-hover)" }}>
                <div style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>Samples</div>
                <div style={{ fontSize: "17px", fontWeight: 700, fontFamily: "var(--font-mono)" }}>
                  {data.samples}
                </div>
              </div>
              <div style={{ padding: "8px 12px", borderRadius: "8px", background: "var(--surface-hover)" }}>
                <div style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>TTFT p50</div>
                <div style={{ fontSize: "17px", fontWeight: 700, color: "var(--accent)", fontFamily: "var(--font-mono)" }}>
                  {formatMs(data.ttft.p50)}
                </div>
              </div>
              <div style={{ padding: "8px 12px", borderRadius: "8px", background: "var(--surface-hover)" }}>
                <div style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>TTFT p95</div>
                <div style={{ fontSize: "17px", fontWeight: 700, color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>
                  {formatMs(data.ttft.p95)}
                </div>
              </div>
              <div style={{ padding: "8px 12px", borderRadius: "8px", background: "var(--surface-hover)" }}>
                <div style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>Total p50</div>
                <div style={{ fontSize: "17px", fontWeight: 700, color: "var(--green)", fontFamily: "var(--font-mono)" }}>
                  {formatMs(data.total.p50)}
                </div>
              </div>
              <div style={{ padding: "8px 12px", borderRadius: "8px", background: "var(--surface-hover)" }}>
                <div style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>Total p95</div>
                <div style={{ fontSize: "17px", fontWeight: 700, color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>
                  {formatMs(data.total.p95)}
                </div>
              </div>
            </div>

            {providers.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "12px", borderTop: "1px solid var(--inner-border)", paddingTop: "10px" }}>
                <div style={{ fontSize: "11.5px", fontWeight: 600, color: "var(--text-tertiary)", marginBottom: "2px" }}>
                  Top Providers Breakdown:
                </div>
                {providers.map(([name, v]) => (
                  <div
                    key={name}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "4px 8px",
                      borderRadius: "6px",
                      background: "var(--surface-hover)",
                    }}
                  >
                    <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>
                      {name} <span style={{ color: "var(--text-tertiary)", fontSize: "11px" }}>({v.samples} reqs)</span>
                    </span>
                    <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)", fontSize: "11.5px" }}>
                      total p50 {formatMs(v.totalP50)} · p95 {formatMs(v.totalP95)} · ttft p50 {formatMs(v.ttftP50)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
