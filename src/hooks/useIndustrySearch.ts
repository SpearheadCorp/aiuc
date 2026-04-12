import { useState, useCallback } from "react";
import { useOktaAuth } from "@okta/okta-react";
import type { IndustryData } from "../types";

export interface IndustrySearchResult {
  item: IndustryData;
  score: number;
  whyMatched: string;
}

export function useIndustrySearch() {
  const [results, setResults] = useState<IndustrySearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { oktaAuth } = useOktaAuth();

  const search = useCallback(async (query: string) => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const token = await oktaAuth.getAccessToken();
      const response = await fetch(`${base}/api/search/industry`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: "Search failed" }));
        throw new Error(errData.error || `Search failed (${response.status})`);
      }
      const data = await response.json();
      type RawResult = { item: Record<string, string>; score: number; whyMatched: string };
      const mapped: IndustrySearchResult[] = (data.results || []).map((r: RawResult) => ({
        item: {
          Id: r.item.id,
          Industry: r.item.industry,
          "Business Function": r.item.business_function,
          "Business Capability": r.item.business_capability,
          "Stakeholders / Users": r.item.stakeholders_users,
          "AI Use Case": r.item.ai_use_case,
          Description: r.item.description,
          "Implementation Plan": r.item.implementation_plan,
          "Expected Outcomes": r.item.expected_outcomes,
          Datasets: r.item.datasets,
          "AI Tools / Platforms": r.item.ai_tools_platforms,
          "Digital Tools / Platforms": r.item.digital_tools_platforms,
          "AI Frameworks": r.item.ai_frameworks,
          "AI Tools and Models": r.item.ai_tools_and_models,
          "Industry References": r.item.industry_references,
        } as IndustryData,
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
