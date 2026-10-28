import { Eye, Shield, Bell, Send } from "lucide-react";
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

      {/* Outbound Alerts */}
      <NotificationsPanel />

      {/* Privacy */}
      <PrivacyPanel />

      {/* Backup & Restore */}
      <DataManagementPanel />
      <RemoteSupportPanel />
      <BackupPanel />
    </div>
  );
}
