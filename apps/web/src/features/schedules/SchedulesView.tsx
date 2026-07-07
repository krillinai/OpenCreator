import type { ScheduleResponse } from '@clawee/protocol';

export type SchedulesViewProps = {
  connected: boolean;
  schedules?: ScheduleResponse[];
};

export function SchedulesView(props: SchedulesViewProps) {
  if (!props.connected) {
    return <div className="panel-scroll">本机 Runtime 就绪后管理计划任务</div>;
  }

  const schedules = props.schedules ?? [];

  return (
    <div className="panel-scroll">
      <h2>计划任务</h2>
      <p>计划任务默认使用 workspace-write，可能在无人值守时修改工作区。</p>
      {schedules.length === 0 ? (
        <p>暂无计划任务</p>
      ) : (
        <ul>
          {schedules.map((schedule) => (
            <li key={schedule.id}>
              <strong>{schedule.name}</strong>
              <span>{schedule.cron}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
