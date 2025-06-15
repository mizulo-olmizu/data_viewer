import { ChangeEvent } from "react";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import Accordion from "@mui/material/Accordion";
import AccordionActions from "@mui/material/AccordionActions";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import Grid from "@mui/material/Grid";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { Schema } from "./types";
import CheckIcon from "@mui/icons-material/Check";

export interface SQLEditorProps {
  query: string;
  schema: Schema;
  queryComplete?: boolean;
  onTextFieldChange: (
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => void;
  onTextFieldBlur: () => void;
  onExecute: () => void;
  onReset: () => void;
}

export default function SQLEditor({
  query,
  schema,
  queryComplete = false,
  onTextFieldChange,
  onTextFieldBlur,
  onExecute,
  onReset,
}: SQLEditorProps) {
  return (
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
              onChange={onTextFieldChange}
              onBlur={onTextFieldBlur}
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
          startIcon={queryComplete && <CheckIcon />}
          color={queryComplete ? "success" : "primary"}
          onClick={onExecute}
        >
          Execute
        </Button>
        <Button onClick={onReset}>Reset</Button>
      </AccordionActions>
    </Accordion>
  );
}
