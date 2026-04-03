import { useState, useEffect } from "react";
import { useOktaAuth } from "@okta/okta-react";
import type { UseCaseData, IndustryData } from "../types";

interface UseS3DataReturn {
    useCaseData: UseCaseData[];
    industryData: IndustryData[];
    loadingUseCase: boolean;
    loadingIndustry: boolean;
    errorUseCase: string | null;
    errorIndustry: string | null;
}

export const useS3Data = (): UseS3DataReturn => {
    const [useCaseData, setUseCaseData] = useState<UseCaseData[]>([]);
    const [industryData, setIndustryData] = useState<IndustryData[]>([]);
    const [loadingUseCase, setLoadingUseCase] = useState(true);
    const [loadingIndustry, setLoadingIndustry] = useState(true);
    const [errorUseCase, setErrorUseCase] = useState<string | null>(null);
    const [errorIndustry, setErrorIndustry] = useState<string | null>(null);
    const { oktaAuth } = useOktaAuth();

    useEffect(() => {
        const loadUseCaseData = async () => {
            try {
                setLoadingUseCase(true);
                setErrorUseCase(null);
                const base = import.meta.env.BASE_URL.replace(/\/$/, "");
                const token = await oktaAuth.getAccessToken();
                const response = await fetch(`${base}/api/data/use-cases`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                // const response = await fetch("/data/use_cases.json");
                if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`);
                const rawData = await response.json();
                const mappedData = rawData.map((item: any) => ({
                    id: Number(item.capability),
                    Capability: Number(item.capability),
                    "Business Function": item.business_function,
                    "Business Capability": item.business_capability,
                    "Stakeholder or User": item.stakeholder_or_user,
                    "AI Use Case": item.ai_use_case,
                    "AI Algorithms & Frameworks": item.ai_algorithms_frameworks,
                    Datasets: item.datasets,
                    "Action / Implementation": item.action_implementation,
                    "AI Tools & Models": item.ai_tools_models,
                    "Digital Platforms and Tools": item.digital_platforms_and_tools,
                    "Expected Outcomes and Results": item.expected_outcomes_and_results,
                })) as UseCaseData[];
                setUseCaseData(mappedData);
            } catch (err) {
                setErrorUseCase(err instanceof Error ? err.message : "An error occurred");
            } finally {
                setLoadingUseCase(false);
            }
        };
        loadUseCaseData();
    }, [oktaAuth]);

    useEffect(() => {
        const loadIndustryData = async () => {
            try {
                setLoadingIndustry(true);
                setErrorIndustry(null);
                // const response = await fetch("/data/industry_use_cases.json");
                const base = import.meta.env.BASE_URL.replace(/\/$/, "");
                const token = await oktaAuth.getAccessToken();
                const response = await fetch(`${base}/api/data/industry`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (!response.ok) throw new Error(`Failed to fetch industry data: ${response.status}`);
                const rawData = await response.json();
                const mappedData = rawData.map((item: any) => ({
                    Id: item.id,
                    Industry: item.industry,
                    "Business Function": item.business_function,
                    "Business Capability": item.business_capability,
                    "Stakeholders / Users": item.stakeholders_users,
                    "AI Use Case": item.ai_use_case,
                    Description: item.description,
                    "Implementation Plan": item.implementation_plan,
                    "Expected Outcomes": item.expected_outcomes,
                    Datasets: item.datasets,
                    "AI Tools / Platforms": item.ai_tools_platforms,
                    "Digital Tools / Platforms": item.digital_tools_platforms,
                    "AI Frameworks": item.ai_frameworks,
                    "AI Tools and Models": item.ai_tools_and_models,
                    "Industry References": item.industry_references,
                })) as IndustryData[];
                setIndustryData(mappedData);
            } catch (err) {
                setErrorIndustry(err instanceof Error ? err.message : "An error occurred");
            } finally {
                setLoadingIndustry(false);
            }
        };
        loadIndustryData();
    }, [oktaAuth]);

    return {
        useCaseData,
        industryData,
        loadingUseCase,
        loadingIndustry,
        errorUseCase,
        errorIndustry,
    };
};