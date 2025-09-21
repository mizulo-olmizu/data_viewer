import { Schema } from "./types";
import { Button } from "@/components/ui/button";
import { LuCheck } from "react-icons/lu";
import { Editor } from "@monaco-editor/react";
import { format } from "sql-formatter";

export interface SQLEditorProps {
  query: string;
  schema: Schema;
  queryComplete?: boolean;
  onChange: (value: string | undefined) => void;
  onExecute: () => void;
}

export default function SQLEditor({
  query,
  queryComplete = false,
  onChange,
  onExecute,
}: SQLEditorProps) {
  return (
    <div className="flex flex-col h-full p-4">
      <div className="grow-1">
        <Editor
          defaultLanguage="sql"
          value={query}
          onChange={onChange}
          theme="vs-dark"
        />
      </div>
      {/* TODO colorを変更する*/}
      <div className="flex flex-row">
        <Button
          onClick={() => {
            const newQuery = format(query);
            onChange(newQuery);
          }}
        >
          Format
        </Button>
        <Button
          className={queryComplete ? "text-green-300" : "text-blue-200"}
          onClick={onExecute}
        >
          {queryComplete && <LuCheck />}
          Execute
        </Button>
      </div>
    </div>
  );
}
