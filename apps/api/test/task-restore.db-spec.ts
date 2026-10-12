import type { INestApplication } from '@nestjs/common';
import { taskResponseSchema, trashResponseSchema } from '@shanflow/contracts';
import { PrismaService } from '../src/database/prisma.service.js';
import { createTestApp, deleteUsers } from './support/db-test-support.js';
import { teamFixtures } from './support/team-fixtures.js';

describe('task trash and restore (database)', () => {
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

  type Scenario = Awaited<ReturnType<typeof fx.scenario>>;
  const stored = (id: string) =>
    prisma.task.findUniqueOrThrow({ where: { id } });
  const remove = (token: string, ws: string, id: string, version = 1) =>
    http()
      .delete(`${base(ws)}/${id}?version=${version}`)
      .set(auth(token));
  const restore = (
    token: string,
    ws: string,
    id: string,
    version: number | object = 2,
  ) =>
    http()
      .post(`${base(ws)}/${id}/restore`)
      .set(auth(token))
      .send(typeof version === 'number' ? { version } : version);
  const trash = (token: string, ws: string, query = '') =>
    http().get(`/workspaces/${ws}/task-trash${query}`).set(auth(token));
  const status = (
    token: string,
    ws: string,
    id: string,
    to: string,
    version: number,
  ) =>
    http()
      .post(`${base(ws)}/${id}/status`)
      .set(auth(token))
      .send({ status: to, version })
      .expect(200);

  /** Creates a task as `by` and deletes it (as the owner), returning it as it is in the trash (version 2). */
  async function deletedTask(
    s: Scenario,
    by = s.owner,
    body: Record<string, unknown> = {},
  ) {
    const task = (await fx.createTask(by.token, s.ws, body).expect(201)).body
      .task;
    await remove(s.owner.token, s.ws, task.id).expect(200);
    return task.id as string;
  }

  describe('restoring', () => {
    it('brings a deleted task back, keeping what it was and bumping the version', async () => {
      const s = await fx.scenario();
      const id = await deletedTask(s, s.owner, {
        title: 'Back',
        priority: 'HIGH',
        dueAt: '2026-11-01T00:00:00Z',
        description: 'keep',
      });
      const before = await stored(id);
      const res = await restore(s.owner.token, s.ws, id).expect(200);
      expect(taskResponseSchema.safeParse(res.body).success).toBe(true);
      expect(res.body.task).toMatchObject({
        id,
        title: 'Back',
        priority: 'HIGH',
        description: 'keep',
        status: 'TODO',
        deletedAt: null,
        version: 3,
      });
      expect(res.headers['cache-control']).toBe('private, no-store');
      const after = await stored(id);
      expect(after).toMatchObject({
        deletedAt: null,
        dueAt: before.dueAt,
        createdById: before.createdById,
        projectId: null,
      });
      await http()
        .get(`${base(s.ws)}/${id}`)
        .set(auth(s.owner.token))
        .expect(200);
      const list = await http()
        .get(base(s.ws))
        .set(auth(s.owner.token))
        .expect(200);
      expect(list.body.tasks.map((t: { id: string }) => t.id)).toContain(id);
    });

    it('keeps a finished task finished, with its completion time', async () => {
      const s = await fx.scenario();
      const task = (await fx.createTask(s.owner.token, s.ws).expect(201)).body
        .task;
      const done = (await status(s.owner.token, s.ws, task.id, 'DONE', 1)).body
        .task;
      await remove(s.owner.token, s.ws, task.id, 2).expect(200);
      const res = await restore(s.owner.token, s.ws, task.id, 3).expect(200);
      expect(res.body.task).toMatchObject({
        status: 'DONE',
        completedAt: done.completedAt,
        deletedAt: null,
      });
    });
  });

  describe('the rank on return', () => {
    it('is always newly allocated at the end of the lane, so a rank taken in the meantime is no collision', async () => {
      const s = await fx.scenario();
      const first = await deletedTask(s, s.owner, { title: 'first' }); // held rank 1024, now released
      const taker = (
        await fx.createTask(s.owner.token, s.ws, { title: 'taker' }).expect(201)
      ).body.task;
      expect(taker.position).toBe('1024'); // the freed rank was reused by someone else
      const res = await restore(s.owner.token, s.ws, first).expect(200);
      expect(res.body.task.position).toBe('2048'); // appended after the taker, not squeezed into the old slot
      expect((await stored(taker.id)).position).toBe(1024n);
    });

    it('goes after every live task of its own lane only', async () => {
      const s = await fx.scenario();
      const project = await prisma.project.create({
        data: { workspaceId: s.ws, name: 'P' },
      });
      const id = await deletedTask(s, s.owner, { projectId: project.id });
      await status(
        s.owner.token,
        s.ws,
        (
          await fx
            .createTask(s.owner.token, s.ws, { projectId: project.id })
            .expect(201)
        ).body.task.id,
        'IN_PROGRESS',
        1,
      );
      await fx
        .createTask(s.owner.token, s.ws, { projectId: project.id })
        .expect(201); // project TODO lane: 1024
      await fx.createTask(s.owner.token, s.ws).expect(201); // Inbox TODO lane: must not matter
      await fx.createTask(s.owner.token, s.ws).expect(201);
      const res = await restore(s.owner.token, s.ws, id).expect(200);
      expect(res.body.task).toMatchObject({
        projectId: project.id,
        status: 'TODO',
        position: '2048',
      });
    });

    it('gives distinct ranks to tombstones that all held the same rank, even restored at once', async () => {
      const s = await fx.scenario();
      const ids: string[] = [];
      for (let i = 0; i < 4; i++)
        ids.push(await deletedTask(s, s.owner, { title: `t${i}` })); // every one held rank 1024
      expect(
        (await prisma.task.findMany({ where: { id: { in: ids } } })).map(
          (t) => t.position,
        ),
      ).toEqual(Array(4).fill(1024n));
      const results = await Promise.all(
        ids.map((id) => restore(s.owner.token, s.ws, id)),
      );
      expect(results.map((r) => r.status)).toEqual(Array(4).fill(200));
      const ranks = results
        .map((r) => r.body.task.position as string)
        .sort((a, b) => Number(a) - Number(b));
      expect(ranks).toEqual(['1024', '2048', '3072', '4096']);
    });
  });

  describe('idempotency', () => {
    it('answers 200 with the live task and changes nothing when it is already restored', async () => {
      const s = await fx.scenario();
      const id = await deletedTask(s);
      const first = (await restore(s.owner.token, s.ws, id).expect(200)).body
        .task;
      const again = await restore(s.owner.token, s.ws, id).expect(200); // the version it carries is now out of date
      expect(again.body.task).toEqual(first);
      expect(await stored(id)).toMatchObject({ version: 3, deletedAt: null });
    });

    it('restores once when many requests arrive together', async () => {
      const s = await fx.scenario();
      const id = await deletedTask(s);
      const results = await Promise.all(
        Array.from({ length: 6 }, () => restore(s.owner.token, s.ws, id)),
      );
      expect(results.map((r) => r.status)).toEqual(Array(6).fill(200));
      expect(new Set(results.map((r) => r.body.task.position)).size).toBe(1);
      expect((await stored(id)).version).toBe(3);
    });

    it('treats a task that was never deleted as already restored', async () => {
      const s = await fx.scenario();
      const task = (await fx.createTask(s.owner.token, s.ws).expect(201)).body
        .task;
      const res = await restore(s.owner.token, s.ws, task.id, 1).expect(200);
      expect(res.body.task).toEqual(task);
    });
  });

  describe('what must still be valid', () => {
    it('refuses to bring a task back into an archived project, and works once the project is restored', async () => {
      const s = await fx.scenario();
      const project = await prisma.project.create({
        data: { workspaceId: s.ws, name: 'P' },
      });
      const id = await deletedTask(s, s.owner, { projectId: project.id });
      await prisma.project.update({
        where: { id: project.id },
        data: { archivedAt: new Date() },
      });
      const blocked = await restore(s.owner.token, s.ws, id).expect(409);
      expect(blocked.body.code).toBe('PROJECT_ARCHIVED');
      expect((await stored(id)).deletedAt).not.toBeNull();

      await prisma.project.update({
        where: { id: project.id },
        data: { archivedAt: null },
      });
      await restore(s.owner.token, s.ws, id).expect(200);
    });

    it('does not depend on a project for Inbox tasks', async () => {
      const s = await fx.scenario();
      const id = await deletedTask(s);
      expect(
        (await restore(s.owner.token, s.ws, id).expect(200)).body.task
          .projectId,
      ).toBeNull();
    });

    it('rejects a stale version when the task really is deleted', async () => {
      const s = await fx.scenario();
      const id = await deletedTask(s);
      const stale = await restore(s.owner.token, s.ws, id, 1).expect(409);
      expect(stale.body.code).toBe('TASK_VERSION_CONFLICT');
      expect((await stored(id)).deletedAt).not.toBeNull();
    });

    it('clears an assignee who is no longer an active member, and keeps one who is', async () => {
      const s = await fx.scenario();
      const gone = await deletedTask(s, s.owner, {
        title: 'gone',
        assigneeId: s.admin.user.id,
      });
      const kept = await deletedTask(s, s.owner, {
        title: 'kept',
        assigneeId: s.member.user.id,
      });
      const suspended = await deletedTask(s, s.owner, {
        title: 'suspended',
        assigneeId: s.admin.user.id,
      });
      await prisma.workspaceMember.updateMany({
        where: { workspaceId: s.ws, userId: s.admin.user.id },
        data: { membershipStatus: 'INACTIVE' },
      });

      expect(
        (await restore(s.owner.token, s.ws, gone).expect(200)).body.task
          .assigneeId,
      ).toBeNull();
      expect(
        (await restore(s.owner.token, s.ws, suspended).expect(200)).body.task
          .assigneeId,
      ).toBeNull();
      expect(
        (await restore(s.owner.token, s.ws, kept).expect(200)).body.task
          .assigneeId,
      ).toBe(s.member.user.id);
    });

    it('clears an assignee whose account is suspended', async () => {
      const s = await fx.scenario();
      const id = await deletedTask(s, s.owner, {
        assigneeId: s.member.user.id,
      });
      await prisma.user.update({
        where: { id: s.member.user.id },
        data: { accountStatus: 'SUSPENDED' },
      });
      expect(
        (await restore(s.owner.token, s.ws, id).expect(200)).body.task
          .assigneeId,
      ).toBeNull();
    });

    it('still works when the creator has since left the workspace (provenance stays)', async () => {
      const s = await fx.scenario();
      const id = await deletedTask(s, s.member);
      await prisma.workspaceMember.updateMany({
        where: { workspaceId: s.ws, userId: s.member.user.id },
        data: { membershipStatus: 'INACTIVE' },
      });
      const res = await restore(s.owner.token, s.ws, id).expect(200);
      expect(res.body.task.createdById).toBe(s.member.user.id);
    });
  });

  describe('who may restore and see the trash', () => {
    it('lets OWNER and ADMIN restore any task', async () => {
      const s = await fx.scenario();
      const byMember = await deletedTask(s, s.member);
      const byOwner = await deletedTask(s, s.owner);
      await restore(s.admin.token, s.ws, byMember).expect(200);
      await restore(s.owner.token, s.ws, byOwner).expect(200);
    });

    it('lets a plain member restore only what they created; being assigned gives no access to the trash', async () => {
      const s = await fx.scenario();
      const mine = await deletedTask(s, s.member);
      const assignedToMe = await deletedTask(s, s.owner, {
        assigneeId: s.member.user.id,
      });
      await restore(s.member.token, s.ws, mine).expect(200);
      await restore(s.member.token, s.ws, assignedToMe).expect(404);
      expect(
        (await stored(assignedToMe).then((t) => t.deletedAt)) !== null,
      ).toBe(true);
    });

    it('answers 401 without a token and 404 to outsiders, other workspaces and bad ids', async () => {
      const s = await fx.scenario();
      const other = await fx.scenario();
      const id = await deletedTask(s);
      await http()
        .post(`${base(s.ws)}/${id}/restore`)
        .send({ version: 2 })
        .expect(401);
      await restore(s.outsider.token, s.ws, id).expect(404);
      await restore(other.owner.token, other.ws, id).expect(404);
      await restore(s.owner.token, s.ws, 'not-a-uuid').expect(404);
      await restore(
        s.owner.token,
        s.ws,
        '00000000-0000-4000-8000-000000000000',
      ).expect(404);
      expect((await stored(id)).deletedAt).not.toBeNull();
    });

    it('takes effect at once when membership is revoked', async () => {
      const s = await fx.scenario();
      const mine = await deletedTask(s, s.member);
      await prisma.workspaceMember.updateMany({
        where: { workspaceId: s.ws, userId: s.member.user.id },
        data: { membershipStatus: 'INACTIVE' },
      });
      await restore(s.member.token, s.ws, mine).expect(404);
    });

    it('rejects a missing version and any field the server decides', async () => {
      const s = await fx.scenario();
      const id = await deletedTask(s);
      for (const body of [
        {},
        { version: 0 },
        { version: 2, position: '1024' },
        { version: 2, deletedAt: null },
        { version: 2, projectId: null },
        { version: 2, status: 'DONE' },
      ]) {
        await restore(s.owner.token, s.ws, id, body).expect(400);
      }
      expect((await stored(id)).deletedAt).not.toBeNull();
    });
  });

  describe('GET /workspaces/:w/task-trash', () => {
    it('shows managers every tombstone and a plain member only their own, never live tasks', async () => {
      const s = await fx.scenario();
      const ownerOne = await deletedTask(s, s.owner, { title: 'owner one' });
      const memberOne = await deletedTask(s, s.member, { title: 'member one' });
      await fx.createTask(s.owner.token, s.ws, { title: 'live' }).expect(201);

      const asOwner = await trash(s.owner.token, s.ws).expect(200);
      expect(trashResponseSchema.safeParse(asOwner.body).success).toBe(true);
      expect(asOwner.body.tasks.map((t: { id: string }) => t.id)).toEqual([
        memberOne,
        ownerOne,
      ]); // most recently deleted first
      expect(
        asOwner.body.tasks.every(
          (t: { deletedAt: string | null }) => t.deletedAt !== null,
        ),
      ).toBe(true);
      expect(asOwner.headers['cache-control']).toBe('private, no-store');

      expect(
        (await trash(s.admin.token, s.ws).expect(200)).body.tasks,
      ).toHaveLength(2);
      expect(
        (await trash(s.member.token, s.ws).expect(200)).body.tasks.map(
          (t: { id: string }) => t.id,
        ),
      ).toEqual([memberOne]);
    });

    it('is empty rather than revealing anything to a member who deleted nothing, and tracks restores', async () => {
      const s = await fx.scenario();
      const id = await deletedTask(s, s.owner);
      expect(
        (await trash(s.member.token, s.ws).expect(200)).body.tasks,
      ).toEqual([]);
      await restore(s.owner.token, s.ws, id).expect(200);
      expect((await trash(s.owner.token, s.ws).expect(200)).body.tasks).toEqual(
        [],
      );
    });

    it('honours the limit, and rejects bad parameters (it cannot be asked for live tasks)', async () => {
      const s = await fx.scenario();
      for (let i = 0; i < 3; i++)
        await deletedTask(s, s.owner, { title: `t${i}` });
      expect(
        (await trash(s.owner.token, s.ws, '?limit=2').expect(200)).body.tasks,
      ).toHaveLength(2);
      for (const query of [
        '?limit=0',
        '?limit=101',
        '?limit=x',
        '?status=TODO',
        '?includeLive=1',
      ]) {
        await trash(s.owner.token, s.ws, query).expect(400);
      }
    });

    it('answers 401 without a token and 404 to outsiders', async () => {
      const s = await fx.scenario();
      await http().get(`/workspaces/${s.ws}/task-trash`).expect(401);
      await trash(s.outsider.token, s.ws).expect(404);
    });

    it('never shows another workspace tombstones', async () => {
      const s = await fx.scenario();
      const other = await fx.scenario();
      await deletedTask(other);
      expect((await trash(s.owner.token, s.ws).expect(200)).body.tasks).toEqual(
        [],
      );
    });
  });
});
