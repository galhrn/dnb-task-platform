import { developmentTaskType } from './development.task-type';
import { procurementTaskType } from './procurement.task-type';
import type { TaskTypeDefinition } from './task-type-definition';

/**
 * THE registration list.
 *
 * Adding a task type is one new file plus one line here - nothing else in the codebase
 * moves. M7 adds Marketing (ADR-008) and its diff touches exactly those two files.
 */
export const TASK_TYPE_DEFINITIONS: readonly TaskTypeDefinition[] = [
  procurementTaskType,
  developmentTaskType,
];

export { developmentTaskType, procurementTaskType };
export * from './field-schema';
export * from './registry';
export * from './task-type-definition';
