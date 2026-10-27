import { afterEach, describe, expect, test } from "bun:test";
import { createElement } from "react";
import { DataManagementPanel, RemoteSupportPanel } from "../../src/components/OperationsPanels";
import { InferhubMarketPanel } from "../../src/components/InferhubMarketPanel";
import { queryKeys } from "../../src/data/query-keys";
import { registerDom, resetDom } from "../helpers/dom";
import { renderMarkup } from "../helpers/render";

registerDom();
afterEach(resetDom);

describe("operator UI parity", () => {
  test("renders InferHub prices and availability from the market snapshot", () => {
    const html = renderMarkup(createElement(InferhubMarketPanel), { seed: [{ key: queryKeys.inferhub.summary, data: {
      models: [{ id:"m1", prefix:"ih", family:"Atlas", aliasKey:"atlas", providersLive:3, minAskIn:0.25, minAskOut:0.75, capacityPriceIn:0.3, capacityPriceOut:0.8, officialIn:1, officialOut:2, lastRate:null, routable:true, tiersIn:[], tiersOut:[], systemPromptNote:null, health:{successRatePct:99,avgTtftMs:120,avgTps:40,familyState:"operational"} }],
      providers:[{prefix:"ih",family:"Atlas",familyState:"operational",availability24hPct:99.9,availability7dPct:99}], pricingConfig:null, meta:{fetchedAt:1,ageSeconds:2,stale:false},error:null
    }}] });
    expect(html).toContain("$0.25"); expect(html).toContain("3 live"); expect(html).toContain("99.9%");
  });

  test("renders data usage and destructive controls", () => {
    const html = renderMarkup(createElement(DataManagementPanel), { seed: [{ key: queryKeys.operations.dataUsage, data: { buckets:[{id:"payload_frames",label:"Payload frames",bytes:2048,files:2,note:"Expired frames",reclaimableBytes:1024,reclaimableFiles:1}],totalBytes:2048,retentionDays:30,payloadRetentionMs:900000,healthEventCount:7 }}] });
    expect(html).toContain("Data Management"); expect(html).toContain("2.0 KiB"); expect(html).toContain("Purge 7 health events");
  });

  test("renders remote support status and start controls without starting a tunnel", () => {
    const html = renderMarkup(createElement(RemoteSupportPanel), { seed: [{ key: queryKeys.operations.remoteSupport, data: { active:null,url:null,blocker:null,message:null,port:3000,installed:{cloudflared:true,tailscale:false} }}] });
    expect(html).toContain("Remote Support"); expect(html).toContain("Start Cloudflare"); expect(html).toContain("Tailscale not installed");
  });
});
