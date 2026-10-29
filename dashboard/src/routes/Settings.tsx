import { Eye, Shield, Bell, Send, Zap, Database, KeyRound, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { consoleRequest } from "../data/api";
import { Select } from "../components/ui/select";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Card, CardBody, CardHeader } from "../components/ui/card";
import { ErrorState, LoadingState } from "../components/ui/state";
import { Inline } from "../components/ui/inline";
import { Stack } from "../components/ui/stack";
import { BackupPanel } from "../components/BackupPanel";
import { DataManagementPanel, RemoteSupportPanel } from "../components/OperationsPanels";
import { toast } from "../shared/toast";
import { useChangePassword } from "../hooks/auth";
import { useRuntimeSettings, useUpdateRuntimeSettings } from "../hooks/settings";
import { getErrorMessage } from "../shared/helpers";


function PrivacyPanel(): ReactNode {
  const query = useRuntimeSettings();
  const mutation = useUpdateRuntimeSettings();
  const settings = query.data;
  if (query.isPending) return <LoadingState label="Loading privacy settings…" />;
  if (query.isError || !settings) {
    return (
      <ErrorState
        message={getErrorMessage(query.error, "Failed to load runtime settings")}
        onRetry={() => void query.refetch()}
      />
    );
  }


  return (
      <Card>
        <CardHeader
          title="Privacy"
          subtitle="Control what request telemetry stores and shows"
          icon={<Eye size={16} />}
        />
        <CardBody>
          <Stack gap="14px">
            <div>
              <Select
                label="Telemetry payloads"
                id="privacy-payloads"
                value={settings.telemetryPayloads}
                onValueChange={(value) =>
                  mutation.mutate(
                    {
                      telemetryPayloads:
                        value === "full" || value === "metadata" ? value : "none",
                    },
                    {
                      onSuccess: () => toast.success("Payload capture updated"),
                      onError: (error) =>
                        toast.error(getErrorMessage(error, "Could not update payload capture.")),
                    },
                  )
                }
                options={[
                  {
                    value: "metadata",
                    label: "Metadata — Proxy→Provider method + headers (default), pruned after 15 minutes",
                  },
                  {
                    value: "full",
                    label: "Full — redacted bodies up to 32 MiB, pruned after 15 minutes",
                  },
                  { value: "none", label: "Off — no payload capture" },
                ]}
              />
              {settings.telemetryPayloads === "full" ? (
                <div
                  role="note"
                  style={{
                    marginTop: "8px",
                    padding: "8px 10px",
                    border: "1px solid color-mix(in srgb, var(--amber) 35%, var(--inner-border))",
                    borderRadius: "8px",
                    background: "color-mix(in srgb, var(--amber) 8%, var(--surface-2))",
                    color: "var(--text-secondary)",
                    fontSize: "11px",
                  }}
                >
                  <strong style={{ color: "var(--amber)" }}>Full capture may reduce performance.</strong>{" "}
                  Use it only while debugging, then switch back to Metadata.
                </div>
              ) : null}
              <p style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: "4px" }}>
                Request-event metadata is always retained. Default drawer capture is metadata-only
                (Proxy→Provider method + allowlisted headers). Bodies stay opt-in, redacted, and
                deleted automatically after 15 minutes.
              </p>
            </div>
            <div>
              <Select
                label="Client IP display"
                id="privacy-ip"
                value={settings.privacyMode}
                onValueChange={(value) =>
                  mutation.mutate(
                    { privacyMode: value === "full" ? "full" : "masked" },
                    {
                      onSuccess: () => toast.success("IP display updated"),
                      onError: (error) =>
                        toast.error(getErrorMessage(error, "Could not update IP display.")),
                    },
                  )
                }
                options={[
                  { value: "masked", label: "Masked — recommended" },
                  { value: "full", label: "Show full IP" },
                ]}
              />
              <p style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: "4px" }}>
                Raw addresses stay in storage; only the presentation changes.
              </p>
            </div>
          </Stack>
        </CardBody>
      </Card>
  );
}

