import type {
  ChangeTaskStatusRequest,
  CloseTaskRequest,
  CreateTaskRequest,
} from '@task-platform/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '../api/client';
import { taskKeys } from './queries';

/**
 * Every mutation invalidates the same root key. A status change can move a task out of one
 * user's list and into another's, so narrowing the invalidation would mean predicting
 * where it landed - and the whole point of ADR-015 is that the server decides, not us.
 */
function useInvalidateTasks() {
  const queryClient = useQueryClient();

  return () => queryClient.invalidateQueries({ queryKey: taskKeys.all });
}

export function useCreateTask() {
  const invalidate = useInvalidateTasks();

  return useMutation({
    mutationFn: (body: CreateTaskRequest) => api.createTask(body),
    onSuccess: invalidate,
  });
}

export function useChangeStatus(taskId: string) {
  const invalidate = useInvalidateTasks();

  return useMutation({
    mutationFn: (body: ChangeTaskStatusRequest) => api.changeStatus(taskId, body),
    onSuccess: invalidate,
  });
}

export function useCloseTask(taskId: string) {
  const invalidate = useInvalidateTasks();

  return useMutation({
    mutationFn: (body: CloseTaskRequest) => api.closeTask(taskId, body),
    onSuccess: invalidate,
  });
}
