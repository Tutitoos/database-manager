import CodeMirror, { EditorView, type ReactCodeMirrorProps } from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { sql, PostgreSQL, MySQL } from "@codemirror/lang-sql";
import { oneDark } from "@codemirror/theme-one-dark";
import { useMemo } from "react";

type Lang = "json" | "postgresql" | "mysql" | "sql";

type Props = Omit<ReactCodeMirrorProps, "extensions" | "theme"> & {
  lang?: Lang;
  className?: string;
  minHeight?: string;
  maxHeight?: string;
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

export function CodeEditor({
  lang = "json",
  className,
  minHeight = "200px",
  maxHeight,
  ...rest
}: Props) {
  const extensions = useMemo(() => {
    if (lang === "json") return [json(), baseTheme];
    if (lang === "postgresql") return [sql({ dialect: PostgreSQL }), baseTheme];
    if (lang === "mysql") return [sql({ dialect: MySQL }), baseTheme];
    return [sql(), baseTheme];
  }, [lang]);

  return (
    <CodeMirror
      {...rest}
      theme={oneDark}
      extensions={extensions}
      className={className}
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        highlightActiveLine: true,
        highlightSelectionMatches: true,
        autocompletion: false,
        bracketMatching: true,
        closeBrackets: true,
        indentOnInput: true,
      }}
      style={{ minHeight, maxHeight }}
    />
  );
}
