import { useState, useCallback } from "react";
import { useOktaAuth } from "@okta/okta-react";
import type { UseCaseData } from "../types";

export interface AISearchResult {
  useCase: UseCaseData;
  score: number;
  whyMatched: string;
}

export function useAISearch() {
  const [results, setResults] = useState<AISearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { oktaAuth } = useOktaAuth();

  const search = useCallback(async (query: string) => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
      const token = await oktaAuth.getAccessToken();
      const response = await fetch(`${base}/api/search`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
      });
      if (!response.ok) {
        if (response.status === 429) {
          const retryAfter = response.headers.get("Retry-After") ?? "60";
          throw new Error(`Too many search requests — please wait ${retryAfter}s before searching again.`);
        }
        const errData = await response.json().catch(() => ({ error: "Search failed" }));
        throw new Error(errData.error || `Search failed (${response.status})`);
      }
      const data = await response.json();
      // Map snake_case keys from the API to the PascalCase UseCaseData interface
      type RawResult = { useCase: Record<string, string>; score: number; whyMatched: string };
      const mapped: AISearchResult[] = (data.results || []).map((r: RawResult) => ({
        useCase: {
          id: Number(r.useCase.capability),
          Capability: Number(r.useCase.capability),
          "Business Function": r.useCase.business_function,
          "Business Capability": r.useCase.business_capability,
          "Stakeholder or User": r.useCase.stakeholder_or_user,
          "AI Use Case": r.useCase.ai_use_case,
          "AI Algorithms & Frameworks": r.useCase.ai_algorithms_frameworks,
          Datasets: r.useCase.datasets,
          "Action / Implementation": r.useCase.action_implementation,
          "AI Tools & Models": r.useCase.ai_tools_models,
          "Digital Platforms and Tools": r.useCase.digital_platforms_and_tools,
          "Expected Outcomes and Results": r.useCase.expected_outcomes_and_results,
        } as UseCaseData,
        score: r.score,
        whyMatched: r.whyMatched,
      }));
      setResults(mapped);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }, [oktaAuth]);

  const clearResults = useCallback(() => {
    setResults([]);
    setError(null);
  }, []);

  return { search, results, loading, error, clearResults };
}
