import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/database/prisma.service.js';
import {
  ProjectArchivedError,
  ProjectNotFoundError,
} from '../src/features/project/project.errors.js';
import {
  InvalidAssigneeError,
  TaskNotFoundError,
} from '../src/features/task/shared/task.errors.js';
import { TaskStore } from '../src/features/task/shared/task-store.service.js';
import { toTask } from '../src/features/task/shared/task.mapper.js';
import {
  appendPosition,
  positionBetween,
} from '../src/features/task/shared/position.js';
import {
  createTestApp,
  createUser,
  deleteUsers,
  type TestUser,
} from './support/db-test-support.js';

describe('task foundation (database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let store: TaskStore;
  const userIds: string[] = [];
  const workspaceIds: string[] = [];

  beforeAll(async () => {
    ({ app } = await createTestApp());
    prisma = app.get(PrismaService);
    store = app.get(TaskStore, { strict: false });
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

  async function workspaceWith(...members: Array<'ADMIN' | 'MEMBER'>) {
    const owner = await createUser(prisma, userIds);
    const others: TestUser[] = [];
    for (const _ of members) others.push(await createUser(prisma, userIds));
    const workspace = await prisma.workspace.create({
      data: {
        name: 'W',
        type: 'TEAM',
        ownerId: owner.id,
        members: {
          create: [
            { userId: owner.id, role: 'OWNER' },
            ...others.map((u, i) => ({ userId: u.id, role: members[i]! })),
          ],
        },
      },
    });
    workspaceIds.push(workspace.id);
    return { owner, others, workspaceId: workspace.id };
  }

  const makeTask = (
    workspaceId: string,
    createdById: string,
    data: Record<string, unknown> = {},
  ) =>
    prisma.task.create({
      data: {
        workspaceId,
        createdById,
        title: 'T',
        position: 1024n,
        ...data,
      } as never,
    });

  it('finds only live tasks of the given workspace', async () => {
    const a = await workspaceWith();
    const b = await workspaceWith();
    const live = await makeTask(a.workspaceId, a.owner.id);
    const deleted = await makeTask(a.workspaceId, a.owner.id, {
      position: 2048n,
      deletedAt: new Date(),
    });

    expect((await store.findLive(prisma, a.workspaceId, live.id)).id).toBe(
      live.id,
    );
    await expect(
      store.findLive(prisma, a.workspaceId, deleted.id),
    ).rejects.toBeInstanceOf(TaskNotFoundError);
    await expect(
      store.findLive(prisma, b.workspaceId, live.id),
    ).rejects.toBeInstanceOf(TaskNotFoundError); // other tenant
    await expect(
      store.findLive(prisma, a.workspaceId, 'not-a-uuid'),
    ).rejects.toBeInstanceOf(TaskNotFoundError);
    expect(
      (await store.findDeleted(prisma, a.workspaceId, deleted.id)).id,
    ).toBe(deleted.id);
    await expect(
      store.findDeleted(prisma, a.workspaceId, live.id),
    ).rejects.toBeInstanceOf(TaskNotFoundError);
  });

  it('accepts Inbox and active projects only', async () => {
    const a = await workspaceWith();
    const b = await workspaceWith();
    const active = await prisma.project.create({
      data: { workspaceId: a.workspaceId, name: 'P' },
    });
    const archived = await prisma.project.create({
      data: { workspaceId: a.workspaceId, name: 'Old', archivedAt: new Date() },
    });
    const foreign = await prisma.project.create({
      data: { workspaceId: b.workspaceId, name: 'F' },
    });

    await expect(
      store.requireEditableProject(prisma, a.workspaceId, null),
    ).resolves.toBeUndefined();
    await expect(
      store.requireEditableProject(prisma, a.workspaceId, active.id),
    ).resolves.toBeUndefined();
    await expect(
      store.requireEditableProject(prisma, a.workspaceId, archived.id),
    ).rejects.toBeInstanceOf(ProjectArchivedError);
    await expect(
      store.requireEditableProject(prisma, a.workspaceId, foreign.id),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
    await expect(
      store.requireEditableProject(prisma, a.workspaceId, 'nope'),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
    await prisma.project.deleteMany({ where: { workspaceId: b.workspaceId } });
  });

  it('requires an ACTIVE member with an ACTIVE account as assignee', async () => {
    const { owner, others, workspaceId } = await workspaceWith(
      'MEMBER',
      'MEMBER',
      'MEMBER',
    );
    const [ok, inactive, suspended] = others as [TestUser, TestUser, TestUser];
    await prisma.workspaceMember.updateMany({
      where: { workspaceId, userId: inactive.id },
      data: { membershipStatus: 'INACTIVE' },
    });
    await prisma.user.update({
      where: { id: suspended.id },
      data: { accountStatus: 'SUSPENDED' },
    });
    const stranger = await createUser(prisma, userIds);

    for (const id of [owner.id, ok.id])
      await expect(
        store.requireActiveAssignee(prisma, workspaceId, id),
      ).resolves.toBeUndefined();
    for (const id of [inactive.id, suspended.id, stranger.id, 'nope'])
      await expect(
        store.requireActiveAssignee(prisma, workspaceId, id),
      ).rejects.toBeInstanceOf(InvalidAssigneeError);
  });

  it('computes lane ranks from live tasks only, per lane', async () => {
    const { owner, workspaceId } = await workspaceWith();
    const project = await prisma.project.create({
      data: { workspaceId, name: 'P' },
    });
    const lane = { workspaceId, projectId: null, status: 'TODO' as const };
    expect(await store.lastPosition(prisma, lane)).toBeNull();

    await makeTask(workspaceId, owner.id, { position: 1024n });
    await makeTask(workspaceId, owner.id, {
      position: 5120n,
      deletedAt: new Date(),
    }); // tombstone holds no rank
    await makeTask(workspaceId, owner.id, { position: 2048n });
    await makeTask(workspaceId, owner.id, {
      position: 9000n,
      status: 'IN_PROGRESS',
    }); // other lane
    await makeTask(workspaceId, owner.id, {
      position: 7000n,
      projectId: project.id,
    }); // other lane
    expect(await store.lastPosition(prisma, lane)).toBe(2048n);
    expect(
      (await store.laneTasks(prisma, lane)).map((t) => t.position),
    ).toEqual([1024n, 2048n]);
    expect(
      await store.lastPosition(prisma, { ...lane, projectId: project.id }),
    ).toBe(7000n);
  });

  it('allocated ranks satisfy the database lane guards, including the same rank freed by a delete', async () => {
    const { owner, workspaceId } = await workspaceWith();
    const lane = { workspaceId, projectId: null, status: 'TODO' as const };
    const first = appendPosition(await store.lastPosition(prisma, lane))!;
    await makeTask(workspaceId, owner.id, { position: first });
    const third = appendPosition(await store.lastPosition(prisma, lane))!;
    const between = positionBetween(first, third)!;
    await makeTask(workspaceId, owner.id, { position: third });
    await makeTask(workspaceId, owner.id, { position: between });
    await expect(
      makeTask(workspaceId, owner.id, { position: between }),
    ).rejects.toThrow(); // strict uniqueness
    expect(
      (await store.laneTasks(prisma, lane)).map((t) => t.position),
    ).toEqual([first, between, third]);
  });

  it('maps rows to the contract with the position as a decimal string', async () => {
    const { owner, workspaceId } = await workspaceWith();
    const row = await makeTask(workspaceId, owner.id, {
      position: 9223372036854775807n,
    });
    const task = toTask(await store.findLive(prisma, workspaceId, row.id));
    expect(task).toMatchObject({
      position: '9223372036854775807',
      version: 1,
      status: 'TODO',
      priority: 'MEDIUM',
      projectId: null,
      deletedAt: null,
    });
    expect(() => JSON.stringify(task)).not.toThrow();
  });

  it('serialises workspace writers with the workspace lock', async () => {
    const { workspaceId } = await workspaceWith();
    let secondEntered = false;
    let second!: Promise<unknown>;
    await prisma.$transaction(async (tx) => {
      await store.lockWorkspace(tx, workspaceId);
      second = prisma.$transaction(async (tx2) => {
        await store.lockWorkspace(tx2, workspaceId);
        secondEntered = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(secondEntered).toBe(false);
    });
    await second;
    expect(secondEntered).toBe(true);
  });
});
