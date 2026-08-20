import type { TaskTypeDefinition } from './task-type-definition';

/** project_context.md section 7. Data is required to ENTER a status (ADR-005). */
export const developmentTaskType: TaskTypeDefinition = {
  type: 'DEVELOPMENT',
  label: 'Development',
  statuses: [
    {
      name: 'Created',
      fields: [],
    },
    {
      name: 'Specification completed',
      fields: [
        {
          kind: 'string',
          name: 'specification',
          label: 'Specification',
          required: true,
          minLength: 1,
          multiline: true,
        },
      ],
    },
    {
      name: 'Development completed',
      fields: [
        {
          kind: 'string',
          name: 'branchName',
          label: 'Branch name',
          required: true,
          minLength: 1,
        },
      ],
    },
    {
      name: 'Distribution completed',
      fields: [
        {
          kind: 'string',
          name: 'version',
          label: 'Version',
          required: true,
          minLength: 1,
        },
      ],
    },
  ],
};
