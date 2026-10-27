import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { consoleRequest } from "../data/api";
import type { ApiErrorShape } from "../data/api";
import { DASHBOARD_QUERY_OPTIONS } from "../data/query-policy";
import { queryKeys } from "../data/query-keys";

/** Named model whitelist preset a tenant reuses when provisioning API keys. */
export interface ModelTemplate {
  readonly id: string;
  readonly name: string;
  readonly modelList: readonly string[];
  readonly createdAt: string;
}

/** Result of pushing one template's models onto the keys linked to it. */
export interface ModelTemplateSyncResult {
  readonly templateId: string;
  readonly updatedKeys: readonly { readonly id: string; readonly label: string }[];
  readonly skippedCount: number;
}

export interface ModelTemplateInput {
  readonly name: string;
  readonly modelList: readonly string[];
}

/** Lists the tenant's model templates. */
export function useModelTemplates() {
  return useQuery<ModelTemplate[], ApiErrorShape>({
    queryKey: queryKeys.modelTemplates.all,
    queryFn: () => consoleRequest<ModelTemplate[]>("/model-templates"),
    ...DASHBOARD_QUERY_OPTIONS,
  });
}

function useTemplateMutation<TVariables, TResult>(run: (variables: TVariables) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation<TResult, ApiErrorShape, TVariables>({
    mutationFn: run,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.modelTemplates.all });
    },
  });
}

/** Creates a template. */
export function useCreateModelTemplate() {
  return useTemplateMutation((input: ModelTemplateInput) =>
    consoleRequest<ModelTemplate>("/model-templates", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  );
}

/** Rewrites a template's name and model list. Linked keys are untouched. */
export function useUpdateModelTemplate() {
  return useTemplateMutation((variables: { templateId: string; input: ModelTemplateInput }) =>
    consoleRequest<ModelTemplate>(`/model-templates/${encodeURIComponent(variables.templateId)}`, {
      method: "PATCH",
      body: JSON.stringify(variables.input),
    }),
  );
}

/** Deletes a template; keys keep the list they copied. */
export function useDeleteModelTemplate() {
  return useTemplateMutation((templateId: string) =>
    consoleRequest<{ success: true }>(`/model-templates/${encodeURIComponent(templateId)}`, {
      method: "DELETE",
    }),
  );
}

/**
 * Applies a template's current models to every key linked to it.
 *
 * Deliberately explicit: a template edit alone never rewrites issued keys, so a
 * live credential cannot change its model access without the operator asking.
 */
export function useSyncModelTemplate() {
  const queryClient = useQueryClient();
  return useMutation<ModelTemplateSyncResult, ApiErrorShape, string>({
    mutationFn: (templateId) =>
      consoleRequest<ModelTemplateSyncResult>(
        `/model-templates/${encodeURIComponent(templateId)}/sync`,
        { method: "POST" },
      ),
    onSuccess: async () => {
      // The sync rewrites api_keys.model_list, so the key list is stale too.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.modelTemplates.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys.all }),
      ]);
    },
  });
}
