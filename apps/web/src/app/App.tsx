import { WorkbenchLayout } from '../components/layout/WorkbenchLayout.js';

export function App() {
  return (
    <WorkbenchLayout
      sidebar={<div className="panel-header">Clawee Agent</div>}
      timeline={<div className="panel-header">Agent 对话</div>}
      rightPanel={<div className="panel-header">文件</div>}
      fileTree={<div className="panel-header">项目文件</div>}
    />
  );
}
