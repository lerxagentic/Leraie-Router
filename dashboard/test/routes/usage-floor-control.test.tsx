import { afterEach, describe, expect, test } from "bun:test";
import { createElement } from "react";
import { UsageFloorControl } from "../../src/routes/provider-detail/UsageFloorControl";
import { queryKeys } from "../../src/data/query-keys";
import { registerDom, resetDom } from "../helpers/dom";
import { mount } from "../helpers/render";

registerDom();
afterEach(resetDom);

/** The routing payload shape the panel reads, as the API returns it. */
function routing(overrides: Record<string, unknown> = {}) {
  return {
    providerId: "workbuddy",
    strategy: "fallback",
    rotateCount: 1,
    maxInflight: null,
    bypassProxy: false,
    assignedPoolId: null,
    userAgent: null,
    creditLimitEnabled: true,
    creditLimit: 200,
    usageFloor: null,
    usageFloorUnit: "percent",
    ...overrides,
  };
}

function seed(overrides: Record<string, unknown> = {}) {
  return [{ key: queryKeys.providers.routing("workbuddy"), data: routing(overrides) }];
}

/**
 * The panel is driven by the routing query. A rendered "enabled" switch with no
 * backing data would invite an operator to set a floor that never saves, so the
 * loading state must stay silent — and every configured state must reflect what
 * the server actually stores, not the component's default.
 */
describe("UsageFloorControl", () => {
  test("renders nothing while the routing settings are still loading", async () => {
    const view = await mount(createElement(UsageFloorControl, { providerId: "workbuddy" }));
    try {
      expect(view.text()).not.toContain("Usage floor");
    } finally {
      view.unmount();
    }
  });

  test("shows the floor off when the provider has no floor configured", async () => {
    const view = await mount(createElement(UsageFloorControl, { providerId: "workbuddy" }), {
      seed: seed({ usageFloor: null }),
    });
    try {
      expect(view.text()).toContain("Usage floor");
      // Off means no value input: the operator has not opted in.
      expect(view.container.querySelector("#usage-floor-value")).toBeNull();
    } finally {
      view.unmount();
    }
  });

  test("shows the stored floor and unit when one is configured", async () => {
    const view = await mount(createElement(UsageFloorControl, { providerId: "workbuddy" }), {
      seed: seed({ usageFloor: 30, usageFloorUnit: "percent" }),
    });
    try {
      const input = view.container.querySelector<HTMLInputElement>("#usage-floor-value");
      expect(input).not.toBeNull();
      expect(input?.value).toBe("30");
      // `Select` is a Radix trigger, not a native <select>, so the stored unit
      // shows as the trigger's text rather than a form value.
      expect(view.text("#usage-floor-unit")).toContain("Percent");
    } finally {
      view.unmount();
    }
  });

  test("renders the credit unit when that is what is stored", async () => {
    const view = await mount(createElement(UsageFloorControl, { providerId: "workbuddy" }), {
      seed: seed({ usageFloor: 250, usageFloorUnit: "credit" }),
    });
    try {
      expect(view.container.querySelector<HTMLInputElement>("#usage-floor-value")?.value).toBe(
        "250",
      );
      expect(view.text("#usage-floor-unit")).toContain("Credit");
    } finally {
      view.unmount();
    }
  });

  test("toggling the switch on reveals the value input", async () => {
    const view = await mount(createElement(UsageFloorControl, { providerId: "workbuddy" }), {
      seed: seed({ usageFloor: null }),
    });
    try {
      expect(view.container.querySelector("#usage-floor-value")).toBeNull();
      // The helper dispatches a real bubbling MouseEvent, which is what React
      // listens for; a bare `element.click()` does not reach its handlers here.
      await view.click('[aria-label="Enable usage floor"]');
      expect(view.container.querySelector("#usage-floor-value")).not.toBeNull();
      expect(
        view.container
          .querySelector('[aria-label="Enable usage floor"]')
          ?.getAttribute("aria-checked"),
      ).toBe("true");
    } finally {
      view.unmount();
    }
  });
});
