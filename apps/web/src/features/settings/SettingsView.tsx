export type SettingsViewProps = {
  connected: boolean;
  cleanupPreviewed: boolean;
};

export function SettingsView(props: SettingsViewProps) {
  return (
    <div className="panel-scroll">
      <h2>设置</h2>
      <section>
        <h3>Runtime</h3>
        <p>{props.connected ? '已连接 Runtime' : '未连接 Runtime'}</p>
      </section>
      <section>
        <h3>清理</h3>
        <button type="button">预览清理</button>
        <button type="button" disabled={!props.connected || !props.cleanupPreviewed}>
          确认清理
        </button>
      </section>
    </div>
  );
}
