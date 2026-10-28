import { describe, expect, test } from "bun:test";
import { DsmlToolCallParser, parseDsmlToolCalls } from "../../src/protocol/response/dsml";

describe("DSML tool call markup parser", () => {
  test("recovers complete DSML calls from settled text", () => {
    const raw = `Here is the plan:
<｜DSML｜ calls><｜DSML｜ invoke name="get_weather"><｜DSML｜ parameter name="city" string="true">Tokyo</｜DSML｜ parameter></｜DSML｜ invoke></｜DSML｜ calls>
Done.`;
    const result = parseDsmlToolCalls(raw, new Set(["get_weather"]));
    expect(result).toBeDefined();
    expect(result?.text).toBe("Here is the plan:\n\nDone.");
    expect(result?.calls).toHaveLength(1);
    expect(result?.calls[0]?.name).toBe("get_weather");
    expect(JSON.parse(result?.calls[0]?.arguments ?? "{}")).toEqual({ city: "Tokyo" });
  });

  test("handles chunked streaming deltas", () => {
    const parser = new DsmlToolCallParser(new Set(["fetch_data"]));
    const p1 = parser.push("Checking <|DSML| calls><|DSML| invoke name=\"fetch_");
    const p2 = parser.push("data\"><|DSML| parameter name=\"id\">123</|DSML| parameter></|DSML| invoke></|DSML| calls>");
    const p3 = parser.flush();

    const allCalls = [...p1.calls, ...p2.calls, ...p3.calls];
    expect(allCalls).toHaveLength(1);
    expect(allCalls[0]?.name).toBe("fetch_data");
    expect(JSON.parse(allCalls[0]?.arguments ?? "{}")).toEqual({ id: 123 });
  });

  test("does not promote tool call if not in allowedNames", () => {
    const raw = `<|DSML| calls><|DSML| invoke name="evil_tool"></|DSML| invoke></|DSML| calls>`;
    const result = parseDsmlToolCalls(raw, new Set(["safe_tool"]));
    expect(result).toBeUndefined();
  });
});
