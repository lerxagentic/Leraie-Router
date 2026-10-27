import { describe, expect, test } from "bun:test";
import { scrubBuddyChannelIdentityText } from "../../src/providers/integrations/buddy/buddy-chat-shared";

describe("buddy identity scrub", () => {
  test("the DSH identity scrub tolerates zero-width-space splitting", () => {
    const scrubbed = scrubBuddyChannelIdentityText("You\u200bare DeepSeek\u200b Harness");
    expect(scrubbed).toBe("You are WorkBuddy, a powerful AI assistant");
    const gui = scrubBuddyChannelIdentityText("Open the DeepSeek Harness Web GUI");
    expect(gui).toBe("Open the WorkBuddy Web GUI");
  });

  test("the scrub leaves unrelated text untouched", () => {
    const plain = "Let us harness the power of deepseek models by reading docs.";
    expect(scrubBuddyChannelIdentityText(plain)).toBe(plain);
  });
});
