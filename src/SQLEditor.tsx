import { ChangeEvent } from "react";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
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
}

export default function SQLEditor({
  query,
  queryComplete = false,
  onTextFieldChange,
  onTextFieldBlur,
  onExecute,
}: SQLEditorProps) {
  return (
    <div>
      <TextField
        id="sql-text-area"
        label="SQL Query"
        multiline
        value={query}
        onChange={onTextFieldChange}
        onBlur={onTextFieldBlur}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        sx={{
          height: "100%",
          width: "100%",
          ".MuiInputBase-input": {
            fontFamily: "monospace",
          },
        }}
      />
      <Button
        startIcon={queryComplete && <CheckIcon />}
        color={queryComplete ? "success" : "primary"}
        onClick={onExecute}
      >
        Execute
      </Button>
    </div>
  );
}
