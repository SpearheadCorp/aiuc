export interface UseCaseData {
    id: number;
    Capability: number;
    "Business Function": string;
    "Business Capability": string;
    "Stakeholder or User": string;
    "AI Use Case": string;
    "AI Algorithms & Frameworks": string;
    Datasets: string;
    "Action / Implementation": string;
    "AI Tools & Models": string;
    "Digital Platforms and Tools": string;
    "Expected Outcomes and Results": string;
}

export interface IndustryData {
    Id: string;
    Industry: string;
    "Business Function": string;
    "Business Capability": string;
    "Stakeholders / Users": string;
    "AI Use Case": string;
    Description: string;
    "Implementation Plan": string;
    "Expected Outcomes": string;
    Datasets: string;
    "AI Tools / Platforms": string;
    "Digital Tools / Platforms": string;
    "AI Frameworks": string;
    "AI Tools and Models": string;
    "Industry References": string;
}

export interface ApiResponse<T> {
    total: number;
    page: number;
    page_size: number | string;
    data: T[];
}

/** Raw use-case object as returned by the /api/search endpoint (snake_case keys). */
export interface UseCaseRaw {
    capability?: number;
    business_function?: string;
    business_capability?: string;
    stakeholder_or_user?: string;
    ai_use_case?: string;
    ai_algorithms_frameworks?: string;
    datasets?: string;
    action_implementation?: string;
    ai_tools_models?: string;
    digital_platforms_and_tools?: string;
    expected_outcomes_and_results?: string;
}

/** Raw industry item as returned by the /api/search/industry endpoint (snake_case keys). */
export interface IndustryRaw {
    id?: string;
    industry?: string;
    business_function?: string;
    business_capability?: string;
    stakeholders_users?: string;
    ai_use_case?: string;
    description?: string;
    implementation_plan?: string;
    expected_outcomes?: string;
    datasets?: string;
    ai_tools_platforms?: string;
    digital_tools_platforms?: string;
    ai_frameworks?: string;
    ai_tools_and_models?: string;
    industry_references?: string;
}

export interface UseCaseSearchResult {
    useCase: UseCaseRaw;
    score: number;
    whyMatched: string;
}

export interface IndustrySearchResult {
    item: IndustryRaw;
    score: number;
    whyMatched: string;
}
