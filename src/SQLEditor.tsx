import { useImperativeHandle, useRef, type Ref } from "react";
import { Schema, DuckdbSymbol } from "./types";
import { Button } from "@/components/ui/button";
import { LuCheck } from "react-icons/lu";
import { Editor } from "@monaco-editor/react";
import { sqlLint, sqlFix } from "./handler";
import * as monaco from "monaco-editor";
import { syntax_def, completion_def } from "./monacoLanguageConfig";

export interface SQLEditorProps {
  query: string;
  schema: Schema;
  queryComplete?: boolean;
  duckdbSymbols?: DuckdbSymbol[];
  onChange: (value: string | undefined) => void;
  onExecute: () => void;
}

export interface SQLEditorHandle {
  insertAtCursor: (text: string) => void;
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

// monaco.languages.registerCompletionItemProviderはグローバルな処理なので、複数回実行するとその分上書きで登録されてしまう。
// それを避けるために、グローバル変数で管理
// https://github.com/microsoft/monaco-editor/issues/2084
let registeredProvider = false;

function SQLEditor({
  query,
  queryComplete = false,
  duckdbSymbols = [],
  onChange,
  onExecute,
  ref,
}: SQLEditorProps & { ref?: Ref<SQLEditorHandle> }) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  useImperativeHandle(ref, () => ({
    insertAtCursor: (text: string) => {
      const editor = editorRef.current;
      // 選択範囲があればそれを置換し、無ければカーソル位置に挿入する
      const range = editor?.getSelection();
      if (!editor || !range) {
        return;
      }
      editor.executeEdits("insert-from-sidebar", [{ range, text }]);
      editor.focus();
    },
  }));

  const handleBeforeMount = (monacoInstance: typeof monaco) => {
    if (monacoInstance && !registeredProvider) {
      monacoInstance.languages.setMonarchTokensProvider(
        "sql",
        syntax_def(duckdbSymbols),
      );

      monacoInstance.languages.registerCompletionItemProvider("sql", {
        provideCompletionItems: completion_def(duckdbSymbols),
      });

      registeredProvider = true;
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

export default SQLEditor;
