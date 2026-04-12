import React, { useState, useMemo, useRef, useCallback, useEffect } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
} from "@tanstack/react-table";
import type {
  ColumnDef,
  SortingState,
  Column,
  RowData,
} from "@tanstack/react-table";

declare module "@tanstack/react-table" {
  interface ColumnMeta<TData extends RowData, TValue> {
    headerName?: string;
  }
}
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Box,
  Typography,
  CircularProgress,
  Alert,
  Chip,
  Button,
  IconButton,
  Popover,
  TextField,
  Checkbox,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  InputAdornment,
  Divider,
  Paper,
  Tooltip,
  Switch,
  FormControlLabel,
} from "@mui/material";
import FilterListIcon from "@mui/icons-material/FilterList";
import SearchIcon from "@mui/icons-material/Search";
import ClearIcon from "@mui/icons-material/Clear";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import MailOutlineIcon from "@mui/icons-material/MailOutline";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import type { UseCaseData } from "../types";
import { parseChipItems } from "../utils";
import { openGmailCompose } from "./ContactDialog";
import { useAISearch } from "../hooks/useAISearch";

const PURE_ORANGE = "#fe5000";

const EMPTY_SET = new Set<string>();
const DEFAULT_FILTER = {
  selectedValues: EMPTY_SET,
  textSearch: "",
};

interface UseCaseTableProps {
  data: UseCaseData[];
  loading: boolean;
  error: string | null;
  userEmail: string;
  contactEmail: string;
  emailTooltipText: string;
}

