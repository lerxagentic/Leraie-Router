import { expect, test } from "bun:test";
import { createElement } from "react";
import { AccountsList } from "../src/routes/provider-detail/Accounts";
import { mount } from "./helpers/render";

const staticJwtAccount = {
  id: "static-jwt",
  providerId: "workbuddy",
  tenantId: "tenant-1",
  label: "static-jwt",
  credentialKind: "oauth" as const,
  credentialMode: "jwt" as const,
  status: "active",
  usageToday: { requests: 0, errors: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  usageAllTime: { requests: 0, errors: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  createdAt: "2026-10-26T00:00:00.000Z",
  staticToken: true,
  lastRemainingCredit: null,
  sortIndex: 0,
};

test("selected static JWT account exposes Re-enable refresh beside Recover", async () => {
  const view = await mount(
    createElement(AccountsList, {
      providerId: "workbuddy",
      accounts: [staticJwtAccount],
      onDelete: () => undefined,
    }),
  );
  try {
    await view.click('input[aria-label="Select static-jwt"]');
    expect(view.text()).toContain("Re-enable refresh");
  } finally {
    view.unmount();
  }
});
