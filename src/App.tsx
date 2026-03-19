import { useState, useEffect } from "react";
import {
  Box,
  Typography,
  Tabs,
  Tab,
  CssBaseline,
  Link,
  CircularProgress,
} from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import { useOktaAuth } from "@okta/okta-react";
import EmailIcon from "@mui/icons-material/Email";
import Logo from "./components/Logo";
import UseCaseTable from "./components/UseCaseTable";
import IndustryDataTable from "./components/IndustryDataTable";
import { theme, PURE_ORANGE } from "./theme";
import { useS3Data } from "./hooks/useS3Data";
import { useOktaUser } from "./hooks/useOktaUser";
import "./globals.css";

function App() {
  // Tab State
  const [activeTab, setActiveTab] = useState(0);

  // Okta auth state (for redirect guard)
  const { authState, oktaAuth } = useOktaAuth();

  // Okta user info
  const { userName, userEmail, isAuthenticated, isLoading: oktaLoading } = useOktaUser();

  // Redirect to Okta login if not authenticated
  // useEffect(() => {
  //   if (authState && !authState.isAuthenticated) {
  //     oktaAuth.signInWithRedirect();
  //   }
  // }, [authState, oktaAuth]);

  // Use custom hook for data
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

  // Show spinner while Okta is determining auth state or redirecting
  // if (!authState || !authState.isAuthenticated) {
  //   return (
  //     <ThemeProvider theme={theme}>
  //       <CssBaseline />
  //       <Box
  //         sx={{
  //           display: "flex",
  //           flexDirection: "column",
  //           alignItems: "center",
  //           justifyContent: "center",
  //           height: "100vh",
  //           gap: 2,
  //           backgroundColor: "#fafafa",
  //         }}
  //       >
  //         <CircularProgress sx={{ color: PURE_ORANGE }} />
  //         <Typography variant="body2" sx={{ color: "#666" }}>
  //           Redirecting to login...
  //         </Typography>
  //       </Box>
  //     </ThemeProvider>
  //   );
  // }

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
            {/* Pure Storage Logo */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Logo
                src="/assets/purelogo.png"
                alt="Pure Storage"
                width={300}
                height={60}
                fallbackText="PURESTORAGE"
              />
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
                variant="h6"
                component="h6"
                sx={{ color: "#1a1a1a", fontWeight: 600, fontSize: "1.25rem" }}
              >
                AI Use Case Repository
              </Typography>
            </Box>

            {/* User Greeting */}
            <Box sx={{ minWidth: 180, display: "flex", justifyContent: "flex-end" }}>
              {oktaLoading ? (
                <Typography
                  variant="body2"
                  sx={{ color: "#999", fontSize: "0.875rem" }}
                >
                  Loading...
                </Typography>
              ) : isAuthenticated ? (
                <Typography
                  variant="body2"
                  sx={{
                    color: "#1a1a1a",
                    fontWeight: 500,
                    fontSize: "0.9rem",
                  }}
                >
                  Hello, <strong>{userName}</strong>
                </Typography>
              ) : (
                <Typography
                  variant="body2"
                  sx={{ color: "#999", fontSize: "0.875rem" }}
                >
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
          {activeTab === 0 && (
            <UseCaseTable
              data={useCaseData}
              loading={loadingUseCase}
              error={errorUseCase}
              userEmail={userEmail}
            />
          )}
          {activeTab === 1 && (
            <IndustryDataTable
              data={industryData}
              loading={loadingIndustry}
              error={errorIndustry}
              userEmail={userEmail}
            />
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
            <Typography
              variant="body2"
              sx={{
                color: "#666666",
                fontSize: "0.75rem",
              }}
            >
              Powered by
            </Typography>
            <Logo
              src="/assets/spearhead.png"
              alt="Spearhead"
              width={100}
              height={50}
              fallbackText=""
            />
          </Box>

          {/* Center - Confidential + Contact */}
          <Box sx={{ flex: 1, display: "flex", justifyContent: "center", gap: 3, alignItems: "center" }}>
            <Typography
              variant="body2"
              sx={{
                color: "#666666",
                fontSize: "0.75rem",
                fontWeight: 500,
              }}
            >
              Confidential - Internal Use Only
            </Typography>
            <Link
              href="mailto:aiuc@purestorage.com"
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

          {/* Right side - Row count */}
          <Box sx={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
            <Typography
              variant="body2"
              sx={{
                color: "#666666",
                fontSize: "0.75rem",
                fontWeight: 500,
              }}
            >
              {activeTab === 0
                ? `${useCaseData.length} use cases`
                : `${industryData.length} industry records`}
            </Typography>
          </Box>
        </Box>
      </Box>
    </ThemeProvider>
  );
}

export default App;
