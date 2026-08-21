import { demoUser, InMemoryDatabase, InMemoryTaskRepository } from './in-memory-repositories';
import { runTaskRepositoryContract } from './task-repository.contract';

const ALICE = 'user-alice';
const BOB = 'user-bob';

/**
 * Half of the contract. The other half runs the same suite against Postgres in
 * `task.repository.int.test.ts` - if these doubles ever drift from the real thing on
 * anything a use case relies on, the two runs disagree.
 */
runTaskRepositoryContract('InMemoryTaskRepository', {
  alice: ALICE,
  bob: BOB,
  setup: () => {
    const db = new InMemoryDatabase().withUsers(demoUser(ALICE, 'Ada'), demoUser(BOB, 'Grace'));

    return Promise.resolve({
      repository: new InMemoryTaskRepository(db),
      remove: (taskId: string) => {
        db.tasks.delete(taskId);

        return Promise.resolve();
      },
    });
  },
});
