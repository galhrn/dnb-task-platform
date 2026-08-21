# Project Context — Extensible Task Management Platform

> Internal working document. Source of truth for architecture, decisions and plan.
> Audience: us. The reviewer-facing document is `README.md`.

---

## 0. How to use this file

- **Update rule:** updated at the end of every milestone, before the next one starts.
- **Conflict rule:** if code and this file disagree, one of them is fixed in the *same* change. Never left divergent.
- **Decision rule:** decisions are append-only in §11. Superseding an ADR requires a *new* ADR that references the old one; the old entry is marked `SUPERSEDED BY ADR-xxx`, never deleted.
- **Question rule:** anything that would become a new ADR goes to §12 and waits for input. Reversible, local choices are implemented and noted in §16.
- **Log rule:** at the very end of every milestone — after the code is committed and this file
  is updated, and **before** asking for the green light to start the next one — append the
  milestone completion summary to `milestone_logs.md`. That file is the narrative record:
  what was built, the judgement calls, the rejected alternatives, and anything that turned out
  to be wrong. Preserve the reasoning rather than compressing it; §11 already holds the terse
  version. A milestone is not finished until its entry exists.
- **Size rule:** keep under ~400 lines. Section order is stable so diffs stay readable.
  `milestone_logs.md` has no size limit — it grows by append and is never rewritten.

---

## 1. Assignment summary & source documents

Build a task-management platform that cleanly separates **general workflow rules** (apply to every task type, present and future) from **task-specific rules** (apply to one type only).

Procurement and Development are given as *examples*. The architecture must accept a third type without structural rewrites.

Source documents:
- `Full-Stack_Assignment_NodeJs_React.docx` — the assignment
- `Full-Stack_Assignment_Breakdown` — annotated interpretation
- `Job_description` — D&B Israel, Senior Full Stack (Node.js/React/TS, GCP, REST, SQL)

**Stated evaluation focus:** server-side clean architecture, generic task handling with no per-type conditionals, correct workflow enforcement. Client-side: clear state management, organised and reusable components.

**Our reading of the real test:** can a third task type be added by adding files only — on *both* server and client.

---

## 2. Scope & explicit non-goals

In scope:
- Create task, change status (forward/backward), close task, get user's tasks
- Type-specific data requirements enforced on status entry
- Append-only transition history
- Minimal but coherent React client
- Migrations + seeded demo users
- A third task type (Marketing) added in a final isolated commit as extensibility proof

Explicit non-goals (documented in README so they read as decisions, not gaps):
- Authentication / authorisation / user management (users are seeded)
- Pagination, sorting, filtering beyond "tasks for user"
- Styling beyond legibility
- Deployment, containerised app runtime (Docker is for Postgres only)
- Real-time updates / websockets

---

## 3. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Language | TypeScript (strict) | `strict: true`, `noUncheckedIndexedAccess: true` |
| Runtime | Node.js 20 LTS | |
| Server framework | **Express 4** | ADR-001 |
| ORM | TypeORM 0.3.x | DataSource API, migrations only |
| Database | PostgreSQL 16 via docker-compose | ADR-002 |
| Validation | Zod | boundary + type-specific entry schemas |
| Repo | npm workspaces monorepo | ADR-003 |
| Client | React 19 + Vite 8 + TypeScript | §16 — §3 originally said 18 |
| Client state | TanStack Query (React Query) | ADR-004 — server state only, no Redux |
| Testing | Vitest (unit + integration), Supertest | |

Versions pinned **exactly** in `package.json` at M0, no ranges: `express 4.22.2`, `typeorm 0.3.31`, `pg 8.23.0`, `zod 3.25.76`, `dotenv 17.4.2`, `typescript 5.9.3`, `tsx 4.23.12`. Engine is `node >=20` (developed on 24.18.0); nothing in the stack is version-sensitive above 20.

---

## 4. Architecture overview

Four layers, one dependency rule.

```
interfaces/http  ──►  application  ──►  domain
        │                  │
        └──────────────────┴──────►  infrastructure (via ports/interfaces)
```

**Dependency rule: `interfaces → application → domain`. Never the reverse. `domain` imports nothing but TypeScript, Zod and the type-only `@task-platform/contracts` — enforced by `domain/purity.test.ts`, which reads every import in the layer and fails on anything else.**

