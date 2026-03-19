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
} from "@mui/material";
import FilterListIcon from "@mui/icons-material/FilterList";
import SearchIcon from "@mui/icons-material/Search";
import ClearIcon from "@mui/icons-material/Clear";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import MailOutlineIcon from "@mui/icons-material/MailOutline";
import type { IndustryData } from "../types";
import { parseChipItems } from "../utils";
import ContactDialog from "./ContactDialog";

const PURE_ORANGE = "#fe5000";

const EMPTY_SET = new Set<string>();
const DEFAULT_FILTER = {
  selectedValues: EMPTY_SET,
  textSearch: "",
};

interface IndustryDataTableProps {
  data: IndustryData[];
  loading: boolean;
  error: string | null;
  userEmail: string;
}

export default function IndustryDataTable({
  data,
  loading,
  error,
  userEmail,
}: IndustryDataTableProps) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  // Contact dialog state
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [contactSubject, setContactSubject] = useState("");

  // Filter state
  type FilterState = {
    selectedValues: Set<string>;
    textSearch: string;
  };

  const allColumns = [
    "Industry",
    "Business Function",
    "Business Capability",
    "Stakeholders / Users",
    "AI Use Case",
    "Description",
    "Implementation Plan",
    "Expected Outcomes",
    "Datasets",
    "AI Tools / Platforms",
    "Digital Tools / Platforms",
    "AI Frameworks",
    "AI Tools and Models",
    "Industry References",
  ];

  const multiselectColumns = [
    "Industry",
    "Business Function",
    "Business Capability",
    "Stakeholders / Users",
    "AI Use Case",
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
  const toggleRowExpansion = useCallback((rowId: string) => {
    setExpandedRows((prev) => {
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
    (value: string | null | undefined, _rowId: string, isExpanded: boolean) => {
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

  // Filter Data Logic
  const filteredData = useMemo(() => {
    let result = data;

    // Apply global filter
    if (globalFilter) {
      const lowerGlobalFilter = globalFilter.toLowerCase();
      result = result.filter((row) => {
        return allColumns.some((field) => {
          const value = String(row[field as keyof IndustryData] || "").toLowerCase();
          return value.includes(lowerGlobalFilter);
        });
      });
    }

    // Apply column filters
    result = result.filter((row) => {
      return Object.keys(filters).every((field) => {
        const filter = filters[field];
        if (!filter) return true;

        if (
          filter.textSearch.length === 0 &&
          filter.selectedValues.size === 0
        ) {
          return true;
        }

        const cellValue = String(row[field as keyof IndustryData] || "");
        const cellValueLower = cellValue.toLowerCase();
        const textSearch = filter.textSearch.toLowerCase();

        if (textSearch && !cellValueLower.includes(textSearch)) {
          return false;
        }

        if (filter.selectedValues.size > 0) {
          const cellValues = cellValueLower
            .split(",")
            .map((v) => v.trim())
            .filter((v) => v.length > 0);
          const selectedValuesArray = Array.from(filter.selectedValues).map(
            (v) => v.toLowerCase().trim()
          );

          return cellValues.some((cv) =>
            selectedValuesArray.some(
              (sv) => cv === sv || cv.includes(sv) || sv.includes(cv)
            )
          );
        }

        return true;
      });
    });
    return result;
  }, [data, filters, globalFilter]);

  // Unique values for filter - FACETED SEARCH (uses filteredData)
  const getUniqueValues = useCallback(
    (field: string): string[] => {
      const values = new Set<string>();
      filteredData.forEach((row) => {
        const value = row[field as keyof IndustryData];
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
    ({ column }: { column: Column<IndustryData, any> }) => {
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


  const handleContactClick = useCallback((aiUseCase: string, industry: string) => {
    setContactSubject(`Interest in: ${aiUseCase} (${industry})`);
    setContactDialogOpen(true);
  }, []);

  const columns = useMemo<ColumnDef<IndustryData>[]>(
    () => [
      {
        id: "contact",
        header: () => null,
        cell: ({ row }) => (
          <Tooltip title="I'm interested — contact me" arrow>
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                handleContactClick(
                  row.original["AI Use Case"],
                  row.original.Industry
                );
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
        size: 50,
      },
      // Define Industry Data Columns
      {
        accessorKey: "Industry",
        header: ({ column }) => <CustomHeader column={column} />,
        meta: { headerName: "Industry" },
        size: 170,
        enableSorting: true,
        cell: ({ row, getValue }) => {
          const rowId = row.original.Id;
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
          const rowId = row.original.Id;
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
        size: 180,
        enableSorting: true,
        cell: ({ row, getValue }) => {
          const rowId = row.original.Id;
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
        accessorKey: "Stakeholders / Users",
        header: ({ column }) => <CustomHeader column={column} />,
        meta: { headerName: "Stakeholders / Users" },
        size: 180,
        enableSorting: true,
        cell: ({ row, getValue }) => {
          const rowId = row.original.Id;
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
          const rowId = row.original.Id;
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
        accessorKey: "Description",
        header: ({ column }) => <CustomHeader column={column} />,
        meta: { headerName: "Description" },
        size: 400,
        enableSorting: true,
        cell: ({ row, getValue }) => {
          const rowId = row.original.Id;
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
                py: 1,
                cursor: "pointer",
              }}
            >
              {getValue() as React.ReactNode}
            </Box>
          );
        },
      },
      {
        accessorKey: "Implementation Plan",
        header: ({ column }) => <CustomHeader column={column} />,
        meta: { headerName: "Implementation Plan" },
        size: 400,
        enableSorting: true,
        cell: ({ row, getValue }) => {
          const rowId = row.original.Id;
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
                py: 1,
                cursor: "pointer",
              }}
            >
              {getValue() as React.ReactNode}
            </Box>
          );
        },
      },
      {
        accessorKey: "Expected Outcomes",
        header: ({ column }) => <CustomHeader column={column} />,
        meta: { headerName: "Expected Outcomes" },
        size: 300,
        enableSorting: true,
        cell: ({ row, getValue }) => {
          const rowId = row.original.Id;
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
        accessorKey: "Datasets",
        header: ({ column }) => <CustomHeader column={column} />,
        meta: { headerName: "Datasets" },
        size: 350,
        enableSorting: true,
        cell: ({ row, getValue }) => {
          const rowId = row.original.Id;
          const isExpanded = expandedRows.has(rowId);
          return (
            <Box
              onClick={(e) => {
                e.stopPropagation();
                toggleRowExpansion(rowId);
              }}
              sx={{
                display: "flex",
                flexWrap: isExpanded ? "wrap" : "nowrap",
                overflow: isExpanded ? "visible" : "hidden",
              }}
            >
              {renderChips(getValue() as string, rowId, isExpanded)}
            </Box>
          );
        },
      },
      {
        accessorKey: "AI Tools / Platforms",
        header: ({ column }) => <CustomHeader column={column} />,
        meta: { headerName: "AI Tools / Platforms" },
        size: 300,
        enableSorting: true,
        cell: ({ row, getValue }) => {
          const rowId = row.original.Id;
          const isExpanded = expandedRows.has(rowId);
          return (
            <Box
              onClick={(e) => {
                e.stopPropagation();
                toggleRowExpansion(rowId);
              }}
              sx={{
                display: "flex",
                flexWrap: isExpanded ? "wrap" : "nowrap",
                overflow: isExpanded ? "visible" : "hidden",
              }}
            >
              {renderChips(getValue() as string, rowId, isExpanded)}
            </Box>
          );
        },
      },
      {
        accessorKey: "Digital Tools / Platforms",
        header: ({ column }) => <CustomHeader column={column} />,
        meta: { headerName: "Digital Tools / Platforms" },
        size: 300,
        enableSorting: true,
        cell: ({ row, getValue }) => {
          const rowId = row.original.Id;
          const isExpanded = expandedRows.has(rowId);
          return (
            <Box
              onClick={(e) => {
                e.stopPropagation();
                toggleRowExpansion(rowId);
              }}
              sx={{
                display: "flex",
                flexWrap: isExpanded ? "wrap" : "nowrap",
                overflow: isExpanded ? "visible" : "hidden",
              }}
            >
              {renderChips(getValue() as string, rowId, isExpanded)}
            </Box>
          );
        },
      },
      {
        accessorKey: "AI Frameworks",
        header: ({ column }) => <CustomHeader column={column} />,
        meta: { headerName: "AI Frameworks" },
        size: 300,
        enableSorting: true,
        cell: ({ row, getValue }) => {
          const rowId = row.original.Id;
          const isExpanded = expandedRows.has(rowId);
          return (
            <Box
              onClick={(e) => {
                e.stopPropagation();
                toggleRowExpansion(rowId);
              }}
              sx={{
                display: "flex",
                flexWrap: isExpanded ? "wrap" : "nowrap",
                overflow: isExpanded ? "visible" : "hidden",
              }}
            >
              {renderChips(getValue() as string, rowId, isExpanded)}
            </Box>
          );
        },
      },
      {
        accessorKey: "AI Tools and Models",
        header: ({ column }) => <CustomHeader column={column} />,
        meta: { headerName: "AI Tools and Models" },
        size: 300,
        enableSorting: true,
        cell: ({ row, getValue }) => {
          const rowId = row.original.Id;
          const isExpanded = expandedRows.has(rowId);
          return (
            <Box
              onClick={(e) => {
                e.stopPropagation();
                toggleRowExpansion(rowId);
              }}
              sx={{
                display: "flex",
                flexWrap: isExpanded ? "wrap" : "nowrap",
                overflow: isExpanded ? "visible" : "hidden",
              }}
            >
              {renderChips(getValue() as string, rowId, isExpanded)}
            </Box>
          );
        },
      },
      {
        accessorKey: "Industry References",
        header: ({ column }) => <CustomHeader column={column} />,
        meta: { headerName: "Industry References" },
        size: 300,
        enableSorting: true,
        cell: ({ row, getValue }) => {
          const rowId = row.original.Id;
          const isExpanded = expandedRows.has(rowId);
          return (
            <Box
              onClick={(e) => {
                e.stopPropagation();
                toggleRowExpansion(rowId);
              }}
              sx={{
                display: "flex",
                flexWrap: isExpanded ? "wrap" : "nowrap",
                overflow: isExpanded ? "visible" : "hidden",
              }}
            >
              <a
                style={{
                  textDecoration: "underline",
                  color: PURE_ORANGE,
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
                href={getValue() as string}
                target="_blank"
                rel="noopener noreferrer"
              >
                Visit Site <OpenInNewIcon sx={{ fontSize: 12 }} />
              </a>
            </Box>
          );
        },
      },
    ],
    [expandedRows, CustomHeader, renderChips, toggleRowExpansion, filters, handleContactClick]
  );

  const table = useReactTable({
    data: filteredData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    state: { sorting },
    onSortingChange: setSorting,
    getRowId: (row) => row.Id,
  });

  const { rows } = table.getRowModel();
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: useCallback(
      (index: number) => {
        const row = rows[index];
        if (!row) return 52;
        return expandedRows.has(row.original.Id) ? 200 : 52;
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

  const totalWidth = useMemo(() => {
    return columns.reduce((sum: number, col: ColumnDef<IndustryData, any>) => sum + (col.size || 150), 0);
  }, [columns]);

  const handleClearAllFilters = () => {
    setFilters(initializeFilters());
    setGlobalFilter("");
  };

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
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 2,
          gap: 2,
        }}
      >
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
        <Button
          variant="outlined"
          size="small"
          startIcon={<ClearIcon />}
          onClick={handleClearAllFilters}
          sx={{
            color: PURE_ORANGE,
            borderColor: PURE_ORANGE,
            "&:hover": {
              borderColor: "#cc4000",
              backgroundColor: "#fff5f2",
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
            height: "100%",
            padding: "16px 32px",
          }}
        >
          <CircularProgress sx={{ color: PURE_ORANGE }} />
        </Box>
      ) : (
        <Paper
          sx={{
            width: "100%",
            height: "100%",
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
                const isExpanded = expandedRows.has(row.original.Id);

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
      <ContactDialog
        open={contactDialogOpen}
        onClose={() => setContactDialogOpen(false)}
        userEmail={userEmail}
        subject={contactSubject}
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
    new Set(filter.selectedValues as Set<string>)
  );

  // Sync local state when the filter anchor changes
  useEffect(() => {
    if (!field) return;
    setTextSearch(filter.textSearch);
    setSelectedValues(new Set(filter.selectedValues as Set<string>));
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
