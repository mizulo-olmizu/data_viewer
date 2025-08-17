import { useState, useEffect } from "react";
import "./App.css";
import { format } from "sql-formatter";
import Box from "@mui/material/Box";
import { ExtractDataResultConverted, Status } from "./types";
import Table from "./Table";
import SummaryDisplay from "./SummaryDisplay";
import {
  extractTable,
  executeQuery,
  registerData,
  getStatus,
  getTableNames,
} from "./handler";
import { generateDefaultQuery } from "./utils";
import Stack from "@mui/material/Stack";
import { useMode } from "./useMode";
import { CssBaseline, createTheme, ThemeProvider } from "@mui/material";
import ErrorModal from "./ErrorModal";
import CircularProgress from "@mui/material/CircularProgress";
import { useDragDrop } from "./useDragDrop";
import FileUpload from "./FileUpload";
import SQLEditor from "./SQLEditor";
import { listen } from "@tauri-apps/api/event";
import { UnlistenFn } from "@tauri-apps/api/event";
import { useErrorMessage } from "./useErrorMessage";
import EmptyData from "./EmptyData";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Drawer, DrawerContent, DrawerTrigger } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { LuSquarePen } from "react-icons/lu";
import { LuRows3 } from "react-icons/lu";
import { LuColumns3 } from "react-icons/lu";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

const hexToRgba = (hex: string, alpha: number) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

function App() {
  const [tableNames, setTableNames] = useState<string[]>([]);
  const [tableData, setTableData] = useState<ExtractDataResultConverted | null>(
    null,
  );
  const [status, setStatus] = useState<Status | null>(null);
  const [query, setQuery] = useState<string>("");
  const [queryComplete, setQueryComplete] = useState(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [fileDragging, setFileDragging] = useState<boolean>(false);

  const [errorMessage, setErrorMessage] = useErrorMessage();
  const mode = useMode();

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    (async () => {
      unlisten = await listen("update-data", async (event) => {
        setLoading(true);
        try {
          const newTableNames = await getTableNames();
          setTableNames(newTableNames);

          if (typeof event.payload !== "string") {
            throw Error(
              `テーブル名が正しく取得出来ませんでした。テーブル名を指定してください。\nevent.payload: ${event.payload}`,
            );
          }

          const result = await extractTable(event.payload as string);

          setTableData(result);
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

          setStatus(result);

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

  const handleOnSelectChange = async (tableName: string) => {
    setLoading(true);
    try {
      const result = await extractTable(tableName);

      setTableData(result);
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

  const handleOnFileChange = async (filePath: string) => {
    setLoading(true);
    try {
      const tableName = await registerData(
        filePath,
        null,
        null,
        true,
        new Map<string, string>(),
      );

      const newTableNames = await getTableNames();
      setTableNames(newTableNames);

      const result = await extractTable(tableName);

      setTableData(result);
      setQuery(generateDefaultQuery(result.df));
      toast("Data set OK!");
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

        setStatus(status);
        if (status.lastBackendError !== null) {
          setErrorMessage(status.lastBackendError);
        }

        const tableNames = await getTableNames();
        setTableNames(tableNames);

        if (tableNames.length > 0) {
          const result = await extractTable(tableNames[0]);
          setTableData(result);
          setQuery(generateDefaultQuery(result.df));
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
    })();
  }, []);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <SidebarProvider>
        <AppSidebar
          status={status}
          tableData={tableData}
          tableList={tableNames}
          onTableSelect={handleOnSelectChange}
          onUpload={handleOnFileChange}
        />
        <main className="container">
          <SidebarTrigger />
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
              <Stack direction="row" spacing={1} alignItems="start">
                <Badge>
                  <LuRows3 />
                  {`${tableData?.df.length ?? 0} Rows`}
                </Badge>
                <Badge>
                  <LuColumns3 />
                  {`${tableData && tableData.df.length > 0 ? Object.keys(tableData.df[0]).length : 0} Rows`}
                </Badge>
              </Stack>
            </Stack>
            {tableData ? (
              <Tabs defaultValue="Table">
                <TabsList>
                  <TabsTrigger value="Table">Table</TabsTrigger>
                  <TabsTrigger value="Summary">Summary</TabsTrigger>
                </TabsList>
                <TabsContent value="Table">
                  <Table
                    data={tableData.df}
                    schema={tableData.schema}
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
                </TabsContent>
                <TabsContent value="Summary">
                  <SummaryDisplay
                    schema={tableData.schema}
                    summary={tableData.summary}
                  />
                </TabsContent>
              </Tabs>
            ) : (
              <EmptyData />
            )}
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
      </SidebarProvider>
      <Toaster />
      <Drawer>
        <DrawerTrigger asChild>
          <Button size="icon" className="fixed bottom-4 right-4">
            <LuSquarePen />
          </Button>
        </DrawerTrigger>
        <DrawerContent>
          <SQLEditor
            query={query}
            schema={tableData?.schema ?? []}
            queryComplete={queryComplete}
            onTextFieldChange={(e) => {
              setQuery(e.target.value);
              setQueryComplete(false);
            }}
            onTextFieldBlur={() => setQuery(format(query))}
            onExecute={() => {
              setLoading(true);
              executeQuery(query)
                .then((result) => {
                  if (result !== null) {
                    setTableData(result);
                    setQueryComplete(true);
                  }
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
        </DrawerContent>
      </Drawer>
    </ThemeProvider>
  );
}

export default App;
