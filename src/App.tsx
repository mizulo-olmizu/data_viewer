import { useState, useEffect } from "react";
import "./App.css";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import { format } from "sql-formatter";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import { DataFrame, Schema, Summary } from "./types";
import Table from "./Table";
import SummaryDisplay from "./SummaryDisplay";
import FileInput from "./FileInput";
import { extractData, registerData } from "./handler";
import { generateDefaultQuery } from "./utils";
import Accordion from "@mui/material/Accordion";
import AccordionActions from "@mui/material/AccordionActions";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import Stack from "@mui/material/Stack";
import Grid from "@mui/material/Grid";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { useMode } from "./useMode";
import { CssBaseline, createTheme, ThemeProvider } from "@mui/material";
import ErrorModal from "./ErrorModal";
import CircularProgress from "@mui/material/CircularProgress";

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function CustomTabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`simple-tabpanel-${index}`}
      aria-labelledby={`simple-tab-${index}`}
      style={{ height: "100%", overflow: "auto" }}
      {...other}
    >
      {value === index && <Box sx={{ py: 3 }}>{children}</Box>}
    </div>
  );
}

const hexToRgba = (hex: string, alpha: number) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

function App() {
  const [data, setData] = useState<DataFrame>([]);
  const [name, setName] = useState<string>("");
  const [query, setQuery] = useState<string>("");
  const [schema, setSchema] = useState<Schema>([]);
  const [summary, setSummary] = useState<Summary>([]);
  const [tabLocation, setTabLocation] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const mode = useMode();

  const backgroundColor = mode === "light" ? "#fafafa" : "#0f172a";
  const scrollbarColor = mode === "light" ? "#cacaca" : "#616161";

  const theme = createTheme({
    palette: {
      mode: mode,
      background: {
        default: backgroundColor,
        paper: backgroundColor,
      },
    },
  });

  useEffect(() => {
    setLoading(true);
    extractData()
      .then((result) => {
        setName(result.name);
        setData(result.df);
        setSchema(result.schema);
        setSummary(result.summary);
        setQuery(generateDefaultQuery(result.df));
      })
      .catch((err) => {
        if (typeof err === "string") {
          setError(err);
        } else if (err instanceof Error) {
          setError(err.message);
        } else {
          setError("エラーが発生しました。");
        }
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <main className="container">
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            height: "100vh",
            p: 3,
          }}
        >
          <Stack spacing={2} sx={{ flex: 0 }}>
            <FileInput
              filePath={name}
              onChange={async (filePath) => {
                setLoading(true);
                try {
                  await registerData(filePath);
                  const result = await extractData();

                  setName(result.name);
                  setData(result.df);
                  setSchema(result.schema);
                  setSummary(result.summary);
                  setQuery(generateDefaultQuery(result.df));
                } catch (err) {
                  if (typeof err === "string") {
                    setError(err);
                  } else if (err instanceof Error) {
                    setError(err.message);
                  } else {
                    setError("エラーが発生しました。");
                  }
                } finally {
                  setLoading(false);
                }
              }}
              fileTypes={["csv", "tsv", "json", "jsonl", "parquet"]}
            />
            <Accordion>
              <AccordionSummary
                expandIcon={<ExpandMoreIcon />}
                aria-controls="panel1-content"
                id="panel1-header"
              >
                <Typography component="span">SQL</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Grid container spacing={2} columns={12} sx={{ py: 2 }}>
                  <Grid size={2}>
                    <Typography sx={{ textAlign: "left" }}>Schema</Typography>
                    {schema.map((field, index) => (
                      <Typography
                        key={index}
                        variant="body1"
                        sx={{ textAlign: "left", ml: 1 }}
                      >
                        {`- ${field.name}: ${field.dtype}`}
                      </Typography>
                    ))}
                  </Grid>
                  <Grid size={10}>
                    <TextField
                      id="sql-text-area"
                      label="SQL Query"
                      multiline
                      maxRows={15}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onBlur={() => setQuery(format(query))}
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      sx={{
                        width: "100%",
                        ".MuiInputBase-input": {
                          fontFamily: "monospace",
                        },
                      }}
                    />
                  </Grid>
                </Grid>
              </AccordionDetails>
              <AccordionActions>
                <Button
                  onClick={() => {
                    setLoading(true);
                    extractData(query)
                      .then((result) => {
                        setData(result.df);
                        setSummary(result.summary);
                      })
                      .catch((err) => {
                        if (typeof err === "string") {
                          setError(err);
                        } else if (err instanceof Error) {
                          setError(err.message);
                        } else {
                          setError("エラーが発生しました。");
                        }
                      })
                      .finally(() => setLoading(false));
                  }}
                >
                  Execute
                </Button>
                <Button
                  onClick={() => {
                    extractData()
                      .then((result) => {
                        setData(result.df);
                        setSummary(result.summary);
                      })
                      .catch((err) => {
                        if (typeof err === "string") {
                          setError(err);
                        } else if (err instanceof Error) {
                          setError(err.message);
                        } else {
                          setError("エラーが発生しました。");
                        }
                      });
                  }}
                >
                  Reset
                </Button>
              </AccordionActions>
            </Accordion>
            <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
              <Tabs
                value={tabLocation}
                onChange={(_e: React.SyntheticEvent, newTabLocation: number) =>
                  setTabLocation(newTabLocation)
                }
                aria-label="basic tabs example"
              >
                <Tab label="Table" />
                <Tab label="Summary" />
              </Tabs>
            </Box>
          </Stack>
          <Box
            sx={{
              flex: 1,
              position: "relative",
              overflow: "auto",
            }}
          >
            <CustomTabPanel value={tabLocation} index={0}>
              <Table data={data} />
            </CustomTabPanel>
            <CustomTabPanel value={tabLocation} index={1}>
              <SummaryDisplay summary={summary} rowData={data} />
            </CustomTabPanel>
            {loading && (
              <Box
                sx={{
                  width: "100%",
                  height: "100%",
                  backgroundColor: hexToRgba(backgroundColor, 0.8),
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%, -50%)",
                  zIndex: 1,
                }}
              >
                <Box
                  sx={{
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    transform: "translate(-50%, -50%)",
                    zIndex: 1,
                  }}
                >
                  <CircularProgress />
                </Box>
              </Box>
            )}
          </Box>
        </Box>
        <ErrorModal
          open={error !== null}
          onClose={() => setError(null)}
          message={error ?? ""}
        />
      </main>
    </ThemeProvider>
  );
}

export default App;
