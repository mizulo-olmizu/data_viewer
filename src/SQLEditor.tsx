import { ChangeEvent } from "react";
import { Schema } from "./types";
import { Button } from "@/components/ui/button";
import { LuCheck } from "react-icons/lu";

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
      <textarea
        className="w-full h-full font-mono"
        value={query}
        onChange={onTextFieldChange}
        onBlur={onTextFieldBlur}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      {/* TODO colorを変更する*/}
      <Button
        className={queryComplete ? "text-green-300" : "text-blue-200"}
        onClick={onExecute}
      >
        {queryComplete && <LuCheck />}
        Execute
      </Button>
    </div>
  );
}
