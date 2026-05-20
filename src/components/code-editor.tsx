import CodeMirror, { EditorView, type Extension, type ReactCodeMirrorProps } from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { sql, PostgreSQL, MySQL, type SQLConfig } from "@codemirror/lang-sql";
import { oneDark } from "@codemirror/theme-one-dark";
import { useMemo } from "react";
import { useResolvedTheme } from "@/lib/theme";
import type { SchemaMap } from "@/lib/schema-cache";

type Lang = "json" | "postgresql" | "mysql" | "sql";

type Props = Omit<ReactCodeMirrorProps, "extensions" | "theme"> & {
  lang?: Lang;
  className?: string;
  minHeight?: string;
  maxHeight?: string;
  extraExtensions?: Extension[];
  /** Schema for schema-aware autocomplete (tables + columns). */
  schema?: SchemaMap;
};

const baseTheme = EditorView.theme({
  "&": {
    backgroundColor: "transparent",
    fontSize: "12.5px",
  },
  ".cm-gutters": {
    backgroundColor: "rgba(0,0,0,0.25)",
    borderRight: "1px solid rgba(255,255,255,0.04)",
    color: "rgb(82 82 91)",
  },
  ".cm-activeLineGutter, .cm-activeLine": {
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  ".cm-content": {
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    padding: "10px 0",
  },
  ".cm-scroller": {
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
  ".cm-focused": { outline: "none" },
  ".cm-selectionBackground": { backgroundColor: "rgba(59,130,246,0.30) !important" },
  ".cm-cursor": { borderLeftColor: "rgb(244 244 245)" },
});

// Minimal light theme for CodeMirror — transparent background so it sits on
// our token surfaces, with adjusted gutter/selection colors for readability.
const lightTheme = EditorView.theme(
  {
    "&": { backgroundColor: "transparent" },
    ".cm-gutters": {
      backgroundColor: "rgba(0,0,0,0.03)",
      borderRight: "1px solid rgba(0,0,0,0.06)",
      color: "#a1a1aa",
    },
    ".cm-activeLineGutter, .cm-activeLine": { backgroundColor: "rgba(0,0,0,0.03)" },
    ".cm-content": { color: "#0a0a0a" },
    ".cm-selectionBackground": { backgroundColor: "rgba(14,165,233,0.20) !important" },
    ".cm-cursor": { borderLeftColor: "#0a0a0a" },
  },
  { dark: false },
);

export function CodeEditor({
  lang = "json",
  className,
  minHeight = "200px",
  maxHeight,
  extraExtensions,
  schema,
  ...rest
}: Props) {
  const resolvedTheme = useResolvedTheme();
  const extensions = useMemo(() => {
    const sqlConfig: SQLConfig | undefined = schema ? { schema } : undefined;
    const base: Extension[] =
      lang === "json" ? [json(), baseTheme]
      : lang === "postgresql" ? [sql({ dialect: PostgreSQL, ...(sqlConfig ?? {}) }), baseTheme]
      : lang === "mysql" ? [sql({ dialect: MySQL, ...(sqlConfig ?? {}) }), baseTheme]
      : [sql(sqlConfig), baseTheme];
    return extraExtensions ? [...base, ...extraExtensions] : base;
  }, [lang, extraExtensions, schema]);

  return (
    <CodeMirror
      {...rest}
      theme={resolvedTheme === "light" ? lightTheme : oneDark}
      extensions={extensions}
      className={className}
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        highlightActiveLine: true,
        highlightSelectionMatches: true,
        autocompletion: lang !== "json",
        bracketMatching: true,
        closeBrackets: true,
        indentOnInput: true,
      }}
      style={{ minHeight, maxHeight }}
    />
  );
}
