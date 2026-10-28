import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import {
  ImageIcon,
  Sparkles,
  Download,
  Copy,
  Trash2,
  Maximize2,
  X,
  Play,
  Clock,
} from "lucide-react";
import { Card, CardBody, CardHeader } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Inline } from "../components/ui/inline";
import { Stack } from "../components/ui/stack";
import { ModelPickerModal } from "../components/ModelPicker";
import { toast } from "../shared/toast";
import { useClipboard } from "../hooks/use-clipboard";
import { getErrorMessage } from "../shared/helpers";
import { ensureGatewayKey } from "../shared/ensure-gateway-key";

const STORAGE_GALLERY_KEY = "cartethyia:image-lab:gallery";
const STORAGE_MODEL_KEY = "cartethyia:image-lab:model";

export interface GeneratedImageItem {
  readonly id: string;
  readonly prompt: string;
  readonly model: string;
  readonly size: string;
  readonly b64: string;
  readonly createdAt: string;
  readonly elapsedMs: number;
}

const DEFAULT_IMAGE_MODELS = [
  { id: "pollinations/flux", label: "Flux (Free & Unlimited)" },
  { id: "antigravity/gemini-3.1-flash-image", label: "Gemini 3.1 Flash Image" },
  { id: "pollinations/turbo", label: "SDXL Turbo (Ultra Fast)" },
  { id: "dahl/dall-e-3", label: "DALL-E 3 (OpenAI)" },
];

const ASPECT_RATIOS = [
  { id: "1024x1024", label: "1:1 Square", icon: "1:1" },
  { id: "1792x1024", label: "16:9 Landscape", icon: "16:9" },
  { id: "1024x1792", label: "9:16 Portrait", icon: "9:16" },
  { id: "1280x960", label: "4:3 Classic", icon: "4:3" },
  { id: "960x1280", label: "3:4 Photo", icon: "3:4" },
];

const EXAMPLE_PROMPTS = [
  "A glowing cyberpunk floating orb in a dark room with neon reflections, highly detailed 8k",
  "A tranquil Japanese zen garden in autumn with red maple leaves and a koi pond, cinematic lighting",
  "Retro 80s synthwave sports car driving towards a massive digital sunset, vaporwave aesthetics",
  "Macro close-up shot of a single water droplet on lush emerald moss, photorealistic",
];

