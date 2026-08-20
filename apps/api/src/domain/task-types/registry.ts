import type { TaskTypeDescriptor } from '@task-platform/contracts';

import { TaskTypeNotFoundError } from '../workflow/errors';
import { finalStatusOf, type TaskTypeDefinition } from './task-type-definition';

/**
 * A malformed definition is a programming mistake, not a request outcome - so it is a
 * plain Error with no ErrorCode, and it is thrown at construction time. A misconfigured
 * task type fails the process on boot rather than the user's request at runtime.
 */
export class TaskTypeConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaskTypeConfigurationError';
  }
}

function assertWellFormed(definition: TaskTypeDefinition): void {
  const { type, statuses } = definition;

  if (type.trim().length === 0) {
    throw new TaskTypeConfigurationError('A task type must declare a non-empty type key');
  }

  if (statuses.length === 0) {
    throw new TaskTypeConfigurationError(`Task type "${type}" must declare at least one status`);
  }

  // WF-3a - nothing transitions INTO the creation status, so it can have no entry requirements.
  if ((statuses[0]?.fields.length ?? 0) > 0) {
    throw new TaskTypeConfigurationError(
      `Task type "${type}" declares entry fields on status 1, which nothing transitions into`,
    );
  }

  statuses.forEach((status, index) => {
    const value = index + 1;

    if (status.name.trim().length === 0) {
      throw new TaskTypeConfigurationError(`Task type "${type}" status ${value} has no name`);
    }

    const names = new Set<string>();

    for (const field of status.fields) {
      if (field.name.trim().length === 0) {
        throw new TaskTypeConfigurationError(`Task type "${type}" status ${value} has an unnamed field`);
      }

      if (names.has(field.name)) {
        throw new TaskTypeConfigurationError(
          `Task type "${type}" status ${value} declares "${field.name}" twice`,
        );
      }

      names.add(field.name);
    }
  });
}

/**
 * The strategy lookup. A Map, deliberately - the pattern the assignment is testing stays
 * visible instead of disappearing into a framework's multi-provider DI (ADR-001).
 */
export class TaskTypeRegistry {
  private readonly byType: Map<string, TaskTypeDefinition>;

  constructor(definitions: readonly TaskTypeDefinition[]) {
    const byType = new Map<string, TaskTypeDefinition>();

    for (const definition of definitions) {
      assertWellFormed(definition);

      if (byType.has(definition.type)) {
        throw new TaskTypeConfigurationError(`Task type "${definition.type}" is registered twice`);
      }

      byType.set(definition.type, definition);
    }

    this.byType = byType;
  }

  has(type: string): boolean {
    return this.byType.has(type);
  }

  /** @throws TaskTypeNotFoundError when the type was never registered. */
  get(type: string): TaskTypeDefinition {
    const definition = this.byType.get(type);

    if (definition === undefined) {
      throw new TaskTypeNotFoundError(type);
    }

    return definition;
  }

  list(): readonly TaskTypeDefinition[] {
    return [...this.byType.values()];
  }

  /**
   * The metadata behind GET /task-types. This is the whole reason the client needs no
   * per-type code: it renders forms from these descriptors.
   */
  describe(): TaskTypeDescriptor[] {
    return this.list().map((definition) => ({
      type: definition.type,
      label: definition.label,
      statuses: definition.statuses.map((status, index) => ({
        value: index + 1,
        name: status.name,
        fields: [...status.fields],
      })),
    }));
  }

  /** Exposed for readability at call sites; the value is always derived, never stored. */
  finalStatusOf(type: string): number {
    return finalStatusOf(this.get(type));
  }
}
