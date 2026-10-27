import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { EmptyState, ErrorState, LoadingState } from "./ui/state";
import { Input } from "./ui/input";
import { ConfirmDialog } from "./ConfirmDialog";
import { toast } from "../shared/toast";
import { getErrorMessage } from "../shared/helpers";
import {
  useCreateModelTemplate,
  useDeleteModelTemplate,
  useModelTemplates,
  useSyncModelTemplate,
  useUpdateModelTemplate,
  type ModelTemplate,
} from "../hooks/model-templates";

/**
 * Model-template manager.
 *
 * A template is a named model whitelist used when provisioning keys. Editing a
 * template does NOT touch already-issued keys: the operator applies it with an
 * explicit Sync, which is the only action that rewrites a live key's models.
 */
export function ModelTemplatesDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): ReactNode {
  const templatesQuery = useModelTemplates();
  const createTemplate = useCreateModelTemplate();
  const updateTemplate = useUpdateModelTemplate();
  const deleteTemplate = useDeleteModelTemplate();
  const syncTemplate = useSyncModelTemplate();
  const [editing, setEditing] = useState<ModelTemplate | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ModelTemplate | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const templates = templatesQuery.data ?? [];
  const busy = createTemplate.isPending || updateTemplate.isPending;

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        title="Model templates"
        description="Named model whitelists you can apply when provisioning API keys. Editing a template never changes issued keys until you sync it."
        size="lg"
      >
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "10px" }}>
          <Button
            variant="primary"
            size="sm"
            icon={<Plus size={13} />}
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            New template
          </Button>
        </div>
        {templatesQuery.isPending && !templatesQuery.data ? (
          <LoadingState label="Loading templates…" />
        ) : templatesQuery.isError && !templatesQuery.data ? (
          <ErrorState
            message={getErrorMessage(templatesQuery.error, "Could not load templates.")}
            onRetry={() => void templatesQuery.refetch()}
          />
        ) : templates.length === 0 ? (
          <EmptyState
            title="No templates yet"
            message="Create a preset such as “DeepSeek Only” or “Budget Models” to reuse when issuing keys."
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {templates.map((template) => (
              <div
                key={template.id}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: "10px",
                  padding: "10px 12px",
                  border: "1px solid var(--inner-border)",
                  borderRadius: "10px",
                  background: "var(--surface-2)",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <strong style={{ fontSize: "12.5px" }}>{template.name}</strong>
                    <Badge tone="default">{template.modelList.length} models</Badge>
                  </div>
                  <code
                    style={{
                      display: "block",
                      marginTop: "3px",
                      fontFamily: "var(--font-mono)",
                      fontSize: "10.5px",
                      color: "var(--text-tertiary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {template.modelList.join(", ") || "—"}
                  </code>
                </div>
                <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Pencil size={12} />}
                    onClick={() => {
                      setEditing(template);
                      setFormOpen(true);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<RefreshCw size={12} />}
                    disabled={syncTemplate.isPending}
                    title="Apply this template's current models to every key linked to it"
                    onClick={() =>
                      syncTemplate.mutate(template.id, {
                        onSuccess: (result) =>
                          toast.success(
                            "Template synced",
                            `${result.updatedKeys.length} key(s) updated` +
                              (result.skippedCount > 0
                                ? `, ${result.skippedCount} skipped`
                                : ""),
                          ),
                        onError: (error) =>
                          toast.error(getErrorMessage(error, "Could not sync template.")),
                      })
                    }
                  >
                    Sync
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Trash2 size={12} />}
                    onClick={() => setDeleteTarget(template)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Dialog>

      <Dialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? "Edit template" : "New template"}
        description="One model per line. These names are copied onto a key when the template is applied."
      >
        <TemplateForm
          record={editing}
          busy={busy}
          onClose={() => setFormOpen(false)}
          onSubmit={(input) => {
            const done = {
              onSuccess: () => {
                setFormOpen(false);
                toast.success(editing ? "Template updated" : "Template created");
              },
              onError: (error: unknown) =>
                toast.error(getErrorMessage(error, "Could not save template.")),
            };
            if (editing) updateTemplate.mutate({ templateId: editing.id, input }, done);
            else createTemplate.mutate(input, done);
          }}
        />
      </Dialog>

      {deleteTarget ? (
        <ConfirmDialog
          open
          title="Delete template"
          message={`Delete “${deleteTarget.name}”? Keys created from it keep their current model list.`}
          confirmLabel="Delete"
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => {
            deleteTemplate.mutate(deleteTarget.id, {
              onSuccess: () => {
                setDeleteTarget(null);
                toast.success("Template deleted");
              },
              onError: (error) => toast.error(getErrorMessage(error, "Could not delete template.")),
            });
          }}
        />
      ) : null}
    </>
  );
}

function TemplateForm({
  record,
  busy,
  onSubmit,
  onClose,
}: {
  record: ModelTemplate | null;
  busy: boolean;
  onSubmit: (input: { name: string; modelList: string[] }) => void;
  onClose: () => void;
}): ReactNode {
  const [name, setName] = useState(record?.name ?? "");
  const [modelsText, setModelsText] = useState((record?.modelList ?? []).join("\n"));
  const modelList = modelsText
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <Input
        label="Template name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        disabled={busy}
      />
      <div className="form-group">
        <label className="form-label" htmlFor="template-models">
          <span>Models</span>
        </label>
        <textarea
          id="template-models"
          className="form-input"
          rows={6}
          value={modelsText}
          onChange={(event) => setModelsText(event.target.value)}
          disabled={busy}
          placeholder={"workbuddy/deepseek-v4.1-flash\nworkbuddy/kimi-k3"}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "6px" }}>
        <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={busy || name.trim().length === 0 || modelList.length === 0}
          onClick={() => onSubmit({ name: name.trim(), modelList })}
        >
          Save template
        </Button>
      </div>
    </div>
  );
}
