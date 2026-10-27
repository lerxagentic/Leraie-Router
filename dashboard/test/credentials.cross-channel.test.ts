import { expect, test } from "bun:test";
import { detectCrossChannelCredential } from "../src/shared/credential-extract";

test("a CodeBuddy credential is recognised and names WorkBuddy as the counterpart", () => {
  expect(detectCrossChannelCredential("codebuddy", "eyJhbGciOi.jwt.token")).toEqual({
    provider: "codebuddy",
    counterpart: "WorkBuddy",
  });
});

test("a WorkBuddy credential is recognised and names CodeBuddy as the counterpart", () => {
  expect(detectCrossChannelCredential("workbuddy", "eyJhbGciOi.jwt.token")).toEqual({
    provider: "workbuddy",
    counterpart: "CodeBuddy",
  });
});

test("the provider id alone is enough, whatever the token holds", () => {
  expect(detectCrossChannelCredential("codebuddy", "opaque-token")?.provider).toBe("codebuddy");
});

test("separators and casing still match", () => {
  expect(detectCrossChannelCredential("code-buddy", "")?.provider).toBe("codebuddy");
  expect(detectCrossChannelCredential("CodeBuddy", "")?.provider).toBe("codebuddy");
  expect(detectCrossChannelCredential("work_buddy", "")?.provider).toBe("workbuddy");
});

test("a token that names its own issuer is caught even on another provider", () => {
  expect(detectCrossChannelCredential("anthropic", "codebuddy_export.json")?.provider).toBe(
    "codebuddy",
  );
});

test("an unrelated provider and token is left alone", () => {
  expect(detectCrossChannelCredential("anthropic", "sk-ant-api03-xxx")).toBeUndefined();
  expect(detectCrossChannelCredential("openai", "")).toBeUndefined();
});
