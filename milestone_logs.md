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
| [M4](#m4--http--api-layer) | `84634d1` | Routers, request schemas, error middleware, composition root |
| [M5](#m5--client-react-layer) | `9ad9383` | Vite + React Query, dynamic forms, structural proof |
| [M6](#m6--docs--polish) | `3bdd880` | README, request collection, dead-code prune, clean-clone check |
| [M7](#m7--marketing-the-extensibility-proof) | `a863f67` | The two-file commit |

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

---

## M4 - HTTP / API layer

**Commit:** `84634d1` (`feat/m4-http`) - **Definition of done:** Supertest integration suite
covering every error code in section 9.

### Result

```
npm test           132 passed   unit, no container
npm run test:int    49 passed   22 repository + 27 API, real Postgres
npm run typecheck   clean
```

Plus a live curl lifecycle against the booted server - because the test harness builds the app
itself, and that path never proves `main.ts` and the composition root actually work.

### The composition root

Every concrete choice in the system is made in one file, in dependency order, readable top to
bottom. This is **ADR-001** made visible: NestJS would assemble the same graph with less code,
but it would assemble it somewhere you cannot point at, and this wiring is exactly what the
assignment is evaluating. No decorators, no container, no reflection, no registration order to
reason about.

The asymmetry from M3 is visible right there in the constructor calls: writes take the
`UnitOfWork`, reads take repositories directly, and `listTaskTypes` takes only the registry
because task types live in code and never touch the database.

`app.ts` declares the `UseCases` interface it needs; the composition root satisfies it. The
dependency points the right way - the HTTP layer states its requirements, and the root serves
them.

### The 400 / 409 / 422 line

The decision that took the most thought. A request schema is asked one question only: **can a
use case accept this?** Whether the request is *allowed* is the engine's call.

| Request | Status | Why |
|---|---|---|
| `toStatus: "two"` | 400 | not a number - unparseable |
| `toStatus: 2.5` | 409 | a number, but not a status (WF-3) |
| `toStatus: 99` | 409 | a status, but out of range for this type |
| `data: "quotes"` | 400 | not an object - wrong shape |
| `data: {}` | 422 | an object, but not the one this status requires |

The temptation is to validate `toStatus` as `z.number().int().min(1)` at the boundary and be
done. That would be wrong twice over: the range depends on the task type, so the schema would
need to know about task types; and WF-3's "statuses are integers" rule would stop being
reachable, leaving a tested domain rule that production can never trigger.

`data` stays opaque at the boundary for the same reason. Putting a type's field rules in the
request schema is a second source of truth that needs editing every time a type is added -
precisely what this architecture exists to avoid. It is validated one layer down, against a
schema compiled from the descriptors (ADR-009).

### Error handling

One `Record<ErrorCode, number>` is the only place in the codebase that knows what an HTTP
status is. Typed as a total map, so adding an `ErrorCode` without deciding its status is a
compile error rather than an accidental 500 - the same trick as the field-kind dispatch table
(ADR-014).

Three codes share 409 - `INVALID_TRANSITION`, `TASK_CLOSED`, `VERSION_CONFLICT`. The status
says "legal request, wrong state"; the `code` in the envelope is what tells a client which.

Details worth keeping:

- **Malformed JSON** is caught explicitly. body-parser throws a `SyntaxError` with
  `type: 'entity.parse.failed'` *before* any route runs, so without handling it a JSON API
  answers a broken request with Express's HTML error page. There is a test for it.
- **Unmatched routes** become a `RouteNotFoundError`, so a 404 leaves through the same envelope
  as everything else rather than through Express's default.
- **Unhandled errors** return an id and nothing else. An internal message leaked into a response
  is how stack traces end up in screenshots. The test asserts the response does *not* contain
  the thrown message and *does* contain the `X-Request-Id`.
- **`asyncRoute`** exists because Express 4 does not catch a rejected promise - it hangs the
  request instead. It is the one thing that would be deleted on an upgrade to Express 5.

`BadRequestError` and `RouteNotFoundError` live in `interfaces/http/errors.ts`, not in the
domain: a malformed request is not a domain concept, and the domain never sees one. They still
extend `DomainError` so the middleware has exactly one shape to understand.

### Strictness

Bodies, params and query strings are all `.strict()`. An unrecognised key, or `?state=ARCHIVED`,
is a 400 rather than silently dropped - the same stance as ADR-012 and the status schemas. A
stale client should be told, not quietly tolerated.

`:id` params are validated as UUIDs at the boundary. That is not pedantry: without it, a request
for `/api/tasks/not-a-uuid` reaches Postgres, which refuses the cast, and a client's typo
becomes a 500.

### Why the API suite is end-to-end

It would have been cheap to run these tests against the in-memory fakes and keep them in
`npm test`. They run against real Postgres instead, because the failures worth catching at this
layer are the ones a double cannot produce: a uuid the database refuses to cast, a JSONB round
trip, the version guard inside a real transaction.

The trade-off is honest - HTTP coverage now needs a container. The one path that does *not* need
one is the middleware's own 500 handling, which is tested with a throwaway Express app and a
route that throws.

### Housekeeping

Two overdue README placeholders were filled while here: `TODO(M4)` (worked request/response
examples per endpoint, taken from real output) and `TODO(M1)` (the Procurement definition as the
README's centrepiece). The snippet was diffed against the source file - identical key for key,
differing only in trailing commas from reflowing to fit the page.

---

## M5 - Client (React) layer

**Commit:** `9ad9383` (`feat/m5-client`) - **Definition of done:** full lifecycle drivable from
the UI; no per-type conditionals in any component.

### Result

```
npm run typecheck     clean across all three workspaces
npm test              132 (api) + 43 (web) passed
npm run test:int       49 passed
npm run build -w web   74 modules, 240 kB, built in 310ms
```

Plus a full lifecycle driven **through the Vite proxy on :5173** - the exact path the browser
takes - including a deliberate stale `expectedVersion` that came back
`409 VERSION_CONFLICT: expected version 1, found 2`.

### What makes the client type-agnostic

Three components carry the whole claim.

**`DynamicFieldForm`** renders whatever `GET /task-types` said a status requires. Its renderer
table is `{ [K in FieldKind]: FieldRenderer<K> }` - deliberately the mirror of `field-schema.ts`
on the server. That symmetry is the point: adding a field KIND is one entry on each side;
adding a task TYPE is nothing on either. The mapped type makes a missing kind a compile error
rather than a blank space in a form.

**`StatusControls`** derives every affordance from the descriptor:

```
next status      = current + 1, if there is one   (WF-4)
its form         = that status's own field list   (ADR-005)
reverse targets  = every status below the current (WF-5)
close permitted  = current === statuses.length    (WF-6)
```

There is no table of what each type allows, because the ladder's *length* is the only thing
that differs between types. A two-status Marketing task will render one advance button and a
close button with nothing touched.

**`ErrorBanner`** shows the code the server chose rather than inventing a friendlier one. A
client that rewrites "you cannot skip a status" into "something went wrong" throws away the
useful half. Field-level `details` paths (`data.quotes.1`) are claimed by the field that owns
them, so a 422 lands under the right input without the client knowing which fields exist.

### The structural proof, and how it was wrong first

`no-task-type-knowledge.test.ts` reads every client source file and fails if one names a task
type, names a field belonging to one, or branches on either. When Marketing arrives at M7 this
suite must pass **unedited** - that is the proof.

The first version was wrong in two ways, and both are instructive:

1. It flagged `descriptor.type === task.type`. That is *matching a task to whatever the server
   described* - the generic behaviour, not a per-type branch. The smell is comparing a type to
   a **literal**, so the rule became `type === ['"` + "`" + `]` - the quote is the part that matters.
2. Made case-insensitive, it flagged two files for the word "procurement" appearing **in a
   comment explaining that the component knows nothing about procurement**. Prose is not
   behaviour, so the scanner strips comments first.

Both failures were in the rule, not in the code. Which is exactly why the suite now carries a
test asserting the rules still catch four real violations while permitting three legitimate
lookups. A structural test whose rules have never been shown to bite is just a green tick.

### Judgement calls

- **React 19, not the React 18 named in section 3.** Nothing in this client uses an API that
  differs between them; shipping a deliberately old major in a new project invites "why 18?"
  and has no answer. Section 3 was updated rather than left divergent.
- **The Vite dev server proxies `/api` to :3000.** The browser only ever sees one origin, so
  CORS never enters the server - no middleware, no allow-list, no environment-dependent
  behaviour to explain.
- **`scripts/dev.mjs` instead of `concurrently`.** Thirty lines of `child_process` against a
  dependency a reviewer would have to install to read one log. Two Windows/Node traps worth
  knowing: Node 20+ refuses to spawn a `.cmd` without a shell (CVE-2024-27980), and passing an
  args array with `shell: true` triggers DEP0190 - so the command goes through the shell as a
  single constant string.
- **React Query `retry: false`.** Every 4xx this API returns is a decision - a version conflict,
  a refused transition. Retrying only delays telling the user by three round trips.
- **The client sends `expectedVersion` on every mutation.** It has the version it rendered, so
  it can say "I was looking at v2 when I decided this" - the stale-page half of ADR-015.
  Verified end to end: it produced a real 409.

### What is not verified

The UI has not been clicked through in a browser. No browser automation is installed and none
was added for this milestone. What *is* verified: it typechecks, it builds for production, the
structural suite passes, and the complete lifecycle works through the proxy the browser uses.
The DoD phrase "drivable from the UI" is therefore attested by the API path the UI drives, not
by the UI itself - worth saying plainly rather than implying more.

---

## M6 - Docs & polish

**Commit:** `3bdd880` (`feat/m6-docs`) - **Definition of done:** clean clone → running app
following the README only.

### The definition of done, actually performed

Not read through - executed. The repository was cloned into a scratch directory, the running
containers were stopped first so the clone got its own volume, and the README's quick start was
followed line by line with nothing added:

```
git clone → .env.example copied → docker compose up -d → npm install
npm run migration:run     applied 1: InitialSchema1755730000000   (fresh, empty database)
npm run seed              3 demo users
npm run dev               api :3000, web :5173
GET localhost:5173/       200        GET localhost:5173/api/task-types  200
npm test                  132 + 43 passed
npm run test:int           49 passed
lifecycle through :5173   create → 2 → 3 → close, history CREATE/FORWARD/FORWARD/CLOSE
```

Then the clone and its volume were destroyed and the development database restored. A quick
start that has never been run from a clone is a wish, not an instruction.

### Why M6 came before M7, and what it forced

The Marketing commit has to contain nothing but the new task type - otherwise the diff proves
nothing, because a reviewer cannot tell whether it stayed small on merit or because work was
left out of it. That constraint reaches backwards into the README:

**The README cannot quote the Marketing commit's sha.** Filling in a sha at M7 would mean
editing the README in the very commit that is supposed to touch two backend files. So the claim
resolves itself instead:

```bash
git log --oneline -1        # the commit
git show --stat HEAD        # its diff: two files, no frontend, no migration
```

This is better than a sha anyway: it cannot rot, and the reviewer runs it rather than trusting
a number. The general lesson is that a proof-by-diff constrains everything the diff must not
contain, and that has to be arranged in advance.

The same reasoning applies to the milestone log and the checkbox in section 13. Those cannot be
pre-written, so **M7 will be two commits**: the pure two-file commit first, then a separate
`docs(m7)` commit. The mic-drop commit stands alone in history and is the one to look at.

### Documentation

The README now carries the full argument: the layering and its dependency rule, JSONB versus
table-per-type and what that trade-off actually costs, the append-only transition log that
makes clear-forward safe, the conditional `UPDATE ... WHERE version` and why it is not
`save()`, the 400/409/422 line, and how a form reaches the screen from `GET /task-types`.

Two claims that used to be assertions are now evidence:

- **"There is no `switch (task.type)`"** ships with the grep that returns nothing, plus the two
  structural tests that fail if it ever would.
- **"224 tests"** is a table by suite saying what each one proves, not a coverage percentage.
  Coverage measures which lines ran; this says which *rules* have a test that names them.

`requests.http` replaces a Postman collection: every endpoint and every error code, runnable
from VS Code's REST Client or copyable into curl, with no export file to drift out of sync.

### Polish

`noUnusedLocals` and `noUnusedParameters` are now on. They found nothing, which is the point -
the rule is enforced from here rather than merely observed.

A scan for exported symbols that nothing imports found five. Four became module-local
(`buildUseCases`, `compileFieldSchema`, `INITIAL_STATUS`, `toTransitionDto`); `ERROR_CODES`
stayed exported, because a contracts package exists to be consumed and unused-in-this-repo is
not the same as dead. One symbol went the other way: `isClosed` in `domain/task.ts` was dead
because the engine compared to a string literal in three places, so the engine now calls it and
reads better for it.

`DynamicFieldForm` was passing an `error` prop into every renderer that none of them read - the
label owns the message. Removed. `noUnusedParameters` does not catch that, because a destructured
property of an interface is not an unused parameter; it took reading the file.

---

## M7 - Marketing, the extensibility proof

**Commit:** `a863f67` (`feat/m7-marketing`) - **Definition of done:** the diff touches
exactly two server files and nothing else.

### The diff

```
apps/api/src/domain/task-types/index.ts            |  4 ++-
apps/api/src/domain/task-types/marketing.task-type.ts | 32 ++++++++++++++++++++++
2 files changed, 35 insertions(+), 1 deletion(-)
```

Not touched: the workflow engine, the registry, the descriptor compiler, any use case, any
route, the composition root, the database, any migration, and every file under `apps/web`.

### It works because nothing had to be told about it

```
GET /task-types
  PROCUREMENT  3 statuses  entry fields: ['quotes', 'receipt']
  DEVELOPMENT  4 statuses  entry fields: ['specification', 'branchName', 'version']
  MARKETING    2 statuses  entry fields: ['campaignUrl']

POST /tasks/:id/close      at status 1
  -> MARKETING can only be closed at status 2, but the task is at 1

POST /tasks/:id/transitions  toStatus 2, no data
  -> VALIDATION_FAILED  [{ path: 'data.campaignUrl', message: 'Required' }]

POST /tasks/:id/transitions  toStatus 2, campaignUrl supplied
  -> status 2 OPEN  data { "2": { "campaignUrl": "https://example.com/spring" } }
```

Both error messages come from code that has never heard of marketing. "Status 2" is
`statuses.length`; `campaignUrl` is a descriptor compiled into a Zod schema at first use.

**226 tests passed unedited.** `purity.test.ts` went from 11 to 12 on its own, because it
enumerates the domain directory rather than a list someone maintains - the new file was
covered the moment it existed.

### The part that nearly did not hold

The first attempt at this commit broke **five assertions**, which means the two-file claim was
not true as the repository stood. Worth recording honestly, because the failure was more
interesting than the success.

Two categories, both wrong independently of Marketing:

1. **Landmine fixtures.** Three tests and one request example used `'MARKETING'` as the value
   for "a task type that is not registered". A fixture for *never registered* must not be the
   name of a type you intend to ship - it expires the day it does. They now use
   `NO_SUCH_TASK_TYPE`, which cannot become a registry key.
2. **Over-specification.** A use-case test and the `GET /task-types` integration test both
   pinned the exact catalogue with `toEqual(['PROCUREMENT', 'DEVELOPMENT'])`. Those suites are
   about the use case and the endpoint; their job is that *whatever is registered* gets
   described in a shape the client can render. Which types exist is the catalogue's business.

The catalogue test kept its assertion, at the right strength: its intent is "the documented
types are registered", not "no other type may exist". `toContain`, plus a duplicate check, plus
a new test asserting every registered type - present or future - has a creation status that
requires nothing (WF-3a).

That went in as its **own commit, before the one it enables**. A diff is only evidence if the
tests it passes were not adjusted to let it through, so the adjusting had to be visible on its
own terms rather than folded in. A reviewer can read that commit, judge whether each change
stands up without Marketing in the picture, and only then look at the proof.

The general lesson is sharper than the milestone: **a claim about how little a change costs is
also a claim about what your tests are coupled to.** Assertions that pin a registry's contents
in suites that are not about the registry will quietly tax every future addition, and you only
find out on the day you make one.

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
