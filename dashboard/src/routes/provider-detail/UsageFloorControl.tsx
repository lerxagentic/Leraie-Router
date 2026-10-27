import { Gauge, Info } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "../../components/ui/button";
import { Select } from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { useRoutingStrategy } from "../../hooks/use-routing-strategy";

/** Upper bound mirrored from the backend's `usageFloor` bound. */
const MAX_FLOOR = 1_000_000;

/** The parsed floor, or `null` when the text is not a usable amount. */
function parseFloor(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < 0 || value > MAX_FLOOR) return null;
  return value;
}

/**
 * Provider-wide usage floor, shown above the account list.
 *
 * An account whose remaining allowance is at or below the floor is skipped at
 * routing time, so the request fails over to a sibling instead of spending the
 * balance the operator wanted to keep. `percent` is the useful unit for a
 * utilization-only provider (WorkBuddy reports percentages, not credits);
 * `credit` compares absolute remaining credit.
 *
 * The floor never makes a provider unroutable: when every account is at or
 * below it, they all stay routable and the request is served. The floor is a
 * preference to preserve balance, not a hard stop.
 *
 * Saves are debounced and only fire for a complete, in-range value: typing "2"
 * on the way to "25" must not persist a floor of 2 and briefly take every
 * healthy account out of rotation. Toggling on with no amount yet saves
 * nothing, which also keeps the parent's refetch from clearing the switch
 * before the operator has typed anything.
 */
export function UsageFloorControl({ providerId }: { readonly providerId: string }): ReactNode {
  const routing = useRoutingStrategy(providerId, false);
  const [enabled, setEnabled] = useState(false);
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState<"credit" | "percent">("percent");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (routing.isLoading) return;
    setEnabled(routing.usageFloor !== null);
    setValue(routing.usageFloor === null ? "" : String(routing.usageFloor));
    setUnit(routing.usageFloorUnit);
  }, [routing.isLoading, routing.usageFloor, routing.usageFloorUnit]);

  useEffect(() => () => clearTimeout(timer.current), []);

  /** Debounced persist. `enabled=false` clears; an unusable amount saves nothing. */
  const commit = (nextEnabled: boolean, nextValue: string, nextUnit: "credit" | "percent") => {
    clearTimeout(timer.current);
    const parsed = nextEnabled ? parseFloor(nextValue) : null;
    if (nextEnabled && parsed === null) return;
    timer.current = setTimeout(() => {
      if (nextUnit !== routing.usageFloorUnit) routing.setUsageFloorUnit(nextUnit);
      routing.setUsageFloor(parsed);
    }, 400);
  };

  if (routing.isLoading) return null;

  const parsed = parseFloor(value);
  const showInvalid = enabled && value.trim() !== "" && parsed === null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        padding: "10px 12px",
        borderRadius: "10px",
        border: "1px solid var(--inner-border)",
        background: "var(--surface-2)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "10px",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "13px",
              fontWeight: 600,
            }}
          >
            <Gauge size={15} aria-hidden="true" style={{ color: "var(--text-tertiary)" }} />
            Usage floor
          </div>
          <div style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>
            Skip accounts at or below this remaining allowance and fail over to the next one
          </div>
        </div>
        <Switch
          checked={enabled}
          label=""
          aria-label="Enable usage floor"
          onChange={(next: boolean) => {
            setEnabled(next);
            commit(next, value, unit);
          }}
        />
      </div>

      {enabled ? (
        <div style={{ display: "flex", alignItems: "flex-end", gap: "8px", flexWrap: "wrap" }}>
          <div className="form-group" style={{ width: "150px" }}>
            <label htmlFor="usage-floor-value" className="form-label">
              <span>Minimum remaining</span>
            </label>
            <input
              id="usage-floor-value"
              className="form-input"
              inputMode="numeric"
              value={value}
              aria-invalid={showInvalid}
              onChange={(event) => {
                const next = event.target.value;
                setValue(next);
                commit(true, next, unit);
              }}
              placeholder={unit === "percent" ? "20" : "200"}
            />
          </div>
          <div className="form-group" style={{ width: "150px" }}>
            <label htmlFor="usage-floor-unit" className="form-label">
              <span>Unit</span>
            </label>
            <Select
              id="usage-floor-unit"
              aria-label="Usage floor unit"
              value={unit}
              options={[
                { value: "percent", label: "Percent" },
                { value: "credit", label: "Credit" },
              ]}
              onValueChange={(next: string) => {
                const resolved = next === "credit" ? "credit" : "percent";
                setUnit(resolved);
                commit(true, value, resolved);
              }}
            />
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              clearTimeout(timer.current);
              setValue("");
              setEnabled(false);
              routing.setUsageFloor(null);
            }}
          >
            Clear
          </Button>
        </div>
      ) : null}

      <div
        style={{
          display: "flex",
          gap: "6px",
          fontSize: "10.5px",
          color: "var(--text-tertiary)",
          lineHeight: 1.45,
        }}
      >
        <Info size={12} aria-hidden="true" style={{ flexShrink: 0, marginTop: "2px" }} />
        <span>
          Percent compares the pooled credit balance. A rate-limit window spent on its own — a
          monthly allowance topped up by bonus packs — does not exclude the account. An account
          with no fetched reading is never excluded, and if every account is below the floor they
          all stay routable rather than failing the request.
        </span>
      </div>
    </div>
  );
}
