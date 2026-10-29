import { GENERIC_API_KEY_SPECS } from "./integrations/configured-openai-providers";
import { createApiKeyAdapter } from "./integrations/configured-provider";
import { ProviderRegistry, toRegistration, type ProviderAuthentication, type ProviderModule } from "./provider-registry";
import type { OAuthLoginClient } from "./authentication/oauth-flow-store";
import type { QuotaFetcher } from "./quota/quota-support";
import { BUNDLED_PROVIDER_METADATA, PROVIDER_COMPATIBILITY_PROFILES, providerRequiresAccount, providerUpstreamHost, providerDefaultWireFamily, type BundledProviderId } from "./provider-metadata";
import { defineModel } from "./model-definition";
import type { ProviderModelDiscovery } from "./discovery/discovery-types";
import type { QoderRealm } from "./integrations/qoder/qoder-realm";
import type { TraeRealm } from "./integrations/trae/trae-realm";

/**
 * Builds a lazy OAuth authentication loader from a dynamic module import and the
 * exported client name. The same client usually acts as its own refresher, so
 * `withRefresher` mirrors the client as the refresher.
 */
function oauthCapability<M, K extends keyof M>(
  loader: () => Promise<M>,
  exportName: K,
  options: { readonly withRefresher?: boolean } = {},
): () => Promise<ProviderAuthentication> {
  return async () => {
    const module = await loader();
    const client = (module as Record<string, unknown>)[exportName as string] as OAuthLoginClient & { refresh: unknown };
    return options.withRefresher
      ? ({ client, refresher: client } as ProviderAuthentication)
      : ({ client } as ProviderAuthentication);
  };
}

/**
 * Builds a lazy quota-collector loader from a dynamic module import and the
 * exported collector function name.
 */
function quotaCapability<M, K extends keyof M>(
  loader: () => Promise<M>,
  exportName: K,
): () => Promise<QuotaFetcher> {
  return () => loader().then((module) => (module as Record<string, unknown>)[exportName as string] as QuotaFetcher);
}

/** Implementation details merged into the canonical ProviderModule rows. */
type ProviderModuleCapabilities = Partial<Omit<ProviderModule, "loadAdapter">> &
  Pick<ProviderModule, "loadAdapter">;

function configuredProvider(
  providerId: keyof typeof GENERIC_API_KEY_SPECS,
  loadModels?: ProviderModuleCapabilities["loadModels"],
): ProviderModuleCapabilities {
  return {
    loadAdapter: async () => createApiKeyAdapter(GENERIC_API_KEY_SPECS[providerId]),
    ...(loadModels === undefined ? {} : { loadModels }),
  };
}

function openAIModelDiscovery(
  providerId: string,
  options?: {
    readonly transformBaseUrl?: (baseUrl: string) => string;
    readonly headers?: (credential: string) => Readonly<Record<string, string>>;
  },
): () => Promise<ProviderModelDiscovery> {
  return async () => async ({ baseUrl, credential, fetcher }) => {
    const { fetchOpenAICompatibleModels } = await import("./discovery/openai-model-discovery");
    return fetchOpenAICompatibleModels({
      baseUrl: options?.transformBaseUrl?.(baseUrl) ?? baseUrl,
      providerId,
      ...(options?.headers ? { headers: options.headers(credential) } : {}),
      ...(fetcher ? { fetcher } : {}),
    });
  };
}

function traeDiscovery(
  realm: TraeRealm,
  providerId: string,
): NonNullable<ProviderModuleCapabilities["loadModelDiscovery"]> {
  return async () => async (request: Parameters<ProviderModelDiscovery>[0]) => {
    const { discoverTraeModels } = await import("./integrations/trae/trae");
    const { TRAE_INTL_MODELS, TRAE_CN_MODELS } = await import("./integrations/trae/trae-catalog");
    const secret = request.credential.trim();
    const fetcher = request.fetcher as unknown as typeof fetch | undefined;
    if (secret.length === 0 || fetcher === undefined) {
      return realm === "cn" ? TRAE_CN_MODELS : TRAE_INTL_MODELS;
    }
    let token = secret;
    if (secret.startsWith("{")) {
      try {
        const parsed = JSON.parse(secret) as Record<string, unknown>;
        const found = ["accessToken", "access_token", "token"].find(
          (key) => typeof parsed[key] === "string" && (parsed[key] as string).length > 0,
        );
        if (found !== undefined) token = parsed[found] as string;
      } catch {
        // Use the raw secret as the token.
      }
    }
    const region = request.authState?.["region"];
    const rows = await discoverTraeModels({
      realm,
      token,
      uid: (request.authState?.["accountId"] as string | undefined) ?? "",
      fetcher,
      providerId,
      ...(typeof region === "string" ? { region } : {}),
    });
    if (rows.length === 0) return realm === "cn" ? TRAE_CN_MODELS : TRAE_INTL_MODELS;
    const fallback = realm === "cn" ? TRAE_CN_MODELS : TRAE_INTL_MODELS;
    const byId = new Map(fallback.map((model) => [model.modelId, model]));
    return rows
      .map((row) => {
        const existing = byId.get(row.id);
        if (existing === undefined) {
          const template = fallback[0];
          if (template === undefined) return undefined;
          return { ...template, modelId: row.id, contextLimit: row.ctx ?? null };
        }
        return row.ctx === undefined ? existing : { ...existing, contextLimit: row.ctx };
      })
      .filter((model): model is NonNullable<typeof model> => model !== undefined);
  };
}

