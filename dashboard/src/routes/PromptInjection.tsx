import { useEffect, useState } from "react";
import { Sparkles, Trash2, Plus, Terminal, Key } from "lucide-react";
import { Card, CardBody, CardHeader } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input, Textarea } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { PageHeader } from "../components/ui/page-header";
import { toast } from "../shared/toast";
import { consoleRequest } from "../data/api";

interface InjectedChatTurn {
  role: "user" | "assistant";
  content: string;
}

interface PromptInjectionConfig {
  id?: string;
  name?: string;
  mode?: "single" | "chat";
  text?: string;
  content?: string;
  position?: "prepend" | "append";
  turns?: InjectedChatTurn[];
  enabled?: boolean;
}

interface VariantConfig extends PromptInjectionConfig {
  name: string;
  model: string;
}

interface InjectionsState {
  global: PromptInjectionConfig | null;
  userPrompts: Record<string, PromptInjectionConfig>;
  prompts: Record<string, PromptInjectionConfig>;
  keyModelPrompts: Record<string, Record<string, PromptInjectionConfig>>;
  variants: Record<string, VariantConfig>;
}

export default function PromptInjection(): React.ReactNode {
  const [data, setData] = useState<InjectionsState | null>(null);
  const [activeTab, setActiveTab] = useState<"global" | "variants" | "keys">("global");

  // Global draft
  const [globalText, setGlobalText] = useState("");
  const [globalPos, setGlobalPos] = useState<"prepend" | "append">("prepend");
  const [globalEnabled, setGlobalEnabled] = useState(true);

  // Variant draft
  const [variantName, setVariantName] = useState("");
  const [variantModel, setVariantModel] = useState("");
  const [variantText, setVariantText] = useState("");
  const [variantPos, setVariantPos] = useState<"prepend" | "append">("prepend");

  // Key draft
  const [keyId, setKeyId] = useState("");
  const [keyText, setKeyText] = useState("");
  const [keyPos, setKeyPos] = useState<"prepend" | "append">("prepend");

  async function loadData() {
    try {
      const res = await consoleRequest<InjectionsState>("/prompt-injection");
      setData(res);
      if (res.global) {
        setGlobalText(res.global.text ?? res.global.content ?? "");
        setGlobalPos(res.global.position ?? "prepend");
        setGlobalEnabled(res.global.enabled !== false);
      }
    } catch {
      toast.error("Failed to load prompt injections");
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  async function saveGlobal() {
    try {
      await consoleRequest("/prompt-injection", {
        method: "PUT",
        body: JSON.stringify({
          global: globalText.trim()
            ? {
                mode: "single",
                text: globalText.trim(),
                position: globalPos,
                enabled: globalEnabled,
              }
            : null,
        }),
      });
      toast.success("Global prompt injection saved");
      void loadData();
    } catch {
      toast.error("Failed to save global injection");
    }
  }

  async function saveVariant() {
    if (!variantName.trim() || !variantModel.trim()) {
      toast.error("Variant name and backing model required");
      return;
    }
    try {
      await consoleRequest("/prompt-injection", {
        method: "PUT",
        body: JSON.stringify({
          variant: {
            name: variantName.trim(),
            model: variantModel.trim(),
            mode: "single",
            text: variantText.trim(),
            position: variantPos,
            enabled: true,
          },
        }),
      });
      toast.success(`Variant ${variantName} saved`);
      setVariantName("");
      setVariantModel("");
      setVariantText("");
      void loadData();
    } catch {
      toast.error("Failed to save variant");
    }
  }

  async function deleteVariant(name: string) {
    try {
      await consoleRequest(`/prompt-injection?variant=${encodeURIComponent(name)}`, {
        method: "DELETE",
      });
      toast.success(`Variant ${name} deleted`);
      void loadData();
    } catch {
      toast.error("Failed to delete variant");
    }
  }

  async function saveKey() {
    if (!keyId.trim() || !keyText.trim()) {
      toast.error("API Key ID and instruction required");
      return;
    }
    try {
      await consoleRequest("/prompt-injection", {
        method: "PUT",
        body: JSON.stringify({
          keyId: keyId.trim(),
          mode: "single",
          content: keyText.trim(),
          position: keyPos,
          enabled: true,
        }),
      });
      toast.success(`Key persona saved`);
      setKeyId("");
      setKeyText("");
      void loadData();
    } catch {
      toast.error("Failed to save key injection");
    }
  }

  async function deleteKey(id: string) {
    try {
      await consoleRequest(`/prompt-injection?keyId=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      toast.success("Key injection deleted");
      void loadData();
    } catch {
      toast.error("Failed to delete key injection");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <PageHeader
        title="Prompt Injection & Variants"
        description="Inject custom instructions, system prompts, or multi-turn chat scripts (Global, per API Key, or as custom Model Variants)."
      />

      <div style={{ display: "flex", gap: "8px", borderBottom: "1px solid var(--inner-border)", paddingBottom: "12px" }}>
        <Button
          variant={activeTab === "global" ? "primary" : "secondary"}
          size="sm"
          onClick={() => setActiveTab("global")}
        >
          <Sparkles size={14} style={{ marginRight: "6px" }} />
          Global Injection
        </Button>
        <Button
          variant={activeTab === "variants" ? "primary" : "secondary"}
          size="sm"
          onClick={() => setActiveTab("variants")}
        >
          <Terminal size={14} style={{ marginRight: "6px" }} />
          Model Variants ({Object.keys(data?.variants ?? {}).length})
        </Button>
        <Button
          variant={activeTab === "keys" ? "primary" : "secondary"}
          size="sm"
          onClick={() => setActiveTab("keys")}
        >
          <Key size={14} style={{ marginRight: "6px" }} />
          Per-API-Key Personas ({Object.keys(data?.userPrompts ?? {}).length})
        </Button>
      </div>

      {activeTab === "global" && (
        <Card>
          <CardHeader
            title="Global Prompt Injection"
            subtitle="Applied to every request passing through Lerx Router. Injected after format translation."
          />
          <CardBody style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div>
              <label style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "6px", display: "block" }}>
                Position
              </label>
              <div style={{ display: "flex", gap: "10px" }}>
                <Button
                  size="sm"
                  variant={globalPos === "prepend" ? "primary" : "secondary"}
                  onClick={() => setGlobalPos("prepend")}
                >
                  Prepend (Front of System Prompt)
                </Button>
                <Button
                  size="sm"
                  variant={globalPos === "append" ? "primary" : "secondary"}
                  onClick={() => setGlobalPos("append")}
                >
                  Append (Tail of System Prompt)
                </Button>
              </div>
            </div>

            <div>
              <label style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "6px", display: "block" }}>
                Global Instruction Content
              </label>
              <Textarea
                rows={6}
                placeholder="Enter prompt instructions that will apply globally to all models and users..."
                value={globalText}
                onChange={(e) => setGlobalText(e.target.value)}
              />
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={globalEnabled}
                  onChange={(e) => setGlobalEnabled(e.target.checked)}
                />
                Enabled
              </label>
              <Button variant="primary" onClick={saveGlobal}>
                Save Global Injection
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {activeTab === "variants" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <Card>
            <CardHeader
              title="Create Model Variant"
              subtitle="A custom-named alias model backed by one real provider/model. Picking the variant serves the model WITH this prompt; calling the raw model serves it cleanly."
            />
            <CardBody style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                <div>
                  <label style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "6px", display: "block" }}>
                    Variant Name (CLI / Client call identifier)
                  </label>
                  <Input
                    placeholder="e.g. coding-assistant, lerx-deepseek"
                    value={variantName}
                    onChange={(e) => setVariantName(e.target.value)}
                  />
                </div>
                <div>
                  <label style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "6px", display: "block" }}>
                    Backing Provider & Model
                  </label>
                  <Input
                    placeholder="e.g. workbuddy/deepseek-v4.1-flash, antigravity/gemini-3.8-flash"
                    value={variantModel}
                    onChange={(e) => setVariantModel(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "6px", display: "block" }}>
                  Position
                </label>
                <div style={{ display: "flex", gap: "10px" }}>
                  <Button
                    size="sm"
                    variant={variantPos === "prepend" ? "primary" : "secondary"}
                    onClick={() => setVariantPos("prepend")}
                  >
                    Prepend
                  </Button>
                  <Button
                    size="sm"
                    variant={variantPos === "append" ? "primary" : "secondary"}
                    onClick={() => setVariantPos("append")}
                  >
                    Append
                  </Button>
                </div>
              </div>

              <div>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "6px", display: "block" }}>
                  Prompt Content
                </label>
                <Textarea
                  rows={4}
                  placeholder="Instructions for this variant..."
                  value={variantText}
                  onChange={(e) => setVariantText(e.target.value)}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <Button variant="primary" onClick={saveVariant}>
                  <Plus size={14} style={{ marginRight: "6px" }} />
                  Create Variant
                </Button>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Configured Model Variants" />
            <CardBody style={{ padding: 0 }}>
              {Object.keys(data?.variants ?? {}).length === 0 ? (
                <div style={{ padding: "24px", textAlign: "center", color: "var(--text-tertiary)" }}>
                  No model variants configured yet.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {Object.entries(data?.variants ?? {}).map(([name, v]) => (
                    <div
                      key={name}
                      style={{
                        padding: "16px 20px",
                        borderBottom: "1px solid var(--inner-border)",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ fontWeight: 700, fontSize: "14px" }}>{name}</span>
                          <span style={{ color: "var(--text-tertiary)", fontSize: "12px" }}>→</span>
                          <Badge tone="default">{v.model}</Badge>
                        </div>
                        <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                          {v.text || v.content || "(No prompt)"}
                        </span>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => deleteVariant(name)}
                      >
                        <Trash2 size={14} style={{ color: "#ef4444" }} />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      )}

      {activeTab === "keys" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <Card>
            <CardHeader
              title="Add Per-API-Key Persona"
              subtitle="Attach custom instructions to a specific API key id. Anyone calling the gateway with this key receives the persona."
            />
            <CardBody style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "6px", display: "block" }}>
                  API Key UUID
                </label>
                <Input
                  placeholder="Paste API Key ID (e.g. 9415b498-5c1a-4d03-...)"
                  value={keyId}
                  onChange={(e) => setKeyId(e.target.value)}
                />
              </div>

              <div>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "6px", display: "block" }}>
                  Position
                </label>
                <div style={{ display: "flex", gap: "10px" }}>
                  <Button
                    size="sm"
                    variant={keyPos === "prepend" ? "primary" : "secondary"}
                    onClick={() => setKeyPos("prepend")}
                  >
                    Prepend
                  </Button>
                  <Button
                    size="sm"
                    variant={keyPos === "append" ? "primary" : "secondary"}
                    onClick={() => setKeyPos("append")}
                  >
                    Append
                  </Button>
                </div>
              </div>

              <div>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "6px", display: "block" }}>
                  Persona Instructions
                </label>
                <Textarea
                  rows={4}
                  placeholder="Instructions for this key holder..."
                  value={keyText}
                  onChange={(e) => setKeyText(e.target.value)}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <Button variant="primary" onClick={saveKey}>
                  <Plus size={14} style={{ marginRight: "6px" }} />
                  Attach Persona to Key
                </Button>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Active Key Personas" />
            <CardBody style={{ padding: 0 }}>
              {Object.keys(data?.userPrompts ?? {}).length === 0 ? (
                <div style={{ padding: "24px", textAlign: "center", color: "var(--text-tertiary)" }}>
                  No per-key personas attached yet.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {Object.entries(data?.userPrompts ?? {}).map(([id, p]) => (
                    <div
                      key={id}
                      style={{
                        padding: "16px 20px",
                        borderBottom: "1px solid var(--inner-border)",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                        <span style={{ fontWeight: 600, fontSize: "13px", fontFamily: "monospace" }}>{id}</span>
                        <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                          {p.text || p.content || "(No prompt)"}
                        </span>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => deleteKey(id)}
                      >
                        <Trash2 size={14} style={{ color: "#ef4444" }} />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}
