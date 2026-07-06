export type FileEditorProps = {
  path: string;
  content: string;
  dirty: boolean;
  onChange(content: string): void;
  onSave(): void;
};

export function FileEditor(props: FileEditorProps) {
  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr)', height: '100%' }}>
      <div className="panel-header" style={{ justifyContent: 'space-between' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{props.path}</div>
          <div style={{ color: 'var(--muted)', fontSize: 12 }}>{props.dirty ? '未保存' : '已保存到本地草稿'}</div>
        </div>
        <button type="button" onClick={props.onSave}>
          保存到本地草稿
        </button>
      </div>
      <div className="panel-scroll" style={{ height: 'auto', padding: 12 }}>
        <textarea
          aria-label={`${props.path} 编辑器`}
          value={props.content}
          onChange={event => props.onChange(event.currentTarget.value)}
          spellCheck={false}
          style={{
            width: '100%',
            minHeight: '100%',
            resize: 'none',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: 12,
            background: 'var(--surface)',
            color: 'var(--text)',
            lineHeight: 1.5
          }}
        />
      </div>
    </div>
  );
}
