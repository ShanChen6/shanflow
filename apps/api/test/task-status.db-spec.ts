import type { INestApplication } from '@nestjs/common';
import { taskResponseSchema } from '@shanflow/contracts';
import { PrismaService } from '../src/database/prisma.service.js';
import { createTestApp, deleteUsers } from './support/db-test-support.js';
import { teamFixtures } from './support/team-fixtures.js';

describe('task status transitions (database)', () => {
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

  const move = (
    token: string,
    ws: string,
    id: string,
    status: string,
    version: number,
  ) =>
    http()
      .post(`${base(ws)}/${id}/status`)
      .set(auth(token))
      .send({ status, version });
  const stored = (id: string) =>
    prisma.task.findUniqueOrThrow({ where: { id } });

  async function oneTask(body: Record<string, unknown> = {}) {
    const s = await fx.scenario();
    const task = (await fx.createTask(s.owner.token, s.ws, body).expect(201))
      .body.task;
    return { ...s, task, id: task.id as string };
  }

  it('moves a task between TODO and IN_PROGRESS, bumping the version and joining the end of the new lane', async () => {
    const { owner, ws, id } = await oneTask();
    const res = await move(owner.token, ws, id, 'IN_PROGRESS', 1).expect(200);
    expect(taskResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.task).toMatchObject({
      status: 'IN_PROGRESS',
      version: 2,
      completedAt: null,
      position: '1024',
    });
    expect(res.headers['cache-control']).toBe('private, no-store');

    const back = await move(owner.token, ws, id, 'TODO', 2).expect(200);
    expect(back.body.task).toMatchObject({ status: 'TODO', version: 3 });
  });

  describe('completedAt', () => {
    it('is set by the server on entering DONE, and cleared on leaving it', async () => {
      const { owner, ws, id } = await oneTask();
      const before = Date.now();
      const done = await move(owner.token, ws, id, 'DONE', 1).expect(200);
      const completedAt = new Date(done.body.task.completedAt).getTime();
      expect(completedAt).toBeGreaterThanOrEqual(before - 1000);
      expect(completedAt).toBeLessThanOrEqual(Date.now() + 1000);
      expect((await stored(id)).completedAt?.toISOString()).toBe(
        done.body.task.completedAt,
      );

      const reopened = await move(owner.token, ws, id, 'IN_PROGRESS', 2).expect(
        200,
      );
      expect(reopened.body.task).toMatchObject({
        status: 'IN_PROGRESS',
        completedAt: null,
      });
      expect((await stored(id)).completedAt).toBeNull();
    });

    it('gets a new timestamp when a reopened task is completed again', async () => {
      const { owner, ws, id } = await oneTask();
      const first = (await move(owner.token, ws, id, 'DONE', 1).expect(200))
        .body.task.completedAt;
      await move(owner.token, ws, id, 'TODO', 2).expect(200);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const second = (await move(owner.token, ws, id, 'DONE', 3).expect(200))
        .body.task.completedAt;
      expect(new Date(second).getTime()).toBeGreaterThan(
        new Date(first).getTime(),
      );
    });

    it('is cleared by cancelling a finished task, because cancelling is not completing', async () => {
      const { owner, ws, id } = await oneTask();
      await move(owner.token, ws, id, 'DONE', 1).expect(200);
      const res = await move(owner.token, ws, id, 'CANCELED', 2).expect(200);
      expect(res.body.task).toMatchObject({
        status: 'CANCELED',
        completedAt: null,
      });
    });

    it('is never accepted from the client', async () => {
      const { owner, ws, id } = await oneTask();
      await http()
        .post(`${base(ws)}/${id}/status`)
        .set(auth(owner.token))
        .send({
          status: 'DONE',
          version: 1,
          completedAt: '2020-01-01T00:00:00Z',
        })
        .expect(400);
    });
  });

  describe('asking for the status the task already has', () => {
    it('is a harmless no-op: nothing changes, not even the version, rank or completion time', async () => {
      const { owner, ws, id } = await oneTask();
      const done = (await move(owner.token, ws, id, 'DONE', 1).expect(200)).body
        .task;
      await new Promise((resolve) => setTimeout(resolve, 20));
      const again = await move(
        owner.token,
        ws,
        id,
        'DONE',
        done.version,
      ).expect(200);
      expect(again.body.task).toEqual(done);
      expect(await stored(id)).toMatchObject({
        version: done.version,
        completedAt: new Date(done.completedAt),
      });
    });

    it('also holds for a retry that carries an out-of-date version (the desired state is already in place)', async () => {
      const { owner, ws, id } = await oneTask();
      await move(owner.token, ws, id, 'IN_PROGRESS', 1).expect(200);
      const retry = await move(owner.token, ws, id, 'IN_PROGRESS', 1).expect(
        200,
      );
      expect(retry.body.task).toMatchObject({
        status: 'IN_PROGRESS',
        version: 2,
      });
    });
  });

  describe('the status graph', () => {
    const allowed: Array<[string, string]> = [
      ['TODO', 'IN_PROGRESS'],
      ['TODO', 'DONE'],
      ['TODO', 'CANCELED'],
      ['IN_PROGRESS', 'TODO'],
      ['IN_PROGRESS', 'DONE'],
      ['IN_PROGRESS', 'CANCELED'],
      ['DONE', 'TODO'],
      ['DONE', 'IN_PROGRESS'],
      ['DONE', 'CANCELED'],
      ['CANCELED', 'TODO'],
    ];
    const forbidden: Array<[string, string]> = [
      ['CANCELED', 'IN_PROGRESS'],
      ['CANCELED', 'DONE'],
    ];

    /** Puts a task directly in `status` (a valid stored state), then asks the API to move it. */
    async function attempt(from: string, to: string) {
      const { owner, ws, id } = await oneTask();
      await prisma.task.update({
        where: { id },
        data: {
          status: from as never,
          completedAt: from === 'DONE' ? new Date() : null,
        },
      });
      return { res: await move(owner.token, ws, id, to, 1), id };
    }

    it.each(allowed)('allows %s -> %s', async (from, to) => {
      const { res } = await attempt(from, to);
      expect(res.status).toBe(200);
      expect(res.body.task.status).toBe(to);
    });

    it.each(forbidden)(
      'rejects %s -> %s with 409 and changes nothing',
      async (from, to) => {
        const { res, id } = await attempt(from, to);
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('INVALID_STATUS_TRANSITION');
        expect(await stored(id)).toMatchObject({
          status: from,
          version: 1,
        });
      },
    );

    it('lets a cancelled task be reopened through TODO, and only then completed', async () => {
      const { owner, ws, id } = await oneTask();
      await move(owner.token, ws, id, 'CANCELED', 1).expect(200);
      await move(owner.token, ws, id, 'DONE', 2).expect(409);
      await move(owner.token, ws, id, 'TODO', 2).expect(200);
      expect(
        (await move(owner.token, ws, id, 'DONE', 3).expect(200)).body.task
          .status,
      ).toBe('DONE');
    });
  });

  describe('lanes', () => {
    it('puts the task at the end of the destination lane of the same project, leaving other lanes alone', async () => {
      const s = await fx.scenario();
      const project = await prisma.project.create({
        data: { workspaceId: s.ws, name: 'P' },
      });
      const make = async (body: Record<string, unknown>) =>
        (await fx.createTask(s.owner.token, s.ws, body).expect(201)).body.task;
      const inboxTodo = await make({});
      const projectTodo = await make({ projectId: project.id });
      const projectDone1 = await make({ projectId: project.id });
      await move(s.owner.token, s.ws, projectDone1.id, 'DONE', 1).expect(200); // DONE lane of the project: 1024
      const moved = await move(
        s.owner.token,
        s.ws,
        projectTodo.id,
        'DONE',
        1,
      ).expect(200);
      expect(moved.body.task).toMatchObject({
        projectId: project.id,
        position: '2048',
      }); // appended after 1024
      expect((await stored(inboxTodo.id)).position).toBe(1024n); // the Inbox lane is untouched
    });

    it('frees the old rank so another task can take its place', async () => {
      const { owner, ws, id } = await oneTask();
      await move(owner.token, ws, id, 'DONE', 1).expect(200);
      const next = await fx.createTask(owner.token, ws).expect(201);
      expect(next.body.task.position).toBe('1024'); // TODO lane was emptied by the move
    });

    it('keeps ranks unique when several tasks move into the same lane at once', async () => {
      const s = await fx.scenario();
      const ids: string[] = [];
      for (let i = 0; i < 6; i++)
        ids.push(
          (
            await fx
              .createTask(s.owner.token, s.ws, { title: `t${i}` })
              .expect(201)
          ).body.task.id,
        );
      const results = await Promise.all(
        ids.map((id) => move(s.owner.token, s.ws, id, 'IN_PROGRESS', 1)),
      );
      expect(results.map((r) => r.status)).toEqual(Array(6).fill(200));
      const positions = results
        .map((r) => r.body.task.position as string)
        .sort((a, b) => Number(a) - Number(b));
      expect(positions).toEqual(
        Array.from({ length: 6 }, (_, i) => String((i + 1) * 1024)),
      );
    });
  });

  describe('guards', () => {
    it('lets every member move any task', async () => {
      const { member, admin, ws, id } = await oneTask();
      await move(member.token, ws, id, 'IN_PROGRESS', 1).expect(200);
      await move(admin.token, ws, id, 'DONE', 2).expect(200);
    });

    it('rejects a stale version when the status really changes, and lets one of many concurrent moves win', async () => {
      const { owner, ws, id } = await oneTask();
      await move(owner.token, ws, id, 'IN_PROGRESS', 1).expect(200);
      const stale = await move(owner.token, ws, id, 'DONE', 1).expect(409);
      expect(stale.body.code).toBe('TASK_VERSION_CONFLICT');

      const race = await Promise.all(
        ['TODO', 'DONE', 'CANCELED', 'TODO'].map((status) =>
          move(owner.token, ws, id, status, 2),
        ),
      );
      expect(
        race.filter((r) => r.status === 200).length,
      ).toBeGreaterThanOrEqual(1);
      // Every request carried version 2, so exactly one real change (one bump to 3) can have happened.
      expect((await stored(id)).version).toBe(3);
    });

    it('is frozen while the project is archived', async () => {
      const { owner, ws } = await oneTask();
      const project = await prisma.project.create({
        data: { workspaceId: ws, name: 'P' },
      });
      const { id } = (
        await fx
          .createTask(owner.token, ws, { projectId: project.id })
          .expect(201)
      ).body.task;
      await prisma.project.update({
        where: { id: project.id },
        data: { archivedAt: new Date() },
      });
      const res = await move(owner.token, ws, id, 'DONE', 1).expect(409);
      expect(res.body.code).toBe('PROJECT_ARCHIVED');
      expect(await stored(id)).toMatchObject({ status: 'TODO', version: 1 });
    });

    it('answers 401 without a token and 404 to outsiders, deleted tasks, other workspaces and bad ids', async () => {
      const { owner, outsider, ws, id } = await oneTask();
      const other = await fx.scenario();
      const gone = await prisma.task.create({
        data: {
          workspaceId: ws,
          createdById: owner.user.id,
          title: 'Gone',
          position: 9999n,
          deletedAt: new Date(),
        },
      });
      await http()
        .post(`${base(ws)}/${id}/status`)
        .send({ status: 'DONE', version: 1 })
        .expect(401);
      await move(outsider.token, ws, id, 'DONE', 1).expect(404);
      await move(owner.token, ws, gone.id, 'DONE', 1).expect(404);
      await move(other.owner.token, other.ws, id, 'DONE', 1).expect(404);
      await move(owner.token, ws, 'not-a-uuid', 'DONE', 1).expect(404);
      expect(await stored(id)).toMatchObject({ status: 'TODO', version: 1 });
    });

    it('rejects an unknown status, a missing version and extra fields', async () => {
      const { owner, ws, id } = await oneTask();
      for (const body of [
        {},
        { status: 'BLOCKED', version: 1 },
        { status: 'DONE' },
        { status: 'DONE', version: 1, position: '5' },
        { status: 'DONE', version: 1, title: 'x' },
      ]) {
        await http()
          .post(`${base(ws)}/${id}/status`)
          .set(auth(owner.token))
          .send(body)
          .expect(400);
      }
    });
  });
});
