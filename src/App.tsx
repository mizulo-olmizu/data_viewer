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
      {...other}
    >
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}

function App() {
  const [data, setData] = useState<DataFrame>([]);
  const [filePath, setFilePath] = useState<string>("");
  const [query, setQuery] = useState<string>("");
  const [schema, setSchema] = useState<Schema>([]);
  const [summary, setSummary] = useState<Summary>([]);
  const [tabLocation, setTabLocation] = useState(0);

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
      <Stack spacing={2}>
        <FileInput
          filePath={filePath}
          onChange={(filePath) => {
            registerData(filePath).then(() => {
              extractData().then((result) => {
                setFilePath(result.filePath);
                setData(result.df);
                setSchema(result.schema);
                setSummary(result.summary);
                setQuery(generateDefaultQuery(result.df));
              });
            });
          }}
          fileType="csv"
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
            <Grid container spacing={2} columns={12}>
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
                  maxRows={10}
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
        <CustomTabPanel value={tabLocation} index={0}>
          <Table data={data} />
        </CustomTabPanel>
        <CustomTabPanel value={tabLocation} index={1}>
          <SummaryDisplay summary={summary} />
        </CustomTabPanel>
      </Stack>
    </main>
  );
}

export default App;