function qoderDiscovery(
  realm: QoderRealm,
  providerId: string,
): NonNullable<ProviderModuleCapabilities["loadModelDiscovery"]> {
  return async () => async (request: Parameters<ProviderModelDiscovery>[0]) => {
    const { discoverQoderModels } = await import("./integrations/qoder/qoder-catalog");
    const { resolveQoderAuth, qoderSignerFor, qoderEncodeBody } = await import("./integrations/qoder/qoder");
    const secret = request.credential.trim();
    if (secret.length === 0) throw new Error("Qoder credential is required");
    const fetcher = request.fetcher as unknown as typeof fetch | undefined;
    const auth = await resolveQoderAuth({
      secret,
      authState: request.authState,
      signal: AbortSignal.timeout(15_000),
      fetcher: (url: string, init: RequestInit) => (fetcher ?? globalThis.fetch)(url, init),
    });
    const signer = qoderSignerFor(auth);
    return discoverQoderModels({
      realm,
      providerId,
      credential: secret,
      headers: (url: string, body: string) => Promise.resolve(signer(url, body)),
      ...(fetcher === undefined ? {} : { fetcher }),
      encode: qoderEncodeBody,
    });
  };
}

/**
 * Adapter, model, OAuth, and quota behavior keyed by canonical provider ID.
 *
 * Adapter and model references use dynamic `import()` so a provider's module
 * graph — including bespoke protobuf adapters and their large generated
 * declarations — is evaluated on first use rather than at startup. Model
 * catalogs are declared inline in each `api-key/` provider module, so a
 * catalog load evaluates the same module the adapter uses; the dynamic import
 * still keeps that evaluation off the startup path.
 */