export default function UseCaseTable({
  data,
  loading,
  error,
  userEmail,
  contactEmail,
  emailTooltipText,
}: UseCaseTableProps) {
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [sorting, setSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState({});
  const [globalFilter, setGlobalFilter] = useState("");

  // AI search — enabled flag persisted in localStorage so it survives page refresh
  const [aiEnabled, setAiEnabled] = useState<boolean>(() => {
    try { return localStorage.getItem("aiuc_ai_search_enabled") !== "false"; }
    catch { return true; }
  });
  const [aiQuery, setAiQuery] = useState("");
  const { search: doAISearch, results: aiResults, loading: aiLoading, error: aiError, clearResults: clearAIResults } = useAISearch();
  const aiMode = aiResults.length > 0 || aiLoading;
  const aiResultsMap = useMemo(
    () => new Map(aiResults.map(r => [r.useCase.id, r.whyMatched])),
    [aiResults]
  );

  const handleAISearchToggle = (enabled: boolean) => {
    setAiEnabled(enabled);
    try { localStorage.setItem("aiuc_ai_search_enabled", String(enabled)); } catch { /* ignore */ }
    if (!enabled) { clearAIResults(); setAiQuery(""); }
    else { setGlobalFilter(""); }
  };

  const handleAISearch = () => {
    if (aiQuery.trim()) doAISearch(aiQuery);
  };

  const handleClearAISearch = () => {
    clearAIResults();
    setAiQuery("");
  };

  // Gmail compose — no dialog state needed

  // Filter state
  type FilterState = {
    selectedValues: Set<string>;
    textSearch: string;
  };

  const allColumns = [
    "Capability",
    "Business Function",
    "Business Capability",
    "Stakeholder or User",
    "AI Use Case",
    "AI Algorithms & Frameworks",
    "Datasets",
    "Action / Implementation",
    "AI Tools & Models",
    "Digital Platforms and Tools",
    "Expected Outcomes and Results",
  ];

  const multiselectColumns = [
    "Business Function",
    "Business Capability",
    "Stakeholder or User",
    "AI Use Case",
    "AI Tools & Models",
    "Digital Platforms and Tools",
    "Expected Outcomes and Results",
  ];

  const initializeFilters = (): Record<string, FilterState> => {
    const initialFilters: Record<string, FilterState> = {};
    allColumns.forEach((col) => {
      initialFilters[col] = { selectedValues: new Set(), textSearch: "" };
    });
    return initialFilters;
  };

  const [filters, setFilters] = useState<Record<string, FilterState>>(
    initializeFilters()
  );

  const [filterAnchorEl, setFilterAnchorEl] = useState<{
    element: HTMLElement;
    field: string;
  } | null>(null);

  const tableContainerRef = useRef<HTMLDivElement>(null);

  // Helper function to toggle row expansion
  const toggleRowExpansion = useCallback((rowId: number) => {
    setExpandedRows((prev: Set<number>) => {
      const newSet = new Set(prev);
      if (newSet.has(rowId)) {
        newSet.delete(rowId);
      } else {
        newSet.add(rowId);
      }
      return newSet;
    });
  }, []);

  // Helper function to render chips
  const renderChips = useCallback(
    (value: string | null | undefined, _rowId: number, isExpanded: boolean) => {
      const items = parseChipItems(value);
      if (items.length === 0) return null;

      return (
        <Box
          sx={{
            display: "flex",
            flexDirection: "row",
            flexWrap: isExpanded ? "wrap" : "nowrap",
            gap: 0.5,
            py: 1,
            width: "100%",
            maxWidth: "100%",
            overflow: isExpanded ? "visible" : "hidden",
            whiteSpace: isExpanded ? "normal" : "nowrap",
            cursor: "pointer",
            minHeight: isExpanded ? "auto" : "24px",
            "&:hover": {
              opacity: 0.8,
            },
          }}
        >
          {items.map((item, index) => (
            <Chip
              key={index}
              label={item}
              size="small"
              sx={{
                fontSize: "0.75rem",
                flexShrink: 0,
                maxWidth: "none",
              }}
            />
          ))}
        </Box>
      );
    },
    []
  );


  // Filter Data Logic - FIXED
  const filteredData = useMemo(() => {
    let result = data;

    // Apply global filter
    if (globalFilter) {
      const lowerGlobalFilter = globalFilter.toLowerCase();
      result = result.filter((row) => {
        return allColumns.some((field) => {
          const value = String(
            row[field as keyof UseCaseData] || ""
          ).toLowerCase();
          return value.includes(lowerGlobalFilter);
        });
      });
    }

    // Apply column filters - IMPROVED LOGIC
    result = result.filter((row) => {
      return Object.keys(filters).every((field) => {
        const filter = filters[field];
        if (!filter) return true;

        // If no filter is applied, pass
        if (
          filter.textSearch.length === 0 &&
          filter.selectedValues.size === 0
        ) {
          return true;
        }

        const cellValue = String(row[field as keyof UseCaseData] || "");
        const cellValueLower = cellValue.toLowerCase();
        const textSearch = filter.textSearch.toLowerCase();

        // Text search filter
        if (textSearch && !cellValueLower.includes(textSearch)) {
          return false;
        }

        // Multi-select filter
        if (filter.selectedValues.size > 0) {
          const cellValues = cellValue
            .split(",")
            .map((v) => v.trim())
            .filter((v) => v.length > 0);

          const selectedValuesArray = Array.from(filter.selectedValues);

          // Check if ANY of the cell values match ANY of the selected values
          const hasMatch = cellValues.some((cv) =>
            selectedValuesArray.some((sv: string) => {
              const cvLower = cv.toLowerCase();
              const svLower = sv.toLowerCase();
              return cvLower === svLower || cvLower.includes(svLower) || svLower.includes(cvLower);
            })
          );

          if (!hasMatch) {
            return false;
          }
        }

        return true;
      });
    });
    return result;
  }, [data, filters, globalFilter]);

  // Get unique values for filtering - FACETED SEARCH (uses filteredData)
  const getUniqueValues = useCallback(
    (field: string): string[] => {
      const values = new Set<string>();
      filteredData.forEach((row) => {
        const value = row[field as keyof UseCaseData];
        if (value) {
          const parts = String(value)
            .split(",")
            .map((p) => p.trim())
            .filter((p) => p.length > 0);
          parts.forEach((part) => values.add(part));
        }
      });
      return Array.from(values).sort();
    },
    [filteredData]
  );

  // Custom Header
  const CustomHeader = useCallback(
    ({ column }: { column: Column<UseCaseData, any> }) => {
      const field = column.id;
      const headerName = column.columnDef.meta?.headerName || field;
      const filter = filters[field] || {
        selectedValues: new Set(),
        textSearch: "",
      };
      const hasActiveFilter =
        filter.selectedValues.size > 0 || filter.textSearch.length > 0;

      const handleFilterClick = (event: React.MouseEvent<HTMLElement>) => {
        event.stopPropagation();
        setFilterAnchorEl({ element: event.currentTarget, field });
      };

      const sortDirection = column.getIsSorted();

      return (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
            height: "100%",
          }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              flex: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              cursor: "pointer",
              userSelect: "none",
            }}
            onClick={() => column.toggleSorting()}
          >
            <Typography
              variant="body2"
              sx={{
                fontWeight: 600,
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {headerName}
            </Typography>
            <Box sx={{ display: "flex", flexDirection: "column", ml: 0.5 }}>
              {sortDirection === "asc" ? (
                <ArrowUpwardIcon sx={{ fontSize: 16, color: PURE_ORANGE }} />
              ) : sortDirection === "desc" ? (
                <ArrowDownwardIcon sx={{ fontSize: 16, color: PURE_ORANGE }} />
              ) : (
                <Box sx={{ width: 16, height: 16 }} />
              )}
            </Box>
          </Box>
          <IconButton
            size="small"
            onClick={handleFilterClick}
            sx={{
              padding: "4px",
              color: hasActiveFilter ? PURE_ORANGE : "#666",
              "&:hover": {
                backgroundColor: "#fff5f2",
              },
            }}
          >
            <FilterListIcon fontSize="small" />
          </IconButton>
        </Box>
      );
    },
    [filters]
  );


  const handleContactClick = useCallback((aiUseCase: string) => {
    const subject = aiUseCase
      ? `Interest in: ${aiUseCase}`
      : "Request for Information";
    const body = [
      userEmail ? `From: ${userEmail}` : "",
      `Use Case: ${aiUseCase || "N/A"}`,
      "",
      "Hi,",
      "",
      "I'm interested in this use case. Please contact me to discuss further.",
      "",
      "Thank you.",
    ]
      .filter((_line, i) => i !== 0 || userEmail)
      .join("\n");
    openGmailCompose(contactEmail, subject, body);
  }, [userEmail, contactEmail]);

  const columns = useMemo<ColumnDef<UseCaseData>[]>(
    () => [
      {
        id: "contact",
        header: () => null,
        cell: ({ row }) => (
          <Tooltip title={emailTooltipText} arrow>
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                handleContactClick(row.original["AI Use Case"]);
              }}
              sx={{
                color: PURE_ORANGE,
                "&:hover": {
                  backgroundColor: "#fff5f2",
                  transform: "scale(1.1)",
                },
                transition: "all 0.2s ease",
              }}
            >
              <MailOutlineIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ),
        size: 60,
      },
      // "Why Matched" column — only visible in AI search mode
      ...(aiMode ? [{
        id: "whyMatched",
        header: () => (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <AutoAwesomeIcon sx={{ fontSize: 14, color: PURE_ORANGE }} />
            <Typography variant="body2" sx={{ fontWeight: 600, fontSize: "0.8rem" }}>
              Why Matched
            </Typography>
          </Box>
        ),
        size: 200,
        enableSorting: false,
        cell: ({ row }) => {
          const explanation = aiResultsMap.get(row.original.id);
          return explanation ? (
            <Typography
              variant="body2"
              sx={{
                fontSize: "0.72rem",
                color: "#555",
                fontStyle: "italic",
                lineHeight: 1.4,
                py: 0.25,
              }}
            >
              {explanation}
            </Typography>
          ) : null;
        },
      } as ColumnDef<UseCaseData>] : []),
      {
        accessorKey: "Capability",
        header: () => null,
        meta: { headerName: "Capability" },
        size: 80,
        enableSorting: false,
        cell: ({ row, getValue }) => {
          const rowId = row.original.id;
          return (
            <Box
              onClick={(e) => {
                e.stopPropagation();
                toggleRowExpansion(rowId);
              }}
              sx={{ width: "100%", cursor: "pointer", py: 1 }}
            >
              {getValue() as React.ReactNode}
            </Box>
          );
        },
      },
      {
        accessorKey: "Business Function",
        header: ({ column }) => <CustomHeader column={column} />,
        meta: { headerName: "Business Function" },
        size: 180,
        enableSorting: true,
        cell: ({ row, getValue }) => {
          const rowId = row.original.id;
          const isExpanded = expandedRows.has(rowId);
          return (
            <Box
              onClick={(e) => {
                e.stopPropagation();
                toggleRowExpansion(rowId);
              }}
              sx={{
                width: "100%",
                cursor: "pointer",
                py: 1,
                whiteSpace: isExpanded ? "normal" : "nowrap",
                overflow: isExpanded ? "visible" : "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {getValue() as React.ReactNode}
            </Box>
          );
        },
      },
      {
        accessorKey: "Business Capability",
        header: ({ column }) => <CustomHeader column={column} />,
        meta: { headerName: "Business Capability" },
        size: 200,
        enableSorting: true,
        cell: ({ row, getValue }) => {
          const rowId = row.original.id;
          const isExpanded = expandedRows.has(rowId);
          return (
            <Box
              onClick={(e) => {
                e.stopPropagation();
                toggleRowExpansion(rowId);
              }}
              sx={{
                width: "100%",
                cursor: "pointer",
                py: 1,
                whiteSpace: isExpanded ? "normal" : "nowrap",
                overflow: isExpanded ? "visible" : "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {getValue() as React.ReactNode}
            </Box>
          );
        },
      },
      {
        accessorKey: "Stakeholder or User",
        header: ({ column }) => <CustomHeader column={column} />,
        meta: { headerName: "Stakeholder or User" },
        size: 180,
        enableSorting: true,
        cell: ({ row, getValue }) => {
          const rowId = row.original.id;
          const isExpanded = expandedRows.has(rowId);
          return (
            <Box
              onClick={(e) => {
                e.stopPropagation();
                toggleRowExpansion(rowId);
              }}
              sx={{
                width: "100%",
                cursor: "pointer",
                py: 1,
                whiteSpace: isExpanded ? "normal" : "nowrap",
                overflow: isExpanded ? "visible" : "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {getValue() as React.ReactNode}
            </Box>
          );
        },
      },
      {
        accessorKey: "AI Use Case",
        header: ({ column }) => <CustomHeader column={column} />,
        meta: { headerName: "AI Use Case" },
        size: 200,
        enableSorting: true,
        cell: ({ row, getValue }) => {
          const rowId = row.original.id;
          const isExpanded = expandedRows.has(rowId);
          return (
            <Box
              onClick={(e) => {
                e.stopPropagation();
                toggleRowExpansion(rowId);
              }}
              sx={{
                width: "100%",
                cursor: "pointer",
                py: 1,
                whiteSpace: isExpanded ? "normal" : "nowrap",
                overflow: isExpanded ? "visible" : "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {getValue() as React.ReactNode}
            </Box>
          );
        },
      },
      {
        accessorKey: "AI Algorithms & Frameworks",
        header: ({ column }) => <CustomHeader column={column} />,
        meta: { headerName: "AI Algorithms & Frameworks" },
        size: 550,
        enableSorting: true,
        cell: ({ row, getValue }) => {
          const rowId = row.original.id;
          const isExpanded = expandedRows.has(rowId);
          return (
            <Box
              onClick={(e) => {
                e.stopPropagation();
                toggleRowExpansion(rowId);
              }}
              sx={{
                width: "100%",
                maxWidth: "100%",
                overflow: isExpanded ? "visible" : "hidden",
                position: "relative",
                display: "flex",
                alignItems: isExpanded ? "flex-start" : "center",
              }}
            >
              {renderChips(getValue() as string, rowId, isExpanded)}
            </Box>
          );
        },
      },
      {
        accessorKey: "Datasets",
        header: ({ column }) => <CustomHeader column={column} />,
        meta: { headerName: "Datasets" },
        size: 450,
        enableSorting: true,
        cell: ({ row, getValue }) => {
          const rowId = row.original.id;
          const isExpanded = expandedRows.has(rowId);
          return (
            <Box
              onClick={(e) => {
                e.stopPropagation();
                toggleRowExpansion(rowId);
              }}
              sx={{
                width: "100%",
                maxWidth: "100%",
                overflow: isExpanded ? "visible" : "hidden",
                position: "relative",
                display: "flex",
                alignItems: isExpanded ? "flex-start" : "center",
              }}
            >
              {renderChips(getValue() as string, rowId, isExpanded)}
            </Box>
          );
        },
      },
      {
        accessorKey: "Action / Implementation",
        header: ({ column }) => <CustomHeader column={column} />,
        meta: { headerName: "Action / Implementation" },
        size: 400,
        enableSorting: true,
        cell: ({ row, getValue }) => {
          const rowId = row.original.id;
          const isExpanded = expandedRows.has(rowId);
          return (
            <Box
              onClick={(e) => {
                e.stopPropagation();
                toggleRowExpansion(rowId);
              }}
              sx={{
                whiteSpace: isExpanded ? "normal" : "nowrap",
                overflow: isExpanded ? "visible" : "hidden",
                textOverflow: "ellipsis",
                lineHeight: 1.5,
                py: 1,
                cursor: "pointer",
                wordWrap: isExpanded ? "break-word" : "normal",
                "&:hover": { opacity: 0.8 },
              }}
            >
              {getValue() as React.ReactNode}
            </Box>
          );
        },
      },
      {
        accessorKey: "AI Tools & Models",
        header: ({ column }) => <CustomHeader column={column} />,
        meta: { headerName: "AI Tools & Models" },
        size: 450,
        enableSorting: true,
        cell: ({ row, getValue }) => {
          const rowId = row.original.id;
          const isExpanded = expandedRows.has(rowId);
          return (
            <Box
              onClick={(e) => {
                e.stopPropagation();
                toggleRowExpansion(rowId);
              }}
              sx={{
                width: "100%",
                maxWidth: "100%",
                overflow: isExpanded ? "visible" : "hidden",
                position: "relative",
                display: "flex",
                alignItems: isExpanded ? "flex-start" : "center",
              }}
            >
              {renderChips(getValue() as string, rowId, isExpanded)}
            </Box>
          );
        },
      },
      {
        accessorKey: "Digital Platforms and Tools",
        header: ({ column }) => <CustomHeader column={column} />,
        meta: { headerName: "Digital Platforms and Tools" },
        size: 250,
        enableSorting: true,
        cell: ({ row, getValue }) => {
          const rowId = row.original.id;
          const isExpanded = expandedRows.has(rowId);
          return (
            <Box
              onClick={(e) => {
                e.stopPropagation();
                toggleRowExpansion(rowId);
              }}
              sx={{
                width: "100%",
                maxWidth: "100%",
                overflow: isExpanded ? "visible" : "hidden",
                position: "relative",
                display: "flex",
                alignItems: isExpanded ? "flex-start" : "center",
              }}
            >
              {renderChips(getValue() as string, rowId, isExpanded)}
            </Box>
          );
        },
      },
      {
        accessorKey: "Expected Outcomes and Results",
        header: ({ column }) => <CustomHeader column={column} />,
        meta: { headerName: "Expected Outcomes and Results" },
        size: 300,
        enableSorting: true,
        cell: ({ row, getValue }) => {
          const rowId = row.original.id;
          const isExpanded = expandedRows.has(rowId);
          return (
            <Box
              onClick={(e) => {
                e.stopPropagation();
                toggleRowExpansion(rowId);
              }}
              sx={{
                width: "100%",
                maxWidth: "100%",
                overflow: isExpanded ? "visible" : "hidden",
                position: "relative",
                display: "flex",
                alignItems: isExpanded ? "flex-start" : "center",
              }}
            >
              {renderChips(getValue() as string, rowId, isExpanded)}
            </Box>
          );
        },
      },
    ],
    [expandedRows, CustomHeader, renderChips, toggleRowExpansion, handleContactClick, aiMode, aiResultsMap]
  );

  // When AI mode is active use the ranked AI results; otherwise use the normally filtered data
  const tableData = useMemo<UseCaseData[]>(() => {
    if (aiMode && aiResults.length > 0) return aiResults.map(r => r.useCase);
    return filteredData;
  }, [aiMode, aiResults, filteredData]);

  const table = useReactTable({
    data: tableData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    state: { sorting, rowSelection },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    enableRowSelection: true,
    getRowId: (row) => String(row.id),
  });

  const { rows } = table.getRowModel();
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: useCallback(
      (index: number) => {
        const row = rows[index];
        if (!row) return 52;
        return expandedRows.has(row.original.id) ? 200 : 52;
      },
      [rows, expandedRows]
    ),
    overscan: 10,
    measureElement:
      typeof window !== "undefined" &&
        navigator.userAgent.indexOf("Firefox") === -1
        ? (element: Element) => element.getBoundingClientRect().height
        : undefined,
  });

  useEffect(() => {
    rowVirtualizer.measure();
  }, [expandedRows, rowVirtualizer]);

  // Total Column Width
  const totalWidth = useMemo(() => {
    return columns.reduce((sum: number, col: ColumnDef<UseCaseData, any>) => sum + (col.size || 150), 0);
  }, [columns]);

  const handleClearAllFilters = () => {
    setFilters(initializeFilters());
    setGlobalFilter("");
  };

  const hasActiveFilters = useMemo(() => {
    if (globalFilter) return true;
    return Object.values(filters).some(
      (f) => f.selectedValues.size > 0 || f.textSearch !== ""
    );
  }, [filters, globalFilter]);

  return (
    <Box
      sx={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        height: "100%",
      }}
    >
      {/* ── AI Search Panel ─────────────────────────────────────────────────── */}
      <Box
        sx={{
          mb: 1.5,
          p: 1.5,
          border: `1px solid ${aiEnabled && aiMode ? PURE_ORANGE : "#e0e0e0"}`,
          borderRadius: "6px",
          backgroundColor: aiEnabled && aiMode ? "#fff8f5" : "#fafafa",
          transition: "all 0.2s ease",
        }}
      >
        {/* Header row: icon + label + toggle + clear button */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <AutoAwesomeIcon sx={{ fontSize: 16, color: aiEnabled ? PURE_ORANGE : "#aaa" }} />
          <Typography variant="body2" sx={{ fontWeight: 700, fontSize: "0.8rem", color: aiEnabled ? "#1a1a1a" : "#aaa" }}>
            AI Search
          </Typography>
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={aiEnabled}
                onChange={e => handleAISearchToggle(e.target.checked)}
                sx={{
                  "& .MuiSwitch-switchBase.Mui-checked": { color: PURE_ORANGE },
                  "& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track": { backgroundColor: PURE_ORANGE },
                }}
              />
            }
            label={
              <Typography variant="body2" sx={{ fontSize: "0.72rem", color: "#666" }}>
                {aiEnabled ? "On" : "Off"}
              </Typography>
            }
            sx={{ ml: 0.5, mr: 0 }}
          />
          {aiEnabled && aiMode && (
            <Button
              size="small"
              variant="text"
              onClick={handleClearAISearch}
              sx={{ ml: "auto", color: "#666", fontSize: "0.72rem", textTransform: "none", py: 0 }}
            >
              ✕ Clear — show all use cases
            </Button>
          )}
        </Box>

        {/* Search input — only shown when AI search is enabled */}
        {aiEnabled && (
          <>
            <Box sx={{ display: "flex", gap: 1, alignItems: "center", mt: 1 }}>
              <TextField
                size="small"
                fullWidth
                placeholder="Describe what you're looking for — e.g. 'automate contract review using NLP'"
                value={aiQuery}
                onChange={e => setAiQuery(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleAISearch(); }}
                disabled={aiLoading}
                sx={{
                  "& .MuiOutlinedInput-root": {
                    fontSize: "0.8rem",
                    "&.Mui-focused fieldset": { borderColor: PURE_ORANGE },
                  },
                }}
              />
              <Button
                variant="contained"
                onClick={handleAISearch}
                disabled={!aiQuery.trim() || aiLoading}
                sx={{
                  backgroundColor: PURE_ORANGE,
                  "&:hover": { backgroundColor: "#cc4000" },
                  "&.Mui-disabled": { backgroundColor: "#eee", color: "#aaa" },
                  whiteSpace: "nowrap",
                  minWidth: 100,
                  fontSize: "0.78rem",
                  py: "6px",
                }}
              >
                {aiLoading ? <CircularProgress size={16} sx={{ color: "#fff" }} /> : "Search with AI"}
              </Button>
            </Box>
            {aiError && (
              <Alert severity="error" sx={{ mt: 1, py: 0.5, fontSize: "0.8rem" }}>{aiError}</Alert>
            )}
            {aiMode && !aiLoading && aiResults.length > 0 && (
              <Typography variant="body2" sx={{ mt: 0.75, color: "#666", fontSize: "0.72rem" }}>
                ✓ {aiResults.length} semantic matches — ranked by relevance, AI explanations in "Why Matched"
              </Typography>
            )}
          </>
        )}
        {!aiEnabled && (
          <Box sx={{ mt: 1 }}>
            <TextField
              size="small"
              fullWidth
              placeholder="Search across all columns — e.g. 'contract', 'finance', 'NLP'"
              value={globalFilter}
              onChange={e => setGlobalFilter(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" sx={{ color: "#aaa" }} />
                  </InputAdornment>
                ),
                endAdornment: globalFilter && (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={() => setGlobalFilter("")} sx={{ padding: "4px" }}>
                      <ClearIcon fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                ),
              }}
              sx={{
                "& .MuiOutlinedInput-root": {
                  fontSize: "0.8rem",
                  "&.Mui-focused fieldset": { borderColor: "#bbb" },
                },
              }}
            />
            {globalFilter && (
              <Typography variant="body2" sx={{ mt: 0.75, color: "#666", fontSize: "0.72rem" }}>
                {filteredData.length} result{filteredData.length !== 1 ? "s" : ""} matching "{globalFilter}"
              </Typography>
            )}
          </Box>
        )}
      </Box>

      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 1.5,
          gap: 2,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          {/* Search all columns field — commented out
          <TextField
            size="small"
            placeholder="Search all columns..."
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
              endAdornment: globalFilter && (
                <InputAdornment position="end">
                  <IconButton
                    size="small"
                    onClick={() => setGlobalFilter("")}
                    sx={{ padding: "4px" }}
                  >
                    <ClearIcon fontSize="small" />
                  </IconButton>
                </InputAdornment>
              ),
            }}
            sx={{
              width: 300,
              "& .MuiOutlinedInput-root": {
                "&.Mui-focused fieldset": {
                  borderColor: PURE_ORANGE,
                },
              },
            }}
          />
          */}
          <Typography variant="body2" sx={{ color: "#666", fontSize: "0.8rem", whiteSpace: "nowrap" }}>
            {aiMode ? `${aiResults.length} AI matches` : `${filteredData.length} use cases`}
          </Typography>
        </Box>
        <Button
          variant="outlined"
          size="small"
          startIcon={<ClearIcon />}
          onClick={handleClearAllFilters}
          disabled={!hasActiveFilters}
            sx={{
              color: PURE_ORANGE,
              borderColor: PURE_ORANGE,
              "&:hover": {
                borderColor: "#cc4000",
                backgroundColor: "#fff5f2",
              },
              "&.Mui-disabled": {
                color: "#bbb",
                borderColor: "#ddd",
              },
            }}
          >
            Clear All Filters
          </Button>
      </Box>

      {error && (
        <Alert
          severity="error"
          sx={{
            mb: 2,
            backgroundColor: "#fff5f2",
            borderLeft: `4px solid ${PURE_ORANGE}`,
            color: "#1a1a1a",
          }}
        >
          {error}
        </Alert>
      )}

      {loading && data.length === 0 ? (
        <Box
          sx={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            flex: 1,
            padding: "16px 32px",
          }}
        >
          <CircularProgress sx={{ color: PURE_ORANGE }} />
        </Box>
      ) : (
        <Paper
          sx={{
            width: "100%",
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            backgroundColor: "#ffffff",
            position: "relative",
            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.08)",
            borderRadius: "4px",
            border: "1px solid #e0e0e0",
          }}
          ref={tableContainerRef}
        >
          <Box
            sx={{
              width: totalWidth,
              position: "relative",
            }}
          >
            {/* Table Header */}
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: `50px ${columns
                  .slice(1)
                  .map((col) => `${col.size || 150}px`)
                  .join(" ")}`,
                position: "sticky",
                top: 0,
                zIndex: 10,
                backgroundColor: "#fafafa",
                borderBottom: `2px solid ${PURE_ORANGE}`,
                boxShadow: "0 2px 8px rgba(0, 0, 0, 0.08)",
                backdropFilter: "blur(10px)",
              }}
            >
              {table.getHeaderGroups().map((headerGroup) =>
                headerGroup.headers.map((header) => (
                  <Box
                    key={header.id}
                    sx={{
                      padding: "14px 16px",
                      fontWeight: 600,
                      fontSize: "0.875rem",
                      color: "#1a1a1a",
                      borderRight: "1px solid #e0e0e0",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      minHeight: "48px",
                      backgroundColor: "#fafafa",
                      transition: "background-color 0.2s ease",
                      "&:hover": {
                        backgroundColor: "#f5f5f5",
                      },
                      "&:last-child": {
                        borderRight: "none",
                      },
                    }}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )}
                  </Box>
                ))
              )}
            </Box>

            {/* Virtualized Table Body */}
            <Box
              sx={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                position: "relative",
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const row = rows[virtualRow.index];
                const isExpanded = expandedRows.has(row.original.id);

                return (
                  <Box
                    key={row.id}
                    data-index={virtualRow.index}
                    ref={rowVirtualizer.measureElement}
                    sx={{
                      display: "grid",
                      gridTemplateColumns: `50px ${columns
                        .slice(1)
                        .map((col) => `${col.size || 150}px`)
                        .join(" ")}`,
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualRow.start}px)`,
                      backgroundColor: "#ffffff",
                      borderBottom: "1px solid #e0e0e0",
                      transition: "background-color 0.2s ease",
                      "&:hover": {
                        backgroundColor: "#fafafa",
                      },
                    }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <Box
                        key={cell.id}
                        sx={{
                          padding: "16px",
                          fontSize: "0.875rem",
                          color: "#333",
                          lineHeight: 1.5,
                          borderRight: "1px solid #e0e0e0",
                          overflow: "hidden",
                          backgroundColor: isExpanded
                            ? "#fafafa"
                            : "transparent",
                          transition: "all 0.2s ease",
                          "&:last-child": {
                            borderRight: "none",
                          },
                        }}
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </Box>
                    ))}
                  </Box>
                );
              })}
            </Box>
          </Box>
        </Paper>
      )}
      <FilterPopup
        filterAnchorEl={filterAnchorEl}
        setFilterAnchorEl={setFilterAnchorEl}
        filters={filters}
        setFilters={setFilters}
        multiselectColumns={multiselectColumns}
        getUniqueValues={getUniqueValues}
        tableContainerRef={tableContainerRef}
      />
    </Box>
  );
}

// --- Filter Popup Component (Moved Outside) ---
interface FilterPopupProps {
  filterAnchorEl: { element: HTMLElement; field: string } | null;
  setFilterAnchorEl: (anchor: { element: HTMLElement; field: string } | null) => void;
  filters: Record<string, { selectedValues: Set<string>; textSearch: string }>;
  setFilters: React.Dispatch<React.SetStateAction<Record<string, { selectedValues: Set<string>; textSearch: string }>>>;
  multiselectColumns: string[];
  getUniqueValues: (field: string) => string[];
  tableContainerRef: React.RefObject<HTMLDivElement | null>;
}

const FilterPopup = ({
  filterAnchorEl,
  setFilterAnchorEl,
  filters,
  setFilters,
  multiselectColumns,
  getUniqueValues,
  tableContainerRef,
}: FilterPopupProps) => {
  const field = filterAnchorEl?.field || "";
  const isMultiselectField = multiselectColumns.includes(field);
  const filter = (field ? filters[field] : null) || DEFAULT_FILTER;

  const [textSearch, setTextSearch] = useState(filter.textSearch);
  const [selectedValues, setSelectedValues] = useState<Set<string>>(
    new Set(filter.selectedValues)
  );

  // Sync local state when the filter anchor changes
  useEffect(() => {
    if (!field) return;
    setTextSearch(filter.textSearch);
    setSelectedValues(new Set(filter.selectedValues));
  }, [field, filter.textSearch, filter.selectedValues]);

  const uniqueValues = useMemo(() => {
    return (isMultiselectField && field) ? getUniqueValues(field) : [];
  }, [field, isMultiselectField, getUniqueValues]);

  const filteredUniqueValues = useMemo(() => {
    if (!isMultiselectField) return [];
    if (!textSearch) return uniqueValues;
    const searchLower = textSearch.toLowerCase();
    return uniqueValues.filter((val) =>
      val.toLowerCase().includes(searchLower)
    );
  }, [uniqueValues, textSearch, isMultiselectField]);

  if (!filterAnchorEl) return null;

  const handleToggleValue = (value: string) => {
    setSelectedValues((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(value)) {
        newSet.delete(value);
      } else {
        newSet.add(value);
      }
      return newSet;
    });
  };

  const handleApplyFilter = () => {
    const scrollTop = tableContainerRef.current?.scrollTop || 0;
    setFilters((prev) => ({
      ...prev,
      [field]: {
        selectedValues: new Set(selectedValues),
        textSearch: textSearch,
      },
    }));
    setFilterAnchorEl(null);
    requestAnimationFrame(() => {
      if (tableContainerRef.current) {
        tableContainerRef.current.scrollTop = scrollTop;
      }
    });
  };

  const handleClearFilter = () => {
    const scrollTop = tableContainerRef.current?.scrollTop || 0;
    setSelectedValues(new Set());
    setTextSearch("");
    setFilters((prev) => {
      const updated = { ...prev };
      updated[field] = { selectedValues: new Set(), textSearch: "" };
      return updated;
    });
    setFilterAnchorEl(null);
    requestAnimationFrame(() => {
      if (tableContainerRef.current) {
        tableContainerRef.current.scrollTop = scrollTop;
      }
    });
  };

  const handleCloseFilter = () => {
    setFilterAnchorEl(null);
  };

  const hasChanges =
    textSearch !== filter.textSearch ||
    selectedValues.size !== filter.selectedValues.size ||
    Array.from(selectedValues).some((v) => !filter.selectedValues.has(v));

  return (
    <Popover
      open={true}
      anchorEl={filterAnchorEl.element}
      onClose={handleCloseFilter}
      anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      transformOrigin={{ vertical: "top", horizontal: "center" }}
      PaperProps={{
        sx: {
          minWidth: 300,
          maxWidth: 400,
          maxHeight: isMultiselectField ? 500 : "auto",
          mt: 1,
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        },
      }}
    >
      <Box sx={{ p: 2 }}>
        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
          Filter: {field}
        </Typography>
        <TextField
          fullWidth
          size="small"
          placeholder={
            isMultiselectField ? "Search options..." : "Type to filter..."
          }
          value={textSearch}
          onChange={(e) => setTextSearch(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
            endAdornment: textSearch && (
              <InputAdornment position="end">
                <IconButton
                  size="small"
                  onClick={() => setTextSearch("")}
                  sx={{ padding: "4px" }}
                >
                  <ClearIcon fontSize="small" />
                </IconButton>
              </InputAdornment>
            ),
          }}
          sx={{ mb: isMultiselectField ? 2 : 0 }}
        />
        {isMultiselectField && (
          <>
            <Divider sx={{ mb: 1 }} />
            <Box sx={{ maxHeight: 300, overflow: "auto", mb: 2 }}>
              {filteredUniqueValues.length === 0 ? (
                <Typography variant="body2" sx={{ p: 2, color: "#666" }}>
                  No values found
                </Typography>
              ) : (
                <List dense>
                  {filteredUniqueValues.map((value) => (
                    <ListItem key={value} disablePadding>
                      <ListItemButton
                        onClick={() => handleToggleValue(value)}
                        dense
                      >
                        <Checkbox
                          checked={selectedValues.has(value)}
                          size="small"
                          sx={{
                            color: PURE_ORANGE,
                            "&.Mui-checked": { color: PURE_ORANGE },
                          }}
                        />
                        <ListItemText
                          primary={value}
                          primaryTypographyProps={{ fontSize: "0.875rem" }}
                        />
                      </ListItemButton>
                    </ListItem>
                  ))}
                </List>
              )}
            </Box>
          </>
        )}
        <Box
          sx={{
            display: "flex",
            gap: 1,
            justifyContent: "flex-end",
            mt: isMultiselectField ? 0 : 2,
          }}
        >
          <Button
            size="small"
            onClick={handleClearFilter}
            sx={{ color: "#666", "&:hover": { backgroundColor: "#f5f5f5" } }}
          >
            Clear
          </Button>
          <Button
            size="small"
            variant="contained"
            onClick={handleApplyFilter}
            disabled={!hasChanges}
            sx={{
              backgroundColor: PURE_ORANGE,
              "&:hover": { backgroundColor: "#cc4000" },
              "&.Mui-disabled": { backgroundColor: "#ccc" },
            }}
          >
            Apply
          </Button>
        </Box>
      </Box>
    </Popover>
  );
};