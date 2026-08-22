import type {
  TaskDto,
  TaskState,
  TaskTypeDescriptor,
  TaskWithHistoryDto,
  UserDto,
} from '@task-platform/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { api } from '../api/client';

/**
 * Server state only (ADR-004). There is no client-side store: everything on screen either
 * came from the API and lives in the React Query cache, or is transient form state owned
 * by the component holding the form.
 */

export const taskKeys = {
  all: ['tasks'] as const,
  byUser: (userId: string, state?: TaskState) => ['tasks', 'user', userId, state ?? 'ALL'] as const,
  byId: (taskId: string) => ['tasks', 'detail', taskId] as const,
};

/**
 * The metadata that drives every form in this app. It only changes when the server
 * registers a new task type, which cannot happen while the tab is open - so it is fetched
 * once and never refetched.
 */
export function useTaskTypes(): UseQueryResult<TaskTypeDescriptor[], Error> {
  return useQuery({
    queryKey: ['task-types'],
    queryFn: api.listTaskTypes,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useUsers(): UseQueryResult<UserDto[], Error> {
  return useQuery({
    queryKey: ['users'],
    queryFn: api.listUsers,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useUserTasks(userId: string, state?: TaskState): UseQueryResult<TaskDto[], Error> {
  return useQuery({
    queryKey: taskKeys.byUser(userId, state),
    queryFn: () => api.getUserTasks(userId, state),
  });
}

export function useTask(taskId: string | null): UseQueryResult<TaskWithHistoryDto, Error> {
  return useQuery({
    queryKey: taskKeys.byId(taskId ?? ''),
    queryFn: () => api.getTask(taskId as string),
    enabled: taskId !== null,
  });
}
