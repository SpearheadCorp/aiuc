import { useState } from "react";
import pureLogoImg from "./assets/purelogo.png";
import spearheadImg from "./assets/spearhead.png";
import {
  Box,
  Typography,
  Tabs,
  Tab,
  CssBaseline,
  Link,
  Paper,
} from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import EmailIcon from "@mui/icons-material/Email";
import ArticleIcon from "@mui/icons-material/Article";
import BarChartIcon from "@mui/icons-material/BarChart";
import UnfoldMoreIcon from "@mui/icons-material/UnfoldMore";
import FilterListIcon from "@mui/icons-material/FilterList";
import LockOpenIcon from "@mui/icons-material/LockOpen";
import Logo from "./components/Logo";
import UseCaseTable from "./components/UseCaseTable";
import IndustryDataTable from "./components/IndustryDataTable";
import { theme, PURE_ORANGE } from "./theme";
import { useS3Data } from "./hooks/useS3Data";
import { useOktaUser } from "./hooks/useOktaUser";
import "./globals.css";

const CONTACT_EMAIL = import.meta.env.VITE_CONTACT_EMAIL || "aiuc@purestorage.com";
const EMAIL_TOOLTIP_TEXT = import.meta.env.VITE_EMAIL_TOOLTIP_TEXT || "I'm interested — contact me";

