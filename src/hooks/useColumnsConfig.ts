import { useState, useEffect } from "react";
import {
  USE_CASE_RESTRICTED_COLUMNS,
  INDUSTRY_RESTRICTED_COLUMNS,
} from "../config/restrictedColumns";

interface ColumnsConfig {
  useCaseRestricted: string[];
  industryRestricted: string[];
}

const DEFAULT: ColumnsConfig = {
  useCaseRestricted: USE_CASE_RESTRICTED_COLUMNS,
  industryRestricted: INDUSTRY_RESTRICTED_COLUMNS,
};

let cached: ColumnsConfig | null = null;

export function useColumnsConfig(): ColumnsConfig {
  const [config, setConfig] = useState<ColumnsConfig>(cached ?? DEFAULT);

  useEffect(() => {
    if (cached) return; // already fetched this session
    fetch("/api/columns-config")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (
          data &&
          Array.isArray(data.useCaseRestricted) &&
          Array.isArray(data.industryRestricted)
        ) {
          cached = data;
          setConfig(data);
        }
      })
      .catch(() => {
        // Network error or no endpoint — fall back to static defaults silently
      });
  }, []);

  return config;
}
