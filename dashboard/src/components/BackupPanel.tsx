import { DatabaseBackup, Download, Trash2, Upload } from "lucide-react";
import { useRef, useState, useEffect, type ReactNode } from "react";
import { Button } from "./ui/button";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Input } from "./ui/input";
import { Inline } from "./ui/inline";
import { Stack } from "./ui/stack";
import { toast } from "../shared/toast";
import { downloadTextFile } from "../shared/download";
import { getErrorMessage } from "../shared/helpers";
import { useDeleteAllBackup, useExportBackup, useRestoreBackup, useAutoBackupStatus, type AutoBackupStatus } from "../hooks/backup";
import { ConfirmDialog } from "./ConfirmDialog";
import type { BackupImportReport } from "../data/contracts";
import type { DeleteAllScope } from "../../../src/console/backup/store";

/**
 * Backup and restore, as a Settings panel.
 *
 * Both actions re-authenticate with the console password, so the form is the
 * same shape for each: type the password, then export or import. The password
 * is never stored — it goes with the one request and is cleared on success.
 *
 * The copy carries the two facts an operator needs before they click, because
 * both behave in ways that are surprising otherwise: the export is plain JSON
 * containing every provider credential, and history restored from older than
 * the retention window is pruned again on the next sweep.
 */

/** Renders a router-import report: what landed, what did not, and why. */
function ImportReportPanel({ report }: { readonly report: BackupImportReport }): ReactNode {
  const imported = Object.entries(report.imported).filter(([, count]) => count > 0);
  return (
    <Stack gap="8px">
      {imported.length > 0 ? (
        <p style={{ fontSize: "12px" }}>
          Imported: {imported.map(([name, count]) => `${count} ${name}`).join(", ")}
        </p>
      ) : null}
      {report.remapped.length > 0 ? (
        <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
          Remapped provider ids: {report.remapped.join(", ")}
        </p>
      ) : null}
      {report.skipped.length > 0 ? (
        <div>
          <p style={{ fontSize: "12px", color: "var(--yellow)" }}>
            Skipped ({report.skipped.length}) — nothing was guessed:
          </p>
          <ul style={{ fontSize: "11px", color: "var(--text-tertiary)", margin: "4px 0 0 16px" }}>
            {report.skipped.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {report.warnings.length > 0 ? (
        <div>
          <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>Warnings:</p>
          <ul style={{ fontSize: "11px", color: "var(--text-tertiary)", margin: "4px 0 0 16px" }}>
            {report.warnings.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </Stack>
  );
}

/** Telegram auto-backup schedule: read status, save config, send a test backup now. */
function AutoBackupSection({ password }: { readonly password: string }): ReactNode {
  const statusApi = useAutoBackupStatus();
  const [status, setStatus] = useState<AutoBackupStatus | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [intervalHours, setIntervalHours] = useState(24);
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    try {
      const s = await statusApi.get();
      setStatus(s);
      setEnabled(s.enabled);
      setChatId(s.chatId ?? "");
      setIntervalHours(s.intervalHours);
    } catch {
      // status is a convenience; the section stays usable without it
    }
  };
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const save = async () => {
    if (password.length === 0) {
      toast.error("Enter your console password first (the field at the top).");
      return;
    }
    setBusy(true);
    try {
      const s = await statusApi.update(password, {
        enabled,
        ...(botToken.length > 0 ? { botToken } : {}),
        ...(chatId.length > 0 ? { chatId } : {}),
        intervalHours,
      });
      setStatus(s);
      setBotToken("");
      toast.success("Auto-backup settings saved.");
    } catch (error) {
      toast.error(getErrorMessage(error, "Saving auto-backup failed."));
    } finally {
      setBusy(false);
    }
  };
  const sendNow = async () => {
    if (password.length === 0) {
      toast.error("Enter your console password first (the field at the top).");
      return;
    }
    setBusy(true);
    try {
      const result = await statusApi.runNow(password);
      if (result.sent) toast.success("Backup sent to Telegram.");
      else if (result.error) toast.error(result.error);
      else toast.error("Nothing was sent — check that auto-backup is enabled and a bot token/chat id are set.");
      await refresh();
    } catch (error) {
      toast.error(getErrorMessage(error, "Sending the backup failed."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ borderTop: "1px solid var(--inner-border)", paddingTop: "14px", marginTop: "4px" }}>
      <Stack gap="10px">
        <div>
          <strong>Telegram auto-backup</strong>
          <p style={{ fontSize: "11px", color: "var(--text-tertiary)", margin: "4px 0 0" }}>
            Periodically sends this tenant&apos;s native backup to your Telegram chat via a bot —
            same idea as 9Router&apos;s auto-backup. Scheduler checks hourly; interval gates actual sends.
          </p>
        </div>
        <label style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "12px" }}>
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          <span>Enabled</span>
        </label>
        <Input
          label="Bot token (@BotFather)"
          type="password"
          value={botToken}
          placeholder={status?.botTokenMasked ?? "123456:ABC-DEF…"}
          onChange={(event) => setBotToken(event.target.value)}
          autoComplete="off"
        />
        <Input
          label="Chat ID"
          value={chatId}
          placeholder={status?.chatId ?? "e.g. 6863051027 or @channel"}
          onChange={(event) => setChatId(event.target.value)}
          autoComplete="off"
        />
        <Input
          label="Interval (hours)"
          type="number"
          value={String(intervalHours)}
          onChange={(event) => setIntervalHours(Math.max(1, Number(event.target.value) || 24))}
        />
        {status !== null ? (
          <p style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>
            Last sent: {status.lastSentAt ?? "never"}
            {status.lastError ? <> · last error: <span style={{ color: "var(--red)" }}>{status.lastError}</span></> : null}
          </p>
        ) : null}
        <Inline justify="flex-start">
          <Button variant="primary" size="sm" onClick={save} disabled={busy}>
            Save auto-backup
          </Button>
          <Button variant="secondary" size="sm" onClick={sendNow} disabled={busy || password.length === 0}>
            Send backup now
          </Button>
        </Inline>
      </Stack>
    </div>
  );
}

export function BackupPanel(): ReactNode {
  const [password, setPassword] = useState("");
  const [includeConfig, setIncludeConfig] = useState(true);
  const [includeTelemetry, setIncludeTelemetry] = useState(false);
  const [restored, setRestored] = useState<Record<string, number> | null>(null);
  const [report, setReport] = useState<BackupImportReport | null>(null);
  const [format, setFormat] = useState<string | null>(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteScopes, setDeleteScopes] = useState<ReadonlySet<DeleteAllScope>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pendingRestoreFile, setPendingRestoreFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const exportBackup = useExportBackup();
  const restoreBackup = useRestoreBackup();
  const deleteAllBackup = useDeleteAllBackup();
  const toggleDeleteScope = (scope: DeleteAllScope) => {
    setDeleteScopes((current) => {
      const next = new Set(current);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  };
  const deleteSelected = () => {
    if (deleteScopes.size === 0 || deletePassword.length === 0) return;
    setConfirmDelete(true);
  };
  const performDelete = async () => {
    const result = await deleteAllBackup.mutateAsync({
      password: deletePassword,
      scopes: [...deleteScopes],
    });
    setDeletePassword("");
    setDeleteScopes(new Set());
    setConfirmDelete(false);
    toast.success("Selected configuration deleted.", Object.entries(result.deleted).map(([table, count]) => `${table}: ${count}`).join(" · "));
  };
  const download = (exportFormat: "native" | "9router") => {
    const sections = [
      ...(includeConfig ? ["config"] : []),
      ...(includeTelemetry ? ["telemetry"] : []),
    ].join(",");
    if (sections.length === 0) {
      toast.error("Select at least one backup section.");
      return;
    }
    exportBackup.mutate(
      { password, sections, format: exportFormat },
      {
        onSuccess: (payload) => {
          const stamp = new Date().toISOString().replace(/[:.]/g, "-");
          const name = exportFormat === "9router" ? `9router-backup-${stamp}.json` : `cartethyia-backup-${stamp}.json`;
          downloadTextFile(name, JSON.stringify(payload, null, 2), "application/json");
          setPassword("");
          toast.success(exportFormat === "9router" ? "9Router-compatible backup downloaded." : "Backup downloaded.");
        },
        onError: (error) => toast.error(getErrorMessage(error, "Backup export failed.")),
      },
    );
  };

  const upload = (file: File) => {
    setPendingRestoreFile(file);
  };
  const performRestore = async () => {
    const file = pendingRestoreFile;
    if (file === null) return;
    let text: string;
    try {
      text = await file.text();
    } catch {
      throw new Error("Could not read that file.");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("That file is not valid JSON.");
    }
    const result = await restoreBackup.mutateAsync({ password, backup: parsed });
    setRestored(result.restored);
    setReport(result.report ?? null);
    setFormat(result.format);
    setPassword("");
    setPendingRestoreFile(null);
    toast.success("Restore complete.");
  };

  const restoreRows = restored === null ? [] : Object.entries(restored);

  return (
    <Card>
      <CardHeader
        title="Backup & Restore"
        subtitle="Export your configuration and history, or restore them from a file"
        icon={<DatabaseBackup size={16} />}
      />
      <CardBody>
        <Stack gap="14px">
          <Input
            id="backup-password"
            label="Console password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
          <fieldset className="backup-section-options">
            <legend>Backup sections</legend>
            <label className="backup-section-option">
              <input
                type="checkbox"
                checked={includeConfig}
                onChange={(event) => setIncludeConfig(event.target.checked)}
              />
              <span>Account, proxy &amp; settings</span>
            </label>
            <label className="backup-section-option">
              <input
                type="checkbox"
                checked={includeTelemetry}
                onChange={(event) => setIncludeTelemetry(event.target.checked)}
              />
              <span>Telemetry history</span>
            </label>
          </fieldset>
          <p style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>
            Both actions re-authenticate with your console password. The export is plain JSON
            containing provider credentials, API-key hashes, routing configuration, and Studio sessions.
            Telemetry is optional; prompt/response payload files, health-event history, and console
            identity/session data are intentionally excluded from the config backup. Treat the file exactly as you would the database.
          </p>

          <Inline justify="flex-start">
            <Button
              variant="primary"
              size="sm"
              onClick={() => download("native")}
              disabled={exportBackup.isPending || password.length === 0}
            >
              <Download size={14} /> {exportBackup.isPending ? "Exporting…" : "Download backup"}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => download("9router")}
              disabled={exportBackup.isPending || password.length === 0}
              title="Export in the 9Router database format, importable by a 9Router instance"
            >
              <Download size={14} /> Download for 9Router
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => fileInput.current?.click()}
              disabled={restoreBackup.isPending || password.length === 0}
            >
              <Upload size={14} /> {restoreBackup.isPending ? "Restoring…" : "Restore from file"}
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              style={{ display: "none" }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) upload(file);
                event.target.value = "";
              }}
            />
          </Inline>

          <p style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>
            A backup carries request metadata only — status, tokens, cost, latency — never prompt or
            response bodies, so it is not a substitute for a database dump. Restored history older
            than the retention window is pruned again on the next sweep; raise
            <code> CARTETHYIA_TELEMETRY_RETENTION_DAYS </code> if you need it to persist. A restore
            only ever touches your own tenant&apos;s rows.
          </p>

          {format !== null ? (
            <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
              Detected format: {format === "nine_router" ? "router export" : "Lerx Router backup"}
            </p>
          ) : null}

          {restoreRows.length > 0 ? (
            <div>
              <p style={{ fontSize: "12px" }}>Restored rows:</p>
              <ul style={{ fontSize: "11px", color: "var(--text-tertiary)", margin: "4px 0 0 16px" }}>
                {restoreRows.map(([table, count]) => (
                  <li key={table}>
                    {table}: {count}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {report !== null ? <ImportReportPanel report={report} /> : null}

          <AutoBackupSection password={password} />

          <div style={{ borderTop: "1px solid var(--inner-border)", paddingTop: "14px", marginTop: "4px" }}>
            <Stack gap="10px">
              <div>
                <strong style={{ color: "var(--red)" }}>Delete all</strong>
                <p style={{ fontSize: "11px", color: "var(--text-tertiary)", margin: "4px 0 0" }}>
                  Destructive action. Select exactly what should be removed. Console users, sessions, audit history, and telemetry are preserved.
                </p>
              </div>
              {([
                ["providers", "Provider", "Provider accounts, credentials, tenant models, provider routing, and account health events"],
                ["proxies", "Proxy", "Network pools, pool settings, and pool health events"],
                ["configuration", "All configuration", "Includes Provider + Proxy, plus aliases, combos, API keys, CLI tools, settings, and Studio sessions"],
              ] as const).map(([scope, label, description]) => (
                <label key={scope} style={{ display: "flex", gap: "8px", alignItems: "flex-start", fontSize: "12px" }}>
                  <input type="checkbox" checked={deleteScopes.has(scope)} onChange={() => toggleDeleteScope(scope)} />
                  <span><strong>{label}</strong><br /><span style={{ color: "var(--text-tertiary)", fontSize: "11px" }}>{description}</span></span>
                </label>
              ))}
              <Input
                label="Password required for Delete all"
                type="password"
                value={deletePassword}
                onChange={(event) => setDeletePassword(event.target.value)}
                autoComplete="current-password"
              />
              <Button
                variant="danger"
                size="sm"
                icon={<Trash2 size={14} />}
                disabled={deleteScopes.size === 0 || deletePassword.length === 0 || deleteAllBackup.isPending}
                onClick={deleteSelected}
              >
                {deleteAllBackup.isPending ? "Deleting…" : "Delete selected"}
              </Button>
            </Stack>
          </div>
          <ConfirmDialog
            open={pendingRestoreFile !== null}
            onClose={() => setPendingRestoreFile(null)}
            onConfirm={performRestore}
            title="Restore backup?"
            message="Restore replaces the selected tenant configuration described by the file. Existing provider credentials and routing data may be replaced. Continue only if this file is trusted."
            confirmLabel="Restore backup"
            danger
          />
          <ConfirmDialog
            open={confirmDelete}
            onClose={() => setConfirmDelete(false)}
            onConfirm={performDelete}
            title="Delete selected configuration?"
            message={`This cannot be undone. ${deleteScopes.has("configuration") ? "All configuration includes Provider and Proxy. " : ""}Selected scopes: ${[...deleteScopes].join(", ")}. The password will be verified again before deletion.`}
            confirmLabel="Delete permanently"
            danger
          />
        </Stack>
      </CardBody>
    </Card>
  );
}
