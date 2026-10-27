/** Search API-key list fields returned by the safe list endpoint. */
export interface SearchableApiKey {
  readonly label: string;
  readonly keyPrefix?: string | null;
  readonly modelList?: readonly string[] | null;
}

/**
 * Matches every whitespace-separated term against the label, public key prefix,
 * or an allowed model. The list response deliberately contains no plaintext key.
 */
export function apiKeyMatchesSearch(key: SearchableApiKey, query: string): boolean {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;

  const fields = [
    key.label.toLocaleLowerCase(),
    (key.keyPrefix ?? "").toLocaleLowerCase(),
    ...(key.modelList ?? []).map((model) => model.toLocaleLowerCase()),
  ];
  return terms.every((term) => fields.some((field) => field.includes(term)));
}

export function filterApiKeys<T extends SearchableApiKey>(keys: readonly T[], query: string): T[] {
  return query.trim().length === 0 ? [...keys] : keys.filter((key) => apiKeyMatchesSearch(key, query));
}
