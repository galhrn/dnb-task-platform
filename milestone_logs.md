# Milestone Logs

> Narrative record of what was built at each milestone, why, and what was learned doing it.
>
> **What this file is.** At the end of every milestone the completion summary is appended
> here before the next milestone starts (`project_context.md` §0, Log rule). Entries preserve
> the reasoning as it was given at the time — including judgement calls, rejected
> alternatives, and things that turned out to be wrong.
>
> **How it differs from the other two documents.** `project_context.md` §11 holds the
> decisions in their final, terse form: what was decided and what follows from it. `README.md`
> is the reviewer-facing argument. This file is the *narrative* — the part that gets lost
> once a decision is tidied into a table row, and the part worth teaching from.
>
> Entries M0–M3 were transcribed retroactively from the working session on 2026-08-21 and
> lightly reformatted to read standalone. Wording, insights and ADR references are as given.

## Index

| Milestone | Commit | Subject |
|---|---|---|
| [M0](#m0--scaffold) | `f43467c` | Workspaces, strict TS, docker-compose, DataSource |
| [M1](#m1--domain-core) | `e3dc138` | Framework-free workflow engine, registry, descriptors |
| [M1 refinement](#m1-refinement--field-kind-dispatch) | `385e3b3` | Lookup-table dispatch, `boolean` and `date` |
| [M2](#m2--infrastructure) | `6e8fd9e` | Entities, migration, repositories, the version guard |
| [M3](#m3--application-layer) | `059859b` | Use cases, transaction boundaries, contract-checked fakes |

---

## M0 — Scaffold

**Commit:** `f43467c` (`main`) · **Definition of done:** `npm run dev` serves `/api/health`;
`docker compose up -d` gives a reachable Postgres.

### Documentation settled first

Three parked questions became decisions before any code was written:

- **ADR-011** — close records no next assignee; the task stays with its current holder.
  Derived rule **WF-6b** added to §6, and §9 notes the close body is `{ expectedVersion? }` only.
- **ADR-012** — `GET /users/:id/tasks` returns everything by default; `?state=OPEN|CLOSED`
  narrows. Unknown `state` values are `BAD_REQUEST`, not silently ignored.
- **ADR-013** — Marketing is `Created → Campaign launched` with `campaignUrl`. Renamed from
  the proposed `campaign_url` to camelCase for consistency with `branchName`/`specification`
  (§15).

### What was built

```
package.json            workspaces root (packages/*, apps/*), engines >=20
tsconfig.base.json      strict + noUncheckedIndexedAccess + decorators
docker-compose.yml      postgres:16-alpine, healthcheck, named volume
.env.example / .env     one variable set, read by compose AND the API
packages/contracts/     errors.ts, task-types.ts, api.ts, index.ts
apps/api/src/           config/env.ts → infrastructure/db/data-source.ts
                        → interfaces/http/app.ts → routes/health.routes.ts → main.ts
```

### Verification

```
npm install          192 packages, 0 vulnerabilities
npm run typecheck    clean, both workspaces
docker compose up -d task-platform-db  Up (healthy)
npm run dev          [db] connected to localhost:5432/taskplatform
GET /api/health      200 {"status":"ok","database":"up","uptimeSeconds":2}
```

The degraded path was confirmed separately: with the DB down, boot logs a warning, the server
still starts, and health returns `503 {"status":"degraded","database":"down"}`.

### Judgement calls

**`packages/contracts` has no build step.** `exports` points straight at `src/index.ts`.
Deployment is a non-goal, so nothing needs to emit JS, and this removes a build-order
dependency from `npm run dev`. Reversible via project references later.

**Boot continues when Postgres is unreachable.** Dev ergonomics; production would fail fast.
It is a good interview talking point either way — logged in §16 as deliberate, not accidental.

**Deferred:** TypeORM CLI wiring and `migration:*`/`seed` scripts → M2 (nothing to run yet);
`apps/web` → M5 (the `apps/*` glob already covers it).

### Teaching note

The health endpoint returns `503` when its only dependency is down. A health check that
reports `ok` while the database is unreachable is worse than no health check at all — it
converts an outage into a silent one.

---

## M1 — Domain core

**Commit:** `e3dc138` (`feat/m1-domain`) · **Definition of done:** unit tests cover WF-1..WF-7
and derived rules; zero framework imports in `domain/`.

### A conflict raised before building

M1 was requested with all three task types, including Marketing. That contradicted **ADR-008**,
which reserves Marketing for an isolated final commit at M7 — and that commit *is* the
extensibility proof the README leads with. If Marketing landed at M1, M7 would have nothing
left to demonstrate.

The subtlety worth preserving: the M7 diff proves "adding a type touches two files and no
frontend file." That claim only means something **once a frontend exists**. Shipping Marketing
before M5 would weaken the proof even if the diff were still two files.

Resolved by keeping Marketing for M7 and proving extensibility at M1 with a structural test
instead.

### Result

```
Test Files  6 passed (6)
     Tests  91 passed (91)     ~740ms, no database, no HTTP server
```

### What the engine knows, and doesn't

`changeTaskStatus(definition, task, command)` — direction is **derived** from `toStatus`, never
declared, so a caller cannot lie about it. Everything type-specific arrives as a
`TaskTypeDefinition`. The final status is `statuses.length`; the legal range is `1..length`.
There is no `switch (task.type)` anywhere.

Rule coverage, each with a named suite: WF-1…WF-7 plus WF-3a, WF-4a, WF-6a, WF-6b, WF-7a, WF-7b.

### Two structural tests

**`extensibility.test.ts`** registers a **five-status** throwaway type at runtime — a length
neither shipped type has — and drives it create → 2 → 3 → 4 → 5 → close, plus skip-rejection,
close-too-early, and clear-forward. Any bound the engine used other than "the length of this
list" fails here.

**`purity.test.ts`** reads every import in `domain/` and fails on anything outside `zod` and the
type-only contracts package. It was mutation-checked — adding `import { DataSource } from
'typeorm'` to `task.ts` produced:

```
× task.ts imports nothing forbidden
  → task.ts imports "typeorm", which the domain layer may not depend on
```

then reverted. **It bites; it isn't decorative.** A structural test that has never been shown to
fail is a comment with a green tick next to it.

### Judgement calls

- **Contracts imported into `domain/`, `import type` only.** ADR-009 makes `FieldDescriptor` the
  single source of truth, so redeclaring it in the domain would create the exact drift the ADR
  exists to prevent. Zero runtime dependency. §4 was reworded rather than left divergent.
- **Status schemas are `.strict()`** — an undeclared key is `VALIDATION_FAILED`, not silently
  stored in the JSONB projection. Same reasoning as ADR-012: no silent ignoring.
- **Required strings are non-empty and trimmed by default.** "A value is required" and "an empty
  string will do" are never both true here.
- **Malformed definitions throw `TaskTypeConfigurationError`** — a plain `Error` with no
  `ErrorCode`, at registry construction. It is a programming mistake, so carrying no error code
  makes it *structurally impossible* to return to a client, and it fails the process on boot
  instead of the first request.
- **The engine never touches `id` or `version`.** `createTask` returns a `NewTaskSnapshot`
  without them — identity comes from the database, `version` from `@VersionColumn` (ADR-010). A
  domain that invented either would need a UUID source or a clock and would stop being pure.

### Anticipated challenge

The `switch (field.kind)` in `field-schema.ts`. A reviewer skimming for conditionals may flag
it — it switches on the descriptor *vocabulary*, which is closed and fixed, not on task type.
Adding a task type never adds a branch to it. (This became the M1 refinement below.)

---

## M1 refinement — field-kind dispatch

**Commit:** `385e3b3` · Requested after M1: replace the switch with a lookup table, widen the
vocabulary, and document why field kinds are *not* treated as an open axis.

### The refactor

`switch (field.kind)` → `Record<FieldKind, builder>`, typed as
`{ [K in FieldKind]: FieldSchemaBuilder<K> }`. The mapped type preserves everything the switch
gave, verified by temporarily adding a `'money'` kind:

```
error TS2741: Property 'money' is missing in type '{ string: ...; number: ...; }'
```

Vocabulary is now `string`, `number`, `boolean`, `date`, `string-array`.

- **`date`** is a calendar date (`YYYY-MM-DD`) — deliberately no time and no zone. It survives
  JSON and JSONB unchanged and maps straight onto `<input type="date">`. Fixed-width, so string
  comparison *is* date comparison, which makes `min`/`max` bounds trivial.
- **`boolean`** never coerces: the string `"false"` is not a boolean, and reading it as one is
  how a checkbox ends up permanently ticked. `required` means *present* — `false` is a value,
  not an absence.

**97 unit tests green.**

### The argument (ADR-014, and the README section it produced)

The asymmetry is the interesting part, because task types and field kinds look superficially
similar and are handled completely differently.

**Open/Closed is applied to the axis that actually changes.** The assignment's question is "how
do you add a task type without touching existing code", so task types get the full treatment: a
definition per file, a registry, and an `index.ts` whose only job is a list. That axis is open
*because the requirement says it is open*.

**Field kinds are a different axis, and it is closed.** The primitive vocabulary of a form field
is roughly the set JSON already has. It changes about once a project, by a developer, in a pull
request. Modelling it as an extension point would mean an interface per primitive, a plugin
registry to discover implementations, and a DI container to wire them — more indirection and
more files to serve a set that will not move, and it would scatter the descriptor vocabulary
across the codebase, which is exactly the drift ADR-009 exists to prevent.

**The lookup table gives up nothing the switch had.** A new kind with no builder is a *compile*
error, and each builder still receives its own narrowed descriptor type. It is a dispatch table,
not a conditional — there is no branch to fall through and nothing to forget.

**And the pressure valve is elsewhere.** What genuinely varies per task type is *rules*, not
primitives — "quote B must be lower than quote A", "this date must follow that one". Those go in
a type's optional `onEnter` hook. Because that hatch exists, the vocabulary never needs to grow
to express a rule, so it stays small on purpose.

**The trade-off, stated plainly.** If field kinds ever became *runtime*-extensible — a form
builder, tenant-defined fields, kinds loaded from configuration — this decision inverts and a
real plugin boundary earns its keep. Nothing would have to be unpicked to get there: the table
is already the seam. Until that requirement exists, building for it is over-engineering, and a
reviewer would be right to say so.

Recorded as **ADR-014**, refining ADR-009 rather than superseding it.

---

## M2 — Infrastructure

**Commit:** `6e8fd9e` (`feat/m2-persistence`) · **Definition of done:** migration runs clean on
an empty DB; seeds insert demo users.

### Verification

```
npm run migration:run     applied 1: InitialSchema1755730000000
npm run migration:revert  → only "migrations" left; re-ran clean on the empty DB
npm run seed              3 demo users, fixed ids, idempotent
npm test                  97 passed      (no container needed)
npm run test:int          14 passed      (dockerised Postgres)
```

The down migration was actually exercised, not assumed. A `down()` that has never run is a
guess.

### Structure

Ports live in `application/`, implementations in `infrastructure/`. Repositories take an
`EntityManager` rather than reaching for a global one, so **one class serves both a plain read
and a transactional write** — the UnitOfWork simply constructs it with the transaction's
manager. That is the whole reason the application layer can own transaction boundaries without
knowing what a transaction is.

Other choices: no `@ManyToOne` between tasks and users (the FKs are real, declared in the
migration, but nothing in §9 traverses the association and an ORM relation that exists only to
look thorough invites accidental eager loading); `migrate.ts` and `seed-users.ts` drive the
DataSource API directly rather than wiring the TypeORM CLI onto a `node_modules` path that
breaks differently on each OS.

### The finding — TypeORM does not enforce `@VersionColumn` on `save()`

The integration test was written **assuming** TypeORM enforced the version column on `save()`.
It does not:

- a write carrying a stale version **silently succeeded** — a textbook lost update;
- `save()` on a row that had been deleted **re-inserted it**.

A probe against the live database settled what the query builder does instead: it *does* honour
the column, emitting `version = version + 1`, and it respects a `WHERE version = ?` guard —
`affected = 0` for a stale write.

So `applyTransition` became one conditional
`UPDATE ... WHERE id = $1 AND version = $2 RETURNING *`. `affected === 0` then distinguishes a
vanished row (`NOT_FOUND`) from a concurrent one (`VERSION_CONFLICT`), and the committed row
comes back in the same round trip.

**The lesson worth teaching:** a mocked repository would have agreed with the wrong assumption
indefinitely. This class of bug is only findable against the real dependency — which is the
argument for having an integration layer at all, and for writing the test *before* trusting the
framework. Recorded as **ADR-016**.

### ADR-015 — the version guard became unconditional

ADR-010 originally said omitting `expectedVersion` means last-write-wins. That was written
before the write path existed. Once a use case reads a task and writes it back, comparing
against the version it just read costs one `AND` and closes the lost-update window entirely;
keeping it opt-in would have been a weaker guarantee for no gain.

The result is two distinct protections:

- the repository **always** guards against interleaving inside the request;
- a client-supplied `expectedVersion` **additionally** guards against acting on a stale page.

Both surface as `VERSION_CONFLICT`.

### Migration detail

The CHECK constraints encode *structure*, not policy — `state` and `kind` are closed sets
belonging to the workflow itself, so the database can hold the line even if something ever
reaches it around the Zod boundary. Nothing task-type-specific is encoded: that would need a
migration per type and defeat ADR-007. `text` + CHECK rather than a Postgres enum, because
widening an enum is an `ALTER TYPE` and a constraint costs nothing to change.

---

## M3 — Application layer

**Commit:** `059859b` (`feat/m3-application`) · **Definition of done:** use-case tests against
in-memory repository doubles.

### Result

```
npm test          132 passed   1.3s, no container
npm run test:int   22 passed   dockerised Postgres
npm run typecheck  clean
```

### Seven use cases, not five

§9's endpoint table has `GET /tasks/:id` and `GET /users`, which had no use case behind them;
§5's list predated that contract. Since routes never reach past the application layer, every
endpoint needs one, even a two-line read.

The split is deliberate and visible in the constructor signatures:

| Use case | Takes | Why |
|---|---|---|
| `create-task`, `change-task-status`, `close-task` | registry + `UnitOfWork` | writes that must be atomic |
| `get-task`, `get-user-tasks`, `list-users` | ports directly | a transaction around one read buys nothing |
| `list-task-types` | registry only | **no port at all** — task types live in code |

No TypeORM import exists anywhere above `infrastructure/`. The `EntityManager` never leaks:
`runInTransaction` hands the use case a `Repositories` bundle already bound to the transaction,
so the application layer expresses "all of this or none of it" without knowing what a
transaction is.

In `change-task-status` the read happens **inside** the transaction, so the version the engine
worked from is the version the write guards against.

### The fakes, and why they can be trusted

The standard objection to hand-written fakes is that they drift and quietly agree with whatever
the code does. So `InMemoryTaskRepository` and `TypeOrmTaskRepository` are held to **one shared
contract suite**, run in both suites — version guard, NOT_FOUND vs conflict, append-only
history, clear-forward, assignee filtering. Drift turns a build red rather than passing
silently.

It earned its keep immediately: it failed on first run and the bug was **in the harness**, not
the fakes. "The row vanished" had been written as re-running `setup()`, which just builds a
*new* store while the repository still points at the old one. The fixture now exposes an
explicit `remove()`.

**A leaky test helper is exactly the kind of thing that makes a green suite meaningless.**

`InMemoryUnitOfWork` snapshots and restores on throw, so a test can distinguish *committed* from
*threw after writing* — without that, testing a transaction boundary proves nothing.

### One ordering call worth defending out loud

In `change-task-status`, the engine runs **before** the assignee existence check. The engine is
pure and free, so an illegal move is refused without a second query — and when both are wrong,
`INVALID_TRANSITION` is more useful than `NOT_FOUND`. The `exists()` check stays, so a bad
assignee is a clean 404 instead of a foreign-key violation surfacing as a 500. There is a test
pinning that precedence.

---

## Recurring themes so far

Patterns that have shown up in more than one milestone, and are probably the transferable part:

1. **Assert structural claims as tests, then prove the test can fail.** `purity.test.ts` and
   `extensibility.test.ts` are claims the README makes; both were mutation-checked. A green tick
   that has never been red proves nothing.
2. **Verify framework behaviour instead of trusting it.** ADR-016 exists because a test was
   written against a real database rather than a double. The assumption was reasonable, widely
   held, and wrong.
3. **Make illegal states unrepresentable at the type level where it is cheap.** The mapped-type
   dispatch table, the `ErrorCode`-less configuration error, `NewTaskSnapshot` lacking `id`.
4. **Apply Open/Closed to the axis that actually changes, and say so out loud for the ones you
   deliberately closed.** ADR-014 is as much about what was *not* built.
5. **No silent ignoring.** Unknown `?state=` value, undeclared payload key, data supplied on a
   backward move — all rejected explicitly. Quiet acceptance is the bug class that survives
   longest.
6. **Errors carry their own meaning; layers above only translate it.** One `DomainError`
   hierarchy with codes, mapped to HTTP in exactly one place.
