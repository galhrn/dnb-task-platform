import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * "The domain imports no framework" is a claim that rots the moment somebody reaches for
 * a convenience import. So it is a test rather than a comment: every import in domain/ is
 * either relative and inside domain/, or one of two dependency-free allowances.
 */

const DOMAIN_DIR = __dirname;

const ALLOWED_PACKAGES = new Set([
  // Schema compilation. Framework-free, and section 3 lists it as a domain dependency.
  'zod',
  // Types only, no runtime code - the shared vocabulary of the whole repository.
  '@task-platform/contracts',
]);

/** Matches `import ... from 'x'`, `import 'x'` and `export ... from 'x'`. */
const IMPORT_PATTERN = /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\bfrom\s+)?['"]([^'"]+)['"]/g;

function productionSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return productionSources(path);
    }

    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

function importsOf(file: string): string[] {
  const source = readFileSync(file, 'utf8');

  return [...source.matchAll(IMPORT_PATTERN)].flatMap((match) => match[1] ?? []);
}

const files = productionSources(DOMAIN_DIR);

describe('the domain layer is framework-free', () => {
  it('finds the files it is meant to be checking', () => {
    expect(files.length).toBeGreaterThanOrEqual(7);
  });

  it.each(files.map((file) => relative(DOMAIN_DIR, file)))('%s imports nothing forbidden', (name) => {
    const file = join(DOMAIN_DIR, name);

    for (const specifier of importsOf(file)) {
      if (specifier.startsWith('.')) {
        // A relative import must not climb out of domain/ - that is how infrastructure
        // creeps in one "just this once" at a time.
        const target = resolve(dirname(file), specifier);

        expect(
          target === DOMAIN_DIR || target.startsWith(DOMAIN_DIR + sep),
          `${name} imports "${specifier}", which is outside the domain layer`,
        ).toBe(true);

        continue;
      }

      expect(
        ALLOWED_PACKAGES.has(specifier),
        `${name} imports "${specifier}", which the domain layer may not depend on`,
      ).toBe(true);
    }
  });

  it('never mentions express, typeorm, pg or a node builtin', () => {
    const forbidden = /\b(express|typeorm|pg|node:)/;

    for (const file of files) {
      expect(
        importsOf(file).some((specifier) => forbidden.test(specifier)),
        `${relative(DOMAIN_DIR, file)} reaches for infrastructure`,
      ).toBe(false);
    }
  });
});
