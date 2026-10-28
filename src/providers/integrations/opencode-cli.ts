import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { CanonicalRequest } from "../../transport/canonical-model";

const OPENCODE_BIN_PATHS = [
  process.env.OPENCODE_BIN,
  "/usr/local/bin/opencode",
  "/usr/bin/opencode",
  "/home/ubuntu/Leraie-Router/bin/opencode",
];

export function findOpencodeBinary(): string | null {
  for (const bin of OPENCODE_BIN_PATHS) {
    if (bin && existsSync(bin)) return bin;
  }
  return null;
}

export function formatOpencodeCliPrompt(request?: CanonicalRequest, payload?: unknown): string {
  if (request) {
    const parts: string[] = [];
    if (request.system && request.system.length > 0) {
      const sys = request.system
        .map((s) => (s.kind === "text" ? s.text : ""))
        .filter(Boolean)
        .join("\n")
        .trim();
      if (sys) parts.push(`[System Instructions]\n${sys}`);
    }
    const dialog = request.messages ?? [];
    if (dialog.length > 1) {
      const earlier = dialog.slice(0, -1);
      const history = earlier
        .map((m) => {
          const text = m.content.map((c) => (c.kind === "text" ? c.text : "")).join("").trim();
          return `${m.role === "assistant" ? "Assistant" : "User"}: ${text}`;
        })
        .join("\n\n");
      parts.push(`[Conversation History]\n${history}`);
      const last = dialog[dialog.length - 1];
      if (last) {
        const lastText = last.content.map((c) => (c.kind === "text" ? c.text : "")).join("").trim();
        parts.push(`User: ${lastText}`);
      }
    } else if (dialog.length === 1 && dialog[0]) {
      const last = dialog[0];
      const lastText = last.content.map((c) => (c.kind === "text" ? c.text : "")).join("").trim();
      parts.push(lastText);
    }
    const res = parts.join("\n\n").trim();
    if (res) return res;
  }
  if (
    payload &&
    typeof payload === "object" &&
    "messages" in payload &&
    Array.isArray((payload as Record<string, unknown>).messages)
  ) {
    const msgs = (payload as { messages: Array<{ role?: string; content?: unknown }> }).messages;
    const lastUser = msgs.slice().reverse().find((m) => m.role === "user");
    if (typeof lastUser?.content === "string") return lastUser.content;
  }
  return "ping";
}

export async function executeOpencodeCli(
  executable: string,
  targetModel: string,
  promptText: string,
  signal?: AbortSignal,
): Promise<string> {
  const cliArgs = ["run", "--model", targetModel, "--format", "default"];
  const homeDir = "/tmp/opencode-home";
  return new Promise((resolve, reject) => {
    let stdoutText = "";
    let stderrText = "";
    const child = spawn(executable, cliArgs, {
      env: { ...process.env, HOME: homeDir, NO_PROXY: "127.0.0.1,localhost,::1" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          try {
            child.kill("SIGKILL");
          } catch {}
          reject(new Error("Request aborted"));
        },
        { once: true },
      );
    }

    if (child.stdin) {
      try {
        child.stdin.write(promptText);
        child.stdin.end();
      } catch {}
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutText += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrText += chunk.toString("utf8");
    });

    child.on("error", (err) => {
      reject(err);
    });

    child.on("close", (code) => {
      if (code === 0 && stdoutText.trim()) {
        const cleanText = stdoutText.trim().replace(/^>[^\n]*\n+/g, "").trim();
        return resolve(cleanText || stdoutText.trim());
      }
      const combined = `${stderrText} ${stdoutText}`.trim();
      reject(new Error(`OpenCode CLI exited with code ${code}: ${combined.slice(0, 150)}`));
    });
  });
}

export function wrapTextAsSseResponse(text: string, model: string): Response {
  const responseId = `chatcmpl-oc-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const emit = (chunk: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      };
      emit({
        id: responseId,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
      });
      emit({
        id: responseId,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
      });
      emit({
        id: responseId,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      });
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}
