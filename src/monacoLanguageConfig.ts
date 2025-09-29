import * as monaco from "monaco-editor";
import { DuckdbSymbol } from "./types";

export const syntax_def = (
  duckdbSymbols: DuckdbSymbol[],
): monaco.languages.IMonarchLanguage => ({
  // typeKeywords: ["unk"],
  keywords: duckdbSymbols
    .filter((symbol) => symbol.category == "keyword")
    .map((symbol) => symbol.name),
  builtinFunctions: duckdbSymbols
    .filter((symbol) => symbol.category == "function")
    .map((symbol) => symbol.name),
  typeKeywords: duckdbSymbols
    .filter((symbol) => symbol.category == "type")
    .map((symbol) => symbol.name),

  defaultToken: "",
  tokenPostfix: ".sql",
  ignoreCase: true,

  brackets: [
    { open: "[", close: "]", token: "delimiter.square" },
    { open: "(", close: ")", token: "delimiter.parenthesis" },
  ],

  operators: [
    "+",
    "-",
    "*",
    "/",
    "%",
    "&",
    "|",
    "^",
    "=",
    "<>",
    "!=",
    ">",
    ">=",
    "<",
    "<=",
    "<<",
    ">>",
    "||",
    "::",
    "->>",
    "->",
    "~",
    "!",
    "@",
  ],

  tokenizer: {
    root: [
      { include: "@comments" },
      { include: "@whitespace" },
      { include: "@numbers" },
      { include: "@strings" },
      { include: "@complexIdentifiers" },
      { include: "@scopes" },
      [/[;,.]/, "delimiter"],
      [/[()]/, "@brackets"],
      [
        /[\w@#$]+/,
        {
          cases: {
            "@keywords": "keyword",
            "@operators": "operator",
            "@builtinFunctions": "predefined",
            "@default": "identifier",
          },
        },
      ],
      [/[<>=!%&+\-*/|~^]/, "operator"],
    ],
    whitespace: [[/\s+/, "white"]],
    comments: [
      [/--+.*/, "comment"],
      [/\/\*/, { token: "comment.quote", next: "@comment" }],
    ],
    comment: [
      [/[^*/]+/, "comment"],
      [/\*\//, { token: "comment.quote", next: "@pop" }],
      [/./, "comment"],
    ],
    numbers: [
      [/0[xX][0-9a-fA-F]*/, "number"],
      [/[$][+-]*\d*(\.\d*)?/, "number"],
      [/((\d+(\.\d*)?)|(\.\d+))([eE][\-+]?\d+)?/, "number"],
    ],
    strings: [
      [/'/, { token: "string", next: "@string" }],
      [/"/, { token: "string.double", next: "@stringDouble" }],
    ],
    string: [
      [/[^']+/, "string"],
      [/''/, "string"],
      [/'/, { token: "string", next: "@pop" }],
    ],
    stringDouble: [
      [/[^"]+/, "string.double"],
      [/""/, "string.double"],
      [/"/, { token: "string.double", next: "@pop" }],
    ],
    complexIdentifiers: [
      [/\[/, { token: "identifier.quote", next: "@bracketedIdentifier" }],
      [/"/, { token: "identifier.quote", next: "@quotedIdentifier" }],
    ],
    bracketedIdentifier: [
      [/[^\]]+/, "identifier"],
      [/]]/, "identifier"],
      [/]/, { token: "identifier.quote", next: "@pop" }],
    ],
    quotedIdentifier: [
      [/[^"]+/, "identifier"],
      [/""/, "identifier"],
      [/"/, { token: "identifier.quote", next: "@pop" }],
    ],
    scopes: [],
  },
});

export const completion_def =
  (duckdbSymbols: DuckdbSymbol[]) =>
  (model: monaco.editor.ITextModel, position: monaco.Position) => {
    const word = model.getWordUntilPosition(position);
    const range = {
      startLineNumber: position.lineNumber,
      endLineNumber: position.lineNumber,
      startColumn: word.startColumn,
      endColumn: word.endColumn,
    };

    const suggestions: monaco.languages.CompletionItem[] = [];

    duckdbSymbols.forEach((symbol) => {
      suggestions.push({
        label: symbol.name,
        kind: monaco.languages.CompletionItemKind.Keyword,
        insertText: symbol.name,
        range,
        detail: symbol.category,
      });
    });

    return { suggestions };
  };
