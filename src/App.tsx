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
} from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import EmailIcon from "@mui/icons-material/Email";
import Logo from "./components/Logo";
import UseCaseTable from "./components/UseCaseTable";
import IndustryDataTable from "./components/IndustryDataTable";
import { theme, PURE_ORANGE } from "./theme";
import { useS3Data } from "./hooks/useS3Data";
import { useOktaUser } from "./hooks/useOktaUser";
import "./globals.css";

const CONTACT_EMAIL     = import.meta.env.VITE_CONTACT_EMAIL     || "aiuc@purestorage.com";
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
                width={300}
                height={60}
                fallbackText="PURESTORAGE"
              />
            </Box>

            <Box sx={{ display: "flex", alignItems: "center", gap: 3, flex: 1, justifyContent: "center" }}>
              <Typography
                variant="h6"
                component="h6"
                sx={{ color: "#1a1a1a", fontWeight: 600, fontSize: "1.25rem" }}
              >
                AI Use Case Repository
              </Typography>
            </Box>

            <Box sx={{ minWidth: 180, display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
              {oktaLoading ? (
                <Typography variant="body2" sx={{ color: "#999", fontSize: "0.875rem" }}>
                  Loading...
                </Typography>
              ) : isAuthenticated ? (
                <Typography variant="body2" sx={{ color: "#1a1a1a", fontWeight: 500, fontSize: "0.9rem" }}>
                  Hello, <strong>{userName}</strong>
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
            <Tab label="Case Study" id="tab-0" aria-controls="tabpanel-0" />
            <Tab label="Industry Data" id="tab-1" aria-controls="tabpanel-1" />
          </Tabs>
        </Box>

        {/* Main Content Area */}
        <Box sx={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", p: 3 }}>
          {activeTab === 0 && (
            <UseCaseTable
              data={useCaseData}
              loading={loadingUseCase}
              error={errorUseCase}
              userEmail={userEmail}
              contactEmail={CONTACT_EMAIL}
              emailTooltipText={EMAIL_TOOLTIP_TEXT}
            />
          )}
          {activeTab === 1 && (
            <IndustryDataTable
              data={industryData}
              loading={loadingIndustry}
              error={errorIndustry}
              userEmail={userEmail}
              contactEmail={CONTACT_EMAIL}
              emailTooltipText={EMAIL_TOOLTIP_TEXT}
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
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flex: 1 }}>
            <Typography variant="body2" sx={{ color: "#666666", fontSize: "0.75rem" }}>
              Powered by
            </Typography>
            <Logo src={spearheadImg} alt="Spearhead" width={100} height={50} fallbackText="" />
          </Box>

          <Box sx={{ flex: 1, display: "flex", justifyContent: "center", gap: 3, alignItems: "center" }}>
            <Typography variant="body2" sx={{ color: "#666666", fontSize: "0.75rem", fontWeight: 500 }}>
              Confidential - Internal Use Only
            </Typography>
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

          <Box sx={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
            <Typography variant="body2" sx={{ color: "#666666", fontSize: "0.75rem", fontWeight: 500 }}>
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
