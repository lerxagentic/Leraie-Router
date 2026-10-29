import { describe, it, expect } from "bun:test";
import { detectFlakyResponse } from "../../src/transport/dispatch/flaky-guard";

describe("Anti-Flaky Guard", () => {
  it("detects empty text response as flaky", () => {
    const emptyResponse = {
      choices: [{ message: { content: "   " } }],
    };
    const verdict = detectFlakyResponse(emptyResponse);
    expect(verdict.flaky).toBe(true);
    expect(verdict.reason).toBe("empty");
  });

  it("detects degenerate repetitive loops as flaky", () => {
    const loopResponse = {
      choices: [{ message: { content: "OK.OK.OK.OK.OK.OK.OK.OK.OK.OK.OK.OK." } }],
    };
    const verdict = detectFlakyResponse(loopResponse);
    expect(verdict.flaky).toBe(true);
    expect(verdict.reason).toBe("degenerate");
  });

  it("treats tool calls as legitimate and not flaky", () => {
    const toolResponse = {
      choices: [
        {
          message: {
            content: "",
            tool_calls: [{ id: "call_1", function: { name: "search", arguments: "{}" } }],
          },
        },
      ],
    };
    const verdict = detectFlakyResponse(toolResponse);
    expect(verdict.flaky).toBe(false);
  });

  it("treats reasoning-only responses as not flaky", () => {
    const reasoningResponse = {
      choices: [
        {
          message: {
            content: "",
            reasoning_content: "Thinking about the complex query...",
          },
        },
      ],
    };
    const verdict = detectFlakyResponse(reasoningResponse);
    expect(verdict.flaky).toBe(false);
  });

  it("accepts normal responses as healthy", () => {
    const normalResponse = {
      choices: [{ message: { content: "Hello! How can I help you today?" } }],
    };
    const verdict = detectFlakyResponse(normalResponse);
    expect(verdict.flaky).toBe(false);
  });

  it("works across Claude Messages format", () => {
    const claudeFlaky = {
      type: "message",
      content: [{ type: "text", text: "" }],
    };
    expect(detectFlakyResponse(claudeFlaky).flaky).toBe(true);

    const claudeOk = {
      type: "message",
      content: [{ type: "text", text: "Here is your code." }],
    };
    expect(detectFlakyResponse(claudeOk).flaky).toBe(false);
  });
});
