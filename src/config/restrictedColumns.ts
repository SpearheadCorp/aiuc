/**
 * Column-level access control config.
 * Columns listed here are blurred for non-authenticated users.
 * These are the "how" columns — implementation details, tooling, datasets.
 * The "what/who" columns (Business Function, AI Use Case, etc.) remain visible.
 *
 * To change which columns are restricted, edit these arrays only.
 * No changes needed in the table components.
 */

export const USE_CASE_RESTRICTED_COLUMNS: string[] = [
  "AI Algorithms & Frameworks",
  "Action / Implementation",
  "Datasets",
  "AI Tools & Models",
  "Digital Platforms and Tools",
  "Expected Outcomes and Results",
  // ""
];

export const INDUSTRY_RESTRICTED_COLUMNS: string[] = [
  "Implementation Plan",
  "Datasets",
  "AI Tools / Platforms",
  "Digital Tools / Platforms",
  "AI Frameworks",
  "AI Tools and Models",
  "Industry References",
];
