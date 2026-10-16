import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLineGutter,
  highlightActiveLine,
  drawSelection,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
  HighlightStyle,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { cpp } from "@codemirror/lang-cpp";
export interface EditorHandle {
  focusLine: (line: number, column?: number) => void;
}
interface Props {
  value: string;
  cursor: { anchor: number; head: number };
  onChange: (value: string, cursor: { anchor: number; head: number }) => void;
  onRun: () => void;
  filename: string;
}
const Editor = forwardRef<EditorHandle, Props>(function Editor(
  { value, cursor, onChange, onRun, filename },
  ref,
) {
  const mount = useRef<HTMLDivElement>(null),
    view = useRef<EditorView | null>(null),
    callbacks = useRef({ onChange, onRun });
  callbacks.current = { onChange, onRun };
  const language = useRef(new Compartment());
  useImperativeHandle(
    ref,
    () => ({
      focusLine: (line, column = 1) => {
        const v = view.current;
        if (!v) return;
        const l = v.state.doc.line(
            Math.max(1, Math.min(line, v.state.doc.lines)),
          ),
          pos = Math.min(l.to, l.from + Math.max(0, column - 1));
        v.dispatch({
          selection: { anchor: pos },
          effects: EditorView.scrollIntoView(pos, { y: "center" }),
        });
        v.focus();
      },
    }),
    [],
  );
  useEffect(() => {
    if (!mount.current) return;
    const state = EditorState.create({
      doc: value,
      selection: {
        anchor: Math.min(cursor.anchor, value.length),
        head: Math.min(cursor.head, value.length),
      },
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        highlightActiveLine(),
        syntaxHighlighting(
          HighlightStyle.define([
            { tag: tags.keyword, color: "var(--blue)" },
            { tag: tags.string, color: "var(--amber)" },
            { tag: tags.number, color: "var(--purple)" },
            { tag: tags.comment, color: "var(--muted)", fontStyle: "italic" },
            { tag: tags.typeName, color: "var(--accent)" },
            { tag: tags.meta, color: "var(--purple)" },
            { tag: tags.function(tags.variableName), color: "var(--blue)" },
          ]),
        ),
        language.current.of(/\.(c|h|cpp|hpp)$/.test(filename) ? cpp() : []),
        keymap.of([
          {
            key: "Mod-Enter",
            run: () => {
              callbacks.current.onRun();
              return true;
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        EditorView.contentAttributes.of({
          "aria-label": "Source code editor",
          "aria-describedby": "editor-help",
          spellcheck: "false",
        }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged || u.selectionSet)
            callbacks.current.onChange(u.state.doc.toString(), {
              anchor: u.state.selection.main.anchor,
              head: u.state.selection.main.head,
            });
        }),
        EditorView.theme(
          {
            "&": {
              fontSize: "var(--editor-size)",
              height: "100%",
              backgroundColor: "var(--editor-bg)",
              color: "var(--text)",
            },
            ".cm-content": {
              fontFamily: "Forge Mono, monospace",
              padding: "16px 0",
              caretColor: "var(--accent)",
            },
            ".cm-gutters": {
              backgroundColor: "var(--editor-bg)",
              color: "var(--muted)",
              border: "none",
            },
            ".cm-lineNumbers .cm-gutterElement": { padding: "0 12px 0 16px" },
            ".cm-activeLine": { backgroundColor: "var(--code-highlight)" },
            ".cm-activeLineGutter": {
              backgroundColor: "var(--code-highlight)",
            },
            ".cm-selectionBackground": {
              backgroundColor: "var(--selection) !important",
            },
            ".cm-scroller": { overflow: "auto" },
            "&.cm-focused": {
              outline: "2px solid var(--accent)",
              outlineOffset: "-2px",
            },
          },
          { dark: document.documentElement.dataset.theme !== "light" },
        ),
      ],
    });
    view.current = new EditorView({ state, parent: mount.current });
    view.current.scrollDOM.tabIndex = 0;
    view.current.scrollDOM.setAttribute(
      "aria-label",
      "Code editor scroll area",
    );
    view.current.scrollDOM.setAttribute("role", "region");
    return () => {
      view.current?.destroy();
      view.current = null;
    };
  }, [filename]);
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value)
      v.dispatch({
        changes: { from: 0, to: v.state.doc.length, insert: value },
        selection: {
          anchor: Math.min(cursor.anchor, value.length),
          head: Math.min(cursor.head, value.length),
        },
      });
  }, [value, cursor]);
  return <div className="editor-mount" ref={mount} />;
});
export default Editor;
