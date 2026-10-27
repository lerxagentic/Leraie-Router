import type { ModelDefinition } from "../model-definition";
import { defineModel } from "../model-definition";

const DEEPSEEK_PROVIDER_ID = "deepseek" as const;

export const DEEPSEEK_MODELS: readonly ModelDefinition[] = [
  defineModel({
    id: "deepseek-v4-pro",
    providerId: DEEPSEEK_PROVIDER_ID,
    wireFamily: "messages",
    endpoint: "/v1/messages",
    reasoning: true,
    toolCall: true,
  }),
  defineModel({
    id: "deepseek-v4.1-flash",
    providerId: DEEPSEEK_PROVIDER_ID,
    wireFamily: "messages",
    endpoint: "/v1/messages",
    vision: true,
    reasoning: true,
    toolCall: true,
  }),
  defineModel({
    id: "deepseek-flash",
    providerId: DEEPSEEK_PROVIDER_ID,
    wireFamily: "messages",
    endpoint: "/v1/messages",
    vision: true,
    reasoning: true,
    toolCall: true,
  }),
];