export default function ImageLab(): ReactNode {
  const [model, setModel] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_MODEL_KEY) || "pollinations/flux";
    } catch {
      return "pollinations/flux";
    }
  });

  const [prompt, setPrompt] = useState<string>("");
  const [size, setSize] = useState<string>("1024x1024");
  const [generating, setGenerating] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [previewItem, setPreviewItem] = useState<GeneratedImageItem | null>(null);

  const [gallery, setGallery] = useState<GeneratedImageItem[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_GALLERY_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed.slice(0, 20);
      }
    } catch {}
    return [];
  });

  const abortRef = useRef<AbortController | null>(null);
  const { copy } = useClipboard();

  // Save gallery to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_GALLERY_KEY, JSON.stringify(gallery.slice(0, 20)));
    } catch {}
  }, [gallery]);

  // Save model preference
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_MODEL_KEY, model);
    } catch {}
  }, [model]);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) {
      toast.error("Please enter a prompt to generate an image.");
      return;
    }

    setGenerating(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const startTime = performance.now();

    try {
      const key = await ensureGatewayKey();
      const res = await fetch("/v1/images/generations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: model.trim(),
          prompt: prompt.trim(),
          size,
          response_format: "b64_json",
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errJson = (await res.json().catch(() => ({}))) as Record<string, any>;
        throw new Error(errJson?.error?.message || `Image generation failed (${res.status})`);
      }

      const json = (await res.json()) as {
        data?: Array<{ b64_json?: string; revised_prompt?: string }>;
      };
      const first = json.data?.[0];
      if (!first?.b64_json) {
        throw new Error("No image data returned from provider.");
      }

      const elapsed = Math.round(performance.now() - startTime);
      const newItem: GeneratedImageItem = {
        id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        prompt: prompt.trim(),
        model: model.trim(),
        size,
        b64: first.b64_json,
        createdAt: new Date().toISOString(),
        elapsedMs: elapsed,
      };

      setGallery((prev) => [newItem, ...prev]);
      toast.success(`Image generated in ${(elapsed / 1000).toFixed(1)}s!`);
    } catch (err: unknown) {
      if ((err as Error)?.name === "AbortError") {
        toast.success("Image generation stopped.");
      } else {
        toast.error(getErrorMessage(err, "Image generation failed."));
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setGenerating(false);
    }
  }, [model, prompt, size]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleDownload = (item: GeneratedImageItem) => {
    const slug = item.prompt
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 24) || "image";
    const filename = `${slug}-${Date.now()}.png`;
    const link = document.createElement("a");
    link.href = `data:image/png;base64,${item.b64}`;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("Image downloaded.");
  };

  const handleDelete = (id: string) => {
    setGallery((prev) => prev.filter((i) => i.id !== id));
    toast.success("Removed from gallery.");
  };

  const handleClearAll = () => {
    setGallery([]);
    try {
      localStorage.removeItem(STORAGE_GALLERY_KEY);
    } catch {}
    toast.success("Gallery cleared.");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px", minWidth: 0, paddingBottom: "32px" }}>
      {/* Top Banner & Control Card */}
      <Card>
        <CardHeader
          title="Image Lab"
          subtitle="AI Image Studio — generate, preview, and export high-resolution visuals via Antigravity & OpenAI models"
          icon={<ImageIcon size={18} />}
        />
        <CardBody>
          <Stack gap="14px">
            {/* Model & Aspect Ratio Controls */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                padding: "12px 14px",
                borderRadius: "10px",
                background: "var(--surface-muted)",
                border: "1px solid var(--inner-border)",
              }}
            >
              {/* Selected Model */}
              <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
                <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase" }}>
                  Active Model
                </span>
                <Inline gap="8px" style={{ alignItems: "center" }}>
                  <span style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--text-primary)" }}>
                    {model || "Pick an image model"}
                  </span>
                  <Badge tone="ok">Active</Badge>
                </Inline>
              </div>

              {/* Quick Model Selector Chips */}
              <Inline gap="6px" style={{ flexWrap: "wrap", alignItems: "center" }}>
                {DEFAULT_IMAGE_MODELS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setModel(m.id)}
                    disabled={generating}
                    style={{
                      fontSize: "11px",
                      fontWeight: model === m.id ? 700 : 500,
                      padding: "4px 8px",
                      borderRadius: "6px",
                      border: model === m.id ? "1px solid var(--accent)" : "1px solid var(--inner-border)",
                      background: model === m.id ? "var(--accent-soft, var(--surface-2))" : "var(--surface-primary)",
                      color: model === m.id ? "var(--accent)" : "var(--text-secondary)",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                  >
                    {m.label}
                  </button>
                ))}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowPicker(true)}
                  disabled={generating}
                >
                  Browse all
                </Button>
              </Inline>
            </div>

            {/* Aspect Ratio Selector */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <span style={{ fontSize: "11.5px", fontWeight: 600, color: "var(--text-secondary)" }}>
                Aspect Ratio / Dimensions
              </span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {ASPECT_RATIOS.map((r) => {
                  const active = size === r.id;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setSize(r.id)}
                      disabled={generating}
                      style={{
                        padding: "6px 12px",
                        fontSize: "12px",
                        fontWeight: active ? 700 : 500,
                        borderRadius: "8px",
                        border: active ? "1px solid var(--accent)" : "1px solid var(--inner-border)",
                        background: active ? "var(--surface-2)" : "var(--surface-muted)",
                        color: active ? "var(--text-primary)" : "var(--text-secondary)",
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "10.5px",
                          fontWeight: 700,
                          padding: "1px 4px",
                          borderRadius: "4px",
                          background: active ? "var(--accent)" : "var(--inner-border)",
                          color: active ? "#fff" : "var(--text-secondary)",
                        }}
                      >
                        {r.icon}
                      </span>
                      {r.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Prompt Input */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)" }}>
                Image Description Prompt
              </label>
              <Textarea
                placeholder="Describe what you want to see in detail (colors, subject, lighting, mood, camera style)..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={generating}
                style={{
                  minHeight: "90px",
                  fontSize: "13px",
                  lineHeight: 1.5,
                }}
              />
            </div>

            {/* Quick Inspiration Chips */}
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
              <span style={{ fontSize: "11px", color: "var(--text-tertiary)", marginRight: "4px" }}>
                Inspirations:
              </span>
              {EXAMPLE_PROMPTS.map((ex, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => !generating && setPrompt(ex)}
                  style={{
                    fontSize: "11px",
                    padding: "4px 8px",
                    borderRadius: "6px",
                    background: "var(--surface-muted)",
                    border: "1px solid var(--inner-border)",
                    color: "var(--text-secondary)",
                    cursor: generating ? "not-allowed" : "pointer",
                    transition: "all 0.15s ease",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-secondary)")}
                >
                  <Sparkles size={11} style={{ display: "inline", marginRight: "4px", verticalAlign: "middle" }} />
                  {ex.length > 40 ? ex.slice(0, 40) + "…" : ex}
                </button>
              ))}
            </div>

            {/* Actions Bar */}
            <Inline gap="10px" style={{ alignItems: "center", justifyContent: "space-between", marginTop: "4px", flexWrap: "wrap" }}>
              <Inline gap="8px" style={{ flexWrap: "wrap" }}>
                {generating ? (
                  <Button variant="danger" size="sm" onClick={handleStop}>
                    Stop Generating
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleGenerate}
                    disabled={!prompt.trim() || !model.trim()}
                  >
                    <Play size={14} /> Generate Image
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPrompt("")}
                  disabled={generating || !prompt}
                >
                  Clear prompt
                </Button>
              </Inline>

              {gallery.length > 0 ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleClearAll}
                  disabled={generating}
                >
                  <Trash2 size={13} /> Clear Gallery ({gallery.length})
                </Button>
              ) : null}
            </Inline>
          </Stack>
        </CardBody>
      </Card>

      {/* Generating Placeholder */}
      {generating ? (
        <Card style={{ padding: "32px", textAlign: "center", background: "var(--surface-muted)" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
            <span className="mlab-live-dot" style={{ width: "12px", height: "12px" }} />
            <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>
              Rendering Image…
            </div>
            <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
              Calling {model} via Lerx Router Gateway
            </div>
          </div>
        </Card>
      ) : null}

      {/* Gallery Section */}
      {gallery.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-primary)" }}>
              Generated Gallery ({gallery.length})
            </span>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 280px), 1fr))",
              gap: "16px",
            }}
          >
            {gallery.map((item) => (
              <Card key={item.id} style={{ overflow: "hidden", display: "flex", flexDirection: "column" }}>
                {/* Image Container */}
                <div
                  style={{
                    position: "relative",
                    background: "#080808",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    minHeight: "240px",
                  }}
                  onClick={() => setPreviewItem(item)}
                >
                  <img
                    src={`data:image/png;base64,${item.b64}`}
                    alt={item.prompt}
                    style={{
                      width: "100%",
                      height: "auto",
                      maxHeight: "360px",
                      objectFit: "contain",
                      display: "block",
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      bottom: "8px",
                      right: "8px",
                      background: "rgba(0,0,0,0.7)",
                      color: "#fff",
                      padding: "3px 6px",
                      borderRadius: "4px",
                      fontSize: "11px",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                  >
                    <Maximize2 size={11} /> Zoom
                  </div>
                </div>

                {/* Metadata & Actions */}
                <CardBody style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "12px 14px", flex: 1 }}>
                  <div style={{ fontSize: "12.5px", color: "var(--text-primary)", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                    &quot;{item.prompt}&quot;
                  </div>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center", fontSize: "11px", color: "var(--text-tertiary)" }}>
                    <Badge tone="default">{item.model.split("/").pop()}</Badge>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}>
                      <Clock size={11} /> {(item.elapsedMs / 1000).toFixed(1)}s
                    </span>
                    <span>· {item.size}</span>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid var(--inner-border)", paddingTop: "8px", marginTop: "auto" }}>
                    <Inline gap="6px">
                      <Button variant="secondary" size="sm" onClick={() => handleDownload(item)}>
                        <Download size={13} /> Download
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={async () => {
                          const ok = await copy(item.prompt);
                          if (ok) toast.success("Prompt copied.");
                        }}
                      >
                        <Copy size={13} /> Copy Prompt
                      </Button>
                    </Inline>
                    <Button variant="secondary" size="sm" onClick={() => handleDelete(item.id)} title="Delete image">
                      <Trash2 size={13} />
                    </Button>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        </div>
      ) : null}

      {/* Lightbox / Zoom Modal */}
      {previewItem ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(0,0,0,0.85)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
          }}
          onClick={() => setPreviewItem(null)}
        >
          <div
            style={{
              position: "relative",
              maxWidth: "90vw",
              maxHeight: "90vh",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "12px",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setPreviewItem(null)}
              style={{
                position: "absolute",
                top: "-36px",
                right: "0",
                background: "transparent",
                border: "none",
                color: "#fff",
                cursor: "pointer",
                padding: "4px",
              }}
            >
              <X size={24} />
            </button>
            <img
              src={`data:image/png;base64,${previewItem.b64}`}
              alt={previewItem.prompt}
              style={{
                maxWidth: "100%",
                maxHeight: "75vh",
                objectFit: "contain",
                borderRadius: "8px",
                boxShadow: "0 10px 40px rgba(0,0,0,0.8)",
              }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <Button variant="primary" size="sm" onClick={() => handleDownload(previewItem)}>
                <Download size={14} /> Download Full Image (.png)
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={async () => {
                  const ok = await copy(previewItem.prompt);
                  if (ok) toast.success("Prompt copied.");
                }}
              >
                <Copy size={14} /> Copy Prompt
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Model Picker Modal */}
      <ModelPickerModal
        open={showPicker}
        onClose={() => setShowPicker(false)}
        selected={model ? [model] : []}
        multi={false}
        onToggle={() => {}}
        onSelectOne={(picked) => {
          setModel(picked);
          setShowPicker(false);
        }}
        title="Select Model for Image Generation"
      />
    </div>
  );
}
