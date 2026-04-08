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
} from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import EmailIcon from "@mui/icons-material/Email";
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

  const {
    useCaseData,
    industryData,
    loadingUseCase,
    loadingIndustry,
    errorUseCase,
    errorIndustry,
  } = useS3Data();

  const TAB_NAMES = ["Case Study", "Industry Data"];
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
                AI Use Case Repository
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
            <Tab label="Case Study" id="tab-0" aria-controls="tabpanel-0" />
            <Tab label="Industry Data" id="tab-1" aria-controls="tabpanel-1" />
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
                <UseCaseTable
                  data={useCaseData}
                  loading={loadingUseCase}
                  error={errorUseCase}
                  userEmail={userEmail}
                  isRegistered={isRegistered}
                />
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
