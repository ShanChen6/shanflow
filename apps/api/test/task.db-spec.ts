import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';

config({
  path: fileURLToPath(new URL('../../../.env', import.meta.url)),
  quiet: true,
});

function assertLocalRuntime(): void {
  try {
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (
      process.env.NODE_ENV === 'production' ||
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      Number(url.port || 5432) !== Number(process.env.POSTGRES_PORT || 5432) ||
      decodeURIComponent(url.username) !== 'shanflow_app' ||
      decodeURIComponent(url.pathname.slice(1)) !== 'shanflow' ||
      [...url.searchParams].some(
        ([key, value]) => key !== 'schema' || value !== 'public',
      )
    ) {
      throw new Error();
    }
  } catch {
    throw new Error('Task tests require local shanflow_app/shanflow/public.');
  }
}

describe('Task database integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let user1: string;
  let user2: string;
  let assignee: string;
  let workspace1: string;
  let workspace2: string;
  let project1: string;
  let project2: string;
  let otherProject: string;
  let taskIds: string[];

  beforeAll(async () => {
    assertLocalRuntime();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    const [identity] = await prisma.$queryRaw<
      Array<{ role: string; db: string; elevated: boolean; ddl: boolean }>
    >`
      SELECT current_user AS role, current_database() AS db,
        (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AS elevated,
        has_schema_privilege(current_user, 'public', 'CREATE') AS ddl
      FROM pg_roles WHERE rolname = current_user
    `;
    expect(identity).toEqual({
      role: 'shanflow_app',
      db: 'shanflow',
      elevated: false,
      ddl: false,
    });
  });

  beforeEach(async () => {
    [
      user1,
      user2,
      assignee,
      workspace1,
      workspace2,
      project1,
      project2,
      otherProject,
    ] = Array.from({ length: 8 }, () => randomUUID());
    taskIds = [];
    await prisma.$transaction(async (tx) => {
      for (const id of [user1, user2, assignee]) {
        await tx.user.create({
          data: {
            id,
            email: `task.${id}@example.invalid`,
            displayName: 'Task fixture',
          },
        });
      }
      await tx.workspace.create({
        data: {
          id: workspace1,
          ownerId: user1,
          name: 'Task workspace 1',
          type: 'TEAM',
        },
      });
      await tx.workspace.create({
        data: {
          id: workspace2,
          ownerId: user2,
          name: 'Task workspace 2',
          type: 'TEAM',
        },
      });
      await tx.workspaceMember.create({
        data: {
          id: randomUUID(),
          workspaceId: workspace1,
          userId: user1,
          role: 'OWNER',
        },
      });
      await tx.workspaceMember.create({
        data: { id: randomUUID(), workspaceId: workspace1, userId: assignee },
      });
      await tx.workspaceMember.create({
        data: {
          id: randomUUID(),
          workspaceId: workspace2,
          userId: user2,
          role: 'OWNER',
        },
      });
      await tx.project.create({
        data: { id: project1, workspaceId: workspace1, name: 'Project 1' },
      });
      await tx.project.create({
        data: { id: project2, workspaceId: workspace1, name: 'Project 2' },
      });
      await tx.project.create({
        data: {
          id: otherProject,
          workspaceId: workspace2,
          name: 'Other project',
        },
      });
    });
  });

  afterEach(async () => {
    await prisma.$transaction(async (tx) => {
      await tx.task.deleteMany({ where: { id: { in: taskIds } } });
      await tx.project.deleteMany({
        where: { id: { in: [project1, project2, otherProject] } },
      });
      await tx.workspaceMember.deleteMany({
        where: { workspaceId: { in: [workspace1, workspace2] } },
      });
      await tx.workspace.deleteMany({
        where: { id: { in: [workspace1, workspace2] } },
      });
      await tx.user.deleteMany({
        where: { id: { in: [user1, user2, assignee] } },
      });
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  function taskId(): string {
    const id = randomUUID();
    taskIds.push(id);
    return id;
  }

  function baseTask(
    overrides: Partial<{
      id: string;
      workspaceId: string;
      projectId: string | null;
      title: string;
      description: string | null;
      status: 'TODO' | 'IN_PROGRESS' | 'DONE' | 'CANCELED';
      priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
      dueAt: Date | null;
      assigneeId: string | null;
      createdById: string;
      position: bigint;
      version: number;
      completedAt: Date | null;
      deletedAt: Date | null;
      updatedAt: Date;
    }> = {},
  ) {
    return {
      id: taskId(),
      workspaceId: workspace1,
      title: 'Task fixture',
      createdById: user1,
      position: 1024n,
      ...overrides,
    };
  }

  it('creates, reads, updates and deletes with UUID/default/timestamp mappings', async () => {
    const past = new Date('2020-01-01T00:00:00.000Z');
    const dueAt = new Date('2026-10-13T09:30:00.123Z');
    const task = await prisma.task.create({
      data: baseTask({
        projectId: project1,
        description: 'Description',
        dueAt,
        assigneeId: assignee,
        updatedAt: past,
      }),
    });
    expect(task.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(task).toMatchObject({
      projectId: project1,
      status: 'TODO',
      priority: 'MEDIUM',
      position: 1024n,
      version: 1,
      completedAt: null,
      deletedAt: null,
      dueAt,
      assigneeId: assignee,
    });
    expect(task.createdAt).toBeInstanceOf(Date);
    expect(task.updatedAt).toEqual(past);
    const read = await prisma.task.findUniqueOrThrow({
      where: { workspaceId_id: { workspaceId: workspace1, id: task.id } },
      include: {
        workspace: true,
        project: true,
        creatorMembership: true,
        assigneeMembership: true,
      },
    });
    expect(read.workspace.id).toBe(workspace1);
    expect(read.project?.id).toBe(project1);
    expect(read.creatorMembership.userId).toBe(user1);
    expect(read.assigneeMembership?.userId).toBe(assignee);
    const updated = await prisma.task.update({
      where: { id: task.id },
      data: {
        title: 'Updated',
        description: null,
        priority: 'HIGH',
        version: 2,
      },
    });
    expect(updated).toMatchObject({
      title: 'Updated',
      description: null,
      priority: 'HIGH',
      version: 2,
    });
    expect(updated.updatedAt.getTime()).toBeGreaterThan(past.getTime());
    await prisma.task.delete({ where: { id: task.id } });
    expect(await prisma.task.findUnique({ where: { id: task.id } })).toBeNull();
  });

  it('creates and queries Inbox Tasks without a fake Project', async () => {
    const task = await prisma.task.create({
      data: baseTask({ projectId: null }),
    });
    expect(task.projectId).toBeNull();
    expect(task.workspaceId).toBe(workspace1);
    expect(
      await prisma.task.findMany({
        where: { workspaceId: workspace1, projectId: null, deletedAt: null },
      }),
    ).toHaveLength(1);
  });

  it('enforces same-workspace Project and valid Workspace/Project references', async () => {
    await expect(
      prisma.task.create({
        data: baseTask({
          workspaceId: workspace2,
          projectId: project1,
          createdById: user2,
        }),
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      prisma.task.create({ data: baseTask({ workspaceId: randomUUID() }) }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      prisma.task.create({ data: baseTask({ projectId: randomUUID() }) }),
    ).rejects.toMatchObject({ code: 'P2003' });
    const valid = await prisma.task.create({
      data: baseTask({ projectId: project1 }),
    });
    expect(valid.projectId).toBe(project1);
  });

  it('enforces creator/assignee membership scope but not ACTIVE status', async () => {
    await expect(
      prisma.task.create({ data: baseTask({ createdById: randomUUID() }) }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      prisma.task.create({ data: baseTask({ assigneeId: user2 }) }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await prisma.workspaceMember.update({
      where: {
        workspaceId_userId: { workspaceId: workspace1, userId: assignee },
      },
      data: { membershipStatus: 'INACTIVE' },
    });
    const accepted = await prisma.task.create({
      data: baseTask({ assigneeId: assignee }),
    });
    expect(accepted.assigneeId).toBe(assignee);
  });

  it('accepts every approved status and priority with valid completion state', async () => {
    const statuses = ['TODO', 'IN_PROGRESS', 'DONE', 'CANCELED'] as const;
    const priorities = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
    for (let index = 0; index < statuses.length; index++) {
      const status = statuses[index];
      const task = await prisma.task.create({
        data: baseTask({
          status,
          priority: priorities[index],
          position: BigInt((index + 1) * 1024),
          completedAt: status === 'DONE' ? new Date() : null,
        }),
      });
      expect(task).toMatchObject({ status, priority: priorities[index] });
    }
  });

  it.each([
    ['DONE without completedAt', 'DONE', null],
    ['TODO with completedAt', 'TODO', new Date()],
    ['IN_PROGRESS with completedAt', 'IN_PROGRESS', new Date()],
    ['CANCELED with completedAt', 'CANCELED', new Date()],
  ] as const)('rejects %s', async (_label, status, completedAt) => {
    await expect(
      prisma.task.create({ data: baseTask({ status, completedAt }) }),
    ).rejects.toMatchObject({ code: 'P2039' });
  });

  it('rejects unsupported enum values at the database boundary', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO public.tasks
          (id, workspace_id, title, status, priority, created_by_id, position)
        VALUES
          (${taskId()}::uuid, ${workspace1}::uuid, 'Invalid enum', 'BLOCKED', 'MEDIUM', ${user1}::uuid, 1024)
      `,
    ).rejects.toMatchObject({
      code: 'P2010',
      meta: { driverAdapterError: { cause: { originalCode: '22P02' } } },
    });
  });

  it('soft-deletes without removing data, releases rank, and rejects conflicting restore', async () => {
    const original = await prisma.task.create({ data: baseTask() });
    const deletedAt = new Date('2026-10-12T02:00:00.123Z');
    const deleted = await prisma.task.update({
      where: { id: original.id },
      data: { deletedAt },
    });
    expect(deleted.deletedAt).toEqual(deletedAt);
    expect(
      await prisma.task.findUnique({ where: { id: original.id } }),
    ).not.toBeNull();
    const replacement = await prisma.task.create({ data: baseTask() });
    expect(replacement.position).toBe(original.position);
    await expect(
      prisma.task.update({
        where: { id: original.id },
        data: { deletedAt: null },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(
      (await prisma.task.findUniqueOrThrow({ where: { id: original.id } }))
        .deletedAt,
    ).toEqual(deletedAt);
  });

  it('enforces Inbox ordering by workspace/status while allowing other statuses and workspaces', async () => {
    await prisma.task.create({ data: baseTask({ position: 2048n }) });
    await expect(
      prisma.task.create({ data: baseTask({ position: 2048n }) }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await prisma.task.create({
      data: baseTask({ status: 'IN_PROGRESS', position: 2048n }),
    });
    await prisma.task.create({
      data: baseTask({
        workspaceId: workspace2,
        createdById: user2,
        position: 2048n,
      }),
    });
  });

  it('enforces Project lane ordering while allowing the same rank in another Project', async () => {
    await prisma.task.create({
      data: baseTask({ projectId: project1, position: 3072n }),
    });
    await expect(
      prisma.task.create({
        data: baseTask({ projectId: project1, position: 3072n }),
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await prisma.task.create({
      data: baseTask({ projectId: project2, position: 3072n }),
    });
  });

  it('uses immediate ordering uniqueness and accepts the full nonnegative bigint range', async () => {
    const first = await prisma.task.create({
      data: baseTask({ projectId: project1, position: 4096n }),
    });
    const second = await prisma.task.create({
      data: baseTask({ projectId: project1, position: 8192n }),
    });
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.task.update({
          where: { id: first.id },
          data: { position: second.position },
        });
        await tx.task.update({
          where: { id: second.id },
          data: { position: first.position },
        });
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(
      (await prisma.task.findUniqueOrThrow({ where: { id: first.id } }))
        .position,
    ).toBe(4096n);
    expect(
      (await prisma.task.findUniqueOrThrow({ where: { id: second.id } }))
        .position,
    ).toBe(8192n);
    const maximum = await prisma.task.create({
      data: baseTask({
        projectId: project1,
        status: 'IN_PROGRESS',
        position: 9_223_372_036_854_775_807n,
      }),
    });
    expect(maximum.position).toBe(9_223_372_036_854_775_807n);
  });

  it.each([
    ['blank title', { title: '   ' }],
    ['negative position', { position: -1n }],
    ['zero version', { version: 0 }],
  ] as const)('rejects %s', async (_label, overrides) => {
    await expect(
      prisma.task.create({ data: baseTask(overrides) }),
    ).rejects.toMatchObject({ code: 'P2039' });
  });

  it('uses MATCH SIMPLE for null Project/assignee but restricts referenced parent deletion', async () => {
    const inbox = await prisma.task.create({
      data: baseTask({ projectId: null, assigneeId: null }),
    });
    expect(inbox.projectId).toBeNull();
    expect(inbox.assigneeId).toBeNull();
    const projectTask = await prisma.task.create({
      data: baseTask({
        projectId: project1,
        position: 2048n,
        assigneeId: assignee,
      }),
    });
    for (const operation of [
      'workspace',
      'project',
      'creator',
      'assignee',
    ] as const) {
      await expect(
        prisma.$transaction(async (tx) => {
          if (operation === 'workspace')
            await tx.workspace.delete({ where: { id: workspace1 } });
          if (operation === 'project')
            await tx.project.delete({ where: { id: project1 } });
          if (operation === 'creator')
            await tx.workspaceMember.delete({
              where: {
                workspaceId_userId: { workspaceId: workspace1, userId: user1 },
              },
            });
          if (operation === 'assignee')
            await tx.workspaceMember.delete({
              where: {
                workspaceId_userId: {
                  workspaceId: workspace1,
                  userId: assignee,
                },
              },
            });
          throw new Error('Unexpected parent deletion; rollback');
        }),
      ).rejects.toMatchObject({ code: 'P2003' });
    }
    expect(
      await prisma.task.findUnique({ where: { id: projectTask.id } }),
    ).not.toBeNull();
  });

  it('denies runtime ALTER/DROP and rolls back unexpected DDL success', async () => {
    for (const sql of [
      'ALTER TABLE public.tasks ADD COLUMN __test_forbidden integer',
      'DROP TABLE public.tasks',
    ]) {
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(sql);
          throw new Error('Unexpected DDL success; rollback');
        }),
      ).rejects.toMatchObject({
        code: 'P2010',
        meta: { driverAdapterError: { cause: { code: '42501' } } },
      });
    }
  });
});
