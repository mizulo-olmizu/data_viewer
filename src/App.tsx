import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import { format } from "sql-formatter";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import {
  DataFrame,
  Schema,
  ExtractDataResult,
  ExtractDataResultConverted,
  Summary,
} from "./types";
import Table from "./Table";
import SummaryDisplay from "./SummaryDisplay";
import FileInput from "./FileInput";

async function extractData(query?: string) {
  const result: ExtractDataResult = await invoke("extract_data", { query });
  const df: DataFrame = JSON.parse(result.dfJson);
  return {
    filePath: result.filePath,
    df,
    schema: result.schema,
    summary: result.summary,
  } as ExtractDataResultConverted;
}

function generateDefaultQuery(data: DataFrame): string {
  if (data.length === 0) {
    return "";
  }

  const columns = Object.keys(data[0]);
  const selectClause = columns.join(",");
  return format(`SELECT ${selectClause} FROM self;`);
}

function App() {
  const [data, setData] = useState<DataFrame>([]);
  const [filePath, setFilePath] = useState<string>("");
  const [query, setQuery] = useState<string>("");
  const [schema, setSchema] = useState<Schema>([]);
  const [summary, setSummary] = useState<Summary>([]);

  useEffect(() => {
    extractData().then((result) => {
      setFilePath(result.filePath);
      setData(result.df);
      setSchema(result.schema);
      setSummary(result.summary);
      setQuery(generateDefaultQuery(result.df));
    });
  }, []);

  return (
    <main className="container">
      <FileInput
        filePath={filePath}
        onChange={(filePath) => {
          invoke("register_data", { filePath });
          extractData().then((result) => {
            setFilePath(result.filePath);
            setData(result.df);
            setSchema(result.schema);
            setSummary(result.summary);
            setQuery(generateDefaultQuery(result.df));
          });
        }}
        fileType="csv"
      />
      <Box>
        {schema.map((field, index) => (
          <Typography key={index} variant="body1">
            {`${field.name}: ${field.dtype}`}
          </Typography>
        ))}
      </Box>
      <TextField
        id="sql-text-area"
        label="SQL Query"
        multiline
        maxRows={10}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onBlur={() => setQuery(format(query))}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        sx={{
          ".MuiInputBase-input": {
            fontFamily: "monospace",
          },
        }}
      />
      <Button
        onClick={() => {
          extractData(query).then((result) => {
            setData(result.df);
            setSummary(result.summary);
          });
        }}
      >
        Execute
      </Button>
      <Button
        onClick={() => {
          extractData().then((result) => {
            setData(result.df);
            setSummary(result.summary);
          });
        }}
      >
        Reset
      </Button>
      <Table data={data} />
      <SummaryDisplay summary={summary} />
    </main>
  );
}

export default App;
