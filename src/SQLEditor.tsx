import { useRef } from "react";
import { Schema } from "./types";
import { Button } from "@/components/ui/button";
import { LuCheck } from "react-icons/lu";
import { Editor, useMonaco } from "@monaco-editor/react";
import { sqlLint, sqlFix } from "./handler";
import { editor } from "monaco-editor";

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
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monaco = useMonaco();

  const handleEditorDidMount = (editor: editor.IStandaloneCodeEditor) => {
    editorRef.current = editor;
  };

  const setMarkers = (markers: editor.IMarkerData[]) => {
    if (!editorRef.current || !monaco) return;

    const model = editorRef.current.getModel();
    if (model) {
      monaco.editor.setModelMarkers(model, "sqruff", markers);
    } else {
      console.error("Editor model is not available.");
    }
  };

  return (
    <div className="flex flex-col h-full p-4">
      <div className="grow-1">
        <Editor
          defaultLanguage="sql"
          value={query}
          onChange={onChange}
          theme="vs-dark"
          onMount={handleEditorDidMount}
        />
      </div>
      {/* TODO colorを変更する*/}
      <div className="flex flex-row">
        <Button
          onClick={() => {
            if (monaco) {
              sqlLint(query).then((diagnostics) => {
                const markers: editor.IMarkerData[] = diagnostics.map((d) => ({
                  startLineNumber: d.range.start.line,
                  startColumn: d.range.start.character,
                  endLineNumber: d.range.end.line,
                  endColumn: d.range.end.character,
                  message: d.message,
                  severity: monaco.MarkerSeverity.Warning,
                  source: d.source,
                  code: d.code,
                }));

                setMarkers(markers);
              });
            } else {
              console.error("Monaco instance is not available.");
            }
          }}
        >
          Lint
        </Button>
        <Button
          onClick={() => {
            sqlFix(query).then((newQuery) => onChange(newQuery));
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
