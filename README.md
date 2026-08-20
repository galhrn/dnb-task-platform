# Extensible Task Management Platform

A task-management system built so that **adding a new task type requires adding files, not changing them** — on the server *and* the client.

Node.js · TypeScript · Express · TypeORM · PostgreSQL · React

---

## Quick start

```bash
git clone <repo> && cd dnb-task-platform
cp .env.example .env
docker compose up -d          # PostgreSQL 16
npm install                   # npm workspaces — installs api + web + contracts
npm run migration:run
npm run seed                  # demo users
npm run dev                   # api :3000, web :5173
```

Open <http://localhost:5173>.

> _TODO(M6): verify this sequence on a clean clone before submitting._

---

## The one thing to look at

The assignment asks how a third task type would be added without touching existing code. Here is the whole answer:

> _TODO(M1): paste the real `TaskTypeDefinition` for Procurement here — it should be short enough to read in fifteen seconds._

To add a type:

1. Add `apps/api/src/domain/task-types/<name>.task-type.ts`.
2. Add one line to `apps/api/src/domain/task-types/index.ts`.

No migration. No change to the workflow engine, use cases, routes, or any frontend file.

**This is demonstrated, not asserted.** The `MARKETING` task type was added in commit `<sha>` — the diff touches exactly two files.

> _TODO(M7): fill in the sha._

---

## Architecture

```
interfaces/http  ──►  application  ──►  domain
        │                  │
        └──────────────────┴──────►  infrastructure (via ports)
```

**Dependency rule: `interfaces → application → domain`, never the reverse.** The `domain/` directory imports no framework — it is plain TypeScript operating on plain objects, and its tests run without a database, an HTTP server, or a container.

| Layer | Responsibility |
|---|---|
| `domain/` | Workflow engine (the general rules), task-type definitions (the specific rules), registry |
| `application/` | Use cases, transaction boundaries, repository *ports* |
| `infrastructure/` | TypeORM entities, repository implementations, migrations, seeds |
| `interfaces/http/` | Express routes, request parsing, error mapping, composition root |

### The separation the assignment asks for

The workflow engine enforces sequencing, closure and assignment. **It has never heard of "procurement."** A task type contributes only two things: an ordered list of statuses, and the data required to *enter* each one. The final status is derived from the list's length, so "close only at the final status" is generic code.

There is no `switch (task.type)` anywhere in the codebase.

> _TODO(M6): consider `grep -rn "task.type ===" apps/api/src` output as evidence. If it returns nothing, say so here._

### Dependency injection without a framework

Express was chosen over NestJS deliberately. Nest's multi-provider DI would register strategies with less code, but it would also hide the mechanism being evaluated. Here the registry is a `Map` and the wiring is a single composition root file you can read top to bottom.

---

## Design decisions

Each of these had a rejected alternative. Full log in `project_context.md` §11.

### Storing type-specific data: JSONB, not table-per-type

`tasks.data` is a `jsonb` column keyed by status. Table-per-type was rejected because it requires a migration for every new type — which defeats the assignment's central question. EAV was rejected on query ergonomics.

The trade-off is real: JSONB gives no database-level shape guarantee. It is mitigated by funnelling every write through a single validation boundary, where the type's own schema is applied.

### An append-only transition log

`task_transitions` records every create, move and close: from-status, to-status, the data supplied, and the assignee. `tasks.data` is a **read projection**; the transition table is the source of truth.

This falls out of the spec — rule 7 requires recording the next assigned user on every change — and it makes the backward-move question tractable: clearing projected data destroys no history.

### Backward moves clear forward data

Moving from status 3 back to 2 discards the data collected for status 3. Re-advancing requires supplying it again. The stricter reading, and the transition log means nothing is lost.

### Concurrency

Status changes run in a transaction against a versioned row. Concurrent modification returns `409 VERSION_CONFLICT` rather than silently losing a write.

---

## API

Base path `/api`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/task-types` | Type metadata — statuses and required fields. Drives the client's forms. |
| `POST` | `/tasks` | Create with a type and an initial assignee |
| `GET` | `/tasks/:id` | Task with its transition history |
| `POST` | `/tasks/:id/transitions` | Change status — direction is derived, not declared |
| `POST` | `/tasks/:id/close` | Close, permitted only at the final status |
| `GET` | `/users/:id/tasks` | Tasks assigned to a user |
| `GET` | `/users` | Seeded demo users |

> _TODO(M4): add one worked request/response example per endpoint. Keep them copy-pasteable._

### Errors

```json
{ "error": { "code": "INVALID_TRANSITION", "message": "...", "details": [] } }
```

| Code | HTTP |
|---|---|
| `BAD_REQUEST` | 400 |
| `NOT_FOUND` | 404 |
| `VALIDATION_FAILED` | 422 |
| `INVALID_TRANSITION` | 409 |
| `TASK_CLOSED` | 409 |
| `VERSION_CONFLICT` | 409 |
| `INTERNAL_ERROR` | 500 |

Domain errors carry a code; one middleware maps them to HTTP. Routes never build error bodies.

---

## Workflow rules

| # | Rule |
|---|---|
| 1 | Exactly one assignee at any moment |
| 2 | Open or Closed; closed tasks are immutable |
| 3 | Statuses are ascending integers from 1 |
| 4 | Forward moves are exactly one step |
| 5 | Backward moves may span any distance |
| 6 | Closure only from the final status |
| 7 | Every change satisfies the type's data requirements and records the next assignee |

Ambiguities in the spec, and how they were resolved:

- Required data is scoped to **entering** a status, so status 1 has no requirements.
- Backward moves also require an assignee — rule 7 says *every* status change.
- Moving to the current status is rejected, not treated as a no-op.
- Closing an already-closed task is an error, not idempotent success.

---

## Task types

> _TODO(M1/M7): status tables for Procurement, Development, Marketing._

---

## Client

Minimal by instruction, but with one deliberate property: **the client has no per-type code either.** It fetches `GET /task-types` and renders forms from the returned field descriptors. Adding Marketing changed zero frontend files.

State is server state, managed with React Query — no global store.

> _TODO(M5): note the hard-coded user id and where to change it._

---

## Testing

```bash
npm run test          # unit — domain, no database required
npm run test:int      # integration — requires docker compose up
```

The domain suite covers each of the seven workflow rules by name. The integration suite covers each error code above. One structural test registers a throwaway task type at runtime, asserting that extensibility is a property of the code rather than a claim in this file.

> _TODO(M6): final counts and any coverage note._

---

## Scope

Deliberately excluded: authentication, user management (users are seeded), pagination, styling beyond legibility, deployment. Docker is used for PostgreSQL only.

---

## Repository layout

> _TODO(M6): trimmed tree — top three levels, one line of purpose each._
