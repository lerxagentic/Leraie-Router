import { describe, expect, test } from "bun:test";
import { codebuddyHeaders } from "../../src/providers/integrations/buddy/codebuddy-shared";
import { workbuddyHeaders } from "../../src/providers/integrations/buddy/workbuddy-shared";

const HEX_32 = /^[0-9a-f]{32}$/;
const HEX_16 = /^[0-9a-f]{16}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function assertOfficialConversationHeaders(headers: Record<string, string>): void {
  expect(headers["x-conversation-id"]).toMatch(UUID);
  expect(headers["x-conversation-request-id"]).toMatch(HEX_32);
  expect(headers["x-root-request-id"]).toBe(headers["x-conversation-request-id"]);
  expect(headers["x-conversation-message-id"]).toMatch(HEX_32);
  expect(headers["x-request-id"]).toBe(headers["x-conversation-message-id"]);
  expect(headers["x-trace-id"]).toBe(headers["x-b3-traceid"]);
  expect(headers["x-trace-id"]).toMatch(HEX_32);
  expect(headers["x-b3-spanid"]).toMatch(HEX_16);
  expect(headers["x-b3-sampled"]).toBe("1");
}

describe("Buddy official conversation header family", () => {
  test("CodeBuddy INTL sends its complete channel-verification headers", async () => {
    assertOfficialConversationHeaders(await codebuddyHeaders("IDE"));
  });

  test("CodeBuddy CN sends its complete channel-verification headers", async () => {
    assertOfficialConversationHeaders(await codebuddyHeaders("CLI"));
  });

  test("WorkBuddy sends its complete channel-verification headers", async () => {
    assertOfficialConversationHeaders(await workbuddyHeaders());
  });
});
