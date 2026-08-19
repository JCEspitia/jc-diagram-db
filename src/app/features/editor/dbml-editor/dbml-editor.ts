import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  effect,
  input,
  output,
  viewChild,
} from '@angular/core';
import { DbmlParseError } from '../../../core/dbml';

type MonacoApi = typeof import('monaco-editor-api');
type MonacoEditor = import('monaco-editor').editor.IStandaloneCodeEditor;

@Component({
  selector: 'app-dbml-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<div #host class="editor-host" aria-label="DBML editor"></div>',
  styles: `
    :host,
    .editor-host {
      display: block;
      width: 100%;
      height: 100%;
      min-height: 0;
    }
  `,
})
export class DbmlEditor implements AfterViewInit, OnDestroy {
  readonly value = input.required<string>();
  readonly errors = input<DbmlParseError[]>([]);
  readonly valueChange = output<string>();
  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private monaco?: MonacoApi;
  private editor?: MonacoEditor;
  private resizeObserver?: ResizeObserver;
  private disposed = false;
  private applyingExternalValue = false;

  constructor() {
    effect(() => this.syncValue(this.value()));
    effect(() => this.syncMarkers(this.errors()));
  }

  async ngAfterViewInit(): Promise<void> {
    if (navigator.userAgent.includes('jsdom')) return;
    configureMonacoWorkers();
    const monaco = await import('monaco-editor-api');
    if (this.disposed) return;
    this.monaco = monaco;
    registerDbmlLanguage(monaco);
    registerDiagramDbTheme(monaco);
    const editor = monaco.editor.create(this.host().nativeElement, {
      value: this.value(),
      language: 'dbml',
      theme: 'diagramdb-dark',
      automaticLayout: false,
      fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
      fontSize: 12.5,
      lineHeight: 22,
      lineNumbersMinChars: 3,
      glyphMargin: false,
      folding: false,
      lineDecorationsWidth: 8,
      minimap: { enabled: false },
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      scrollBeyondLastLine: false,
      padding: { top: 12 },
      renderLineHighlight: 'gutter',
      renderWhitespace: 'selection',
      roundedSelection: false,
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on',
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: true, indentation: true },
      autoClosingBrackets: 'always',
      autoClosingQuotes: 'always',
      autoIndent: 'full',
      formatOnPaste: true,
      suggest: { showWords: false, preview: true },
      quickSuggestions: { other: true, comments: false, strings: false },
      stickyScroll: { enabled: false },
      scrollbar: {
        verticalScrollbarSize: 8,
        horizontalScrollbarSize: 8,
        useShadows: false,
      },
      tabSize: 2,
      wordWrap: 'off',
    });
    this.editor = editor;
    editor.onDidChangeModelContent(() => {
      if (!this.applyingExternalValue) this.valueChange.emit(editor.getValue());
    });
    this.syncMarkers(this.errors());
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.editor?.layout());
      this.resizeObserver.observe(this.host().nativeElement);
    }
  }

  ngOnDestroy(): void {
    this.disposed = true;
    this.resizeObserver?.disconnect();
    this.editor?.dispose();
  }

  private syncValue(value: string): void {
    if (this.editor && this.editor.getValue() !== value) {
      this.applyingExternalValue = true;
      this.editor.setValue(value);
      this.applyingExternalValue = false;
    }
  }

  private syncMarkers(errors: DbmlParseError[]): void {
    const model = this.editor?.getModel();
    if (!model || !this.monaco) return;
    this.monaco.editor.setModelMarkers(
      model,
      'diagramdb',
      errors.map((error) => ({
        severity: this.monaco!.MarkerSeverity.Error,
        message: error.message,
        startLineNumber: error.line ?? 1,
        startColumn: error.column ?? 1,
        endLineNumber: error.line ?? 1,
        endColumn: (error.column ?? 1) + 1,
      })),
    );
  }
}

function configureMonacoWorkers(): void {
  const environment = globalThis as typeof globalThis & {
    MonacoEnvironment?: { getWorker: () => Worker };
  };
  environment.MonacoEnvironment ??= {
    getWorker: () =>
      new Worker(new URL('monaco/esm/vs/editor/editor.worker.js', document.baseURI), {
        type: 'module',
      }),
  };
}