export const PROVIDER_CAPABILITIES = {
  openai: {
    endpointPathsByWireFamily: { chat: "/v1/chat/completions", responses: "/v1/responses" },
    loadAdapter: async () => createApiKeyAdapter((await import("./integrations/openai")).OPENAI_SPEC),
    loadModels: async () => (await import("./integrations/openai")).OPENAI_MODELS,
    loadModelDiscovery: openAIModelDiscovery("openai", { headers: (credential) => ({ authorization: `Bearer ${credential}` }) }),
  },
  anthropic: {
    endpointPathsByWireFamily: { messages: "/v1/messages" },
    loadAdapter: async () => (await import("./integrations/anthropic")).createAnthropicAdapter(),
    loadModels: async () => (await import("./integrations/anthropic")).ANTHROPIC_MODELS,
    loadModelDiscovery: openAIModelDiscovery("anthropic", { headers: (credential) => ({ "x-api-key": credential, "anthropic-version": "2023-06-01" }) }),
  },
  claude: {
    loadAdapter: async () => (await import("./integrations/claude/claude")).claudeAdapter,
    loadModels: async () => (await import("./integrations/claude/claude")).CLAUDE_MODELS,
    loadAuthentication: oauthCapability(() => import("./integrations/claude/claude-oauth"), "claudeOAuthClient", { withRefresher: true }),
    loadQuotaCollector: quotaCapability(() => import("./integrations/claude/claude-quota"), "fetchClaudeQuota"),
    loadModelDiscovery: async () => async ({ credential, fetcher }) => {
      const { discoverClaudeModels } = await import("./integrations/claude/claude-oauth");
      const { modelIds } = await discoverClaudeModels(credential, ...(fetcher ? [fetcher] : []));
      // `defineModel` resolves limits/pricing by model name: an exact catalog
      // row first, then the bare id, then the most-agreed row for that name
      // (date suffixes stripped). The live listing carries dated ids
      // (`claude-sonnet-4-5-20250929`) the catalog files undated, so a name
      // match is what fills their limits — a hardcoded `null` here is what
      // rendered "n/a ctx · n/a out".
      return modelIds.map((modelId) =>
        defineModel({
          id: modelId,
          providerId: "claude",
          wireFamily: "messages",
          endpoint: "/v1/messages",
          vision: true,
          reasoning: true,
          toolCall: true,
        }),
      );
    },
  },
  codex: {
    loadAdapter: async () => (await import("./integrations/codex/codex")).createCodexAdapter({ provider_id: "codex" }),
    loadModels: async () => (await import("./integrations/codex/codex")).CODEX_MODELS,
    loadAuthentication: oauthCapability(() => import("./integrations/codex/codex-oauth"), "codexOAuthClient", { withRefresher: true }),
    loadQuotaCollector: quotaCapability(() => import("./integrations/codex/codex-quota"), "fetchCodexQuota"),
    loadModelDiscovery: async () => async ({ credential, fetcher }) =>
      (await import("./integrations/codex/codex")).discoverCodexModels({
        credential,
        ...(fetcher === undefined ? {} : { fetcher }),
      }),
  },
  grok: {
    loadAdapter: async () => (await import("./integrations/grok/grok")).GrokAdapter,
    loadModels: async () => (await import("./integrations/grok/grok")).GROK_MODELS,
    loadAuthentication: oauthCapability(() => import("./integrations/grok/grok-oauth"), "grokOAuthClient", { withRefresher: true }),
    loadQuotaCollector: quotaCapability(() => import("./integrations/grok/grok-quota"), "fetchGrokQuota"),
    loadModelDiscovery: async () => async ({ credential, fetcher }) =>
      (await import("./integrations/grok/grok")).fetchGrokModels({
        credential,
        ...(fetcher === undefined ? {} : { fetcher }),
      }),
  },
  xai: {
    endpointPathsByWireFamily: { responses: "/responses" },
    loadAdapter: async () => (await import("./integrations/xai/xai")).xaiAdapter,
    loadModels: async () => (await import("./integrations/xai/xai")).XAI_MODELS,
    loadAuthentication: oauthCapability(() => import("./integrations/xai/xai-oauth"), "xaiOAuthClient", { withRefresher: true }),
    loadModelDiscovery: async () => async ({ credential, fetcher }) =>
      (await import("./integrations/xai/xai-discovery")).discoverXaiModels({
        credential,
        ...(fetcher === undefined ? {} : { fetcher }),
      }),
  },
  devin: {
    loadAdapter: async () => (await import("./integrations/devin/devin")).devinAdapter,
    loadModels: async () => (await import("./integrations/devin/devin-catalog")).DEVIN_MODELS,
    loadAuthentication: oauthCapability(() => import("./integrations/devin/devin-oauth"), "devinOAuthClient"),
    loadQuotaCollector: quotaCapability(() => import("./integrations/devin/devin-quota"), "fetchDevinQuota"),
    // Devin's catalog is per-account: `GetCliModelConfigs` answers with the
    // models the credential's plan reaches, so the static row is only the
    // offline seed and discovery needs the credential.
    loadModelDiscovery: async () => async ({ credential, fetcher }) =>
      (await import("./integrations/devin/devin")).fetchDevinModels(
        credential,
        ...(fetcher === undefined ? [] : [fetcher as typeof fetch]),
      ),
    modelDiscoveryRequiresCredential: true,
  },
  antigravity: {
    loadAdapter: async () => (await import("./integrations/antigravity/antigravity")).antigravityAdapter,
    loadModels: async () => (await import("./integrations/antigravity/antigravity")).ANTIGRAVITY_MODELS,
    loadAuthentication: oauthCapability(() => import("./integrations/antigravity/antigravity-oauth"), "antigravityOAuthClient", { withRefresher: true }),
    loadQuotaCollector: quotaCapability(() => import("./integrations/antigravity/antigravity-quota"), "fetchAntigravityQuota"),
    loadModelDiscovery: async () => async ({ baseUrl, credential, fetcher }) => {
      const { discoverAntigravityModels } = await import("./integrations/antigravity/antigravity-protocol");
      return discoverAntigravityModels(credential, { baseUrl, ...(fetcher ? { fetcher } : {}) });
    },
  },
  muse: {
    loadAdapter: async () => (await import("./integrations/muse/muse")).museCodeAdapter,
    loadModels: async () => (await import("./integrations/muse/muse")).MUSE_CODE_MODELS,
    loadAuthentication: oauthCapability(() => import("./integrations/muse/muse-oauth"), "museCodeOAuthClient", { withRefresher: true }),
    loadQuotaCollector: quotaCapability(() => import("./integrations/muse/muse-quota"), "fetchMuseQuota"),
  },
  meta: {
    loadAdapter: async () => (await import("./integrations/meta/meta")).metaAdapter,
    loadModels: async () => (await import("./integrations/meta/meta")).META_MODELS,
    // No `loadAuthentication`: the Model API is a plain API key pasted from the
    // Meta developer dashboard, so the default key-only credential path applies
    // and `probeApiKeyConnectivity` is the account test.
  },
  kiro: {
    loadAdapter: async () => (await import("./integrations/kiro/kiro")).kiroAdapter,
    loadModels: async () => (await import("./integrations/kiro/kiro-catalog")).KIRO_MODELS,
    loadAuthentication: oauthCapability(() => import("./integrations/kiro/kiro-oauth"), "kiroOAuthClient", {
      withRefresher: true,
    }),
    loadQuotaCollector: quotaCapability(() => import("./integrations/kiro/kiro-quota"), "fetchKiroQuota"),
    // Kiro's model list is per-account: which models a credential reaches
    // depends on the plan it is bound to, so discovery needs the credential and
    // the account's region.
    loadModelDiscovery: async () => async ({ credential, fetcher, authState }) =>
      (await import("./integrations/kiro/kiro-discovery")).fetchKiroModels({
        credential,
        ...(fetcher === undefined ? {} : { fetcher }),
        ...(authState === undefined ? {} : { authState }),
      }),
    modelDiscoveryRequiresCredential: true,
  },
  kimi: {
    loadAdapter: async () => (await import("./integrations/kimi/kimi")).kimiCodeAdapter,
    loadModels: async () => (await import("./integrations/kimi/kimi")).KIMI_CODE_MODELS,
    loadAuthentication: oauthCapability(() => import("./integrations/kimi/kimi-oauth"), "kimiCodeOAuthClient", { withRefresher: true }),
    loadQuotaCollector: quotaCapability(() => import("./integrations/kimi/kimi-quota"), "fetchKimiQuota"),
  },
  cerebras: {
    endpointPathsByWireFamily: { chat: "/chat/completions" },
    loadAdapter: async () => createApiKeyAdapter((await import("./integrations/cerebras")).CEREBRAS_SPEC),
    loadModels: async () => (await import("./integrations/cerebras")).CEREBRAS_MODELS,
    loadQuotaCollector: quotaCapability(() => import("./integrations/cerebras"), "fetchCerebrasQuota"),
    loadModelDiscovery: openAIModelDiscovery("cerebras", { headers: (credential) => ({ authorization: `Bearer ${credential}` }) }),
  },
  mistral: configuredProvider(
    "mistral",
    async () => (await import("./integrations/mistral")).MISTRAL_MODELS,
  ),
  fireworks: configuredProvider("fireworks"),
  nvidia: configuredProvider("nvidia"),
  deepseek: {
    endpointPathsByWireFamily: { messages: "/v1/messages" },
    loadAdapter: async () => (await import("./integrations/anthropic")).createDeepseekAnthropicAdapter(),
    loadModels: async () => (await import("./integrations/deepseek")).DEEPSEEK_MODELS,
    loadModelDiscovery: openAIModelDiscovery("deepseek", {
      headers: (credential) => ({ authorization: `Bearer ${credential}` }),
    }),
  },
  gmi: configuredProvider("gmi"),
  opencodeft: {
    // Only the two families this provider's catalog actually serves. The
    // registry map is what discovery and probing read, so listing `messages`
    // here would resolve a probe onto a wire with no endpoint path and no
    // catalog row behind it.
    endpointPathsByWireFamily: {
      chat: "/zen/v1/chat/completions",
      responses: "/zen/v1/responses",
    },
    loadAdapter: async () => new (await import("./integrations/opencode")).OpenCodeFreeAdapter(),
    loadModels: async () => (await import("./integrations/opencode")).OPENCODE_FREE_MODELS,
    // Free-tier filtered, unlike the generic OpenAI discovery: this provider
    // serves the free tier only, and the shared Zen listing publishes the whole
    // billed catalog alongside it.
    loadModelDiscovery: async () => async ({ baseUrl, fetcher }) => {
      const { discoverOpenCodeFreeModels } = await import("./integrations/opencode");
      return discoverOpenCodeFreeModels({
        baseUrl: `${baseUrl.replace(/\/+$/, "")}/zen/v1`,
        ...(fetcher === undefined ? {} : { fetcher }),
      });
    },
    modelDiscoveryRequiresCredential: false,
  },
  opencodezen: {
    endpointPathsByWireFamily: {
      chat: "/zen/v1/chat/completions",
      responses: "/zen/v1/responses",
    },
    loadAdapter: async () => createApiKeyAdapter((await import("./integrations/opencode")).OPENCODE_ZEN_SPEC),
    loadModels: async () => (await import("./integrations/opencode")).OPENCODE_ZEN_MODELS,
    loadModelDiscovery: openAIModelDiscovery("opencodezen", { transformBaseUrl: (baseUrl) => `${baseUrl.replace(/\/+$/, "")}/zen/v1`, headers: (credential) => ({ authorization: `Bearer ${credential}` }) }),
  },
  opencodego: {
    // The billed Go tier serves the same two wire families as the shared Zen
    // base, under its own `/zen/go/v1` prefix. Declaring them here is what the
    // endpoint-parity test guards against the catalog's own rows: without the
    // map this provider declared no paths at all, so its gate was a no-op.
    endpointPathsByWireFamily: {
      chat: "/zen/go/v1/chat/completions",
      responses: "/zen/go/v1/responses",
    },
    loadAdapter: async () => createApiKeyAdapter((await import("./integrations/opencode")).OPENCODE_GO_SPEC),
    loadModels: async () => (await import("./integrations/opencode")).OPENCODE_GO_MODELS,
    loadModelDiscovery: openAIModelDiscovery("opencodego", { transformBaseUrl: (baseUrl) => `${baseUrl.replace(/\/+$/, "")}/zen/go/v1`, headers: (credential) => ({ authorization: "Bea" + "rer " + credential }) }),
    loadQuotaCollector: quotaCapability(() => import("./integrations/opencode-go-quota"), "fetchOpenCodeGoQuota"),
  },
  agentrouter: {
    loadAdapter: async () => (await import("./integrations/agentrouter")).createAgentRouterAdapter(),
    loadModels: async () => (await import("./integrations/agentrouter")).AGENTROUTER_MODELS,
  },
  gemini: {
    loadAdapter: async () => (await import("./integrations/gemini")).createGeminiAdapter(),
    loadModels: async () => (await import("./integrations/gemini")).GEMINI_MODELS,
    loadModelDiscovery: async () => async ({ credential }) => (await import("./integrations/gemini")).discoverGeminiModels({ credential }),
  },
  aihubmix: {
    loadAdapter: async () => createApiKeyAdapter((await import("./integrations/aihubmix")).AIHUBMIX_SPEC),
    loadModels: async () => (await import("./integrations/aihubmix")).AIHUBMIX_FALLBACK_MODELS,
  },
  bai: {
    loadAdapter: async () => createApiKeyAdapter((await import("./integrations/bai")).BAI_SPEC),
    loadModels: async () => (await import("./integrations/bai")).BAI_FALLBACK_MODELS,
  },
  inception: {
    endpointPathsByWireFamily: { chat: "/chat/completions" },
    loadAdapter: async () => createApiKeyAdapter((await import("./integrations/inception/provider")).INCEPTION_SPEC),
    loadModels: async () => (await import("./integrations/inception/provider")).INCEPTION_MODELS,
    loadModelDiscovery: async () => async ({ baseUrl, credential, fetcher }) =>
      (await import("./integrations/inception/provider")).discoverInceptionFreeModels({
        baseUrl,
        ...(typeof credential === "string" && credential.length > 0 ? { credential } : {}),
        ...(fetcher === undefined ? {} : { fetcher }),
      }),
  },
  tokenharbor: {
    loadAdapter: async () => createApiKeyAdapter((await import("./integrations/tokenharbor")).TOKENHARBOR_SPEC),
    loadModels: async () => (await import("./integrations/tokenharbor")).TOKENHARBOR_FALLBACK_MODELS,
  },
  cline: {
    loadAdapter: async () => (await import("./integrations/cline/cline")).createClineAdapter(),
    loadModels: async () => (await import("./integrations/cline/cline")).CLINE_MODELS,
    loadAuthentication: oauthCapability(() => import("./integrations/cline/cline-oauth"), "clineOAuthClient", { withRefresher: true }),
    loadQuotaCollector: quotaCapability(() => import("./integrations/cline/cline-quota"), "fetchClineQuota"),
    loadModelDiscovery: async () => async ({ fetcher }) => {
      const { fetchClineRecommendedModels } = await import("./integrations/cline/cline");
      // `pass: false` reads only `recommended` + `free`. This gateway carries
      // Cline as one provider, and discovery persists whatever the resolver
      // returns for every account of it, so asking for the pass roster wrote
      // subscription rows into the catalog of an operator who may hold no pass
      // — rows whose dispatch can only 401. The free tier is what this
      // discovery is for; a pass account reconciles the rest through the same
      // "Fetch models" action once the roster has a home of its own.
      return fetchClineRecommendedModels(undefined, false, fetcher ?? globalThis.fetch);
    },
    modelDiscoveryRequiresCredential: false,
  },
  cb: {
    // CodeBuddy intl's chat endpoint is `/v2/chat/completions` off the origin
    // root (verified live: `/v2/...` answers 401 for a bad key, `/v1/...` and
    // the bare path answer 404/405). Without this map the generic `/v1/…`
    // default joined onto the root and every probe/dispatch 404'd.
    endpointPathsByWireFamily: { chat: "/v2/chat/completions" },
    loadAdapter: async () => (await import("./integrations/buddy/codebuddy")).createCodeBuddyAdapter(),
    loadModels: async () => (await import("./integrations/buddy/codebuddy")).CODEBUDDY_MODELS,
    loadModelDiscovery: async () => async ({ credential, fetcher }) => (await import("./integrations/buddy/codebuddy")).discoverCodeBuddyModels({ credential, ...(fetcher === undefined ? {} : { fetcher }) }),
    loadAuthentication: oauthCapability(() => import("./integrations/buddy/codebuddy-oauth"), "codeBuddyOAuthClient", { withRefresher: true }),
    loadQuotaCollector: quotaCapability(() => import("./integrations/buddy/codebuddy-quota"), "fetchCodeBuddyIntlQuota"),
  },
  cbcn: {
    endpointPathsByWireFamily: { chat: "/v2/chat/completions" },
    loadAdapter: async () => (await import("./integrations/buddy/codebuddy-cn")).createCodeBuddyCnAdapter(),
    loadModels: async () => (await import("./integrations/buddy/codebuddy-cn")).CODEBUDDY_CN_MODELS,
    loadModelDiscovery: async () => async ({ credential, fetcher }) => (await import("./integrations/buddy/codebuddy-cn")).discoverCodeBuddyCnModels({ credential, ...(fetcher === undefined ? {} : { fetcher }) }),
    loadAuthentication: oauthCapability(() => import("./integrations/buddy/codebuddy-oauth"), "codeBuddyCnOAuthClient", { withRefresher: true }),
    loadQuotaCollector: quotaCapability(() => import("./integrations/buddy/codebuddy-quota"), "fetchCodeBuddyCnQuota"),
  },
  workbuddy: {
    loadAdapter: async () => (await import("./integrations/buddy/workbuddy")).createWorkBuddyAdapter(),
    loadModels: async () => (await import("./integrations/buddy/workbuddy")).WORKBUDDY_MODELS,
    loadModelDiscovery: async () => async ({ credential, fetcher }) => (await import("./integrations/buddy/workbuddy")).discoverWorkBuddyModels({ credential, ...(fetcher === undefined ? {} : { fetcher }) }),
    loadAuthentication: oauthCapability(() => import("./integrations/buddy/workbuddy-oauth"), "workBuddyOAuthClient", { withRefresher: true }),
    loadQuotaCollector: quotaCapability(() => import("./integrations/buddy/workbuddy-quota"), "fetchWorkBuddyQuota"),
  },
  kilo: {
    loadAdapter: async () => (await import("./integrations/kilo/kilo")).kiloAdapter,
    loadModels: async () => (await import("./integrations/kilo/kilo")).KILO_MODELS,
    // No `withRefresher`: Kilo Code has no refresh grant, so this client
    // declares no refresher and the stored token is used exactly as issued.
    // Registering one would make the 401 retry path call a method that always
    // throws, turning a recoverable auth failure into a permanent one.
    loadAuthentication: oauthCapability(() => import("./integrations/kilo/kilo-oauth"), "kiloOAuthClient"),
    loadModelDiscovery: async () => async ({ credential, fetcher }) =>
      (await import("./integrations/kilo/kilo-discovery")).discoverKiloModels({
        credential,
        ...(fetcher === undefined ? {} : { fetcher }),
      }),
  },
  commandcode: {
    loadAdapter: async () => (await import("./integrations/commandcode/commandcode")).createCommandCodeAdapter(),
    loadModels: async () => (await import("./integrations/commandcode/commandcode")).COMMANDCODE_MODELS,
    loadQuotaCollector: quotaCapability(() => import("./integrations/commandcode/quota"), "fetchCommandCodeQuota"),
    loadModelDiscovery: async () =>
      (await import("./integrations/commandcode/discovery")).discoverCommandCodeModels,
  },
  qoder: {
    loadAdapter: async () => (await import("./integrations/qoder/qoder")).createQoderAdapter(),
    loadModels: async () => (await import("./integrations/qoder/qoder")).QODER_MODELS,
    loadAuthentication: oauthCapability(() => import("./integrations/qoder/qoder-oauth"), "qoderOAuthClient"),
    loadQuotaCollector: quotaCapability(() => import("./integrations/qoder/qoder-quota"), "fetchQoderQuota"),
    loadModelDiscovery: qoderDiscovery("intl", "qoder"),
  },
  qodercn: {
    loadAdapter: async () => (await import("./integrations/qoder/qoder")).createQoderCnAdapter(),
    loadModels: async () => (await import("./integrations/qoder/qoder-catalog")).QODER_CN_MODELS,
    loadAuthentication: oauthCapability(() => import("./integrations/qoder/qoder-oauth"), "qoderCnOAuthClient"),
    loadQuotaCollector: quotaCapability(() => import("./integrations/qoder/qoder-quota"), "fetchQoderCnQuota"),
    loadModelDiscovery: qoderDiscovery("cn", "qodercn"),
  },
  trae: {
    loadAdapter: async () => (await import("./integrations/trae/trae")).createTraeAdapter(),
    loadModels: async () => (await import("./integrations/trae/trae-catalog")).TRAE_INTL_MODELS,
    loadAuthentication: oauthCapability(() => import("./integrations/trae/trae-oauth"), "traeOAuthClient", { withRefresher: true }),
    loadQuotaCollector: quotaCapability(() => import("./integrations/trae/trae-quota"), "fetchTraeQuota"),
    loadModelDiscovery: traeDiscovery("intl", "trae"),
  },
  traecn: {
    loadAdapter: async () => (await import("./integrations/trae/trae")).createTraeCnAdapter(),
    loadModels: async () => (await import("./integrations/trae/trae-catalog")).TRAE_CN_MODELS,
    loadAuthentication: oauthCapability(() => import("./integrations/trae/trae-oauth"), "traeCnOAuthClient", { withRefresher: true }),
    loadQuotaCollector: quotaCapability(() => import("./integrations/trae/trae-quota"), "fetchTraeCnQuota"),
    loadModelDiscovery: traeDiscovery("cn", "traecn"),
  },
  inferhub: {
    loadAdapter: async () => (await import("./integrations/inferhub")).createInferhubAdapter(),
    // Live `/v1/models` is the primary source: the marketplace republishes its
    // whole roster and it moves faster than a committed array can. The static
    // list stays as the offline fallback when the fetch fails.
    loadModels: async () => (await import("./integrations/inferhub")).INFERHUB_MODELS,
    loadModelDiscovery: async () =>
      (await import("./integrations/inferhub")).inferhubModelDiscovery()(),
    loadQuotaCollector: quotaCapability(() => import("./integrations/inferhub"), "fetchInferhubQuota"),
  },
  hermes: {
    loadAdapter: async () => createApiKeyAdapter((await import("./integrations/hermes")).HERMES_SPEC),
    loadModels: async () => (await import("./integrations/hermes")).HERMES_MODELS,
    loadModelDiscovery: async () => async ({ baseUrl, fetcher }: { baseUrl: string; fetcher?: typeof fetch }) => {
      const { discoverHermesFreeModels } = await import("./integrations/hermes");
      return discoverHermesFreeModels({
        baseUrl,
        ...(fetcher === undefined ? {} : { fetcher }),
      });
    },
  },
  openrouter: {
    loadAdapter: async () => createApiKeyAdapter((await import("./integrations/openrouter")).OPENROUTER_SPEC),
    loadModels: async () => (await import("./integrations/openrouter")).OPENROUTER_MODELS,
    loadModelDiscovery: async () => async ({ credential }) => (await import("./integrations/openrouter")).discoverOpenrouterModels({ credential }),
    // No `withRefresher`: the PKCE exchange returns a durable API key rather
    // than an access token, so there is no refresh grant to register. The key
    // is stored as an ordinary credential and forwarded as the bearer, which is
    // why the same adapter serves the pasted-key and signed-in cases.
    loadAuthentication: oauthCapability(() => import("./integrations/openrouter-oauth"), "openrouterOAuthClient"),
  },
  xiaomipg: {
    loadAdapter: async () => createApiKeyAdapter((await import("./integrations/xiaomi-mimo/xiaomi")).XIAOMIPG_SPEC),
    loadModels: async () => (await import("./integrations/xiaomi-mimo/xiaomi")).XIAOMI_MODELS,
  },
  xiaomitp: {
    loadAdapter: async () => createApiKeyAdapter((await import("./integrations/xiaomi-mimo/xiaomi")).XIAOMITP_SPEC),
    loadModels: async () => (await import("./integrations/xiaomi-mimo/xiaomi")).XIAOMI_MODELS,
  },
  mimodesktop: {
    loadAdapter: async () => createApiKeyAdapter((await import("./integrations/xiaomi-mimo/mimodesktop")).MIMODESKTOP_SPEC),
    loadModels: async () => (await import("./integrations/xiaomi-mimo/mimodesktop")).MIMODESKTOP_MODELS,
    loadAuthentication: oauthCapability(() => import("./integrations/xiaomi-mimo/mimodesktop-oauth"), "mimoDesktopOAuthClient", { withRefresher: true }),
    loadQuotaCollector: quotaCapability(() => import("./integrations/xiaomi-mimo/mimodesktop-quota"), "fetchMimoDesktopQuota"),
  },
  mimostudio: {
    loadAdapter: async () => (await import("./integrations/xiaomi-mimo/mimostudio")).createMimoStudioAdapter(),
    loadModels: async () => (await import("./integrations/xiaomi-mimo/mimostudio")).MIMOSTUDIO_MODELS,
    loadAuthentication: oauthCapability(() => import("./integrations/xiaomi-mimo/mimostudio-oauth"), "mimoStudioOAuthClient", { withRefresher: true }),
    loadQuotaCollector: quotaCapability(() => import("./integrations/xiaomi-mimo/mimostudio-quota"), "fetchMimoStudioQuota"),
  },
  zcode: {
    loadAdapter: async () => createApiKeyAdapter((await import("./integrations/zcode")).ZCODE_SPEC),
    loadModels: async () => (await import("./integrations/zcode")).ZCODE_MODELS,
    loadModelDiscovery: async () => async ({ credential, fetcher }) =>
      (await import("./integrations/zcode")).discoverZcodeModels({
        credential,
        ...(fetcher === undefined ? {} : { fetcher }),
      }),
    // No `withRefresher`: the sign-in flow ends by minting a durable API key,
    // and Z.AI publishes no refresh grant for it (`refresh "none"` upstream).
    loadAuthentication: oauthCapability(() => import("./integrations/zcode-oauth"), "zcodeOAuthClient"),
  },
  perplexity: {
    loadAdapter: async () => (await import("./integrations/perplexity")).createPerplexityAdapter(),
    loadModels: async () => (await import("./integrations/perplexity")).PERPLEXITY_MODELS,
  },
  factory: {
    loadAdapter: async () => (await import("./integrations/factory/factory")).factoryAdapter,
    loadModels: async () => (await import("./integrations/factory/factory-models")).FACTORY_MODELS,
    loadAuthentication: oauthCapability(
      () => import("./integrations/factory/factory-oauth"),
      "factoryOAuthClient",
      { withRefresher: true },
    ),
  },
  cloudflareai: {
    loadAdapter: async () =>
      (await import("./integrations/cloudflareai/cloudflareai")).cloudflareaiAdapter,
    loadAuthentication: oauthCapability(
      () => import("./integrations/cloudflareai/cloudflareai-oauth"),
      "cloudflareaiOAuthClient",
    ),
    loadModels: async () =>
      (await import("./integrations/cloudflareai/cloudflareai-models")).CLOUDFLAREAI_MODELS,
  },
  alibabacp: {
    loadAdapter: async () =>
      (await import("./integrations/alibabacp/alibabacp")).alibabacpAdapter,
    loadAuthentication: oauthCapability(
      () => import("./integrations/alibabacp/alibabacp-oauth"),
      "alibabacpOAuthClient",
    ),
    loadModels: async () =>
      (await import("./integrations/alibabacp/alibabacp-models")).ALIBABACP_MODELS,
  },
  dashscope: {
    loadAdapter: async () => createApiKeyAdapter(GENERIC_API_KEY_SPECS.dashscope),
    loadModels: async () => (await import("./integrations/dashscope-models")).DASHSCOPE_MODELS,
    loadModelDiscovery: openAIModelDiscovery("dashscope", {
      headers: (credential) => ({ authorization: `Bearer ${credential}` }),
    }),
  },
  // Web-search providers: a `createSearchAdapter` over their spec, and a single
  // `serviceKind: "websearch"` catalog row served by the `/v1/search` route.
  exa: {
    loadAdapter: async () =>
      (await import("./search/search-provider")).createSearchAdapter(
        (await import("./search/search-providers")).SEARCH_PROVIDER_SPECS.exa,
      ),
    loadModels: async () => (await import("./search/search-catalog")).EXA_SEARCH_MODELS,
  },
  tavily: {
    loadAdapter: async () =>
      (await import("./search/search-provider")).createSearchAdapter(
        (await import("./search/search-providers")).SEARCH_PROVIDER_SPECS.tavily,
      ),
    loadModels: async () => (await import("./search/search-catalog")).TAVILY_SEARCH_MODELS,
  },
  brave: {
    loadAdapter: async () =>
      (await import("./search/search-provider")).createSearchAdapter(
        (await import("./search/search-providers")).SEARCH_PROVIDER_SPECS.brave,
      ),
    loadModels: async () => (await import("./search/search-catalog")).BRAVE_SEARCH_MODELS,
  },
  "github": {
    // Chat only. Copilot also serves some SKUs on `/responses`, but those arrive
    // through discovery, which carries its own endpoint path with the wire
    // family it read from `supported_endpoints` — this map is the static floor,
    // and the static catalog is all chat.
    endpointPathsByWireFamily: { chat: "/chat/completions" },
    loadAdapter: async () => (await import("./integrations/github/github")).githubAdapter,
    loadModels: async () => (await import("./integrations/github/github")).GITHUB_MODELS,
    // The Copilot token is short-lived and re-minted from the GitHub token the
    // device flow issued, so this provider registers a real refresher.
    loadAuthentication: oauthCapability(() => import("./integrations/github/github-oauth"), "githubOAuthClient", { withRefresher: true }),
    // The account's own `/models` is authoritative: it names the SKUs the
    // subscription may use and the surface each answers on.
    loadModelDiscovery: async () => async ({ credential, fetcher }) =>
      (await import("./integrations/github/github-discovery")).discoverGithubModels({
        credential,
        ...(fetcher === undefined ? {} : { fetcher }),
      }),
    loadQuotaCollector: quotaCapability(() => import("./integrations/github/github-quota"), "fetchGithubQuota"),
  },
  ollamacloud: {
    // Only the two families this provider's catalog actually serves. The
    // registry map is what discovery and probing read, so listing `messages`
    // here would resolve a probe onto a wire with no endpoint path and no
    // catalog row behind it.
    endpointPathsByWireFamily: {
      chat: "/chat/completions",
      responses: "/responses",
    },
    loadAdapter: async () => createApiKeyAdapter(GENERIC_API_KEY_SPECS.ollamacloud),
    loadModels: async () => (await import("./integrations/ollamacloud-models")).OLLAMACLOUD_MODELS,
    loadQuotaCollector: quotaCapability(() => import("./integrations/ollama-cloud-quota"), "fetchOllamaQuota"),
    loadModelDiscovery: openAIModelDiscovery("ollamacloud", { headers: (credential) => ({ authorization: `Bearer ${credential}` }) }),
  },
} satisfies Readonly<Record<BundledProviderId, ProviderModuleCapabilities>>;

