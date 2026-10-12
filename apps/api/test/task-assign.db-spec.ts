import type { INestApplication } from '@nestjs/common';
import { taskResponseSchema } from '@shanflow/contracts';
import { PrismaService } from '../src/database/prisma.service.js';
import { createTestApp, deleteUsers } from './support/db-test-support.js';
import { teamFixtures } from './support/team-fixtures.js';

describe('task assignment (database)', () => {
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

  const assign = (
    token: string,
    ws: string,
    id: string,
    assigneeId: string | null,
    version = 1,
  ) =>
    http()
      .put(`${base(ws)}/${id}/assignee`)
      .set(auth(token))
      .send({ assigneeId, version });
  const stored = (id: string) =>
    prisma.task.findUniqueOrThrow({ where: { id } });

  async function oneTask(
    body: Record<string, unknown> = {},
    by: 'owner' | 'member' = 'owner',
  ) {
    const s = await fx.scenario();
    const task = (await fx.createTask(s[by].token, s.ws, body).expect(201)).body
      .task;
    return { ...s, task, id: task.id as string };
  }

  describe('assigning, changing hands and clearing', () => {
    it('lets a manager give a task to an active member, changing nothing else', async () => {
      const { owner, member, ws, id } = await oneTask({
        priority: 'HIGH',
        dueAt: '2026-12-01T10:00:00Z',
      });
      const before = await stored(id);
      const res = await assign(owner.token, ws, id, member.user.id).expect(200);
      expect(taskResponseSchema.safeParse(res.body).success).toBe(true);
      expect(res.body.task).toMatchObject({
        assigneeId: member.user.id,
        version: 2,
        status: 'TODO',
        priority: 'HIGH',
        position: '1024',
      });
      expect(res.headers['cache-control']).toBe('private, no-store');
      const after = await stored(id);
      expect(after).toMatchObject({
        assigneeId: member.user.id,
        dueAt: before.dueAt,
        createdById: before.createdById,
        position: before.position,
      });
    });

    it('moves a task from one person to another, and back to nobody with null', async () => {
      const { owner, admin, member, ws, id } = await oneTask();
      await assign(owner.token, ws, id, member.user.id, 1).expect(200);
      const moved = await assign(admin.token, ws, id, admin.user.id, 2).expect(
        200,
      );
      expect(moved.body.task).toMatchObject({
        assigneeId: admin.user.id,
        version: 3,
      });
      const cleared = await assign(owner.token, ws, id, null, 3).expect(200);
      expect(cleared.body.task).toMatchObject({ assigneeId: null, version: 4 });
      expect((await stored(id)).assigneeId).toBeNull();
    });

    it('works on a finished task without touching its completion', async () => {
      const { owner, member, ws, id } = await oneTask();
      const done = (
        await http()
          .post(`${base(ws)}/${id}/status`)
          .set(auth(owner.token))
          .send({ status: 'DONE', version: 1 })
          .expect(200)
      ).body.task;
      const res = await assign(owner.token, ws, id, member.user.id, 2).expect(
        200,
      );
      expect(res.body.task).toMatchObject({
        status: 'DONE',
        completedAt: done.completedAt,
        assigneeId: member.user.id,
      });
    });

    it('shows up in the list filters', async () => {
      const { owner, member, ws, id } = await oneTask();
      await fx.createTask(owner.token, ws, { title: 'other' }).expect(201);
      await assign(owner.token, ws, id, member.user.id).expect(200);
      const mine = await http()
        .get(`${base(ws)}?assigneeId=${member.user.id}`)
        .set(auth(owner.token))
        .expect(200);
      expect(mine.body.tasks.map((t: { id: string }) => t.id)).toEqual([id]);
      const free = await http()
        .get(`${base(ws)}?assigneeId=unassigned`)
        .set(auth(owner.token))
        .expect(200);
      expect(free.body.tasks.map((t: { id: string }) => t.id)).not.toContain(
        id,
      );
    });
  });

  describe('idempotency', () => {
    it('is a no-op when the task already has that assignee, even with an out-of-date version', async () => {
      const { owner, member, ws, id } = await oneTask();
      const first = (
        await assign(owner.token, ws, id, member.user.id, 1).expect(200)
      ).body.task;
      const before = await stored(id);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const retry = await assign(owner.token, ws, id, member.user.id, 1).expect(
        200,
      );
      expect(retry.body.task).toEqual(first);
      const after = await stored(id);
      expect(after.version).toBe(2);
      expect(after.updatedAt).toEqual(before.updatedAt);
    });

    it('treats clearing an unassigned task as already done', async () => {
      const { owner, ws, id, task } = await oneTask();
      const res = await assign(owner.token, ws, id, null, 1).expect(200);
      expect(res.body.task).toEqual(task);
    });

    it('lets many identical concurrent requests all succeed with one change', async () => {
      const { owner, member, ws, id } = await oneTask();
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          assign(owner.token, ws, id, member.user.id),
        ),
      );
      expect(results.map((r) => r.status)).toEqual(Array(6).fill(200));
      expect((await stored(id)).version).toBe(2);
    });

    it('lets only one of several competing assignments with the same version win', async () => {
      const { owner, admin, member, ws, id } = await oneTask();
      const results = await Promise.all(
        [admin.user.id, member.user.id, owner.user.id, admin.user.id].map(
          (who) => assign(owner.token, ws, id, who),
        ),
      );
      expect(
        results.filter((r) => r.status === 200).length,
      ).toBeGreaterThanOrEqual(1);
      expect((await stored(id)).version).toBe(2); // exactly one real change from version 1
      expect(
        results.filter((r) => r.status !== 200).every((r) => r.status === 409),
      ).toBe(true);
    });

    it('rejects a stale version when the assignment would really change', async () => {
      const { owner, admin, member, ws, id } = await oneTask();
      await assign(owner.token, ws, id, member.user.id, 1).expect(200);
      const stale = await assign(owner.token, ws, id, admin.user.id, 1).expect(
        409,
      );
      expect(stale.body.code).toBe('TASK_VERSION_CONFLICT');
      expect((await stored(id)).assigneeId).toBe(member.user.id);
    });
  });

  describe('who may assign (the permission matrix)', () => {
    it('lets a plain member take an unassigned task for themselves and give it up again', async () => {
      const { member, ws, id } = await oneTask();
      expect(
        (await assign(member.token, ws, id, member.user.id, 1).expect(200)).body
          .task.assigneeId,
      ).toBe(member.user.id);
      expect(
        (await assign(member.token, ws, id, null, 2).expect(200)).body.task
          .assigneeId,
      ).toBeNull();
    });

    it('stops a plain member from assigning someone else', async () => {
      const { owner, member, ws, id } = await oneTask();
      await assign(member.token, ws, id, owner.user.id).expect(403);
      expect((await stored(id)).assigneeId).toBeNull();
    });

    it("stops a plain member from taking over, handing on or clearing another person's task", async () => {
      const { owner, admin, member, ws, id } = await oneTask();
      await assign(owner.token, ws, id, admin.user.id, 1).expect(200);
      await assign(member.token, ws, id, member.user.id, 2).expect(403); // take over
      await assign(member.token, ws, id, null, 2).expect(403); // clear someone else's
      await assign(member.token, ws, id, owner.user.id, 2).expect(403);
      expect(await stored(id)).toMatchObject({
        assigneeId: admin.user.id,
        version: 2,
      });
    });

    it('stops a plain member from passing their own task to someone else', async () => {
      const { owner, member, ws, id } = await oneTask();
      await assign(member.token, ws, id, member.user.id, 1).expect(200);
      await assign(member.token, ws, id, owner.user.id, 2).expect(403);
      expect((await stored(id)).assigneeId).toBe(member.user.id);
    });

    it('lets ADMIN assign anyone too', async () => {
      const { admin, member, ws, id } = await oneTask();
      await assign(admin.token, ws, id, member.user.id).expect(200);
    });

    it('does not let being the creator grant more than the role does', async () => {
      const { owner, member, ws, id } = await oneTask({}, 'member'); // the member created it
      await assign(member.token, ws, id, owner.user.id).expect(403);
    });
  });

  describe('who can be assigned', () => {
    it('refuses anyone who is not an active member of this workspace', async () => {
      const { owner, admin, member, outsider, ws, id } = await oneTask();
      await prisma.workspaceMember.updateMany({
        where: { workspaceId: ws, userId: admin.user.id },
        data: { membershipStatus: 'INACTIVE' },
      });
      await prisma.user.update({
        where: { id: member.user.id },
        data: { accountStatus: 'SUSPENDED' },
      });
      for (const who of [
        admin.user.id,
        member.user.id,
        outsider.user.id,
        '00000000-0000-4000-8000-000000000000',
      ]) {
        const res = await assign(owner.token, ws, id, who).expect(422);
        expect(res.body.code).toBe('INVALID_ASSIGNEE');
      }
      expect(await stored(id)).toMatchObject({ assigneeId: null, version: 1 });
    });

    it('can be assigned again once membership is reactivated', async () => {
      const { owner, admin, ws, id } = await oneTask();
      await prisma.workspaceMember.updateMany({
        where: { workspaceId: ws, userId: admin.user.id },
        data: { membershipStatus: 'INACTIVE' },
      });
      await assign(owner.token, ws, id, admin.user.id).expect(422);
      await prisma.workspaceMember.updateMany({
        where: { workspaceId: ws, userId: admin.user.id },
        data: { membershipStatus: 'ACTIVE' },
      });
      await assign(owner.token, ws, id, admin.user.id).expect(200);
    });
  });

  describe('when the assignee leaves or is deactivated', () => {
    it('lets a manager clear or reassign a task still held by an inactive member', async () => {
      const { owner, member, admin, ws, id } = await oneTask();
      await assign(owner.token, ws, id, member.user.id).expect(200);
      await prisma.workspaceMember.updateMany({
        where: { workspaceId: ws, userId: member.user.id },
        data: { membershipStatus: 'INACTIVE' },
      });
      expect(
        (await assign(owner.token, ws, id, admin.user.id, 2).expect(200)).body
          .task.assigneeId,
      ).toBe(admin.user.id);

      await prisma.workspaceMember.updateMany({
        where: { workspaceId: ws, userId: admin.user.id },
        data: { membershipStatus: 'INACTIVE' },
      });
      expect(
        (await assign(owner.token, ws, id, null, 3).expect(200)).body.task
          .assigneeId,
      ).toBeNull();
    });

    it('leaves the departed member with no access of their own', async () => {
      const { owner, member, ws, id } = await oneTask();
      await assign(owner.token, ws, id, member.user.id).expect(200);
      await prisma.workspaceMember.updateMany({
        where: { workspaceId: ws, userId: member.user.id },
        data: { membershipStatus: 'INACTIVE' },
      });
      await assign(member.token, ws, id, null, 2).expect(404); // cannot even give the task up
      await http()
        .get(`${base(ws)}/${id}`)
        .set(auth(member.token))
        .expect(404);
    });
  });

  describe('guards', () => {
    it('is frozen while the project is archived', async () => {
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
      const res = await assign(
        s.owner.token,
        s.ws,
        id,
        s.member.user.id,
      ).expect(409);
      expect(res.body.code).toBe('PROJECT_ARCHIVED');
      expect((await stored(id)).assigneeId).toBeNull();
    });

    it('answers 401 without a token and 404 to outsiders, deleted tasks, other workspaces and bad ids', async () => {
      const { owner, member, outsider, ws, id } = await oneTask();
      const other = await fx.scenario();
      await http()
        .put(`${base(ws)}/${id}/assignee`)
        .send({ assigneeId: null, version: 1 })
        .expect(401);
      await assign(outsider.token, ws, id, member.user.id).expect(404);
      await assign(other.owner.token, other.ws, id, null).expect(404);
      await assign(owner.token, ws, 'not-a-uuid', null).expect(404);
      await http()
        .delete(`${base(ws)}/${id}?version=1`)
        .set(auth(owner.token))
        .expect(200);
      await assign(owner.token, ws, id, member.user.id, 2).expect(404);
    });

    it('rejects a missing assigneeId (never read as "clear"), a non-user value, a bad version and extra fields', async () => {
      const { owner, member, ws, id } = await oneTask();
      for (const body of [
        { version: 1 },
        { assigneeId: 'me', version: 1 },
        { assigneeId: member.user.id },
        { assigneeId: member.user.id, version: 0 },
        { assigneeId: member.user.id, version: 1, status: 'DONE' },
      ]) {
        await http()
          .put(`${base(ws)}/${id}/assignee`)
          .set(auth(owner.token))
          .send(body)
          .expect(400);
      }
      expect((await stored(id)).assigneeId).toBeNull();
    });

    it('does not accept an assignee through create-time or edit-time shortcuts it should not', async () => {
      const { owner, member, ws, id } = await oneTask();
      await http()
        .patch(`${base(ws)}/${id}`)
        .set(auth(owner.token))
        .send({ version: 1, assigneeId: member.user.id })
        .expect(400);
    });
  });
});