function PasswordChangeForm(): ReactNode {
  const changePassword = useChangePassword();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const submit = () => {
    setSuccess(false);
    if (newPassword.length < 8) {
      setFormError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setFormError("New password and confirmation do not match.");
      return;
    }
    setFormError(null);
    changePassword.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          setSuccess(true);
          setCurrentPassword("");
          setNewPassword("");
          setConfirmPassword("");
        },
        onError: (error) => setFormError(getErrorMessage(error, "Password change failed.")),
      },
    );
  };

  return (
    <Stack gap="10px">
      <Input
        id="current-password"
        label="Current password"
        type="password"
        value={currentPassword}
        onChange={(e) => setCurrentPassword(e.target.value)}
        autoComplete="current-password"
      />
      <Input
        id="new-password"
        label="New password (min 8 characters)"
        type="password"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        autoComplete="new-password"
      />
      <Input
        id="confirm-password"
        label="Confirm new password"
        type="password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        autoComplete="new-password"
      />
      {formError ? <p style={{ fontSize: "12px", color: "var(--red)" }}>{formError}</p> : null}
      {success ? (
        <p style={{ fontSize: "12px", color: "var(--green)" }}>Password updated successfully.</p>
      ) : null}
      <Inline justify="flex-end" style={{ marginTop: "4px" }}>
        <Button
          variant="primary"
          size="sm"
          onClick={submit}
          disabled={
            changePassword.isPending || !currentPassword || !newPassword || !confirmPassword
          }
        >
          {changePassword.isPending ? "Updating…" : "Update Password"}
        </Button>
      </Inline>
    </Stack>
  );
}

interface NotificationStatus {
  telegram: { enabled: boolean; configured: boolean; chatId: string };
  webhook: { enabled: boolean; configured: boolean; url: string };
}

