import type { TaskTypeDefinition } from './task-type-definition';

/** project_context.md section 7. Data is required to ENTER a status (ADR-005). */
export const procurementTaskType: TaskTypeDefinition = {
  type: 'PROCUREMENT',
  label: 'Procurement',
  statuses: [
    {
      name: 'Created',
      fields: [],
    },
    {
      name: 'Supplier offers received',
      fields: [
        {
          kind: 'string-array',
          name: 'quotes',
          label: 'Supplier quotes',
          required: true,
          minItems: 2,
          maxItems: 2,
          itemMinLength: 1,
        },
      ],
    },
    {
      name: 'Purchase completed',
      fields: [
        {
          kind: 'string',
          name: 'receipt',
          label: 'Receipt',
          required: true,
          minLength: 1,
        },
      ],
    },
  ],
};
