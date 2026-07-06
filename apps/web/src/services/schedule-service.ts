import type {
  CreateScheduleRequest,
  RunScheduleNowResponse,
  ScheduleListResponse,
  ScheduleResponse,
  UpdateScheduleRequest
} from '@clawee/protocol';
import type { RuntimeClient } from '../runtime/client.js';

export function createScheduleService(client: RuntimeClient) {
  return {
    listSchedules(): Promise<ScheduleListResponse> {
      return client.get('/schedules');
    },
    createSchedule(input: CreateScheduleRequest): Promise<ScheduleResponse> {
      return client.post('/schedules', input);
    },
    updateSchedule(id: string, input: UpdateScheduleRequest): Promise<ScheduleResponse> {
      return client.patch(`/schedules/${encodeURIComponent(id)}`, input);
    },
    deleteSchedule(id: string): Promise<{ deleted: true }> {
      return client.delete(`/schedules/${encodeURIComponent(id)}`);
    },
    runNow(id: string): Promise<RunScheduleNowResponse> {
      return client.post(`/schedules/${encodeURIComponent(id)}/run-now`);
    }
  };
}
