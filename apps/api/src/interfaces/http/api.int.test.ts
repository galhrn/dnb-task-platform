import type { Express } from 'express';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../composition-root';
import { AppDataSource } from '../../infrastructure/db/data-source';
import { UserEntity } from '../../infrastructure/db/entities/user.entity';
import { errorHandler } from './middleware/error-handler';
import { requestId } from './middleware/request-id';

/**
 * The API contract of section 9, and every row of its error table, over a real stack:
 * Express -> composition root -> use case -> TypeORM -> Postgres. Requires
 * `npm run db:up` and `npm run migration:run`.
 *
 * These are deliberately end-to-end rather than fake-backed. The interesting failures at
 * this layer are the ones a double cannot produce: a uuid that Postgres refuses to cast,
 * a JSONB round trip, a version guard racing inside a transaction.
 */

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const MISSING = '99999999-9999-4999-8999-999999999999';

const QUOTES = { quotes: ['Supplier A - 100', 'Supplier B - 90'] };
const RECEIPT = { receipt: 'INV-2026-001' };

let app: Express;

beforeAll(async () => {
  await AppDataSource.initialize();

  await AppDataSource.createQueryBuilder()
    .insert()
    .into(UserEntity)
    .values([
      { id: ALICE, name: 'Ada Lovelace', email: 'ada@example.com' },
      { id: BOB, name: 'Grace Hopper', email: 'grace@example.com' },
    ])
    .orIgnore()
    .execute();

  app = buildApp(AppDataSource);
});

afterAll(async () => {
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }
});

beforeEach(async () => {
  await AppDataSource.query('TRUNCATE TABLE "tasks" CASCADE');
});

async function createProcurementTask(assignedUserId = ALICE) {
  const response = await request(app)
    .post('/api/tasks')
    .send({ type: 'PROCUREMENT', assignedUserId })
    .expect(201);

  return response.body as { id: string; version: number };
}

function transition(taskId: string, body: Record<string, unknown>) {
  return request(app).post(`/api/tasks/${taskId}/transitions`).send(body);
}

describe('GET /api/task-types', () => {
  it('returns the metadata the client renders forms from', async () => {
    const response = await request(app).get('/api/task-types').expect(200);

    const types = response.body as { type: string; statuses: { value: number }[] }[];

    expect(types.map((type) => type.type)).toEqual(['PROCUREMENT', 'DEVELOPMENT']);
    expect(types[0]?.statuses.map((status) => status.value)).toEqual([1, 2, 3]);
    expect(types[0]?.statuses[1]).toMatchObject({
      name: 'Supplier offers received',
      fields: [expect.objectContaining({ kind: 'string-array', name: 'quotes' })],
    });
  });
});

describe('GET /api/users', () => {
  it('returns the seeded users without leaking anything else', async () => {
    const response = await request(app).get('/api/users').expect(200);
    const users = response.body as Record<string, unknown>[];

    expect(users.length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(users[0] ?? {}).sort()).toEqual(['email', 'id', 'name']);
  });
});

describe('the task lifecycle', () => {
  it('runs create -> 2 -> 3 -> close and reports history at every step', async () => {
    const created = await createProcurementTask();

    expect(created).toMatchObject({ type: 'PROCUREMENT', status: 1, state: 'OPEN', version: 1 });

    await transition(created.id, { toStatus: 2, assignedUserId: BOB, data: QUOTES }).expect(200);
    await transition(created.id, { toStatus: 3, assignedUserId: BOB, data: RECEIPT }).expect(200);

    const closed = await request(app)
      .post(`/api/tasks/${created.id}/close`)
      .send({})
      .expect(200);

    // ADR-011 - the task stays with whoever held it.
    expect(closed.body).toMatchObject({ state: 'CLOSED', status: 3, assignedUserId: BOB });

    const found = await request(app).get(`/api/tasks/${created.id}`).expect(200);
    const body = found.body as {
      data: Record<string, unknown>;
      transitions: { kind: string; payload: unknown }[];
    };

    expect(body.data).toEqual({ '2': QUOTES, '3': RECEIPT });
    expect(body.transitions.map((entry) => entry.kind)).toEqual([
      'CREATE',
      'FORWARD',
      'FORWARD',
      'CLOSE',
    ]);
  });

  it('accepts a close with no body at all', async () => {
    const created = await createProcurementTask();

    await transition(created.id, { toStatus: 2, assignedUserId: ALICE, data: QUOTES }).expect(200);
    await transition(created.id, { toStatus: 3, assignedUserId: ALICE, data: RECEIPT }).expect(200);

    await request(app).post(`/api/tasks/${created.id}/close`).expect(200);
  });

  it('derives direction from the target status, and clears forward data going back', async () => {
    const created = await createProcurementTask();

    await transition(created.id, { toStatus: 2, assignedUserId: BOB, data: QUOTES }).expect(200);
    await transition(created.id, { toStatus: 3, assignedUserId: BOB, data: RECEIPT }).expect(200);

    const back = await transition(created.id, { toStatus: 2, assignedUserId: ALICE }).expect(200);

    expect(back.body).toMatchObject({ status: 2, assignedUserId: ALICE });
    expect((back.body as { data: unknown }).data).toEqual({ '2': QUOTES });

    const found = await request(app).get(`/api/tasks/${created.id}`).expect(200);

    // WF-7b cleared the projection; the log still has what was collected.
    expect(
      (found.body as { transitions: { kind: string }[] }).transitions.map((e) => e.kind),
    ).toEqual(['CREATE', 'FORWARD', 'FORWARD', 'BACKWARD']);
  });
});

