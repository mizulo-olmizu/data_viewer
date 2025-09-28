import { useRef } from "react";
import { Schema, DuckdbSymbol } from "./types";
import { Button } from "@/components/ui/button";
import { LuCheck } from "react-icons/lu";
import { Editor } from "@monaco-editor/react";
import { sqlLint, sqlFix } from "./handler";
import * as monaco from "monaco-editor";
import { syntax_def } from "./monacoLanguageConfig";

export interface SQLEditorProps {
  query: string;
  schema: Schema;
  queryComplete?: boolean;
  duckdbSymbols?: DuckdbSymbol[];
  onChange: (value: string | undefined) => void;
  onExecute: () => void;
}

function debounce<T extends (...args: any[]) => void>(
  f: T,
  wait: number,
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout>;

  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      f(...args);
    }, wait);
  };
}

export default function SQLEditor({
  query,
  queryComplete = false,
  duckdbSymbols = [],
  onChange,
  onExecute,
}: SQLEditorProps) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  const handleBeforeMount = (monacoInstance: typeof monaco) => {
    if (monacoInstance) {
      monacoInstance.languages.setMonarchTokensProvider(
        "sql",
        syntax_def(duckdbSymbols),
      );
    }
  };

  const handleEditorDidMount = (
    editor: monaco.editor.IStandaloneCodeEditor,
    monacoInstance: typeof monaco,
  ) => {
    editorRef.current = editor;

    editor.onDidChangeModelContent(
      // 一定時間操作されなかったら実行する
      debounce(() => {
        sqlLint(editor.getValue()).then((diagnostics) => {
          const markers: monaco.editor.IMarkerData[] = diagnostics.map((d) => ({
            startLineNumber: d.range.start.line,
            startColumn: d.range.start.character,
            endLineNumber: d.range.end.line,
            endColumn: d.range.end.character,
            message: d.message,
            severity: monaco.MarkerSeverity.Warning,
            source: d.source,
            code: d.code,
          }));
          const model = editor.getModel();
          if (model) {
            monacoInstance.editor.setModelMarkers(model, "sqruff", markers);
          }
        });
      }, 500),
    );
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
          beforeMount={handleBeforeMount}
        />
      </div>
      {/* TODO colorを変更する*/}
      <div className="flex flex-row">
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
