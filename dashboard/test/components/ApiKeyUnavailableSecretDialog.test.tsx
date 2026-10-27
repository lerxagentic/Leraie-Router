import { afterEach, describe, expect, test } from "bun:test";
import { createElement } from "react";
import { ApiKeyUnavailableSecretDialog } from "../../src/components/ApiKeyUnavailableSecretDialog";
import { registerDom, resetDom } from "../helpers/dom";
import { mount } from "../helpers/render";

registerDom();
afterEach(resetDom);

describe("ApiKeyUnavailableSecretDialog", () => {
  test("honestly explains that a listed key cannot be revealed again", async () => {
    const view = await mount(createElement(ApiKeyUnavailableSecretDialog, { open: true, onClose: () => {} }));

    expect(document.body.textContent).toContain("Key cannot be revealed");
    expect(document.body.textContent).toContain("never stores plaintext API keys");
    expect(document.body.textContent).toContain("Create or rotate the key");
    expect(document.body.textContent).not.toContain("rk_");

    view.unmount();
  });
});
