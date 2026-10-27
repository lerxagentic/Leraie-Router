import { randomBytes, randomUUID } from "node:crypto";

/**
 * Channel-verification identifiers required by CodeBuddy and WorkBuddy chat.
 *
 * The conversation value is stable when the client supplied/resolved one. The
 * turn, message, and span identifiers deliberately rotate for each upstream
 * dispatch, preventing one outbound message from being mistaken for another.
 */
export function buddyConversationHeaders(conversationId?: string): Record<string, string> {
  const conversation = conversationId?.trim() || randomUUID();
  const turn = randomBytes(16).toString("hex");
  const message = randomBytes(16).toString("hex");
  const trace = randomBytes(16).toString("hex");
  const span = randomBytes(8).toString("hex");
  return {
    "x-conversation-id": conversation,
    "x-conversation-request-id": turn,
    "x-root-request-id": turn,
    "x-conversation-message-id": message,
    "x-request-id": message,
    "x-trace-id": trace,
    traceparent: `00-${trace}-${span}-01`,
    b3: `${trace}-${span}-1`,
    "x-b3-traceid": trace,
    "x-b3-spanid": span,
    "x-b3-sampled": "1",
  };
}
