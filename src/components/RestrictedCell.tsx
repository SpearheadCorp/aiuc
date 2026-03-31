import React from "react";
import { Box, Tooltip } from "@mui/material";
import LockIcon from "@mui/icons-material/Lock";

interface RestrictedCellProps {
  rawValue: string;
}

/**
 * Shown in place of a restricted cell's normal content when the user is not logged in.
 * - Shows the first 3 characters of the raw value unobscured (teaser)
 * - Blurs everything after that with CSS filter
 * - Shows a lock icon and tooltip prompting registration
 */
export default function RestrictedCell({ rawValue }: RestrictedCellProps) {
  const preview = rawValue.slice(0, 3);
  // Use the real remaining text so the blur looks like real content, not fake dots
  const masked = rawValue.slice(3) || "••••••••••••";

  return (
    <Tooltip title="Register to view full data" arrow placement="top">
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          width: "100%",
          overflow: "hidden",
          cursor: "default",
        }}
      >
        {/* Unblurred preview */}
        <Box
          component="span"
          sx={{ fontSize: "0.875rem", color: "#333", flexShrink: 0 }}
        >
          {preview}
        </Box>

        {/* Blurred remainder — fills available width */}
        <Box
          component="span"
          sx={{
            fontSize: "0.875rem",
            color: "#333",
            filter: "blur(5px)",
            userSelect: "none",
            pointerEvents: "none",
            overflow: "hidden",
            whiteSpace: "nowrap",
            flex: 1,
          }}
        >
          {masked}
        </Box>

        {/* Lock icon */}
        <LockIcon
          sx={{ fontSize: 13, color: "#bbb", flexShrink: 0, ml: 0.25 }}
        />
      </Box>
    </Tooltip>
  );
}
