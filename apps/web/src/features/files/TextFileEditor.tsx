import type { WorkspaceFileKind } from '@opencreator/protocol';
import { history, historyKeymap, defaultKeymap } from '@codemirror/commands';
import { cssLanguage } from '@codemirror/lang-css';
import { htmlLanguage } from '@codemirror/lang-html';
import { javascriptLanguage, jsxLanguage, tsxLanguage, typescriptLanguage } from '@codemirror/lang-javascript';
import { jsonLanguage } from '@codemirror/lang-json';
import { markdownLanguage } from '@codemirror/lang-markdown';
import { pythonLanguage } from '@codemirror/lang-python';
import { xmlLanguage } from '@codemirror/lang-xml';
import { LanguageSupport, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { Annotation, EditorState, Compartment } from '@codemirror/state';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { useEffect, useMemo, useRef } from 'react';

export type TextFileEditorProps = {
  path: string;
  content: string;
  kind: WorkspaceFileKind;
  readonly?: boolean;
  onChange?(value: string): void;
  onSave?(): void;
};

const externalSyncAnnotation = Annotation.define<boolean>();

export function TextFileEditor(props: TextFileEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(props.onChange);
  const onSaveRef = useRef(props.onSave);
  const readonlyRef = useRef(Boolean(props.readonly));
  const readonlyCompartment = useMemo(() => new Compartment(), []);
  const languageCompartment = useMemo(() => new Compartment(), []);

  useEffect(() => {
    onChangeRef.current = props.onChange;
  }, [props.onChange]);

  useEffect(() => {
    onSaveRef.current = props.onSave;
  }, [props.onSave]);

  useEffect(() => {
    readonlyRef.current = Boolean(props.readonly);
  }, [props.readonly]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return undefined;
    }

    const state = EditorState.create({
      doc: props.content,
      extensions: [
        lineNumbers(),
        history(),
        EditorView.lineWrapping,
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        highlightSelectionMatches(),
        keymap.of([
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
              if (readonlyRef.current) {
                return true;
              }
              onSaveRef.current?.();
              return true;
            }
          },
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !update.transactions.some((transaction) => transaction.annotation(externalSyncAnnotation))) {
            onChangeRef.current?.(update.state.doc.toString());
          }
        }),
        readonlyCompartment.of(readonlyExtensions(Boolean(props.readonly))),
        languageCompartment.of(languageForFile(props.path, props.kind)),
        EditorView.theme({
          '&': {
            height: '100%',
            backgroundColor: 'var(--surface)',
            color: 'var(--text)'
          },
          '.cm-scroller': {
            minHeight: '0',
            overflow: 'auto'
          },
          '.cm-content': {
            fontFamily: 'var(--font-mono)',
            fontSize: '12.5px'
          },
          '.cm-line': {
            color: 'var(--text)'
          },
          '.cm-gutters': {
            borderRight: '1px solid var(--border)',
            backgroundColor: 'var(--surface-2)',
            color: 'var(--subtle)'
          },
          '.cm-activeLineGutter': {
            backgroundColor: 'var(--surface-3)',
            color: 'var(--text)'
          },
          '.cm-activeLine': {
            backgroundColor: 'color-mix(in srgb, var(--accent-soft) 55%, transparent)'
          },
          '.cm-cursor': {
            borderLeftColor: 'var(--accent-strong)'
          },
          '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
            backgroundColor: 'color-mix(in srgb, var(--accent) 42%, transparent)'
          }
        })
      ]
    });

    const view = new EditorView({
      state,
      parent: host
    });
    configureContentDom(view, props.path, Boolean(props.readonly));
    viewRef.current = view;

    return () => {
      viewRef.current = null;
      view.destroy();
    };
  }, [languageCompartment, readonlyCompartment]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    const current = view.state.doc.toString();
    if (current === props.content) {
      return;
    }

    view.dispatch({
      changes: {
        from: 0,
        to: current.length,
        insert: props.content
      },
      annotations: externalSyncAnnotation.of(true)
    });
  }, [props.content]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    view.dispatch({
      effects: [
        readonlyCompartment.reconfigure(readonlyExtensions(Boolean(props.readonly))),
        languageCompartment.reconfigure(languageForFile(props.path, props.kind))
      ]
    });
    configureContentDom(view, props.path, Boolean(props.readonly));
  }, [languageCompartment, props.kind, props.path, props.readonly, readonlyCompartment]);

  return (
    <div className="text-file-editor">
      <div ref={hostRef} className="text-file-editor-host" />
    </div>
  );
}

function configureContentDom(view: EditorView, path: string, readonly: boolean) {
  view.contentDOM.setAttribute('role', 'textbox');
  view.contentDOM.setAttribute('aria-label', `${path} 编辑器`);
  view.contentDOM.setAttribute('aria-multiline', 'true');
  view.contentDOM.setAttribute('aria-readonly', readonly ? 'true' : 'false');
}

function readonlyExtensions(readonly: boolean) {
  return [EditorState.readOnly.of(readonly), EditorView.editable.of(!readonly)];
}

function languageForFile(path: string, kind: WorkspaceFileKind) {
  const extension = fileExtension(path);

  if (kind === 'markdown' || extension === 'md' || extension === 'mdx') {
    return new LanguageSupport(markdownLanguage);
  }

  if (kind === 'json' || extension === 'json') {
    return new LanguageSupport(jsonLanguage);
  }

  if (kind === 'html' || extension === 'html' || extension === 'htm') {
    return new LanguageSupport(htmlLanguage);
  }

  if (extension === 'css') {
    return new LanguageSupport(cssLanguage);
  }

  if (extension === 'tsx') {
    return new LanguageSupport(tsxLanguage);
  }

  if (extension === 'ts' || extension === 'mts' || extension === 'cts') {
    return new LanguageSupport(typescriptLanguage);
  }

  if (extension === 'jsx') {
    return new LanguageSupport(jsxLanguage);
  }

  if (extension === 'js' || extension === 'mjs' || extension === 'cjs') {
    return new LanguageSupport(javascriptLanguage);
  }

  if (extension === 'py') {
    return new LanguageSupport(pythonLanguage);
  }

  if (extension === 'xml' || extension === 'svg') {
    return new LanguageSupport(xmlLanguage);
  }

  return [];
}

function fileExtension(path: string): string {
  const name = path.split('/').at(-1) ?? path;
  const index = name.lastIndexOf('.');
  if (index === -1) {
    return '';
  }

  return name.slice(index + 1).toLowerCase();
}
