import type { ModelDefinition } from "../model-definition";
import { defineModel } from "../model-definition";

const MISTRAL_PROVIDER_ID = "mistral" as const;

export const MISTRAL_MODELS: readonly ModelDefinition[] = [
  defineModel({
    id: "mistral-large-latest",
    providerId: MISTRAL_PROVIDER_ID,
    wireFamily: "chat",
    vision: true,
    toolCall: true,
  }),
  defineModel({
    id: "mistral-medium-latest",
    providerId: MISTRAL_PROVIDER_ID,
    wireFamily: "chat",
    vision: true,
    reasoning: true,
    toolCall: true,
  }),
];
