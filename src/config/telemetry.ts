export { resolveTelemetryRetentionDays } from "../config";

export function resolveTelemetryPayloadMaxBytes(): number {
  const raw = process.env.CARTETHYIA_TELEMETRY_PAYLOAD_MAX_BYTES?.trim();
  if (!raw) return 262_144;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 262_144;
}
