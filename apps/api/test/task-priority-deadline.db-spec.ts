import type { INestApplication } from '@nestjs/common';
import { DUE_AT_MAX, DUE_AT_MIN, TASK_PRIORITIES } from '@shanflow/contracts';
import { PrismaService } from '../src/database/prisma.service.js';
import { createTestApp, deleteUsers } from './support/db-test-support.js';
import { teamFixtures } from './support/team-fixtures.js';

/** The one shape a deadline is answered in everywhere: UTC, milliseconds, Z. */
const UTC_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('task priority and deadline (database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const userIds: string[] = [];
  const workspaceIds: string[] = [];
  const fx = teamFixtures(
    () => app,
    () => prisma,
    userIds,
    workspaceIds,
  );
  const { http, auth, base } = fx;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    prisma = app.get(PrismaService);
  });
  afterEach(async () => {
    const ids = workspaceIds.splice(0);
    await prisma.task.deleteMany({ where: { workspaceId: { in: ids } } });
    await prisma.project.deleteMany({ where: { workspaceId: { in: ids } } });
    await deleteUsers(prisma, userIds);
  });
  afterAll(async () => {
    await app.close();
  });

  const patch = (token: string, ws: string, id: string, body: unknown) =>
    http()
      .patch(`${base(ws)}/${id}`)
      .set(auth(token))
      .send(body as object);
  const stored = (id: string) =>
    prisma.task.findUniqueOrThrow({ where: { id } });

  async function oneTask(body: Record<string, unknown> = {}) {
    const s = await fx.scenario();
    const task = (await fx.createTask(s.owner.token, s.ws, body).expect(201))
      .body.task;
    return { ...s, task, id: task.id as string };
  }

  describe('priority', () => {
    it.each(TASK_PRIORITIES)(
      'can be set to %s, leaving everything else as it was',
      async (priority) => {
        const { owner, ws, id } = await oneTask({
          description: 'keep',
          dueAt: '2026-11-01T00:00:00Z',
        });
        // Start from a different value so the change is real for every case, including MEDIUM.
        const from = priority === 'LOW' ? 'HIGH' : 'LOW';
        await patch(owner.token, ws, id, { version: 1, priority: from }).expect(
          200,
        );
        const res = await patch(owner.token, ws, id, {
          version: 2,
          priority,
        }).expect(200);
        expect(res.body.task).toMatchObject({
          priority,
          version: 3,
          description: 'keep',
          dueAt: '2026-11-01T00:00:00.000Z',
          status: 'TODO',
        });
        expect((await stored(id)).priority).toBe(priority);
      },
    );

    it('defaults to MEDIUM on creation', async () => {
      const { task } = await oneTask();
      expect(task.priority).toBe('MEDIUM');
    });

    it('rejects unknown, lower-case and empty priorities without changing the task', async () => {
      const { owner, ws, id } = await oneTask();
      for (const priority of [
        'high',
        'NOW',
        '',
        null,
        3,
        'MEDIUM ',
        ['HIGH'],
      ]) {
        await patch(owner.token, ws, id, { version: 1, priority }).expect(400);
      }
      expect(await stored(id)).toMatchObject({
        priority: 'MEDIUM',
        version: 1,
      });
    });

    it('can be changed on a finished task without touching its completion', async () => {
      const { owner, ws, id } = await oneTask();
      const done = (
        await http()
          .post(`${base(ws)}/${id}/status`)
          .set(auth(owner.token))
          .send({ status: 'DONE', version: 1 })
          .expect(200)
      ).body.task;
      const res = await patch(owner.token, ws, id, {
        version: 2,
        priority: 'URGENT',
      }).expect(200);
      expect(res.body.task).toMatchObject({
        status: 'DONE',
        completedAt: done.completedAt,
        priority: 'URGENT',
      });
    });

    it('can be changed by any member', async () => {
      const { member, ws, id } = await oneTask();
      await patch(member.token, ws, id, { version: 1, priority: 'LOW' }).expect(
        200,
      );
    });
  });

  describe('deadline', () => {
    it('can be added, moved and removed', async () => {
      const { owner, ws, id } = await oneTask();
      const added = await patch(owner.token, ws, id, {
        version: 1,
        dueAt: '2026-12-01T10:00:00Z',
      }).expect(200);
      expect(added.body.task.dueAt).toBe('2026-12-01T10:00:00.000Z');
      const moved = await patch(owner.token, ws, id, {
        version: 2,
        dueAt: '2026-12-24T18:00:00Z',
      }).expect(200);
      expect(moved.body.task.dueAt).toBe('2026-12-24T18:00:00.000Z');
      const removed = await patch(owner.token, ws, id, {
        version: 3,
        dueAt: null,
      }).expect(200);
      expect(removed.body.task).toMatchObject({ dueAt: null, version: 4 });
      expect((await stored(id)).dueAt).toBeNull();
    });

    it('is left alone when the request does not mention it', async () => {
      const { owner, ws, id } = await oneTask({
        dueAt: '2026-12-01T10:00:00Z',
      });
      const res = await patch(owner.token, ws, id, {
        version: 1,
        title: 'Renamed',
      }).expect(200);
      expect(res.body.task.dueAt).toBe('2026-12-01T10:00:00.000Z');
    });

    it('stores the instant whatever offset it arrives with, and answers in UTC', async () => {
      const { owner, ws, id } = await oneTask();
      const sent = [
        '2026-10-12T09:00:00+07:00',
        '2026-10-11T21:00:00-05:00',
        '2026-10-12T07:30:00+05:30',
        '2026-10-12T02:00:00Z',
      ];
      let version = 1;
      for (const dueAt of sent) {
        // alternate through null so each request is a real change
        const res = await patch(owner.token, ws, id, { version, dueAt }).expect(
          200,
        );
        expect(res.body.task.dueAt).toBe('2026-10-12T02:00:00.000Z');
        expect((await stored(id)).dueAt?.toISOString()).toBe(
          '2026-10-12T02:00:00.000Z',
        );
        version = (
          await patch(owner.token, ws, id, {
            version: res.body.task.version,
            dueAt: null,
          }).expect(200)
        ).body.task.version;
      }
    });

    it('keeps millisecond precision and truncates anything finer', async () => {
      const { owner, ws, id } = await oneTask();
      const res = await patch(owner.token, ws, id, {
        version: 1,
        dueAt: '2026-10-12T02:00:00.123987Z',
      }).expect(200);
      expect(res.body.task.dueAt).toBe('2026-10-12T02:00:00.123Z');
      expect((await stored(id)).dueAt?.getTime()).toBe(
        Date.parse('2026-10-12T02:00:00.123Z'),
      );
    });

    it('accepts a deadline in the past: overdue is a normal state', async () => {
      const { owner, ws, id } = await oneTask();
      const res = await patch(owner.token, ws, id, {
        version: 1,
        dueAt: '2020-01-01T00:00:00Z',
      }).expect(200);
      expect(res.body.task.dueAt).toBe('2020-01-01T00:00:00.000Z');
    });

    it('accepts both ends of the supported range and stores them exactly', async () => {
      const { owner, ws, id } = await oneTask();
      const min = await patch(owner.token, ws, id, {
        version: 1,
        dueAt: DUE_AT_MIN,
      }).expect(200);
      expect(min.body.task.dueAt).toBe(DUE_AT_MIN);
      const max = await patch(owner.token, ws, id, {
        version: 2,
        dueAt: DUE_AT_MAX,
      }).expect(200);
      expect(max.body.task.dueAt).toBe(DUE_AT_MAX);
      expect((await stored(id)).dueAt?.toISOString()).toBe(DUE_AT_MAX);
    });

    it('answers 400, never 500, for dates that cannot be stored or are not instants', async () => {
      const { owner, ws, id } = await oneTask();
      const bad = [
        '2026-10-12',
        '2026-10-12T09:00:00',
        '2026-10-12 09:00:00Z',
        'tomorrow',
        '',
        1760000000,
        '2026-02-30T00:00:00Z',
        '2026-13-01T00:00:00Z',
        '2026-10-12T24:00:00Z',
        '2026-10-12T23:59:60Z',
        '0000-01-01T00:00:00Z',
        '0001-06-01T00:00:00Z',
        '1969-12-31T23:59:59Z',
        '10000-01-01T00:00:00Z',
      ];
      for (const dueAt of bad) {
        const res = await patch(owner.token, ws, id, { version: 1, dueAt });
        expect([dueAt, res.status]).toEqual([dueAt, 400]);
      }
      for (const dueAt of [
        '2026-02-30T00:00:00Z',
        '0000-01-01T00:00:00Z',
        '2026-10-12',
      ]) {
        await fx.createTask(owner.token, ws, { dueAt }).expect(400);
      }
      expect(await stored(id)).toMatchObject({ dueAt: null, version: 1 });
    });

    it('is normalised the same way when a task is created', async () => {
      const { owner, ws } = await oneTask();
      const res = await fx
        .createTask(owner.token, ws, { dueAt: '2026-10-12T09:00:00+07:00' })
        .expect(201);
      expect(res.body.task.dueAt).toBe('2026-10-12T02:00:00.000Z');
    });
  });

  describe('one format everywhere', () => {
    it('answers every deadline, completion and deletion time as UTC with milliseconds from every endpoint', async () => {
      const { owner, ws, id } = await oneTask({
        dueAt: '2026-10-12T09:00:00+07:00',
      });
      const done = await http()
        .post(`${base(ws)}/${id}/status`)
        .set(auth(owner.token))
        .send({ status: 'DONE', version: 1 })
        .expect(200);
      const fromGet = await http()
        .get(`${base(ws)}/${id}`)
        .set(auth(owner.token))
        .expect(200);
      const fromList = await http()
        .get(base(ws))
        .set(auth(owner.token))
        .expect(200);
      const removed = await http()
        .delete(`${base(ws)}/${id}?version=2`)
        .set(auth(owner.token))
        .expect(200);
      const fromTrash = await http()
        .get(`/workspaces/${ws}/task-trash`)
        .set(auth(owner.token))
        .expect(200);
      const restored = await http()
        .post(`${base(ws)}/${id}/restore`)
        .set(auth(owner.token))
        .send({ version: 3 })
        .expect(200);

      const tasks = [
        done.body.task,
        fromGet.body.task,
        fromList.body.tasks[0],
        removed.body.task,
        fromTrash.body.tasks[0],
        restored.body.task,
      ];
      for (const task of tasks) {
        expect(task.dueAt).toBe('2026-10-12T02:00:00.000Z');
        for (const field of ['createdAt', 'updatedAt', 'completedAt'] as const)
          expect(task[field]).toMatch(UTC_MILLIS);
      }
      expect(removed.body.task.deletedAt).toMatch(UTC_MILLIS);
      expect(fromTrash.body.tasks[0].deletedAt).toMatch(UTC_MILLIS);
    });
  });

  describe('changing nothing', () => {
    it('is a harmless no-op: same priority and deadline leave the version and timestamps alone', async () => {
      const { owner, ws, id } = await oneTask({
        priority: 'HIGH',
        dueAt: '2026-12-01T10:00:00Z',
      });
      const before = await stored(id);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const res = await patch(owner.token, ws, id, {
        version: 1,
        priority: 'HIGH',
        dueAt: '2026-12-01T17:00:00+07:00',
      }).expect(200);
      expect(res.body.task).toMatchObject({
        version: 1,
        priority: 'HIGH',
        dueAt: '2026-12-01T10:00:00.000Z',
      });
      const after = await stored(id);
      expect(after.version).toBe(1);
      expect(after.updatedAt).toEqual(before.updatedAt);
    });

    it('is safe to retry: the same edit sent again with the now-stale version still succeeds', async () => {
      const { owner, ws, id } = await oneTask();
      const first = await patch(owner.token, ws, id, {
        version: 1,
        priority: 'URGENT',
        dueAt: '2026-12-01T10:00:00Z',
      }).expect(200);
      const retry = await patch(owner.token, ws, id, {
        version: 1,
        priority: 'URGENT',
        dueAt: '2026-12-01T10:00:00Z',
      }).expect(200);
      expect(retry.body.task).toEqual(first.body.task);
      expect((await stored(id)).version).toBe(2);
    });

    it('is still a real change, counted once, when only some fields differ', async () => {
      const { owner, ws, id } = await oneTask({ priority: 'HIGH' });
      const res = await patch(owner.token, ws, id, {
        version: 1,
        priority: 'HIGH',
        dueAt: '2026-12-01T10:00:00Z',
      }).expect(200);
      expect(res.body.task).toMatchObject({
        version: 2,
        priority: 'HIGH',
        dueAt: '2026-12-01T10:00:00.000Z',
      });
    });

    it('still rejects a stale version when the edit would change something', async () => {
      const { owner, ws, id } = await oneTask();
      await patch(owner.token, ws, id, { version: 1, priority: 'LOW' }).expect(
        200,
      );
      const stale = await patch(owner.token, ws, id, {
        version: 1,
        priority: 'URGENT',
      }).expect(409);
      expect(stale.body.code).toBe('TASK_VERSION_CONFLICT');
      expect((await stored(id)).priority).toBe('LOW');
    });

    it('lets several identical concurrent edits all succeed with a single change', async () => {
      const { owner, ws, id } = await oneTask();
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          patch(owner.token, ws, id, {
            version: 1,
            priority: 'URGENT',
            dueAt: '2026-12-01T10:00:00Z',
          }),
        ),
      );
      expect(results.map((r) => r.status)).toEqual(Array(6).fill(200));
      expect((await stored(id)).version).toBe(2);
    });
  });

  describe('guards', () => {
    it('is frozen while the project is archived, even for these fields', async () => {
      const s = await fx.scenario();
      const project = await prisma.project.create({
        data: { workspaceId: s.ws, name: 'P' },
      });
      const { id } = (
        await fx
          .createTask(s.owner.token, s.ws, { projectId: project.id })
          .expect(201)
      ).body.task;
      await prisma.project.update({
        where: { id: project.id },
        data: { archivedAt: new Date() },
      });
      const res = await patch(s.owner.token, s.ws, id, {
        version: 1,
        priority: 'URGENT',
        dueAt: '2026-12-01T10:00:00Z',
      }).expect(409);
      expect(res.body.code).toBe('PROJECT_ARCHIVED');
      expect(await stored(id)).toMatchObject({
        priority: 'MEDIUM',
        dueAt: null,
      });
    });

    it('answers 404 to outsiders and for deleted tasks', async () => {
      const { owner, outsider, ws, id } = await oneTask();
      await patch(outsider.token, ws, id, {
        version: 1,
        priority: 'LOW',
      }).expect(404);
      await http()
        .delete(`${base(ws)}/${id}?version=1`)
        .set(auth(owner.token))
        .expect(200);
      await patch(owner.token, ws, id, { version: 2, priority: 'LOW' }).expect(
        404,
      );
    });
  });
});
