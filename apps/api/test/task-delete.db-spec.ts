import type { INestApplication } from '@nestjs/common';
import {
  listTasksResponseSchema,
  taskResponseSchema,
} from '@shanflow/contracts';
import { PrismaService } from '../src/database/prisma.service.js';
import { createTestApp, deleteUsers } from './support/db-test-support.js';
import { teamFixtures } from './support/team-fixtures.js';

describe('task soft delete (database)', () => {
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

  const remove = (
    token: string,
    ws: string,
    id: string,
    version: number | string = 1,
  ) =>
    http()
      .delete(`${base(ws)}/${id}?version=${version}`)
      .set(auth(token));
  const stored = (id: string) =>
    prisma.task.findUniqueOrThrow({ where: { id } });

  async function oneTask(
    token?: (s: Awaited<ReturnType<typeof fx.scenario>>) => string,
    body: Record<string, unknown> = {},
  ) {
    const s = await fx.scenario();
    const task = (
      await fx
        .createTask(token ? token(s) : s.owner.token, s.ws, body)
        .expect(201)
    ).body.task;
    return { ...s, task, id: task.id as string };
  }

  describe('first delete', () => {
    it('marks the task deleted, bumps the version and answers with the tombstone', async () => {
      const { owner, ws, id } = await oneTask();
      const before = await stored(id);
      const res = await remove(owner.token, ws, id).expect(200);
      expect(taskResponseSchema.safeParse(res.body).success).toBe(true);
      expect(res.body.task).toMatchObject({
        id,
        version: 2,
        deletedAt: expect.any(String),
      });
      expect(res.headers['cache-control']).toBe('private, no-store');

      const after = await stored(id);
      expect(after.deletedAt).toBeInstanceOf(Date);
      expect(after.updatedAt.getTime()).toBeGreaterThan(
        before.updatedAt.getTime(),
      );
    });

    it('never hard-deletes: the row and everything the history needs survive, status untouched', async () => {
      const { owner, ws, id } = await oneTask(undefined, {
        priority: 'HIGH',
        dueAt: '2026-11-01T00:00:00Z',
        description: 'keep',
      });
      await http()
        .post(`${base(ws)}/${id}/status`)
        .set(auth(owner.token))
        .send({ status: 'DONE', version: 1 })
        .expect(200);
      const before = await stored(id);
      await remove(owner.token, ws, id, 2).expect(200);
      const after = await stored(id);
      expect(after).toMatchObject({
        status: 'DONE', // deleting is not cancelling
        completedAt: before.completedAt,
        priority: 'HIGH',
        dueAt: before.dueAt,
        description: 'keep',
        position: before.position,
        createdById: before.createdById,
        projectId: before.projectId,
      });
      expect(await prisma.task.count({ where: { id } })).toBe(1);
    });
  });

  describe('idempotency', () => {
    it('answers 200 with the same tombstone when the task is already deleted, changing nothing', async () => {
      const { owner, ws, id } = await oneTask();
      const first = (await remove(owner.token, ws, id).expect(200)).body.task;
      const rowAfterFirst = await stored(id);
      await new Promise((resolve) => setTimeout(resolve, 20));

      const again = await remove(owner.token, ws, id).expect(200);
      expect(again.body.task).toEqual(first);
      const rowAfterSecond = await stored(id);
      expect(rowAfterSecond.deletedAt).toEqual(rowAfterFirst.deletedAt);
      expect(rowAfterSecond.version).toBe(rowAfterFirst.version);
      expect(rowAfterSecond.updatedAt).toEqual(rowAfterFirst.updatedAt);
    });

    it('is safe to repeat with an out-of-date version, because the desired state already holds', async () => {
      const { owner, ws, id } = await oneTask();
      await remove(owner.token, ws, id, 1).expect(200);
      for (let i = 0; i < 3; i++)
        expect(
          (await remove(owner.token, ws, id, 1).expect(200)).body.task.version,
        ).toBe(2);
    });

    it('lets many simultaneous deletes all succeed and deletes exactly once', async () => {
      const { owner, ws, id } = await oneTask();
      const results = await Promise.all(
        Array.from({ length: 6 }, () => remove(owner.token, ws, id)),
      );
      expect(results.map((r) => r.status)).toEqual(Array(6).fill(200));
      expect(new Set(results.map((r) => r.body.task.deletedAt)).size).toBe(1);
      expect((await stored(id)).version).toBe(2);
    });
  });

  describe('visibility afterwards', () => {
    it('drops the task from the default list, the single read and every other change', async () => {
      const { owner, ws, id } = await oneTask();
      const kept = (
        await fx.createTask(owner.token, ws, { title: 'Kept' }).expect(201)
      ).body.task;
      await remove(owner.token, ws, id).expect(200);

      const list = await http()
        .get(base(ws))
        .set(auth(owner.token))
        .expect(200);
      expect(listTasksResponseSchema.safeParse(list.body).success).toBe(true);
      expect(list.body.tasks.map((t: { id: string }) => t.id)).toEqual([
        kept.id,
      ]);
      await http()
        .get(`${base(ws)}/${id}`)
        .set(auth(owner.token))
        .expect(404);
      await http()
        .patch(`${base(ws)}/${id}`)
        .set(auth(owner.token))
        .send({ version: 2, title: 'x' })
        .expect(404);
      await http()
        .post(`${base(ws)}/${id}/status`)
        .set(auth(owner.token))
        .send({ status: 'DONE', version: 2 })
        .expect(404);
    });

    it('has no filter that brings deleted tasks back into the list', async () => {
      const { owner, ws, id } = await oneTask();
      await remove(owner.token, ws, id).expect(200);
      for (const query of [
        '?deleted=true',
        '?includeDeleted=1',
        '?deletedAt=null',
      ]) {
        await http()
          .get(`${base(ws)}${query}`)
          .set(auth(owner.token))
          .expect(400);
      }
    });
  });

  describe('releasing the rank', () => {
    it('frees the position held by the task, so the lane can use it again', async () => {
      const { owner, ws, id } = await oneTask(); // rank 1024 in the Inbox TODO lane
      await remove(owner.token, ws, id).expect(200);
      const next = await fx
        .createTask(owner.token, ws, { title: 'Next' })
        .expect(201);
      expect(next.body.task.position).toBe('1024'); // the tombstone no longer holds the slot
      expect((await stored(id)).position).toBe(1024n); // the tombstone keeps its historical rank
    });

    it('lets another task move into the freed slot of a status lane', async () => {
      const s = await fx.scenario();
      const a = (
        await fx.createTask(s.owner.token, s.ws, { title: 'a' }).expect(201)
      ).body.task;
      await http()
        .post(`${base(s.ws)}/${a.id}/status`)
        .set(auth(s.owner.token))
        .send({ status: 'DONE', version: 1 })
        .expect(200);
      await remove(s.owner.token, s.ws, a.id, 2).expect(200);
      const b = (
        await fx.createTask(s.owner.token, s.ws, { title: 'b' }).expect(201)
      ).body.task;
      const moved = await http()
        .post(`${base(s.ws)}/${b.id}/status`)
        .set(auth(s.owner.token))
        .send({ status: 'DONE', version: 1 })
        .expect(200);
      expect(moved.body.task.position).toBe('1024');
    });
  });

  describe('who may delete', () => {
    it('lets OWNER and ADMIN delete any task', async () => {
      const { owner, admin, member, ws } = await oneTask();
      const byMember = (
        await fx.createTask(member.token, ws, { title: 'm' }).expect(201)
      ).body.task;
      const byOwner = (
        await fx.createTask(owner.token, ws, { title: 'o' }).expect(201)
      ).body.task;
      await remove(admin.token, ws, byMember.id).expect(200);
      await remove(owner.token, ws, byOwner.id).expect(200);
    });

    it('lets a plain member delete only a task they created; being assigned is not enough', async () => {
      const { owner, member, ws } = await oneTask();
      const mine = (
        await fx.createTask(member.token, ws, { title: 'mine' }).expect(201)
      ).body.task;
      const assignedToMe = (
        await fx
          .createTask(owner.token, ws, {
            title: 'theirs',
            assigneeId: member.user.id,
          })
          .expect(201)
      ).body.task;
      await remove(member.token, ws, mine.id).expect(200);
      await remove(member.token, ws, assignedToMe.id).expect(403);
      expect((await stored(assignedToMe.id)).deletedAt).toBeNull();
    });

    it('keeps the trash invisible to someone who may not delete: a repeated delete is 404 for them, not a hint that it exists', async () => {
      const { owner, member, ws, id } = await oneTask();
      await remove(owner.token, ws, id).expect(200);
      await remove(member.token, ws, id).expect(404);
    });

    it('answers 401 without a token and 404 to outsiders, other workspaces and bad ids', async () => {
      const { outsider, owner, ws, id } = await oneTask();
      const other = await fx.scenario();
      await http()
        .delete(`${base(ws)}/${id}?version=1`)
        .expect(401);
      await remove(outsider.token, ws, id).expect(404);
      await remove(other.owner.token, other.ws, id).expect(404);
      await remove(owner.token, ws, 'not-a-uuid').expect(404);
      await remove(
        owner.token,
        ws,
        '00000000-0000-4000-8000-000000000000',
      ).expect(404);
      expect((await stored(id)).deletedAt).toBeNull();
    });
  });

  describe('guards', () => {
    it('rejects a stale version on the first delete', async () => {
      const { owner, ws, id } = await oneTask();
      await http()
        .patch(`${base(ws)}/${id}`)
        .set(auth(owner.token))
        .send({ version: 1, title: 'Edited' })
        .expect(200);
      const stale = await remove(owner.token, ws, id, 1).expect(409);
      expect(stale.body.code).toBe('TASK_VERSION_CONFLICT');
      expect((await stored(id)).deletedAt).toBeNull();
    });

    it('requires a valid version and refuses any extra parameter', async () => {
      const { owner, ws, id } = await oneTask();
      await http()
        .delete(`${base(ws)}/${id}`)
        .set(auth(owner.token))
        .expect(400);
      for (const query of [
        '?version=abc',
        '?version=0',
        '?version=1&hard=true',
        '?version=1&force=1',
      ]) {
        await http()
          .delete(`${base(ws)}/${id}${query}`)
          .set(auth(owner.token))
          .expect(400);
      }
      expect((await stored(id)).deletedAt).toBeNull();
    });

    it('is frozen while the project is archived, but repeating an earlier delete still succeeds', async () => {
      const s = await fx.scenario();
      const project = await prisma.project.create({
        data: { workspaceId: s.ws, name: 'P' },
      });
      const live = (
        await fx
          .createTask(s.owner.token, s.ws, { projectId: project.id })
          .expect(201)
      ).body.task;
      const deleted = (
        await fx
          .createTask(s.owner.token, s.ws, { projectId: project.id })
          .expect(201)
      ).body.task;
      await remove(s.owner.token, s.ws, deleted.id).expect(200);
      await prisma.project.update({
        where: { id: project.id },
        data: { archivedAt: new Date() },
      });

      const blocked = await remove(s.owner.token, s.ws, live.id).expect(409);
      expect(blocked.body.code).toBe('PROJECT_ARCHIVED');
      expect((await stored(live.id)).deletedAt).toBeNull();
      await remove(s.owner.token, s.ws, deleted.id).expect(200); // nothing changes, so nothing to freeze
    });

    it('takes effect at once when membership is revoked', async () => {
      const { member, ws } = await oneTask();
      const mine = (
        await fx.createTask(member.token, ws, { title: 'mine' }).expect(201)
      ).body.task;
      await prisma.workspaceMember.updateMany({
        where: { workspaceId: ws, userId: member.user.id },
        data: { membershipStatus: 'INACTIVE' },
      });
      await remove(member.token, ws, mine.id).expect(404);
    });
  });
});