- **domain/** — framework-free. The workflow engine, task-type definitions, the registry, domain errors. Operates on plain snapshot objects. Unit-testable with no database, no HTTP, no container. Contracts is imported for *types* only (`import type`), so the layer has no runtime dependency on it at all.
- **application/** — use cases. Owns transaction boundaries and orchestration. Depends on repository *interfaces* declared here, not on TypeORM.
- **infrastructure/** — TypeORM entities, repository implementations, migrations, seeds, DataSource.
- **interfaces/http/** — Express routers, request DTO parsing, the error-mapping middleware, the composition root.

**Dependency injection is manual and explicit** (ADR-001). A single composition root file wires concrete implementations into use cases. No decorators, no container, no reflection — the wiring is readable top to bottom in one file.

---

## 5. Repository map

```
dnb-task-platform/
├─ docker-compose.yml               Postgres 16 service only
├─ package.json                     npm workspaces root, orchestration scripts
├─ tsconfig.base.json               strict compiler options; every workspace extends it
├─ .env.example                     one variable set, read by compose *and* the api
├─ project_context.md               this file — decisions in their final form
├─ milestone_logs.md                narrative record, appended at each milestone (§0)
├─ README.md                        reviewer-facing deliverable
│
├─ packages/contracts/              shared, dependency-free types (source-only, no build step)
│  └─ src/
│     ├─ index.ts                   barrel — the package's only entry point
│     ├─ api.ts                     request/response DTO types
│     ├─ errors.ts                  ErrorCode union + error envelope shape
│     └─ task-types.ts              FieldDescriptor / StatusDescriptor metadata types
│
├─ apps/api/
│  └─ src/
│     ├─ domain/
│     │  ├─ workflow/
│     │  │  ├─ workflow-engine.ts        rules WF-1..WF-7, pure functions
│     │  │  └─ errors.ts                 DomainError hierarchy, one per ErrorCode
│     │  ├─ task-types/
│     │  │  ├─ task-type-definition.ts   the contract every type implements
│     │  │  ├─ registry.ts               Map<type, definition>, lookup + describe()
│     │  │  ├─ field-schema.ts           descriptor → Zod compiler, memoised per definition
│     │  │  ├─ procurement.task-type.ts  ← one file per type
│     │  │  ├─ development.task-type.ts
│     │  │  └─ index.ts                  the ONE registration list
│     │  ├─ task.ts                      TaskSnapshot type + data helpers
│     │  ├─ extensibility.test.ts        a throwaway type driven end to end
│     │  └─ purity.test.ts               asserts the layer imports no framework
│     ├─ application/
│     │  ├─ ports/                       TaskRepository, UserRepository, UnitOfWork
│     │  │                                (no barrel — §15; imported file by file)
│     │  ├─ use-cases/
│     │  │  ├─ create-task.ts               ┐
│     │  │  ├─ change-task-status.ts        ├ transactional (UnitOfWork)
│     │  │  ├─ close-task.ts                ┘
│     │  │  ├─ get-task.ts                  ┐
│     │  │  ├─ get-user-tasks.ts            ├ reads — ports injected directly
│     │  │  ├─ list-users.ts                │
│     │  │  ├─ list-task-types.ts           ┘ (no database at all)
│     │  │  └─ expected-version.ts          the stale-page half of ADR-015
│     │  └─ testing/
│     │     ├─ in-memory-repositories.ts    fakes with real rollback semantics
│     │     └─ task-repository.contract.ts  one suite, run against both implementations
│     ├─ infrastructure/
│     │  ├─ db/data-source.ts            entities + migrations registered explicitly
│     │  ├─ db/entities/                 TaskEntity, TaskTransitionEntity, UserEntity
│     │  ├─ db/repositories/             TypeORM implementations + the UnitOfWork
│     │  ├─ db/migrations/               hand-written SQL, committed
│     │  ├─ db/migrate.ts                `migration:run` / `--revert`, no CLI wiring
│     │  └─ db/seeds/seed-users.ts       fixed ids, idempotent
│     ├─ interfaces/http/
│     │  ├─ app.ts                       express factory; declares the UseCases it needs
│     │  ├─ errors.ts                    BadRequestError, RouteNotFoundError (boundary only)
│     │  ├─ routes/                      health, tasks, users, task-types
│     │  ├─ middleware/
│     │  │  ├─ error-handler.ts          ErrorCode → HTTP status, the only such map
│     │  │  ├─ request-id.ts             X-Request-Id, quoted in every 500
│     │  │  └─ async-route.ts            Express 4 does not catch rejected promises
│     │  └─ dto/
│     │     ├─ request-schemas.ts        Zod parsers — shape only, never policy
│     │     └─ response-mappers.ts       application results → contracts DTOs
│     ├─ config/env.ts                   process.env parsed once through a Zod schema
│     ├─ composition-root.ts             all wiring, explicit
│     └─ main.ts                         bootstrap only
│
├─ scripts/dev.mjs                   runs api + web together, no extra dependency
│
└─ apps/web/
   ├─ vite.config.ts                 proxies /api → :3000, so CORS never exists
   └─ src/
      ├─ api/client.ts               fetch wrapper, ApiError, typed calls
      ├─ hooks/
      │  ├─ queries.ts               useTaskTypes / useUsers / useUserTasks / useTask
      │  └─ use-task-mutations.ts    create / change status / close
      ├─ components/
      │  ├─ DynamicFieldForm.tsx     renders from FieldDescriptor[] — type-agnostic
      │  ├─ StatusControls.tsx       advance / reverse / close, all derived
      │  ├─ TaskDetails.tsx          ladder, collected data, history
      │  ├─ CreateTaskForm.tsx
      │  ├─ TaskList.tsx / TaskCard.tsx
      │  └─ ErrorBanner.tsx          shows the server's code, never a friendlier lie
      ├─ pages/TasksPage.tsx
      └─ no-task-type-knowledge.test.ts  the client half of the M7 proof
```

**Extensibility proof:** adding a task type touches `apps/api/src/domain/task-types/<name>.task-type.ts` (new) and `index.ts` (one line). Nothing else. No migration. No frontend file.

---

## 6. Domain invariants

Testable IDs. Every one gets at least one dedicated unit test.

| ID | Rule | Enforcement |
|---|---|---|
| WF-1 | A task is assigned to exactly one user at any moment | `assigned_user_id` NOT NULL |
| WF-2 | A task is Open or Closed; closed tasks are immutable | any mutation on CLOSED → `TASK_CLOSED` (409) |
| WF-3 | Status is an ascending integer starting at 1 | engine; type defines the ordered list |
| WF-4 | Forward moves are sequential — exactly +1 | `to === from + 1`, else `INVALID_TRANSITION` |
| WF-5 | Backward moves are unrestricted in distance | any `to < from`, `to >= 1` |
| WF-6 | A task may be closed only at its final status | `from === definition.statuses.length` |
| WF-7 | Every status change must (a) satisfy type data requirements, (b) record the next assigned user | entry schema validation + mandatory `assignedUserId` on **all** moves, forward and backward |

Derived rules we made explicit:
- **WF-3a** — status 1 is the creation status; nothing transitions *into* it, so it has no entry requirements.
- **WF-4a** — `to === from` is not a move; rejected as `INVALID_TRANSITION`.
- **WF-6a** — closing a CLOSED task is `TASK_CLOSED`, not idempotent success.
- **WF-6b** — closing carries **no** next assignee; the task stays with whoever closed it (ADR-011). WF-7's assignment requirement is scoped to *status* changes, and closing is a state change.
- **WF-7a** — required data is scoped to **entering** a status (ADR-005).
- **WF-7b** — on a backward move to status T, collected data for all statuses `> T` is cleared (ADR-006). History in `task_transitions` is unaffected.

---

## 7. Task type catalogue

### Procurement (`PROCUREMENT`) — final status 3

| Status | Meaning | Entry requirements |
|---|---|---|
| 1 | Created | — |
| 2 | Supplier offers received | `quotes`: exactly 2 non-empty strings |
| 3 | Purchase completed | `receipt`: non-empty string |

### Development (`DEVELOPMENT`) — final status 4

| Status | Meaning | Entry requirements |
|---|---|---|
| 1 | Created | — |
| 2 | Specification completed | `specification`: non-empty text |
| 3 | Development completed | `branchName`: non-empty string |
| 4 | Distribution completed | `version`: non-empty string |

### Marketing (`MARKETING`) — final status 2, added in final commit (ADR-008, ADR-013)

| Status | Meaning | Entry requirements |
|---|---|---|
| 1 | Created | — |
| 2 | Campaign launched | `campaignUrl`: non-empty string |

Deliberately the shortest legal ladder. Its job is structural, not domain-realistic: two statuses is a third
distinct length (2 vs 3 vs 4), so it exercises "the final status is derived from the list" rather than any
hard-coded bound — and its arrival must touch no engine, use-case, route or client file.

---

## 8. Runbook: adding a new task type

1. Create `apps/api/src/domain/task-types/<name>.task-type.ts` exporting a `TaskTypeDefinition`: a `type` key and an ordered `statuses` array, each status carrying a name and its entry `fields` descriptors.
2. Add it to the array in `apps/api/src/domain/task-types/index.ts`.
3. Done. No migration, no changes to the engine, use cases, routes, or any frontend file. Restart and the new type appears in `GET /task-types`, and the client renders its forms automatically.

Escape hatch for rules a descriptor cannot express (e.g. "quote B must be lower than quote A"): an optional `onEnter(status, ctx)` hook on the definition. Opt-in composition, not inheritance.

---

## 9. API contract

Base path `/api`. All responses JSON.

| Method | Path | Purpose |
|---|---|---|
| GET | `/task-types` | Metadata: every type, its statuses, entry field descriptors. Drives the client. |
| POST | `/tasks` | `{ type, assignedUserId }` → 201 task |
| GET | `/tasks/:id` | Task + transition history |
| POST | `/tasks/:id/transitions` | `{ toStatus, assignedUserId, data?, expectedVersion? }` → 200 task |
| POST | `/tasks/:id/close` | `{ expectedVersion? }` → 200 task |
| GET | `/users/:id/tasks` | Tasks assigned to a user — open **and** closed by default; `?state=OPEN` / `?state=CLOSED` narrows it (ADR-012) |
| GET | `/users` | Seeded users, so the client can populate assignee pickers |
| GET | `/health` | Liveness + database reachability. `200 ok` / `503 degraded`. |

A single `/transitions` endpoint handles forward and backward; direction is derived, not declared by the caller. Close is separate because it is a state change, not a status change — which is also why its body carries no `assignedUserId` (ADR-011).

### Error envelope

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "...", "details": [...] } }
```

| Code | HTTP | When |
|---|---|---|
| `BAD_REQUEST` | 400 | Malformed body/params — request cannot be parsed |
| `NOT_FOUND` | 404 | Unknown task, user, or task type |
| `VALIDATION_FAILED` | 422 | Well-formed, but fails the target status's entry schema |
| `INVALID_TRANSITION` | 409 | Skipping forward, no-op move, out-of-range, close before final status |
| `TASK_CLOSED` | 409 | Any mutation attempt on a closed task |
| `VERSION_CONFLICT` | 409 | `expectedVersion` mismatch — concurrent modification |
| `INTERNAL_ERROR` | 500 | Unhandled — logged with a correlation id |

Domain errors carry a `code`; the HTTP mapping lives in one middleware. Routes never build error responses by hand.

---

## 10. Database schema & migration log

```
users
  id uuid pk, name text not null, email text not null unique, created_at

tasks
  id uuid pk
  type text not null                    -- registry key, not an FK
  status int not null                   -- current status value
  state text not null                   -- 'OPEN' | 'CLOSED'
  assigned_user_id uuid not null fk → users(id)
  data jsonb not null default '{}'      -- keyed BY STATUS: { "2": {...}, "3": {...} }
  version int not null                  -- @VersionColumn, optimistic locking
  created_at, updated_at
  index (assigned_user_id), index (type)

task_transitions                        -- append-only, source of truth
  id uuid pk
  task_id uuid not null fk → tasks(id)
  from_status int null                  -- null for the creation record
  to_status int null                    -- null for the close record
  kind text not null                    -- 'CREATE' | 'FORWARD' | 'BACKWARD' | 'CLOSE'
  payload jsonb not null default '{}'   -- data supplied for this transition
  assigned_user_id uuid not null fk → users(id)
  created_at
  index (task_id, created_at)
```

`tasks.data` is a **read projection**. `task_transitions` is the record of what happened. This is what makes clear-forward (WF-7b) safe: clearing the projection destroys no history.

`data` is keyed by status string, so clear-forward is a key filter (`delete keys > T`) rather than per-type field knowledge — the engine stays type-agnostic.

`synchronize` is **off**. Migrations are hand-checked and committed.

| # | Migration | Contents |
|---|---|---|
| 1 | `InitialSchema1755730000000` | users, tasks, task_transitions, both indexes, FKs, and CHECK constraints on `state`, `status >= 1` and `kind`. Verified down-then-up on a live database. |

The CHECKs encode *structure* — `state` and `kind` are closed sets belonging to the workflow itself, so the database can hold the line even if something ever reaches it around the Zod boundary. Nothing task-type-specific is encoded: that would need a migration per type and defeat ADR-007. `text` + CHECK rather than a Postgres enum, because widening an enum is an `ALTER TYPE` and a constraint costs nothing to change.

---

## 11. Decision log (ADR-lite)

| ID | Decision | Context / alternatives rejected | Consequences |
|---|---|---|---|
| ADR-001 | **Express + manual DI** | NestJS considered and rejected. Nest's multi-provider DI would register strategies with less code, and it appears in the JD — but the graded artefact is the *visibility* of the pattern, and the candidate can defend Express internals under live questioning without risk. | We hand-write the registry and a composition root. Slightly more code; the architecture is legible without framework knowledge. README states this was a considered choice, not a default. |
| ADR-002 | **PostgreSQL 16 via docker-compose** | SQLite rejected: `simple-json` is a text column with no JSONB operators or GIN indexing, which would hollow out ADR-007. Dual-dialect (SQLite for tests) rejected: dialect drift risk. | Reviewer runs one command. Domain tests need no DB at all; integration tests use the dockerised instance. |
| ADR-003 | **npm workspaces monorepo** with `packages/contracts` | Two independent folders rejected: DTO types would be duplicated and drift. | One `npm install`. Client and server share request/response and descriptor types. |
| ADR-004 | **React Query, no Redux** | All state here is server state. Redux would be reflex, not judgement. | Cache invalidation on mutation; no global store. |
| ADR-005 | Required data is **entry-scoped** | Reading the spec tables as "arriving at status N requires X" rather than "leaving N requires X". | Status 1 has no requirements. A backward move to T validates T's entry schema only if T > 1 — see ADR-006. |
| ADR-006 | **Clear-forward on backward moves** | Preserving collected data considered; clear-forward is stricter and forces re-validation on the way forward. | Moving 3 → 2 clears `data["3"]`. Re-advancing to 3 requires the receipt again. History preserved in `task_transitions`. Backward moves themselves supply no data. |
| ADR-007 | **Single `tasks` table + `data jsonb`**, plus append-only `task_transitions` | Table-per-type rejected: a migration per new type defeats the assignment's core test, and TypeORM's class-table inheritance is limited. EAV rejected: worst query ergonomics. | No DB-level shape guarantee for `data` — mitigated because every write funnels through one Zod boundary. Adding a type needs no migration. |
| ADR-008 | **Ship a third type (Marketing)** in a final isolated commit | Claiming extensibility vs demonstrating it. | The commit diff is the proof. README links to it. |
| ADR-009 | **Field descriptors are the single source of truth**; Zod schemas are compiled from them | Alternative: hand-written Zod per type plus separate metadata — two sources that can drift. | One declaration serves both validation and the `GET /task-types` metadata that drives dynamic client forms. Descriptor vocabulary is intentionally small; anything richer uses the `onEnter` hook. (Widened and re-argued in ADR-014.) |
| ADR-010 | **Optimistic locking** via `@VersionColumn`; `expectedVersion` optional in mutation bodies | Pessimistic locking rejected as overkill. | Concurrent status changes surface as `VERSION_CONFLICT` (409) rather than a silent lost update. Omitting `expectedVersion` means last-write-wins — documented. |
| ADR-011 | **Closing records no next assignee**; the task stays with its current holder | Requiring an assignee on close was considered for symmetry with WF-7. Rejected: WF-7 governs *status* changes, and close is a state change — a terminal state has no "next" holder to hand work to. | `POST /tasks/:id/close` takes `{ expectedVersion? }` only. The `CLOSE` row in `task_transitions` still stores the assignee at the moment of closing, so history stays complete. See WF-6b. |
| ADR-012 | **`GET /users/:id/tasks` returns every task**, open and closed, with an optional `?state=OPEN\|CLOSED` filter | Defaulting to open-only was considered and rejected as a silent, undiscoverable omission — a caller cannot distinguish absent-because-closed from absent-because-unassigned. | The default is the honest answer; narrowing is explicit and lives in the query string. An unrecognised `state` value is `BAD_REQUEST` (400), not silently ignored. |
| ADR-013 | **Marketing is a 2-status ladder**: Created → Campaign launched, entry field `campaignUrl` | A richer 4–5 step funnel was considered and rejected: it adds domain detail the assignment never asked for and dilutes what the commit is meant to prove. | Shortest legal ladder, and a third distinct length — the diff proves the engine derives its bounds rather than knowing them. Named `campaignUrl`, not `campaign_url`, for consistency with `branchName`/`specification` (§15). |
| ADR-014 | **Field kinds are a closed vocabulary dispatched through a lookup table**, not an extension point | Refines ADR-009, does not supersede it. A strategy interface per primitive with registration and DI was considered and rejected: it is the right shape for the open axis (task types, served by the registry) and the wrong shape for a set that changes once a project. Vocabulary widened to `string`, `number`, `boolean`, `date`, `string-array`. | `Record<FieldKind, builder>` typed as `{ [K in FieldKind]: FieldSchemaBuilder<K> }`, so a kind with no builder is a compile error — the exhaustiveness a `switch` gave, kept. Per-type rules a primitive cannot express stay in the `onEnter` hook, so the vocabulary is under no pressure to grow. If kinds ever become runtime-extensible the table is already the seam. README explains the asymmetry. |
| ADR-015 | **The version guard is always applied**, using the version the request read; `expectedVersion` is an *additional* staleness check | Refines ADR-010's consequence. Its "omitting `expectedVersion` means last-write-wins" was written before the write path existed; once a use case reads a task and writes it back, comparing against the version it read costs one `AND` and closes the lost-update window entirely. Keeping it opt-in would have been a weaker guarantee for no gain. | Two distinct protections: the repository always guards against interleaving inside the request, and a client-supplied `expectedVersion` additionally guards against acting on a stale page. Both surface as `VERSION_CONFLICT`. |
| ADR-016 | **Writes go through a guarded `UPDATE ... WHERE id AND version`**, not `repository.save()` | TypeORM's `save()` was assumed to enforce `@VersionColumn`. It does not: the integration test proved a stale write silently succeeded, and a `save()` of a deleted row re-inserted it. The query builder *does* honour the column — it emits `version = version + 1` and respects the guard. | `applyTransition` issues one conditional `UPDATE ... RETURNING *`; `affected === 0` then distinguishes a vanished row (`NOT_FOUND`) from a concurrent one (`VERSION_CONFLICT`). Correctness no longer depends on ORM behaviour we would have to trust. `@VersionColumn` still drives the increment and the schema. |

---

## 12. Open questions / awaiting input

**None open.**

- [x] **Q-01** — close and the next assignee → resolved, **ADR-011** (stays with the current holder) + WF-6b.
- [x] **Q-02** — closed tasks in `GET /users/:id/tasks` → resolved, **ADR-012** (everything by default, `?state=` filter).
- [x] **Q-03** — Marketing ladder → resolved, **ADR-013** (2 statuses, `campaignUrl`), catalogued in §7.

*(Resolved questions move to §11 as ADRs or to §16 with a note.)*

---

## 13. Work plan

Each milestone has a definition of done. This file is updated at the end of each, and the
completion summary is appended to `milestone_logs.md` before the next one starts (§0).

- [x] **M0 — Scaffold.** Workspaces, TS strict configs, Express boot, docker-compose, DataSource, health route. *DoD: `npm run dev` serves `/api/health`; `docker compose up -d` gives a reachable Postgres.* — **done 2026-08-21**
- [x] **M1 — Domain core.** `TaskTypeDefinition`, registry, descriptor→Zod compiler, workflow engine, domain errors. Procurement + Development definitions. *DoD: unit tests cover WF-1..WF-7 and derived rules; zero framework imports in `domain/`.* — **done 2026-08-21**, 91 tests green.
- [x] **M2 — Persistence.** Entities, InitialSchema migration, repository implementations, user seed. *DoD: migration runs clean on an empty DB; seeds insert demo users.* — **done 2026-08-21**; down-then-up verified, 14 integration tests green.
- [x] **M3 — Application layer.** Five use cases, transaction boundaries, optimistic locking. *DoD: use-case tests against in-memory repository doubles.* — **done 2026-08-21**; **seven** use cases (see §16), 132 unit + 22 integration tests green.
- [x] **M4 — HTTP layer.** Routes, request DTOs, error middleware, `GET /task-types`. *DoD: Supertest integration suite covering every error code in §9.* — **done 2026-08-21**; 27 API tests, all seven codes covered, plus a live curl lifecycle against the booted server.
- [x] **M5 — Client.** API client, hooks, `DynamicFieldForm`, task list, status controls. *DoD: full lifecycle drivable from the UI; no per-type conditionals in any component.* — **done 2026-08-21**; 43 structural tests assert the second half. Browser click-through is still unverified by me — see §16.
- [ ] **M6 — Docs & polish.** README complete, `.env.example`, seed script, request collection. *DoD: clean clone → running app following README only.*
- [ ] **M7 — Marketing type.** Isolated commit. *DoD: diff touches exactly two server files and nothing else.*

---

## 14. Testing strategy

| Layer | Type | Tooling | What it proves |
|---|---|---|---|
| `domain/` | Pure unit, no DB | Vitest | WF-1..WF-7 and derived rules; the engine is genuinely framework-free |
| `application/` | Unit with repository doubles | Vitest | Orchestration, transaction intent, version conflict handling |
| `infrastructure/` | Integration | Vitest + dockerised PG (`npm run test:int`) | The version guard, transactional rollback, JSONB round-trip — the things a repository double would only agree with |
| `interfaces/http` | Integration | Vitest + Supertest + dockerised PG | Status codes and error envelope for every code in §9 |
| `application/` → ports | Contract | `application/testing/task-repository.contract.ts`, run in **both** suites | The in-memory doubles and the TypeORM repository behave identically on everything a use case relies on — so the fast tests are trustworthy |
| Extensibility | Structural | `domain/extensibility.test.ts` — registers a 5-status throwaway type at runtime | Adding a type requires no engine change — the claim, asserted |
| Purity | Structural | `domain/purity.test.ts` — reads every import in `domain/` | The layer is framework-free, and stays that way after the next contributor |
| `apps/web` | Structural | `no-task-type-knowledge.test.ts` — reads every client source file | No component names a task type, names a type's field, or branches on either — the client half of the M7 proof |

Not chasing a coverage number. Chasing: every row in §6 and every row in the §9 error table has a named test.

---

## 15. Conventions

- Files `kebab-case.ts`; classes `PascalCase`; the one-per-type files use the `.task-type.ts` suffix.
- Domain errors are classes extending `DomainError` with a `code` field. Routes never construct HTTP error bodies.
- No `any`. No non-null assertions outside tests.
- Barrel exports only in `domain/task-types/index.ts` (the registration list) — nowhere else.
- Commits: conventional prefixes, one milestone per branch, M7 as a single clean commit.

---

## 16. Session log

| Date | Change | Why |
|---|---|---|
| 2026-08-21 | Planning session. Stack, layering, DB strategy and workflow semantics agreed. ADR-001..010 recorded. `project_context.md` and `README.md` skeleton created. | Establish the architecture before writing code, per the collaboration rule. |
| 2026-08-21 | Q-01/02/03 answered. ADR-011..013 recorded, WF-6b derived, §7 Marketing catalogued, §9 updated. §12 is now empty. | M0 starts against a settled contract. |
| 2026-08-21 | **M0 executed.** Workspaces root, `tsconfig.base.json`, `packages/contracts`, `apps/api` (`config/env.ts` → `data-source.ts` → `app.ts` → `health.routes.ts`), `docker-compose.yml`, `.env.example`, `.gitignore`. | Scaffold milestone. |
| 2026-08-21 | *Local choice (reversible):* `packages/contracts` is **source-only** — `exports` points at `src/index.ts`, no build step. | Deployment is a non-goal (§2), so no workspace needs to emit JS. Removes a build-order dependency from `npm run dev`; `tsx` and Vite both consume workspace TS directly. Reversible: add `tsc -b` + project references if a dist build is ever needed. |
| 2026-08-21 | *Local choice (reversible):* on boot the API logs and **continues** when Postgres is unreachable; `/api/health` then reports `503 degraded`. | The two M0 DoD clauses are independent — the HTTP server stays inspectable with no container running. Production would fail fast instead; noted as a talking point, not as shipped behaviour. |
| 2026-08-21 | *Local choice (reversible):* `tsx` as the dev runner; not listed in §3 because it is tooling, not architecture. | Zero-config TS execution + watch. Swappable for `ts-node` or `node --experimental-strip-types` without touching source. |
| 2026-08-21 | *Deferred:* TypeORM CLI wiring and the `migration:*` / `seed` npm scripts move to **M2**, alongside the first migration. | Nothing to run at M0; the DataSource is verified through `/api/health` instead. |
| 2026-08-21 | *Deferred:* `apps/web` is scaffolded at **M5**, not M0. | The workspace glob `apps/*` already covers it; scaffolding an empty Vite app now would add dependencies with nothing to render. |
| 2026-08-21 | **M1 executed** on `feat/m1-domain`. Engine, registry, descriptor compiler, `DomainError` hierarchy, Procurement + Development. 91 unit tests. | Domain milestone. |
| 2026-08-21 | *Correction:* M1 was asked for with all three task types; Marketing was held back for M7 instead. | ADR-008 makes the M7 commit the extensibility proof, and "zero frontend files changed" only means something once a frontend exists. Confirmed before building. |
| 2026-08-21 | *Local choice:* `domain/` imports `@task-platform/contracts` — `import type` only — rather than redeclaring `FieldDescriptor`. §4 reworded. | Two declarations of the descriptor shape would drift, and ADR-009 makes that shape the single source of truth. No runtime dependency is created, and `purity.test.ts` pins the allowance to exactly two packages. |
| 2026-08-21 | *Local choice:* status schemas are `.strict()` — a key the type never declared is `VALIDATION_FAILED`. | An undeclared key is a typo or a stale client; silently storing it in the JSONB projection is the quiet kind of bug. Consistent with ADR-012's "no silent ignoring". |
| 2026-08-21 | *Local choice:* required strings are non-empty and trimmed by default; a descriptor need not spell out `minLength: 1`. | "A value is required" and "an empty string will do" are never both true here. Trimming normalises what reaches the JSONB column. |
| 2026-08-21 | *Local choice:* a malformed `TaskTypeDefinition` throws `TaskTypeConfigurationError` — a plain `Error`, at registry construction. | It is a programming mistake, not a request outcome. Carrying no `ErrorCode` makes it structurally impossible to return to a client, and boot-time failure beats a 500 on the first request. |
| 2026-08-21 | **M5 executed** on `feat/m5-client`. Vite + React + React Query, dynamic forms, 43 structural tests, `scripts/dev.mjs`. | Client milestone. |
| 2026-08-21 | *Deviation from §3:* React **19.2.8**, not 18. §3 updated. | React 19 is the current stable release and nothing in this client uses an API that differs between them. Shipping a deliberately old major in a new project invites the question "why 18?" and has no answer. |
| 2026-08-21 | *Local choice:* the Vite dev server proxies `/api` to :3000. | The browser then only ever sees one origin, so CORS never enters the server — no middleware, no allow-list, no environment-dependent behaviour to explain. |
| 2026-08-21 | *Local choice:* `scripts/dev.mjs` runs both halves instead of `concurrently`. | Thirty lines of `child_process` against a dependency a reviewer would have to install to read one log. Note for anyone reusing it: Node 20+ refuses to spawn a `.cmd` without a shell (CVE-2024-27980), and passing an args array with `shell: true` triggers DEP0190 — so the command goes through the shell as one constant string. |
| 2026-08-21 | *Local choice:* React Query `retry: false`. | Every 4xx this API returns is a decision — a version conflict, a refused transition — and retrying only delays telling the user by three round trips. |
| 2026-08-21 | *Honesty note:* M5 is verified by typecheck, production build, the structural suite and a full lifecycle driven through the Vite proxy. It has **not** been clicked through in a browser by me. | No browser automation is installed and none was added for this. The DoD line "drivable from the UI" is therefore attested by the API path the UI uses, not by the UI itself. |
| 2026-08-21 | *Finding:* the first version of the client structural test flagged `descriptor.type === task.type` and prose in comments. | Matching a task to the descriptor the server sent is the generic behaviour, not a per-type branch — the smell is comparing a type to a *literal*. The rules now strip comments first and carry a test asserting they still catch four real violations while permitting three legitimate lookups. |
| 2026-08-21 | **M4 executed** on `feat/m4-http`. Routers, Zod request schemas, error middleware, composition root, 27 Supertest tests. | HTTP milestone. |
| 2026-08-21 | *Local choice:* the 400/409/422 boundary is drawn at **parseability**, not legality. `toStatus: "two"` is 400; `toStatus: 2.5` and `toStatus: 99` are 409; `data: "x"` is 400 but `data: {}` is 422. | Putting a type's field rules in the request schema would be a second source of truth needing an edit per task type — the exact thing this architecture exists to avoid. The DTO asks "can a use case accept this?"; everything else is the engine's call. |
| 2026-08-21 | *Local choice:* `BadRequestError` and `RouteNotFoundError` live in `interfaces/http/errors.ts`, not in the domain, but extend `DomainError`. | A malformed request is not a domain concept — the domain never sees one. Extending the coded-error base keeps the middleware with exactly one shape to understand. |
| 2026-08-21 | *Local choice:* request bodies, params and query strings are all `.strict()`; an unrecognised key or `?state=` value is a 400. | Same stance as ADR-012 and the status schemas: no silent ignoring. A stale client should be told, not quietly tolerated. |
| 2026-08-21 | *Local choice:* the API suite is end-to-end against Postgres rather than fake-backed. | The failures worth catching here are the ones a double cannot produce — a uuid Postgres refuses to cast, a JSONB round trip, the version guard inside a real transaction. The trade-off is that HTTP coverage needs a container; the middleware's own 500 path is tested separately with a throwaway app and no database. |
| 2026-08-21 | *Workflow change:* `milestone_logs.md` added; §0 gains a Log rule. M0–M3 summaries transcribed retroactively. | The completion summaries carried reasoning that §11 deliberately compresses away — rejected alternatives, findings, and the arguments behind them. They are the raw material for a teaching write-up, and they were only living in a chat transcript. |
| 2026-08-21 | **M3 executed** on `feat/m3-application`. Seven use cases, in-memory fakes, a shared repository contract suite, 27 new tests. | Application milestone. |
| 2026-08-21 | *Doc correction:* §5 and §13 said "five use cases", but §9's endpoint table also has `GET /tasks/:id` and `GET /users`, which had none. `get-task.ts` and `list-users.ts` added. | §5 predated the §9 contract. Routes never reach past the application layer, so every endpoint needs one — even a two-line read. |
| 2026-08-21 | *Local choice:* fakes are held to the **same contract suite** as the TypeORM repository — one file, run in both the unit and integration runs. | The standard objection to fakes is that they drift and quietly agree with whatever the code does. Running one suite against both makes drift a red build. It found a leak in its own harness immediately: "the row vanished" cannot be simulated by re-running setup, so the fixture exposes an explicit `remove()`. |
| 2026-08-21 | *Local choice:* in `change-task-status`, the engine runs **before** the assignee existence check. | The engine is pure and free, so an illegal move is refused without a second query, and "you cannot skip a status" beats "that user does not exist" when both are true. The `exists()` check remains, so a bad assignee is a clean 404 rather than a foreign-key 500. |
| 2026-08-21 | *Local choice:* only the three write use cases take a `UnitOfWork`; reads take the ports directly, and `list-task-types` takes only the registry. | A transaction around a single read buys nothing, and the asymmetry documents where atomicity actually matters. `list-task-types` touching no port at all is the clearest statement that task types live in code. |
| 2026-08-21 | *Local choice:* `InMemoryUnitOfWork` snapshots and restores on failure, giving genuine rollback semantics. | Without it a use-case test cannot distinguish "committed" from "threw after writing" — which is the entire point of a transaction boundary. |
| 2026-08-21 | **M2 executed** on `feat/m2-persistence`. Entities, `InitialSchema`, repositories, `TypeOrmUnitOfWork`, `migrate.ts`, user seed, 14 integration tests. | Persistence milestone. |
| 2026-08-21 | *Finding:* TypeORM's `save()` does **not** enforce `@VersionColumn` — a stale write succeeded, and saving a deleted row re-inserted it. ADR-016 recorded; write path is now a guarded `UPDATE ... RETURNING *`. | The integration test was written expecting the ORM to do this and failed. Worth keeping in mind: a mocked repository would have agreed with the wrong assumption forever. |
| 2026-08-21 | *Local choice:* `migration:run` / `seed` are small scripts over the DataSource API rather than the TypeORM CLI. | The CLI needs a TypeScript loader pinned onto a path inside `node_modules`, which breaks differently on each OS — a poor thing to hand a reviewer. `migration:generate` is not needed; migrations are hand-written (§10). |
| 2026-08-21 | *Local choice:* no `@ManyToOne` between tasks and users. The FKs are real, declared in the migration. | Nothing in §9 traverses the association, and an ORM relation that exists only to look complete invites accidental eager loading. |
| 2026-08-21 | *Local choice:* unit and integration suites are separate commands (`test` / `test:int`, two vitest configs). | `npm test` has to stay runnable with no container, and the domain suite has no business waiting on Postgres. |
| 2026-08-21 | *M1 refinement:* `switch (field.kind)` replaced by a typed lookup table; `boolean` and `date` added to the vocabulary. ADR-014 recorded, README gained a “Design decisions & trade-offs” entry explaining the asymmetry with task types. | The switch read like a per-type conditional to a skimming reviewer even though it was not one. The table says “dispatch” rather than “branch”, and the mapped type keeps exhaustiveness. 97 tests green. |
| 2026-08-21 | *Local choice:* the engine takes and returns snapshots and never touches `id` or `version`. | Identity comes from the database and `version` from `@VersionColumn` (ADR-010); a domain that invented either would need a clock or a UUID source and stop being pure. `createTask` therefore returns a `NewTaskSnapshot` with neither field. |
