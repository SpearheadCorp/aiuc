import { userPool } from "../config/cognito";
import type { UseCaseSearchResult, IndustrySearchResult } from "../types";

/** Get the Cognito ID token for the current session, or null if not signed in. */
function getCognitoToken(): Promise<string | null> {
    return new Promise((resolve) => {
        const user = userPool?.getCurrentUser();
        if (!user) { resolve(null); return; }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        user.getSession((err: Error | null, session: any) => {
            if (err || !session?.isValid()) { resolve(null); return; }
            resolve(session.getIdToken().getJwtToken() as string);
        });
    });
}

export interface SearchApiReturn {
    searchUseCases: (query: string, limit?: number) => Promise<UseCaseSearchResult[]>;
    searchIndustry: (query: string, limit?: number) => Promise<IndustrySearchResult[]>;
}

export function useSearchApi(): SearchApiReturn {
    async function searchUseCases(query: string, limit = 10): Promise<UseCaseSearchResult[]> {
        const token = await getCognitoToken();
        const headers: HeadersInit = {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        };
        const response = await fetch("/api/search", {
            method: "POST",
            headers,
            body: JSON.stringify({ query, limit }),
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({ error: "Search failed" }));
            throw new Error(err.error || `Search failed with status ${response.status}`);
        }
        const data = await response.json();
        return (data.results ?? []) as UseCaseSearchResult[];
    }

    async function searchIndustry(query: string, limit = 10): Promise<IndustrySearchResult[]> {
        const token = await getCognitoToken();
        const headers: HeadersInit = {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        };
        const response = await fetch("/api/search/industry", {
            method: "POST",
            headers,
            body: JSON.stringify({ query, limit }),
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({ error: "Search failed" }));
            throw new Error(err.error || `Industry search failed with status ${response.status}`);
        }
        const data = await response.json();
        return (data.results ?? []) as IndustrySearchResult[];
    }

    return { searchUseCases, searchIndustry };
}
