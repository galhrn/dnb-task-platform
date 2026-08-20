import { AppDataSource } from '../data-source';
import { UserEntity } from '../entities/user.entity';

/**
 * `npm run seed`. Users are seeded, never managed (section 2).
 *
 * Fixed ids, not generated ones: the client needs a user to act as without an auth
 * system, and a reviewer who reruns this should get the same ids they had before.
 * Idempotent - rerunning changes nothing.
 */
const DEMO_USERS = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Ada Lovelace', email: 'ada@example.com' },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Grace Hopper', email: 'grace@example.com' },
  { id: '33333333-3333-4333-8333-333333333333', name: 'Alan Turing', email: 'alan@example.com' },
];

async function main(): Promise<void> {
  await AppDataSource.initialize();

  try {
    await AppDataSource.createQueryBuilder()
      .insert()
      .into(UserEntity)
      .values(DEMO_USERS)
      .orIgnore()
      .execute();

    const users = await AppDataSource.getRepository(UserEntity).find({ order: { name: 'ASC' } });

    console.log(`[db] ${users.length} demo users available:`);

    for (const user of users) {
      console.log(`      ${user.id}  ${user.name} <${user.email}>`);
    }
  } finally {
    await AppDataSource.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error('[db] seeding failed', error);
  process.exit(1);
});