describe('GET /api/users/:id/tasks (ADR-012)', () => {
  it('returns open and closed by default and narrows on request', async () => {
    const open = await createProcurementTask();
    const toClose = await createProcurementTask();

    await transition(toClose.id, { toStatus: 2, assignedUserId: ALICE, data: QUOTES }).expect(200);
    await transition(toClose.id, { toStatus: 3, assignedUserId: ALICE, data: RECEIPT }).expect(200);
    await request(app).post(`/api/tasks/${toClose.id}/close`).expect(200);

    const all = await request(app).get(`/api/users/${ALICE}/tasks`).expect(200);
    const onlyOpen = await request(app).get(`/api/users/${ALICE}/tasks?state=OPEN`).expect(200);
    const onlyClosed = await request(app).get(`/api/users/${ALICE}/tasks?state=CLOSED`).expect(200);

    expect(all.body).toHaveLength(2);
    expect((onlyOpen.body as { id: string }[]).map((task) => task.id)).toEqual([open.id]);
    expect((onlyClosed.body as { id: string }[]).map((task) => task.id)).toEqual([toClose.id]);
  });
});

describe('BAD_REQUEST (400) - the request cannot be parsed', () => {
  it('rejects malformed JSON', async () => {
    const response = await request(app)
      .post('/api/tasks')
      .set('Content-Type', 'application/json')
      .send('{"type": ')
      .expect(400);

    expect(response.body).toEqual({
      error: { code: 'BAD_REQUEST', message: 'Request body is not valid JSON' },
    });
  });

  it('rejects a missing field and points at it', async () => {
    const response = await request(app).post('/api/tasks').send({ type: 'PROCUREMENT' }).expect(400);

    expect(response.body).toMatchObject({ error: { code: 'BAD_REQUEST' } });
    expect(
      (response.body as { error: { details: { path: string }[] } }).error.details.map(
        (detail) => detail.path,
      ),
    ).toContain('body.assignedUserId');
  });

  it('rejects a key the endpoint never declared', async () => {
    await request(app)
      .post('/api/tasks')
      .send({ type: 'PROCUREMENT', assignedUserId: ALICE, priority: 'high' })
      .expect(400);
  });

  it('rejects an id that is not a uuid before it can reach the database', async () => {
    const response = await request(app).get('/api/tasks/not-a-uuid').expect(400);

    expect(response.body).toMatchObject({ error: { code: 'BAD_REQUEST' } });
  });

  it('rejects an unrecognised ?state= rather than ignoring it', async () => {
    await request(app).get(`/api/users/${ALICE}/tasks?state=ARCHIVED`).expect(400);
  });

  it('rejects data that is not an object - that is shape, not content', async () => {
    const created = await createProcurementTask();

    await transition(created.id, { toStatus: 2, assignedUserId: BOB, data: 'quotes' }).expect(400);
  });
});

