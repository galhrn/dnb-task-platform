import type {
  ChangeTaskStatusRequest,
  CloseTaskRequest,
  CreateTaskRequest,
  TaskDto,
} from '@task-platform/contracts';
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { api } from '../api/client';
import { taskKeys } from './queries';

/**
 * Every mutation invalidates the same root key. A status change can move a task out of one
 * user's list and into another's, so narrowing the invalidation would mean predicting
 * where it landed - and the whole point of ADR-015 is that the server decides, not us.
 */
function useInvalidateTasks(): () => Promise<void> {
  const queryClient = useQueryClient();

  return () => queryClient.invalidateQueries({ queryKey: taskKeys.all });
}

export function useCreateTask(): UseMutationResult<TaskDto, Error, CreateTaskRequest> {
  const invalidate = useInvalidateTasks();

  return useMutation({
    mutationFn: (body: CreateTaskRequest) => api.createTask(body),
    onSuccess: invalidate,
  });
}

export function useChangeStatus(
  taskId: string,
): UseMutationResult<TaskDto, Error, ChangeTaskStatusRequest> {
  const invalidate = useInvalidateTasks();

  return useMutation({
    mutationFn: (body: ChangeTaskStatusRequest) => api.changeStatus(taskId, body),
    onSuccess: invalidate,
  });
}

export function useCloseTask(
  taskId: string,
): UseMutationResult<TaskDto, Error, CloseTaskRequest> {
  const invalidate = useInvalidateTasks();

  return useMutation({
    mutationFn: (body: CloseTaskRequest) => api.closeTask(taskId, body),
    onSuccess: invalidate,
  });
}