let languageRegistered = false;
function registerDbmlLanguage(monaco: MonacoApi): void {
  if (languageRegistered) return;
  languageRegistered = true;
  monaco.languages.register({ id: 'dbml' });
  monaco.languages.setLanguageConfiguration('dbml', {
    comments: { lineComment: '//' },
    brackets: [
      ['{', '}'],
      ['[', ']'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
    indentationRules: {
      increaseIndentPattern: /\{[^}]*$/,
      decreaseIndentPattern: /^\s*\}/,
    },
  });
  monaco.languages.setMonarchTokensProvider('dbml', {
    keywords: ['Table', 'Enum', 'Ref', 'Project', 'Note'],
    tokenizer: {
      root: [
        [/\/\/.*$/, 'comment'],
        [/'[^']*'/, 'string'],
        [/\b(Table|Enum|Ref|Project|Note)\b/, 'keyword'],
        [/\b(pk|unique|increment|null|not|default|delete|update)\b/, 'attribute.name'],
        [/[{}\[\]]/, '@brackets'],
        [/[><:-]/, 'operator'],
        [/\b\d+(?:\.\d+)?\b/, 'number'],
      ],
    },
  });
  monaco.languages.registerCompletionItemProvider('dbml', {
    triggerCharacters: ['[', ':'],
    provideCompletionItems(model, position) {
      const range = model.getWordUntilPosition(position);
      const replaceRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: range.startColumn,
        endColumn: range.endColumn,
      };
      return {
        suggestions: [
          completion(
            monaco,
            'Table',
            'Table ${1:table_name} {\n  ${2:id} ${3:uuid} [pk]\n}',
            replaceRange,
            true,
          ),
          completion(
            monaco,
            'Ref',
            'Ref: ${1:table.column} > ${2:table.column}',
            replaceRange,
            true,
          ),
          completion(monaco, 'Enum', 'Enum ${1:enum_name} {\n  ${2:value}\n}', replaceRange, true),
          completion(monaco, 'pk', 'pk', replaceRange),
          completion(monaco, 'not null', 'not null', replaceRange),
          completion(monaco, 'unique', 'unique', replaceRange),
          completion(monaco, 'increment', 'increment', replaceRange),
          completion(monaco, 'delete: cascade', 'delete: cascade', replaceRange),
        ],
      };
    },
  });
}

function completion(
  monaco: MonacoApi,
  label: string,
  insertText: string,
  range: import('monaco-editor').IRange,
  snippet = false,
): import('monaco-editor').languages.CompletionItem {
  return {
    label,
    kind: monaco.languages.CompletionItemKind.Keyword,
    insertText,
    insertTextRules: snippet
      ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
      : undefined,
    range,
  };
}

let themeRegistered = false;
function registerDiagramDbTheme(monaco: MonacoApi): void {
  if (themeRegistered) return;
  themeRegistered = true;
  monaco.editor.defineTheme('diagramdb-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '596780', fontStyle: 'italic' },
      { token: 'keyword', foreground: '9184F7', fontStyle: 'bold' },
      { token: 'attribute.name', foreground: 'E6B867' },
      { token: 'string', foreground: '77C7A5' },
      { token: 'number', foreground: 'E28B8B' },
      { token: 'operator', foreground: '8492A9' },
    ],
    colors: {
      'editor.background': '#0F1624',
      'editor.foreground': '#BAC4D6',
      'editorCursor.foreground': '#9184F7',
      'editorLineNumber.foreground': '#46536B',
      'editorLineNumber.activeForeground': '#8795AD',
      'editor.lineHighlightBackground': '#141D2D',
      'editor.selectionBackground': '#4E438066',
      'editor.inactiveSelectionBackground': '#3A355566',
      'editorIndentGuide.background1': '#263146',
      'editorIndentGuide.activeBackground1': '#47546D',
      'editorError.foreground': '#E06472',
      'editorOverviewRuler.border': '#00000000',
      'scrollbar.shadow': '#00000000',
      'scrollbarSlider.background': '#47546D55',
      'scrollbarSlider.hoverBackground': '#59678088',
      'scrollbarSlider.activeBackground': '#71809AAA',
    },
  });
}
