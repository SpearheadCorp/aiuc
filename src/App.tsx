import { useEffect } from "react";
import { useState } from "react";
import {
  Box,
  Typography,
  Tabs,
  Tab,
  CssBaseline,
  Link,
  CircularProgress,
  Button,
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
import { useCognitoUser } from "./hooks/useCognitoUser";
import { useLogger } from "./hooks/useLogger";
import { APP_CONFIG } from "./config/appConfig";
import { userPool } from "./config/cognito";
import "./globals.css";

function App() {
  const [activeTab, setActiveTab] = useState(0);

  const { userName, userEmail, isRegistered, isChecking } = useCognitoUser();
  const { logClick, logPageView } = useLogger();

  // Log page view on mount
  useEffect(() => {
    logPageView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset scroll when switching to How to Use tab
  useEffect(() => {
    if (activeTab === 2) {
      document.getElementById("tabpanel-2")?.scrollTo({ top: 0 });
    }
  }, [activeTab]);

  const {
    useCaseData,
    industryData,
    loadingUseCase,
    loadingIndustry,
    errorUseCase,
    errorIndustry,
  } = useS3Data();

  const TAB_NAMES = ["Business Function", "Industry", "How to Use"];
  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
    logClick("tab", { tabName: TAB_NAMES[newValue] });
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
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            {/* Spearhead Logo */}
            <Box sx={{ display: "flex", alignItems: "center" }}>
              <Link
                href="https://spearhead.so"
                target="_blank"
                rel="noopener noreferrer"
                sx={{ display: "flex", alignItems: "center", lineHeight: 0 }}
              >
                <Logo
                  src="/assets/spearhead.png"
                  alt="Spearhead"
                  width={160}
                  height={48}
                  fallbackText="SPEARHEAD"
                />
              </Link>
            </Box>

            {/* Title */}
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 3,
                flex: 1,
                justifyContent: "center",
              }}
            >
              <Typography
                variant="h5"
                component="h1"
                sx={{ color: "#1a1a1a", fontWeight: 700, fontSize: "1.6rem", letterSpacing: "-0.01em" }}
              >
                AI Use Case Library
              </Typography>
            </Box>

            {/* User area */}
            <Box sx={{ minWidth: 180, display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 1.5 }}>
              {isChecking ? null : isRegistered ? (
                <>
                  <Typography
                    variant="body2"
                    sx={{ color: "#1a1a1a", fontWeight: 500, fontSize: "0.9rem" }}
                  >
                    Hello, <strong>{userName || userEmail}</strong>
                  </Typography>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => {
                      userPool?.getCurrentUser()?.signOut();
                      window.location.replace("/login");
                    }}
                    sx={{
                      borderColor: PURE_ORANGE,
                      color: PURE_ORANGE,
                      textTransform: "none",
                      fontSize: "0.8rem",
                      boxShadow: "none",
                      "&:hover": { borderColor: "#1a6bbf", color: "#1a6bbf", boxShadow: "none" },
                    }}
                  >
                    Logout
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    component="a"
                    href="/login"
                    size="small"
                    variant="outlined"
                    sx={{
                      borderColor: PURE_ORANGE,
                      color: PURE_ORANGE,
                      textTransform: "none",
                      fontSize: "0.8rem",
                      boxShadow: "none",
                      "&:hover": { borderColor: "#1a6bbf", color: "#1a6bbf", boxShadow: "none" },
                    }}
                  >
                    Login
                  </Button>
                  <Button
                    component="a"
                    href="/register"
                    size="small"
                    variant="contained"
                    sx={{
                      backgroundColor: PURE_ORANGE,
                      color: "#fff",
                      textTransform: "none",
                      fontSize: "0.8rem",
                      boxShadow: "none",
                      "&:hover": { backgroundColor: "#1a6bbf", boxShadow: "none" },
                    }}
                  >
                    Register
                  </Button>
                </>
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
            sx={{
              "& .MuiTabs-indicator": {
                backgroundColor: PURE_ORANGE,
              }
            }}
          >
            <Tab label="Business Function" id="tab-0" aria-controls="tabpanel-0" />
            <Tab label="Industry" id="tab-1" aria-controls="tabpanel-1" />
            <Tab label="How to Use" id="tab-2" aria-controls="tabpanel-2" />
          </Tabs>
        </Box>

        {/* Main Content Area */}
        <Box
          sx={{
            flex: 1,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            p: 3
          }}
        >
          {isChecking ? (
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1 }}>
              <CircularProgress sx={{ color: PURE_ORANGE }} />
            </Box>
          ) : (
            <>
              {activeTab === 0 && (
                <>
                  <Typography variant="body2" sx={{ mb: 1.5, color: "#555", fontSize: "0.85rem" }}>
                    Need help getting started?{" "}
                    <Link
                      component="button"
                      underline="hover"
                      onClick={() => setActiveTab(2)}
                      sx={{ color: PURE_ORANGE, fontWeight: 500, fontSize: "0.85rem", cursor: "pointer", verticalAlign: "baseline" }}
                    >
                      Visit our How to Use tab.
                    </Link>
                  </Typography>
                  <UseCaseTable
                    data={useCaseData}
                    loading={loadingUseCase}
                    error={errorUseCase}
                    userEmail={userEmail}
                    isRegistered={isRegistered}
                  />
                </>
              )}
              {activeTab === 1 && (
                <IndustryDataTable
                  data={industryData}
                  loading={loadingIndustry}
                  error={errorIndustry}
                  userEmail={userEmail}
                  isRegistered={isRegistered}
                />
              )}
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
                        { icon: <LockOpenIcon sx={{ fontSize: 18, color: PURE_ORANGE }} />, text: <>Register to unlock additional columns and AI-powered semantic search.</> },
                      ].map((step, i) => (
                        <Box
                          key={i}
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 1.5,
                            backgroundColor: "#f8faff",
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
                              backgroundColor: "#e0edfd",
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
                        backgroundColor: "#f0f6ff",
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
                        href={`mailto:${APP_CONFIG.contactEmail}`}
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
                          "&:hover": { backgroundColor: "#1a6bbf" },
                        }}
                      >
                        <EmailIcon sx={{ fontSize: 16 }} />
                        Contact Us at {APP_CONFIG.contactEmail}
                      </Link>
                    </Box>

                  </Box>
                </Box>
              )}
            </>
          )}
        </Box>

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
          {/* Left side - Powered by */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flex: 1 }}>
            {/* <Typography
              variant="body2"
              sx={{ color: "#666666", fontSize: "0.75rem" }}
            >
              Powered by
            </Typography>
            <Link
              href="https://spearhead.so"
              target="_blank"
              rel="noopener noreferrer"
              sx={{ display: "flex", alignItems: "center", lineHeight: 0 }}
            >
              <Logo
                src="/assets/spearhead.png"
                alt="Spearhead"
                width={100}
                height={50}
                fallbackText=""
              />
            </Link> */}
          </Box>

          {/* Center - Confidential */}
          <Box sx={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center" }}>
            <Typography
              variant="body2"
              sx={{ color: "#666666", fontSize: "0.75rem", fontWeight: 500 }}
            >
              Confidential - Internal Use Only
            </Typography>
          </Box>

          {/* Right side - Contact Us */}
          <Box sx={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
            <Link
              href={`mailto:${APP_CONFIG.contactEmail}`}
              underline="hover"
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.5,
                color: PURE_ORANGE,
                fontSize: "0.75rem",
                fontWeight: 500,
                "&:hover": { color: "#1a6bbf" },
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