describe('NOT_FOUND (404)', () => {
  it('reports an unknown task type', async () => {
    const response = await request(app)
      .post('/api/tasks')
      .send({ type: 'MARKETING', assignedUserId: ALICE })
      .expect(404);

    expect(response.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('reports an unknown assignee, task and user', async () => {
    await request(app)
      .post('/api/tasks')
      .send({ type: 'PROCUREMENT', assignedUserId: MISSING })
      .expect(404);

    await request(app).get(`/api/tasks/${MISSING}`).expect(404);
    await request(app).get(`/api/users/${MISSING}/tasks`).expect(404);
  });

  it('reports an unmatched route through the same envelope', async () => {
    const response = await request(app).get('/api/nope').expect(404);

    expect(response.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });
});

describe('VALIDATION_FAILED (422) - well formed, but not what the status requires', () => {
  it('rejects a forward move with no data', async () => {
    const created = await createProcurementTask();

    const response = await transition(created.id, { toStatus: 2, assignedUserId: BOB }).expect(422);

    expect(response.body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });

  it('rejects data of the wrong shape and names the field', async () => {
    const created = await createProcurementTask();

    const response = await transition(created.id, {
      toStatus: 2,
      assignedUserId: BOB,
      data: { quotes: ['only one'] },
    }).expect(422);

    expect(
      (response.body as { error: { details: { path: string }[] } }).error.details.map(
        (detail) => detail.path,
      ),
    ).toContain('data.quotes');
  });

  it('rejects a key the task type never declared', async () => {
    const created = await createProcurementTask();

    await transition(created.id, {
      toStatus: 2,
      assignedUserId: BOB,
      data: { ...QUOTES, sneaky: 'value' },
    }).expect(422);
  });
});

describe('INVALID_TRANSITION (409)', () => {
  it('refuses to skip a status, stand still, or leave the range', async () => {
    const created = await createProcurementTask();

    for (const toStatus of [3, 1, 0, 99, 2.5]) {
      const response = await transition(created.id, {
        toStatus,
        assignedUserId: BOB,
        data: RECEIPT,
      }).expect(409);

      expect(response.body).toMatchObject({ error: { code: 'INVALID_TRANSITION' } });
    }
  });

  it('refuses to close before the final status', async () => {
    const created = await createProcurementTask();

    const response = await request(app).post(`/api/tasks/${created.id}/close`).expect(409);

    expect(response.body).toMatchObject({ error: { code: 'INVALID_TRANSITION' } });
  });
});

describe('TASK_CLOSED (409)', () => {
  async function closedTask() {
    const created = await createProcurementTask();

    await transition(created.id, { toStatus: 2, assignedUserId: ALICE, data: QUOTES }).expect(200);
    await transition(created.id, { toStatus: 3, assignedUserId: ALICE, data: RECEIPT }).expect(200);
    await request(app).post(`/api/tasks/${created.id}/close`).expect(200);

    return created;
  }

  it('refuses any move on a closed task', async () => {
    const closed = await closedTask();

    const response = await transition(closed.id, { toStatus: 2, assignedUserId: BOB }).expect(409);

    expect(response.body).toMatchObject({ error: { code: 'TASK_CLOSED' } });
  });

  it('refuses to close twice - not idempotent success (WF-6a)', async () => {
    const closed = await closedTask();

    const response = await request(app).post(`/api/tasks/${closed.id}/close`).expect(409);

    expect(response.body).toMatchObject({ error: { code: 'TASK_CLOSED' } });
  });
});

describe('VERSION_CONFLICT (409)', () => {
  it('refuses a transition built on a stale expectedVersion', async () => {
    const created = await createProcurementTask();

    await transition(created.id, { toStatus: 2, assignedUserId: BOB, data: QUOTES }).expect(200);

    const response = await transition(created.id, {
      toStatus: 3,
      assignedUserId: BOB,
      data: RECEIPT,
      expectedVersion: created.version,
    }).expect(409);

    expect(response.body).toMatchObject({ error: { code: 'VERSION_CONFLICT' } });
  });

  it('accepts a matching expectedVersion, and refuses a stale close', async () => {
    const created = await createProcurementTask();

    await transition(created.id, {
      toStatus: 2,
      assignedUserId: BOB,
      data: QUOTES,
      expectedVersion: 1,
    }).expect(200);

    await transition(created.id, {
      toStatus: 3,
      assignedUserId: BOB,
      data: RECEIPT,
      expectedVersion: 2,
    }).expect(200);

    await request(app)
      .post(`/api/tasks/${created.id}/close`)
      .send({ expectedVersion: 1 })
      .expect(409);
  });
});

describe('INTERNAL_ERROR (500)', () => {
  /** A route that throws something that is not a DomainError - i.e. a bug. */
  function appWithABug(): Express {
    const buggy = express();

    buggy.use(requestId());
    buggy.get('/boom', () => {
      throw new Error('a stack trace nobody outside should ever read');
    });
    buggy.use(errorHandler());

    return buggy;
  }

  it('answers with an envelope and a request id, never with the internal message', async () => {
    const response = await request(appWithABug()).get('/boom').expect(500);

    expect(response.body).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });

    const message = (response.body as { error: { message: string } }).error.message;

    expect(message).not.toContain('stack trace');
    expect(message).toContain(response.headers['x-request-id']);
  });
});

describe('cross-cutting', () => {
  it('stamps every response with a request id', async () => {
    const response = await request(app).get('/api/task-types').expect(200);

    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('does not advertise the framework', async () => {
    const response = await request(app).get('/api/task-types').expect(200);

    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});
