import type { TaskTypeDefinition } from './task-type-definition';

/**
 * project_context.md section 7, ADR-013. Data is required to ENTER a status (ADR-005).
 *
 * Two statuses: a third distinct ladder length, so this type exercises "the final status
 * is the length of this list" rather than any bound somebody hard-coded. Everything else
 * it needs - sequencing, closure, assignment, validation, the form the client renders -
 * it inherits by existing.
 */
export const marketingTaskType: TaskTypeDefinition = {
  type: 'MARKETING',
  label: 'Marketing',
  statuses: [
    {
      name: 'Created',
      fields: [],
    },
    {
      name: 'Campaign launched',
      fields: [
        {
          kind: 'string',
          name: 'campaignUrl',
          label: 'Campaign URL',
          required: true,
          minLength: 1,
        },
      ],
    },
  ],
};
