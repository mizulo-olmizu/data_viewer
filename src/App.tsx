import { useState, useEffect } from "react";
import "./App.css";
import { format } from "sql-formatter";
import Box from "@mui/material/Box";
import { DataFrame, Schema, Summary } from "./types";
import Table from "./Table";
import SummaryDisplay from "./SummaryDisplay";
import FileInput from "./FileInput";
import { extractData, registerData, getStatus } from "./handler";
import { generateDefaultQuery } from "./utils";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import { useMode } from "./useMode";
import { CssBaseline, createTheme, ThemeProvider } from "@mui/material";
import ErrorModal from "./ErrorModal";
import CircularProgress from "@mui/material/CircularProgress";
import { useDragDrop } from "./useDragDrop";
import FileUpload from "./FileUpload";
import SQLEditor from "./SQLEditor";
import Chip from "@mui/material/Chip";
import TableRowsIcon from "@mui/icons-material/TableRows";
import ViewColumnIcon from "@mui/icons-material/ViewColumn";
import { listen } from "@tauri-apps/api/event";
import { UnlistenFn } from "@tauri-apps/api/event";
import { useErrorMessage } from "./useErrorMessage";

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
  mykey: string | number;
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
  const [port, setPort] = useState<number | null>(null);
  const [query, setQuery] = useState<string>("");
  const [queryComplete, setQueryComplete] = useState(false);
  const [schema, setSchema] = useState<Schema>([]);
  const [summary, setSummary] = useState<Summary>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [fileDragging, setFileDragging] = useState<boolean>(false);

  const [errorMessage, setErrorMessage] = useErrorMessage();
  const mode = useMode();

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    (async () => {
      unlisten = await listen("update-data", async (_event) => {
        setLoading(true);
        try {
          const result = await extractData();

          setName(result.name);
          setData(result.df);
          setSchema(result.schema);
          setSummary(result.summary);
          setQuery(generateDefaultQuery(result.df));
        } catch (err) {
          if (typeof err === "string") {
            setErrorMessage(err);
          } else if (err instanceof Error) {
            setErrorMessage(err.message);
          } else {
            setErrorMessage("エラーが発生しました。");
          }
        } finally {
          setLoading(false);
        }
      });
    })();

    return () => {
      if (unlisten != null) {
        unlisten();
      }
    };
  }, []);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    (async () => {
      unlisten = await listen("update-status", async (_event) => {
        setLoading(true);
        try {
          const result = await getStatus();

          setPort(result.port);

          if (result.lastBackendError !== null) {
            setErrorMessage(result.lastBackendError);
          }
        } catch (err) {
          if (typeof err === "string") {
            setErrorMessage(err);
          } else if (err instanceof Error) {
            setErrorMessage(err.message);
          } else {
            setErrorMessage("エラーが発生しました。");
          }
        } finally {
          setLoading(false);
        }
      });
    })();

    return () => {
      if (unlisten != null) {
        unlisten();
      }
    };
  }, []);

  const handleOnFileChange = async (filePath: string) => {
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
        setErrorMessage(err);
      } else if (err instanceof Error) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage("エラーが発生しました。");
      }
    } finally {
      setLoading(false);
    }
  };

  useDragDrop({
    onDragStart: () => setFileDragging(true),
    onDrop: (paths) => {
      if (paths.length == 1) {
        handleOnFileChange(paths[0]);
      } else {
        setErrorMessage("複数のファイルを同時にドロップすることはできません。");
      }
    },
    onDragEnd: () => setFileDragging(false),
  });

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
    (async () => {
      setLoading(true);
      try {
        const status = await getStatus();
        const result = await extractData();

        setPort(status.port);
        if (status.lastBackendError !== null) {
          setErrorMessage(status.lastBackendError);
        }

        setName(result.name);
        setData(result.df);
        setSchema(result.schema);
        setSummary(result.summary);
        setQuery(generateDefaultQuery(result.df));
      } catch (err) {
        if (typeof err === "string") {
          setErrorMessage(err);
        } else if (err instanceof Error) {
          setErrorMessage(err.message);
        } else {
          setErrorMessage("エラーが発生しました。");
        }
      } finally {
        setLoading(false);
      }
    })();
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
            userSelect: "none",
            cursor: "default",
            scrollbarColor: `${scrollbarColor} transparent`,
            scrollbarWidth: "thin",
            overflow: "hidden",
          }}
        >
          <Stack spacing={2} sx={{ flex: 0, mb: 2 }}>
            {port != null ? (
              <Box textAlign="left">
                Ready to accept HTTP requests 🚀 : http://localhost:{port}
              </Box>
            ) : (
              <Box textAlign="left">
                HTTP Request disabled: 🛑 Server setup failed
              </Box>
            )}
            <FileInput
              filePath={name}
              onChange={handleOnFileChange}
              fileTypes={["csv", "tsv", "json", "jsonl", "parquet"]}
            />
            <SQLEditor
              query={query}
              schema={schema}
              queryComplete={queryComplete}
              onTextFieldChange={(e) => {
                setQuery(e.target.value);
                setQueryComplete(false);
              }}
              onTextFieldBlur={() => setQuery(format(query))}
              onExecute={() => {
                setLoading(true);
                extractData(query)
                  .then((result) => {
                    setData(result.df);
                    setSummary(result.summary);
                    setQueryComplete(true);
                  })
                  .catch((err) => {
                    if (typeof err === "string") {
                      setErrorMessage(err);
                    } else if (err instanceof Error) {
                      setErrorMessage(err.message);
                    } else {
                      setErrorMessage("エラーが発生しました。");
                    }
                  })
                  .finally(() => setLoading(false));
              }}
              onReset={() => {
                setLoading(true);
                extractData()
                  .then((result) => {
                    setData(result.df);
                    setSummary(result.summary);
                    setQueryComplete(false);
                  })
                  .catch((err) => {
                    if (typeof err === "string") {
                      setErrorMessage(err);
                    } else if (err instanceof Error) {
                      setErrorMessage(err.message);
                    } else {
                      setErrorMessage("エラーが発生しました。");
                    }
                  })
                  .finally(() => setLoading(false));
              }}
            />
            <Stack direction="row" spacing={1} alignItems="start">
              <Chip icon={<TableRowsIcon />} label={`${data.length} Rows`} />
              <Chip
                icon={<ViewColumnIcon />}
                label={`${data.length > 0 ? Object.keys(data[0]).length : 0} Columns`}
              />
            </Stack>
          </Stack>
          <TabLayout
            tabItems={[
              {
                name: "Table",
                component: (
                  <Table
                    data={data}
                    schema={schema}
                    onSortError={(err) => {
                      if (typeof err === "string") {
                        setErrorMessage(err);
                      } else if (err instanceof Error) {
                        setErrorMessage(err.message);
                      } else {
                        setErrorMessage("エラーが発生しました。");
                      }
                    }}
                  />
                ),
              },
              {
                name: "Summary",
                component: <SummaryDisplay summary={summary} />,
              },
            ]}
          />
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
                zIndex: 10000,
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
          {fileDragging && (
            <FileUpload
              color={theme.palette.text.primary}
              backgroundColor={hexToRgba(backgroundColor, 0.8)}
            />
          )}
        </Box>
        <ErrorModal
          open={errorMessage !== null}
          onClose={() => setErrorMessage(null)}
          message={errorMessage ?? ""}
        />
      </main>
    </ThemeProvider>
  );
}

export default App;

type TabItem = {
  name: string;
  component: JSX.Element;
};

function TabLayout({ tabItems }: { tabItems: TabItem[] }) {
  const [tabLocation, setTabLocation] = useState(0);
  return (
    <>
      <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Tabs
          value={tabLocation}
          onChange={(_e: React.SyntheticEvent, newTabLocation: number) =>
            setTabLocation(newTabLocation)
          }
          aria-label="basic tabs example"
        >
          {tabItems.map((item, index) => (
            <Tab key={index} label={item.name} />
          ))}
        </Tabs>
      </Box>
      <Box
        sx={{
          flex: 1,
          position: "relative",
          overflow: "auto",
        }}
      >
        {tabItems.map((item, index) => (
          <CustomTabPanel
            value={tabLocation}
            index={index}
            key={index}
            mykey={index}
          >
            {item.component}
          </CustomTabPanel>
        ))}
      </Box>
    </>
  );
}