function NotificationsPanel(): ReactNode {
  const [loading, setLoading] = useState(true);
  const [tgEnabled, setTgEnabled] = useState(false);
  const [tgToken, setTgToken] = useState("");
  const [tgChatId, setTgChatId] = useState("");
  const [whEnabled, setWhEnabled] = useState(false);
  const [whUrl, setWhUrl] = useState("");
  const [whSecret, setWhSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    void consoleRequest<NotificationStatus>("/settings/notifications")
      .then((res) => {
        setTgEnabled(res.telegram.enabled);
        setTgChatId(res.telegram.chatId || "");
        setWhEnabled(res.webhook.enabled);
        setWhUrl(res.webhook.url || "");
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await consoleRequest("/settings/notifications", {
        method: "PUT",
        body: JSON.stringify({
          telegram: {
            enabled: tgEnabled,
            ...(tgToken ? { botToken: tgToken } : {}),
            chatId: tgChatId,
          },
          webhook: {
            enabled: whEnabled,
            url: whUrl,
            ...(whSecret ? { secret: whSecret } : {}),
          },
        }),
      });
      toast.success("Notification settings saved");
      setTgToken("");
      setWhSecret("");
    } catch {
      toast.error("Failed to save notifications");
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      const res = await consoleRequest<{ telegram: string; webhook: string }>(
        "/settings/notifications/test",
        { method: "POST" },
      );
      toast.success(`Test sent — Telegram: ${res.telegram}, Webhook: ${res.webhook}`);
    } catch {
      toast.error("Failed to send test alert");
    } finally {
      setTesting(false);
    }
  };

  if (loading) return <LoadingState label="Loading notification settings…" />;

  return (
    <Card>
      <CardHeader
        title="Alert Notifications"
        subtitle="Telegram Bot & Webhook alerts for quota limits, proxy failures, and silent jobs. Tokens are never exposed once saved."
        icon={<Bell size={16} />}
      />
      <CardBody>
        <Stack gap="16px">
          {/* Telegram */}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={tgEnabled}
                onChange={(e) => setTgEnabled(e.target.checked)}
              />
              Enable Telegram Alerts
            </label>
            {tgEnabled && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginTop: "4px" }}>
                <div>
                  <label style={{ fontSize: "11.5px", color: "var(--text-tertiary)", display: "block", marginBottom: "4px" }}>
                    Bot Token (blank = keep stored)
                  </label>
                  <Input
                    type="password"
                    placeholder="123456789:ABCdef..."
                    value={tgToken}
                    onChange={(e) => setTgToken(e.target.value)}
                  />
                </div>
                <div>
                  <label style={{ fontSize: "11.5px", color: "var(--text-tertiary)", display: "block", marginBottom: "4px" }}>
                    Chat ID
                  </label>
                  <Input
                    placeholder="-100... or user id"
                    value={tgChatId}
                    onChange={(e) => setTgChatId(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Webhook */}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={whEnabled}
                onChange={(e) => setWhEnabled(e.target.checked)}
              />
              Enable Webhook Alerts
            </label>
            {whEnabled && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginTop: "4px" }}>
                <div>
                  <label style={{ fontSize: "11.5px", color: "var(--text-tertiary)", display: "block", marginBottom: "4px" }}>
                    Webhook URL
                  </label>
                  <Input
                    placeholder="https://your-domain.com/webhook"
                    value={whUrl}
                    onChange={(e) => setWhUrl(e.target.value)}
                  />
                </div>
                <div>
                  <label style={{ fontSize: "11.5px", color: "var(--text-tertiary)", display: "block", marginBottom: "4px" }}>
                    HMAC Secret (blank = keep stored)
                  </label>
                  <Input
                    type="password"
                    placeholder="Secret for X-Lerx-Signature"
                    value={whSecret}
                    onChange={(e) => setWhSecret(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>

          <Inline gap="8px">
            <Button variant="primary" disabled={saving} onClick={save}>
              {saving ? "Saving…" : "Save Alerts"}
            </Button>
            <Button variant="secondary" disabled={testing} onClick={sendTest}>
              <Send size={13} style={{ marginRight: "6px" }} />
              {testing ? "Sending…" : "Send Test Alert"}
            </Button>
          </Inline>
        </Stack>
      </CardBody>
    </Card>
  );
}

interface CacheStats {
  enabled: boolean;
  stats: { size: number; hits: number; misses: number };
}

function ResponseCachePanel(): ReactNode {
  const [data, setData] = useState<CacheStats | null>(null);
  const [clearing, setClearing] = useState(false);

  const load = () => {
    void consoleRequest<CacheStats>("/settings/cache")
      .then(setData)
      .catch(() => undefined);
  };

  useEffect(() => {
    load();
  }, []);

  const clearCache = async () => {
    setClearing(true);
    try {
      await consoleRequest("/settings/cache/clear", { method: "POST" });
      toast.success("Response cache cleared");
      load();
    } catch {
      toast.error("Failed to clear cache");
    } finally {
      setClearing(false);
    }
  };

  const total = (data?.stats.hits ?? 0) + (data?.stats.misses ?? 0);
  const hitRate = total > 0 ? (((data?.stats.hits ?? 0) / total) * 100).toFixed(1) : "0.0";

  return (
    <Card>
      <CardHeader
        title="Response Cache"
        subtitle="Exact replays for identical non-streaming completions. Serves instant 0ms responses without using upstream token quota."
        icon={<Zap size={16} />}
      />
      <CardBody>
        <Stack gap="14px">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
              gap: "10px",
            }}
          >
            <div style={{ padding: "8px 12px", borderRadius: "8px", background: "var(--surface-hover)" }}>
              <div style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>Cached Entries</div>
              <div style={{ fontSize: "18px", fontWeight: 700, fontFamily: "var(--font-mono)" }}>
                {data?.stats.size ?? 0}
              </div>
            </div>
            <div style={{ padding: "8px 12px", borderRadius: "8px", background: "var(--surface-hover)" }}>
              <div style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>Cache Hits</div>
              <div style={{ fontSize: "18px", fontWeight: 700, color: "var(--green)", fontFamily: "var(--font-mono)" }}>
                {data?.stats.hits ?? 0}
              </div>
            </div>
            <div style={{ padding: "8px 12px", borderRadius: "8px", background: "var(--surface-hover)" }}>
              <div style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>Cache Misses</div>
              <div style={{ fontSize: "18px", fontWeight: 700, color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
                {data?.stats.misses ?? 0}
              </div>
            </div>
            <div style={{ padding: "8px 12px", borderRadius: "8px", background: "var(--surface-hover)" }}>
              <div style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>Hit Rate</div>
              <div style={{ fontSize: "18px", fontWeight: 700, color: "var(--accent)", fontFamily: "var(--font-mono)" }}>
                {hitRate}%
              </div>
            </div>
          </div>
          <Inline gap="8px">
            <Button variant="secondary" size="sm" disabled={clearing} onClick={clearCache}>
              <Trash2 size={13} style={{ marginRight: "6px" }} />
              {clearing ? "Clearing…" : "Clear Cache"}
            </Button>
          </Inline>
        </Stack>
      </CardBody>
    </Card>
  );
}

interface MaintenanceStatus {
  config: {
    enabled: boolean;
    retentionDays: number;
    lastRunAt: string | null;
    lastResult: {
      cutoff: string;
      prunedTelemetry: number;
      prunedCache: number;
      vacuum: string;
      ranAt: string;
    } | null;
  };
}

function DatabaseMaintenancePanel(): ReactNode {
  const [retentionDays, setRetentionDays] = useState(90);
  const [lastResult, setLastResult] = useState<MaintenanceStatus["config"]["lastResult"]>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    void consoleRequest<MaintenanceStatus>("/settings/maintenance")
      .then((res) => {
        if (res.config.retentionDays) setRetentionDays(res.config.retentionDays);
        if (res.config.lastResult) setLastResult(res.config.lastResult);
      })
      .catch(() => undefined);
  }, []);

  const runNow = async () => {
    setRunning(true);
    try {
      const res = await consoleRequest<{ result: NonNullable<MaintenanceStatus["config"]["lastResult"]> }>(
        "/settings/maintenance",
        {
          method: "POST",
          body: JSON.stringify({ retentionDays: Number(retentionDays) }),
        },
      );
      setLastResult(res.result);
      toast.success(
        `Maintenance complete: pruned ${res.result.prunedTelemetry} telemetry events (vacuum: ${res.result.vacuum})`,
      );
    } catch {
      toast.error("Failed to run maintenance");
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Database Maintenance & Pruning"
        subtitle="Prune per-request telemetry history older than retention days to reclaim disk space. Quota and rollup aggregates remain preserved."
        icon={<Database size={16} />}
      />
      <CardBody>
        <Stack gap="14px">
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <label style={{ fontSize: "13px", fontWeight: 600 }}>Retention Period (Days):</label>
            <Input
              type="number"
              style={{ width: "90px" }}
              value={retentionDays}
              onChange={(e) => setRetentionDays(Number(e.target.value))}
            />
          </div>
          {lastResult && (
            <div style={{ fontSize: "12px", color: "var(--text-tertiary)", background: "var(--surface-hover)", padding: "8px 12px", borderRadius: "8px" }}>
              Last executed: <b>{new Date(lastResult.ranAt).toLocaleString()}</b> · Pruned{" "}
              <b>{lastResult.prunedTelemetry}</b> events · Vacuum: <b>{lastResult.vacuum}</b>
            </div>
          )}
          <Inline gap="8px">
            <Button variant="primary" size="sm" disabled={running} onClick={runNow}>
              {running ? "Running…" : "Run Maintenance Now"}
            </Button>
          </Inline>
        </Stack>
      </CardBody>
    </Card>
  );
}

interface TotpStatus {
  enabled: boolean;
  backupCodesRemaining: number;
  hasPendingSetup: boolean;
}

interface TotpSetupData {
  secret: string;
  otpauthUrl: string;
  backupCodes: string[];
}

function TotpSecurityPanel(): ReactNode {
  const [status, setStatus] = useState<TotpStatus | null>(null);
  const [setupData, setSetupData] = useState<TotpSetupData | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [loading, setLoading] = useState(false);

  const load = () => {
    void consoleRequest<TotpStatus>("/settings/totp")
      .then(setStatus)
      .catch(() => undefined);
  };

  useEffect(() => {
    load();
  }, []);

  const startSetup = async () => {
    setLoading(true);
    try {
      const data = await consoleRequest<TotpSetupData>("/settings/totp", {
        method: "POST",
        body: JSON.stringify({ action: "setup" }),
      });
      setSetupData(data);
    } catch {
      toast.error("Failed to start 2FA setup");
    } finally {
      setLoading(false);
    }
  };

  const enable = async () => {
    if (!verifyCode) return;
    setLoading(true);
    try {
      await consoleRequest("/settings/totp", {
        method: "POST",
        body: JSON.stringify({ action: "enable", code: verifyCode }),
      });
      toast.success("Two-factor authentication enabled successfully!");
      setSetupData(null);
      setVerifyCode("");
      load();
    } catch {
      toast.error("Invalid authenticator code");
    } finally {
      setLoading(false);
    }
  };

  const disable = async () => {
    const code = prompt("Enter 6-digit authenticator code or a backup code to disable 2FA:");
    if (!code) return;
    setLoading(true);
    try {
      await consoleRequest("/settings/totp", {
        method: "POST",
        body: JSON.stringify({ action: "disable", code }),
      });
      toast.success("Two-factor authentication disabled");
      load();
    } catch {
      toast.error("Invalid code");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Two-Factor Authentication (2FA / TOTP)"
        subtitle="Protect console admin access with Google Authenticator, Aegis, or 1Password."
        icon={<KeyRound size={16} />}
      />
      <CardBody>
        <Stack gap="14px">
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "13px" }}>Status:</span>
            <span
              style={{
                fontSize: "12px",
                fontWeight: 600,
                padding: "2px 8px",
                borderRadius: "12px",
                background: status?.enabled ? "var(--green-subtle, rgba(34, 197, 94, 0.15))" : "var(--surface-hover)",
                color: status?.enabled ? "var(--green)" : "var(--text-tertiary)",
              }}
            >
              {status?.enabled ? `Active (${status.backupCodesRemaining} backup codes left)` : "Disabled"}
            </span>
          </div>

          {!status?.enabled && !setupData && (
            <Inline gap="8px">
              <Button variant="primary" size="sm" disabled={loading} onClick={startSetup}>
                {loading ? "Starting…" : "Set Up 2FA"}
              </Button>
            </Inline>
          )}

          {!status?.enabled && setupData && (
            <Stack gap="12px" style={{ background: "var(--surface-hover)", padding: "12px", borderRadius: "8px" }}>
              <div style={{ fontSize: "12.5px" }}>
                1. Add this secret key to your authenticator app:
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "13px", padding: "6px 8px", background: "var(--surface)", borderRadius: "6px", margin: "6px 0", wordBreak: "break-all" }}>
                  {setupData.secret}
                </div>
              </div>
              <div style={{ fontSize: "12.5px" }}>
                2. Save these one-time recovery backup codes:
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px", fontFamily: "var(--font-mono)", fontSize: "11px", margin: "6px 0" }}>
                  {setupData.backupCodes.map((c) => (
                    <span key={c} style={{ background: "var(--surface)", padding: "4px 6px", borderRadius: "4px" }}>{c}</span>
                  ))}
                </div>
              </div>
              <div style={{ fontSize: "12.5px" }}>
                3. Enter the 6-digit verification code from your app:
                <div style={{ display: "flex", gap: "8px", marginTop: "6px" }}>
                  <Input
                    placeholder="123456"
                    value={verifyCode}
                    onChange={(e) => setVerifyCode(e.target.value)}
                    style={{ width: "120px", fontFamily: "var(--font-mono)", textAlign: "center" }}
                  />
                  <Button variant="primary" size="sm" disabled={loading || !verifyCode} onClick={enable}>
                    Confirm & Enable 2FA
                  </Button>
                </div>
              </div>
            </Stack>
          )}

          {status?.enabled && (
            <Inline gap="8px">
              <Button variant="secondary" size="sm" disabled={loading} onClick={disable}>
                Disable 2FA
              </Button>
            </Inline>
          )}
        </Stack>
      </CardBody>
    </Card>
  );
}

export default function Settings(): ReactNode {
  return (
    <div className="settings-column">
      {/* Security Controls / Password Change */}
      <Card>
        <CardHeader
          title="Security Controls"
          subtitle="Manage console account credentials"
          icon={<Shield size={16} />}
        />
        <CardBody>
          <PasswordChangeForm />
        </CardBody>
      </Card>

      {/* 2FA / TOTP */}
      <TotpSecurityPanel />

      {/* Outbound Alerts */}
      <NotificationsPanel />

      {/* Response Cache */}
      <ResponseCachePanel />

      {/* Database Maintenance */}
      <DatabaseMaintenancePanel />

      {/* Privacy */}
      <PrivacyPanel />

      {/* Backup & Restore */}
      <DataManagementPanel />
      <RemoteSupportPanel />
      <BackupPanel />
    </div>
  );
}
