import { useState, useEffect } from "react";
import "./App.css";
import { ExtractDataResultConverted, Status, DuckdbSymbol } from "./types";
import Table from "./Table";
import SummaryDisplay from "./SummaryDisplay";
import {
  extractTable,
  executeQuery,
  registerData,
  getStatus,
  getTableNames,
  getDuckdbSymbols,
} from "./handler";
import { generateDefaultQuery } from "./utils";
import { useMode } from "./useMode";
import ErrorModal from "./ErrorModal";
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { LuSquarePen } from "react-icons/lu";
import { LuRows3 } from "react-icons/lu";
import { LuColumns3 } from "react-icons/lu";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { LuLoader } from "react-icons/lu";
import { ThemeProvider } from "@/components/theme-provider";

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
  const [duckdbSymbols, setDuckdbSymbols] = useState<DuckdbSymbol[]>([]);
  const [errorMessage, setErrorMessage] = useErrorMessage();
  const mode = useMode();

  useEffect(() => {
    getDuckdbSymbols().then((symbols) => setDuckdbSymbols(symbols));

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
          setQuery(generateDefaultQuery(result.df, result.name));
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
      setQuery(generateDefaultQuery(result.df, result.name));
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
      setQuery(generateDefaultQuery(result.df, result.name));
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

  const scrollbarColor = mode === "light" ? "#cacaca" : "#616161";

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
          setQuery(generateDefaultQuery(result.df, result.name));
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
    <ThemeProvider defaultTheme="system">
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
          <div
            className="flex flex-col h-screen w-full p-3"
            // TODO tailwindcssに対応させる https://zenn.dev/nbr41to/articles/11efbc362a89ba
            style={{
              scrollbarColor: `${scrollbarColor} transparent`,
              scrollbarWidth: "thin",
            }}
          >
            <h2>{tableData?.name}</h2>
            <div className="flex flex-row gap-1">
              <Badge>
                <LuRows3 />
                {`${tableData?.df.length ?? 0} Rows`}
              </Badge>
              <Badge>
                <LuColumns3 />
                {`${tableData && tableData.df.length > 0 ? Object.keys(tableData.df[0]).length : 0} Rows`}
              </Badge>
            </div>
            {tableData ? (
              <Tabs
                defaultValue="Table"
                className="grow-1 overflow-hidden pb-10"
              >
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
                <TabsContent value="Summary" className="overflow-hidden">
                  <div className="h-full overflow-auto">
                    <SummaryDisplay
                      schema={tableData.schema}
                      summary={tableData.summary}
                    />
                  </div>
                </TabsContent>
              </Tabs>
            ) : (
              <EmptyData />
            )}
            {loading && (
              <div className="fixed z-50 inset-0 flex items-center justify-center">
                <div className="absolute inset-0 bg-black opacity-50"></div>
                <LuLoader className="animate-spin" />
              </div>
            )}
            {fileDragging && <FileUpload />}
          </div>
          <ErrorModal
            open={errorMessage !== null}
            onOpenChange={(open) => {
              if (!open) {
                setErrorMessage(null);
              }
            }}
            message={errorMessage ?? ""}
          />
        </main>
      </SidebarProvider>
      <Toaster />
      <Sheet>
        <SheetTrigger asChild>
          <Button size="icon" className="fixed bottom-4 right-4">
            <LuSquarePen />
          </Button>
        </SheetTrigger>
        <SheetContent className="sm:max-w-none">
          <SheetHeader>
            <SheetTitle>SQL Editor</SheetTitle>
          </SheetHeader>
          <SQLEditor
            query={query}
            schema={tableData?.schema ?? []}
            duckdbSymbols={duckdbSymbols}
            queryComplete={queryComplete}
            onChange={(query) => {
              setQuery(query ?? "");
              setQueryComplete(false);
            }}
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
        </SheetContent>
      </Sheet>
    </ThemeProvider>
  );
}

export default App;
