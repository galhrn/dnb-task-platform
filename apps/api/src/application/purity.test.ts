import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The application layer's half of the dependency rule, asserted rather than assumed.
 *
 * `domain/purity.test.ts` guards the layer below this one. Nothing guarded this one, and
 * it is the boundary most likely to erode: a use case that imports `EntityManager` "just
 * to add a lock" still compiles, still passes every behavioural test, and quietly makes
 * the layer untestable without a database. The whole point of the ports is that it cannot.
 *
 * The rule: `application/` may reach DOWN into `domain/` and sideways within itself. It
 * may never reach UP into `interfaces/`, or across into `infrastructure/`, and it may
 * never name an ORM or a web framework.
 */

const APPLICATION_DIR = __dirname;
const SRC_DIR = resolve(APPLICATION_DIR, '..');
const DOMAIN_DIR = join(SRC_DIR, 'domain');

/**
 * Types only, no runtime code - the shared vocabulary of the whole repository. Zod is
 * absent on purpose: schema compilation belongs to the domain, and a use case that reached
 * for it would be doing validation the engine already owns.
 */
const ALLOWED_PACKAGES = new Set(['@task-platform/contracts']);

/** Matches `import ... from 'x'`, `import 'x'` and `export ... from 'x'`. */
const IMPORT_PATTERN = /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\bfrom\s+)?['"]([^'"]+)['"]/g;

/**
 * `testing/` holds the in-memory doubles and the shared repository contract. They are test
 * support rather than production code - they import `vitest` by design - so the rule does
 * not apply to them. Everything a request actually runs through lives in `ports/` and
 * `use-cases/`.
 */
function productionSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return entry.name === 'testing' ? [] : productionSources(path);
    }

    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

function importsOf(file: string): string[] {
  const source = readFileSync(file, 'utf8');

  return [...source.matchAll(IMPORT_PATTERN)].flatMap((match) => match[1] ?? []);
}

/** True when `target` is inside `directory` (or is it). */
function isWithin(target: string, directory: string): boolean {
  return target === directory || target.startsWith(directory + sep);
}

const files = productionSources(APPLICATION_DIR);

describe('the application layer depends on ports, not on implementations', () => {
  it('finds the files it is meant to be checking', () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it.each(files.map((file) => relative(APPLICATION_DIR, file)))(
    '%s imports nothing forbidden',
    (name) => {
      const file = join(APPLICATION_DIR, name);

      for (const specifier of importsOf(file)) {
        if (specifier.startsWith('.')) {
          const target = resolve(dirname(file), specifier);

          expect(
            isWithin(target, APPLICATION_DIR) || isWithin(target, DOMAIN_DIR),
            `${name} imports "${specifier}", which is neither in application/ nor domain/`,
          ).toBe(true);

          continue;
        }

        expect(
          ALLOWED_PACKAGES.has(specifier),
          `${name} imports "${specifier}", which the application layer may not depend on`,
        ).toBe(true);
      }
    },
  );

  it('never names an ORM, a web framework, or a driver', () => {
    const forbidden = /\b(typeorm|express|pg|node:)/;

    for (const file of files) {
      expect(
        importsOf(file).some((specifier) => forbidden.test(specifier)),
        `${relative(APPLICATION_DIR, file)} reaches for infrastructure`,
      ).toBe(false);
    }
  });

  it('would catch a leak - the rule is not vacuous', () => {
    // The exact import that would erode this boundary, checked against the same predicates
    // the suite applies, so a future change to those predicates cannot silently stop biting.
    const forbidden = /\b(typeorm|express|pg|node:)/;

    expect(ALLOWED_PACKAGES.has('typeorm')).toBe(false);
    expect(forbidden.test('typeorm')).toBe(true);
    expect(isWithin(join(SRC_DIR, 'infrastructure', 'db'), APPLICATION_DIR)).toBe(false);
    expect(isWithin(join(SRC_DIR, 'interfaces', 'http'), APPLICATION_DIR)).toBe(false);
    expect(isWithin(join(DOMAIN_DIR, 'workflow'), DOMAIN_DIR)).toBe(true);
  });
});
