import { WorkbenchLayout } from '../components/layout/WorkbenchLayout.js';
import { ConnectionPanel } from '../features/connection/ConnectionPanel.js';
import { Composer } from '../features/runs/Composer.js';
import { ThreadList } from '../features/threads/ThreadList.js';

export function App() {
  return (
    <WorkbenchLayout
      sidebar={
        <div className="sidebar-stack">
          <ConnectionPanel status="disconnected" />
          <ThreadList threads={[]} onSelect={() => {}} onNewThread={() => {}} />
        </div>
      }
      timeline={
        <>
          <div className="panel-header">Agent 对话</div>
          <Composer onSubmit={() => {}} />
        </>
      }
      rightPanel={<div className="panel-header">文件</div>}
      fileTree={<div className="panel-header">项目文件</div>}
    />
  );
}
