import type { TaskTypeDescriptor } from '@task-platform/contracts';

import type { TaskTypeRegistry } from '../../domain/task-types/registry';

/**
 * GET /task-types. No database is involved: task types live in code, and this is the
 * metadata the client renders its forms from. Adding a type changes this response
 * without changing this file.
 */
export class ListTaskTypesUseCase {
  constructor(private readonly registry: TaskTypeRegistry) {}

  execute(): TaskTypeDescriptor[] {
    return this.registry.describe();
  }
}
