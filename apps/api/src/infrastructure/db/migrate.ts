import { AppDataSource } from './data-source';

/**
 * `npm run migration:run` / `npm run migration:revert`.
 *
 * A script rather than the TypeORM CLI: the CLI needs a TypeScript loader wired onto a
 * path inside node_modules, which is a cross-platform trap for a reviewer on a different
 * OS. This is the same API the CLI calls, with nothing between it and the DataSource.
 */
async function main(): Promise<void> {
  const revert = process.argv.includes('--revert');

  await AppDataSource.initialize();

  try {
    if (revert) {
      await AppDataSource.undoLastMigration({ transaction: 'all' });
      console.log('[db] reverted the last migration');
      return;
    }

    const applied = await AppDataSource.runMigrations({ transaction: 'all' });

    console.log(
      applied.length === 0
        ? '[db] no pending migrations'
        : `[db] applied ${applied.length}: ${applied.map((migration) => migration.name).join(', ')}`,
    );
  } finally {
    await AppDataSource.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error('[db] migration failed', error);
  process.exit(1);
});