/** Canonical provider registry; every provider subsystem consumes these rows. */
export const BUNDLED_PROVIDER_MODULES: readonly ProviderModule[] = BUNDLED_PROVIDER_METADATA.map((definition) => {
  const implementation = PROVIDER_CAPABILITIES[definition.id];
  if (implementation === undefined) throw new Error(`Missing provider implementation: ${definition.id}`);
  const compatibility = PROVIDER_COMPATIBILITY_PROFILES[definition.id];
  return {
    id: definition.id,
    displayName: definition.displayName,
    baseUrl: definition.baseUrl,
    defaultBypassProxy: definition.defaultBypassProxy,
    ...implementation,
    upstreamHost: providerUpstreamHost(definition.id),
    ...(compatibility === undefined ? {} : { compatibility }),
    wireFamilyDefault: providerDefaultWireFamily(definition.id),
    requiresAccount: providerRequiresAccount(definition.id),
  };
});

/**
 * Eagerly composes the default provider registry from the canonical
 * bundled module. Registration itself is direct and synchronous; each
 * provider's adapter and model catalog still load lazily through
 * capability loader, so protobuf-heavy adapters stay out of the
 * startup path.
 */
export function createDefaultProviderRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();
  for (const provider of BUNDLED_PROVIDER_MODULES) {
    registry.register(toRegistration(provider));
  }
  return registry;
}
