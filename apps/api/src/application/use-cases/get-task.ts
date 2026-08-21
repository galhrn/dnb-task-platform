import { TaskNotFoundError } from '../../domain/workflow/errors';
import type { TaskRepository, TaskWithHistory } from '../ports/task-repository';

/** GET /tasks/:id - the task with its full transition history. */
export class GetTaskUseCase {
  constructor(private readonly tasks: TaskRepository) {}

  async execute(taskId: string): Promise<TaskWithHistory> {
    const found = await this.tasks.findByIdWithHistory(taskId);

    if (found === null) {
      throw new TaskNotFoundError(taskId);
    }

    return found;
  }
}
