import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/database/prisma.service.js';
import { TaskAssignmentCleanup } from '../src/features/task/shared/task-assignment-cleanup.service.js';
import { createTestApp, deleteUsers } from './support/db-test-support.js';
import { teamFixtures } from './support/team-fixtures.js';

describe('clearing a departing member from tasks (database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cleanup: TaskAssignmentCleanup;
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
    cleanup = app.get(TaskAssignmentCleanup, { strict: false });
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

  const stored = (id: string) =>
    prisma.task.findUniqueOrThrow({ where: { id } });
  const unassign = (workspaceId: string, userId: string) =>
    prisma.$transaction((tx) => cleanup.unassignAll(tx, workspaceId, userId));

  /** Gives `member` one task of every kind a departing member can hold. */
  async function taskKinds() {
    const s = await fx.scenario();
    const project = await prisma.project.create({
      data: { workspaceId: s.ws, name: 'P' },
    });
    const make = async (body: Record<string, unknown>) =>
      (
        await fx
          .createTask(s.owner.token, s.ws, {
            assigneeId: s.member.user.id,
            ...body,
          })
          .expect(201)
      ).body.task.id as string;
    const live = await make({ title: 'live' });
    const finished = await make({ title: 'finished' });
    await http()
      .post(`${base(s.ws)}/${finished}/status`)
      .set(auth(s.owner.token))
      .send({ status: 'DONE', version: 1 })
      .expect(200);
    const deleted = await make({ title: 'deleted' });
    await http()
      .delete(`${base(s.ws)}/${deleted}?version=1`)
      .set(auth(s.owner.token))
      .expect(200);
    const archived = await make({
      title: 'in archived project',
      projectId: project.id,
    });
    await prisma.project.update({
      where: { id: project.id },
      data: { archivedAt: new Date() },
    });
    return { ...s, live, finished, deleted, archived };
  }

  it('clears every task held by the member: live, finished, deleted and in archived projects', async () => {
    const k = await taskKinds();
    const before = await Promise.all(
      [k.live, k.finished, k.deleted, k.archived].map(stored),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(await unassign(k.ws, k.member.user.id)).toBe(4);

    const after = await Promise.all(
      [k.live, k.finished, k.deleted, k.archived].map(stored),
    );
    for (const [i, task] of after.entries()) {
      expect(task.assigneeId).toBeNull();
      expect(task.version).toBe(before[i]!.version + 1);
      expect(task.updatedAt.getTime()).toBeGreaterThan(
        before[i]!.updatedAt.getTime(),
      );
      // Only the assignment changes: status, completion, deletion and rank are exactly as they were.
      expect(task).toMatchObject({
        status: before[i]!.status,
        completedAt: before[i]!.completedAt,
        deletedAt: before[i]!.deletedAt,
        position: before[i]!.position,
      });
    }
  });

  it("leaves other people's tasks, unassigned tasks and the same user's tasks in other workspaces alone", async () => {
    const k = await taskKinds();
    const others = await fx.scenario();
    const byAdmin = (
      await fx
        .createTask(k.owner.token, k.ws, { assigneeId: k.admin.user.id })
        .expect(201)
    ).body.task;
    const unassigned = (
      await fx.createTask(k.owner.token, k.ws, { title: 'free' }).expect(201)
    ).body.task;
    const elsewhere = await prisma.task.create({
      data: {
        workspaceId: others.ws,
        createdById: others.owner.user.id,
        title: 'elsewhere',
        position: 1024n,
        assigneeId: others.member.user.id,
      },
    });

    await unassign(k.ws, k.member.user.id);

    expect(await stored(byAdmin.id)).toMatchObject({
      assigneeId: k.admin.user.id,
      version: 1,
    });
    expect(await stored(unassigned.id)).toMatchObject({
      assigneeId: null,
      version: 1,
    });
    expect(await stored(elsewhere.id)).toMatchObject({
      assigneeId: others.member.user.id,
      version: 1,
    });
  });

  it('is safe to repeat: the second run finds nothing to do', async () => {
    const k = await taskKinds();
    expect(await unassign(k.ws, k.member.user.id)).toBe(4);
    expect(await unassign(k.ws, k.member.user.id)).toBe(0);
    expect((await stored(k.live)).version).toBe(2);
  });

  it('commits or rolls back together with the membership change that caused it', async () => {
    const k = await taskKinds();
    await expect(
      prisma.$transaction(async (tx) => {
        await cleanup.unassignAll(tx, k.ws, k.member.user.id);
        await tx.workspaceMember.updateMany({
          where: { workspaceId: k.ws, userId: k.member.user.id },
          data: { membershipStatus: 'INACTIVE' },
        });
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect((await stored(k.live)).assigneeId).toBe(k.member.user.id);
    expect(
      (
        await prisma.workspaceMember.findFirstOrThrow({
          where: { workspaceId: k.ws, userId: k.member.user.id },
        })
      ).membershipStatus,
    ).toBe('ACTIVE');

    await prisma.$transaction(async (tx) => {
      await cleanup.unassignAll(tx, k.ws, k.member.user.id);
      await tx.workspaceMember.updateMany({
        where: { workspaceId: k.ws, userId: k.member.user.id },
        data: { membershipStatus: 'INACTIVE' },
      });
    });
    expect((await stored(k.live)).assigneeId).toBeNull();
    expect((await stored(k.deleted)).assigneeId).toBeNull();
  });

  it('means a deleted task restored later does not resurrect the revoked assignment', async () => {
    const k = await taskKinds();
    await prisma.$transaction(async (tx) => {
      await cleanup.unassignAll(tx, k.ws, k.member.user.id);
      await tx.workspaceMember.updateMany({
        where: { workspaceId: k.ws, userId: k.member.user.id },
        data: { membershipStatus: 'INACTIVE' },
      });
    });
    const restored = await http()
      .post(`${base(k.ws)}/${k.deleted}/restore`)
      .set(auth(k.owner.token))
      .send({ version: 3 })
      .expect(200);
    expect(restored.body.task.assigneeId).toBeNull();
  });

  it('serialises with other task writers of the workspace', async () => {
    const k = await taskKinds();
    let secondDone = false;
    let second!: Promise<unknown>;
    await prisma.$transaction(async (tx) => {
      await cleanup.unassignAll(tx, k.ws, k.member.user.id);
      second = prisma.$transaction(async (tx2) => {
        await cleanup.unassignAll(tx2, k.ws, k.admin.user.id);
        secondDone = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(secondDone).toBe(false); // waits for the workspace lock held by the first
    });
    await second;
    expect(secondDone).toBe(true);
  });
});
