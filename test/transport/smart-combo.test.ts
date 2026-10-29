import { describe, it, expect, beforeEach } from "bun:test";
import {
  orderComboGroupsSmart,
  clearSmartComboSession,
  resetSmartComboSessions,
  getStickyComboModel,
  setStickyComboModel,
} from "../../src/transport/routing/smart-combo";

describe("Smart Combo Router (System One decision logic)", () => {
  beforeEach(() => {
    resetSmartComboSessions();
  });

  const groupFlash = [{ model_id: "google/gemini-2.0-flash" }];
  const groupSonnet = [{ model_id: "anthropic/claude-3-5-sonnet" }];
  const groupOpus = [{ model_id: "anthropic/claude-3-opus" }];
  const allGroups = [groupFlash, groupSonnet, groupOpus];

  it("prioritizes reasoning and high-capability models by default", () => {
    const sorted = orderComboGroupsSmart(allGroups, "coding-combo", null);
    expect(sorted[0]![0]!.model_id).toBe("anthropic/claude-3-opus");
    expect(sorted[1]![0]!.model_id).toBe("anthropic/claude-3-5-sonnet");
    expect(sorted[2]![0]!.model_id).toBe("google/gemini-2.0-flash");
  });

  it("retains session stickiness across multiple requests", () => {
    const sessionId = "sess_user_123";
    const firstCall = orderComboGroupsSmart(allGroups, "coding-combo", sessionId);
    const chosen = firstCall[0]![0]!.model_id;
    expect(chosen).toBe("anthropic/claude-3-opus");

    // Manually set stickiness to another member (e.g. Sonnet)
    setStickyComboModel("coding-combo", sessionId, "anthropic/claude-3-5-sonnet");

    // Second call with same session ID must prioritize the sticky member
    const secondCall = orderComboGroupsSmart(allGroups, "coding-combo", sessionId);
    expect(secondCall[0]![0]!.model_id).toBe("anthropic/claude-3-5-sonnet");
  });

  it("clears sticky lock when clearSmartComboSession is invoked", () => {
    const sessionId = "sess_user_fail";
    setStickyComboModel("coding-combo", sessionId, "google/gemini-2.0-flash");
    expect(getStickyComboModel("coding-combo", sessionId, ["google/gemini-2.0-flash"])).toBe("google/gemini-2.0-flash");

    clearSmartComboSession("coding-combo", sessionId);
    expect(getStickyComboModel("coding-combo", sessionId, ["google/gemini-2.0-flash"])).toBeNull();
  });
});