function App() {
  const [activeTab, setActiveTab] = useState(0);

  const { userName, isAuthenticated, isLoading: oktaLoading, userEmail } = useOktaUser();

  const {
    useCaseData,
    industryData,
    loadingUseCase,
    loadingIndustry,
    errorUseCase,
    errorIndustry,
  } = useS3Data();

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ display: "flex", flexDirection: "column", height: "100vh" }}>

        {/* Header */}
        <Box
          sx={{
            backgroundColor: "#ffffff",
            padding: "16px 32px",
            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.08)",
            zIndex: 100,
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Logo
                src={pureLogoImg}
                alt="Pure Storage"
                width={160}
                height={40}
                fallbackText="PURESTORAGE"
                href="https://www.purestorage.com/"
              />
            </Box>

            <Box sx={{ display: "flex", alignItems: "center", gap: 3, flex: 1, justifyContent: "center" }}>
              <Typography
                variant="h6"
                component="h6"
                sx={{ color: "#1a1a1a", fontWeight: 600, fontSize: "1.6rem" }}
              >
                AI Use Case Library
              </Typography>
            </Box>

            <Box sx={{ minWidth: 180, display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
              {oktaLoading ? (
                <Typography variant="body2" sx={{ color: "#999", fontSize: "0.875rem" }}>
                  Loading...
                </Typography>
              ) : isAuthenticated ? (
                <Typography variant="body2" sx={{ color: "#1a1a1a", fontWeight: 500, fontSize: "0.9rem" }}>
                  Hello <strong>{userName}</strong>
                </Typography>
              ) : (
                <Typography variant="body2" sx={{ color: "#999", fontSize: "0.875rem" }}>
                  Not signed in
                </Typography>
              )}
            </Box>
          </Box>
        </Box>

        {/* Tabs Bar */}
        <Box sx={{ borderBottom: 1, borderColor: "divider", bgcolor: "background.paper", px: 4 }}>
          <Tabs
            value={activeTab}
            onChange={handleTabChange}
            aria-label="data tabs"
            sx={{ "& .MuiTabs-indicator": { backgroundColor: PURE_ORANGE } }}
          >
            <Tab label="Business Function" id="tab-0" aria-controls="tabpanel-0" />
            <Tab label="Industry" id="tab-1" aria-controls="tabpanel-1" />
            <Tab label="How to Use" id="tab-2" aria-controls="tabpanel-2" />
          </Tabs>
        </Box>

        {/* Main Content Area — both tabs stay mounted so AI results/filters survive tab switches */}
        <Box sx={{ flex: 1, overflow: "hidden", flexDirection: "column", p: 3, display: activeTab === 0 ? "flex" : "none" }}>
          <Box sx={{ mb: 1 }}>
            <Typography
              variant="body2"
              sx={{
                color: "#444",
                fontSize: "0.875rem",
                lineHeight: 1.6,
                fontStyle: "italic",
                borderLeft: `3px solid ${PURE_ORANGE}`,
                pl: 1.5,
                mb: 1,
              }}
            >
              An internal library of curated AI use cases spanning industries and business functions — with implementation details, expected outcomes, tools, and frameworks to help your team discover and act on AI opportunities faster.
            </Typography>
            <Typography variant="body2" sx={{ color: "#666", fontSize: "0.82rem" }}>
              Need help getting started?{" "}
              <Link
                component="button"
                onClick={() => setActiveTab(2)}
                underline="hover"
                sx={{ color: PURE_ORANGE, fontWeight: 500, fontSize: "0.82rem", cursor: "pointer", verticalAlign: "baseline" }}
              >
                Visit our How to Use tab.
              </Link>
            </Typography>
          </Box>
          <UseCaseTable
            data={useCaseData}
            loading={loadingUseCase}
            error={errorUseCase}
            userEmail={userEmail}
            contactEmail={CONTACT_EMAIL}
            emailTooltipText={EMAIL_TOOLTIP_TEXT}
          />
        </Box>
        <Box sx={{ flex: 1, overflow: "hidden", display: activeTab === 1 ? "flex" : "none", flexDirection: "column", p: 3 }}>
          <Box sx={{ mb: 1 }}>
            <Typography
              variant="body2"
              sx={{
                color: "#444",
                fontSize: "0.875rem",
                lineHeight: 1.6,
                fontStyle: "italic",
                borderLeft: `3px solid ${PURE_ORANGE}`,
                pl: 1.5,
                mb: 1,
              }}
            >
              An internal library of curated AI use cases spanning industries and business functions — with implementation details, expected outcomes, tools, and frameworks to help your team discover and act on AI opportunities faster.
            </Typography>
            <Typography variant="body2" sx={{ color: "#666", fontSize: "0.82rem" }}>
              Need help getting started?{" "}
              <Link
                component="button"
                onClick={() => setActiveTab(2)}
                underline="hover"
                sx={{ color: PURE_ORANGE, fontWeight: 500, fontSize: "0.82rem", cursor: "pointer", verticalAlign: "baseline" }}
              >
                Visit our How to Use tab.
              </Link>
            </Typography>
          </Box>
          <IndustryDataTable
            data={industryData}
            loading={loadingIndustry}
            error={errorIndustry}
            userEmail={userEmail}
            contactEmail={CONTACT_EMAIL}
            emailTooltipText={EMAIL_TOOLTIP_TEXT}
          />
        </Box>

        {/* How to Use Tab */}
        {activeTab === 2 && (
          <Box
            id="tabpanel-2"
            role="tabpanel"
            sx={{ flex: 1, overflowY: "auto", px: 3, py: 3 }}
          >
            <Box sx={{ maxWidth: 760, mx: "auto" }}>

              {/* Intro */}
              <Typography variant="h5" sx={{ fontWeight: 700, mb: 1, color: "#1a1a1a" }}>
                About the AI Use Case Library
              </Typography>
              <Typography variant="body1" sx={{ color: "#555", lineHeight: 1.8, mb: 4 }}>
                An internal library of curated AI use cases spanning industries and business
                functions — with implementation details, expected outcomes, tools, and frameworks
                to help your team discover and act on AI opportunities faster.
              </Typography>

              {/* Feature cards */}
              <Typography variant="h6" sx={{ fontWeight: 700, mb: 2, color: "#1a1a1a" }}>
                What's Inside
              </Typography>
              <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, mb: 4 }}>
                <Paper sx={{ p: 2.5, border: "1px solid #e8e8e8", boxShadow: "none" }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                    <ArticleIcon sx={{ color: PURE_ORANGE, fontSize: 22 }} />
                    <Typography variant="subtitle1" sx={{ fontWeight: 700, color: "#1a1a1a" }}>
                      Business Functions
                    </Typography>
                  </Box>
                  <Typography variant="body2" sx={{ color: "#555", lineHeight: 1.7 }}>
                    Browse detailed AI use cases with full implementation context — outcomes, datasets, tools, and more.
                  </Typography>
                </Paper>
                <Paper sx={{ p: 2.5, border: "1px solid #e8e8e8", boxShadow: "none" }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                    <BarChartIcon sx={{ color: PURE_ORANGE, fontSize: 22 }} />
                    <Typography variant="subtitle1" sx={{ fontWeight: 700, color: "#1a1a1a" }}>
                      Industry
                    </Typography>
                  </Box>
                  <Typography variant="body2" sx={{ color: "#555", lineHeight: 1.7 }}>
                    Filter and explore use cases by industry, business function, or AI capability in a structured view.
                  </Typography>
                </Paper>
              </Box>

              {/* Navigation steps */}
              <Typography variant="h6" sx={{ fontWeight: 700, mb: 2, color: "#1a1a1a" }}>
                How to Navigate
              </Typography>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, mb: 4 }}>
                {[
                  { icon: <ArticleIcon sx={{ fontSize: 18, color: PURE_ORANGE }} />, text: <><strong>Business Functions</strong> tab — browse AI use cases with full context.</> },
                  { icon: <BarChartIcon sx={{ fontSize: 18, color: PURE_ORANGE }} />, text: <><strong>Industry</strong> tab — filter and explore by industry, function, or capability.</> },
                  { icon: <UnfoldMoreIcon sx={{ fontSize: 18, color: PURE_ORANGE }} />, text: <>Click any row to expand and see detailed information.</> },
                  { icon: <FilterListIcon sx={{ fontSize: 18, color: PURE_ORANGE }} />, text: <>Use the column filter icons to narrow down results.</> },
                  { icon: <LockOpenIcon sx={{ fontSize: 18, color: PURE_ORANGE }} />, text: <>Use AI-powered semantic search to find relevant use cases by describing your need.</> },
                ].map((step, i) => (
                  <Box
                    key={i}
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1.5,
                      backgroundColor: "#fafafa",
                      borderRadius: "6px",
                      px: 2,
                      py: 1.5,
                    }}
                  >
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 26,
                        height: 26,
                        borderRadius: "50%",
                        backgroundColor: "#fff0ea",
                        flexShrink: 0,
                      }}
                    >
                      <Typography variant="caption" sx={{ fontWeight: 700, color: PURE_ORANGE, lineHeight: 1 }}>
                        {i + 1}
                      </Typography>
                    </Box>
                    {step.icon}
                    <Typography variant="body2" sx={{ color: "#444", lineHeight: 1.7 }}>
                      {step.text}
                    </Typography>
                  </Box>
                ))}
              </Box>

              {/* CTA */}
              <Box
                sx={{
                  border: `1.5px solid ${PURE_ORANGE}`,
                  borderRadius: "8px",
                  backgroundColor: "#fff8f5",
                  p: 3,
                }}
              >
                <Typography variant="h6" sx={{ fontWeight: 700, mb: 1, color: "#1a1a1a" }}>
                  Request Help / Express Interest
                </Typography>
                <Typography variant="body2" sx={{ color: "#555", mb: 2, lineHeight: 1.7 }}>
                  Have a question about a specific use case? Want to explore how AI can help your team?
                  Reach out — we'd love to help you get started.
                </Typography>
                <Link
                  href={`mailto:${CONTACT_EMAIL}`}
                  underline="none"
                  sx={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 0.75,
                    backgroundColor: PURE_ORANGE,
                    color: "#fff",
                    fontWeight: 600,
                    fontSize: "0.875rem",
                    px: 2.5,
                    py: 1,
                    borderRadius: "4px",
                    "&:hover": { backgroundColor: "#cc4000" },
                  }}
                >
                  <EmailIcon sx={{ fontSize: 16 }} />
                  Contact the AIUC Team
                </Link>
              </Box>

            </Box>
          </Box>
        )}

        {/* Footer */}
        <Box
          sx={{
            backgroundColor: "#ffffff",
            borderTop: `1px solid ${PURE_ORANGE}`,
            padding: "0px 32px",
            display: "flex",
            height: "50px",
            alignItems: "center",
            justifyContent: "space-between",
            zIndex: 100,
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flex: 1 }}>
            <Typography variant="body2" sx={{ color: "#666666", fontSize: "0.75rem" }}>
              Powered by
            </Typography>
            <Logo src={spearheadImg} alt="Spearhead" width={100} height={50} fallbackText="" href="https://www.spearhead.so/" />
          </Box>

          <Box sx={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center" }}>
            <Typography variant="body2" sx={{ color: "#666666", fontSize: "0.75rem", fontWeight: 500 }}>
              Confidential - Internal Use Only
            </Typography>
          </Box>

          <Box sx={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
            <Link
              href={`mailto:${CONTACT_EMAIL}`}
              underline="hover"
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.5,
                color: PURE_ORANGE,
                fontSize: "0.75rem",
                fontWeight: 500,
                "&:hover": { color: "#cc4000" },
              }}
            >
              <EmailIcon sx={{ fontSize: 14 }} />
              Contact Us
            </Link>
          </Box>
        </Box>
      </Box>
    </ThemeProvider>
  );
}

export default App;
