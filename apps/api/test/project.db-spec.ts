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
    throw new Error(
      'Project tests require local shanflow_app/shanflow/public.',
    );
  }
}

describe('Project database integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerId: string;
  let workspaceId: string;
  let projectIds: string[];

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
    ownerId = randomUUID();
    workspaceId = randomUUID();
    projectIds = [];
    await prisma.$transaction(async (tx) => {
      await tx.user.create({
        data: {
          id: ownerId,
          email: `project.${ownerId}@example.invalid`,
          displayName: 'Project fixture',
        },
      });
      await tx.workspace.create({
        data: {
          id: workspaceId,
          ownerId,
          name: 'Project fixture',
          type: 'TEAM',
        },
      });
    });
  });

  afterEach(async () => {
    await prisma.$transaction(async (tx) => {
      await tx.project.deleteMany({
        where: { id: { in: projectIds }, workspaceId },
      });
      await tx.workspace.deleteMany({ where: { id: workspaceId } });
      await tx.user.deleteMany({ where: { id: ownerId } });
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  function fixtureId(): string {
    const id = randomUUID();
    projectIds.push(id);
    return id;
  }

  it('creates and reads a Project with approved nullable fields and timestamps', async () => {
    const id = fixtureId();
    const past = new Date('2020-01-01T00:00:00.000Z');
    const project = await prisma.project.create({
      data: {
        id,
        workspaceId,
        name: 'Roadmap',
        description: 'Quarterly plan',
        color: '#336699',
        icon: 'roadmap',
        updatedAt: past,
      },
    });
    expect(project).toMatchObject({
      id,
      workspaceId,
      name: 'Roadmap',
      description: 'Quarterly plan',
      archivedAt: null,
      color: '#336699',
      icon: 'roadmap',
    });
    expect(project.createdAt).toBeInstanceOf(Date);
    expect(project.updatedAt).toEqual(past);
    const read = await prisma.project.findUniqueOrThrow({
      where: { workspaceId_id: { workspaceId, id } },
      include: { workspace: true },
    });
    expect(read.workspace.id).toBe(workspaceId);
    expect(
      (
        await prisma.workspace.findUniqueOrThrow({
          where: { id: workspaceId },
          include: { projects: true },
        })
      ).projects.map((row) => row.id),
    ).toContain(id);
    const updated = await prisma.project.update({
      where: { id },
      data: { description: null, color: null, icon: null },
    });
    expect(updated.description).toBeNull();
    expect(updated.color).toBeNull();
    expect(updated.icon).toBeNull();
    expect(updated.updatedAt.getTime()).toBeGreaterThan(past.getTime());
    await prisma.project.delete({ where: { id } });
    expect(await prisma.project.findUnique({ where: { id } })).toBeNull();
  });

  it('generates a UUID and exposes the composite unique selector', async () => {
    const rollback = new Error('rollback generated fixture');
    await expect(
      prisma.$transaction(async (tx) => {
        const project = await tx.project.create({
          data: { workspaceId, name: 'Generated' },
        });
        expect(project.id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        );
        expect(
          await tx.project.findUnique({
            where: {
              workspaceId_id: { workspaceId, id: project.id },
            },
          }),
        ).toMatchObject({ id: project.id });
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });

  it('rejects nonexistent and missing Workspace references', async () => {
    await expect(
      prisma.project.create({
        data: { id: fixtureId(), workspaceId: randomUUID(), name: 'Invalid' },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    const rawId = fixtureId();
    await expect(
      prisma.$executeRaw`
        INSERT INTO public.projects (id, name) VALUES (${rawId}::uuid, 'Missing Workspace')
      `,
    ).rejects.toMatchObject({
      code: 'P2010',
      meta: { driverAdapterError: { cause: { originalCode: '23502' } } },
    });
  });

  it('archives and restores without deleting the Project', async () => {
    const id = fixtureId();
    await prisma.project.create({
      data: { id, workspaceId, name: 'Archive target' },
    });
    const archivedAt = new Date('2026-10-12T00:00:00.123Z');
    const archived = await prisma.project.update({
      where: { id },
      data: { archivedAt },
    });
    expect(archived.archivedAt).toEqual(archivedAt);
    expect(await prisma.project.count({ where: { id } })).toBe(1);
    const restored = await prisma.project.update({
      where: { id },
      data: { archivedAt: null },
    });
    expect(restored.archivedAt).toBeNull();
    expect(await prisma.project.count({ where: { id } })).toBe(1);
  });

  it('rejects blank names but permits duplicate, case-distinct and long names', async () => {
    await expect(
      prisma.project.create({
        data: { id: fixtureId(), workspaceId, name: '   ' },
      }),
    ).rejects.toMatchObject({ code: 'P2039' });
    for (const name of ['Plan', 'Plan', 'plan', 'x'.repeat(2048)]) {
      await prisma.project.create({
        data: { id: fixtureId(), workspaceId, name },
      });
    }
    expect(await prisma.project.count({ where: { workspaceId } })).toBe(4);
  });

  it('uses RESTRICT/NO ACTION and never cascades from Workspace', async () => {
    const id = fixtureId();
    await prisma.project.create({
      data: { id, workspaceId, name: 'Retained' },
    });
    for (const operation of ['delete', 'update'] as const) {
      await expect(
        prisma.$transaction(async (tx) => {
          if (operation === 'delete')
            await tx.workspace.delete({ where: { id: workspaceId } });
          else
            await tx.workspace.update({
              where: { id: workspaceId },
              data: { id: randomUUID() },
            });
          throw new Error('Unexpected parent mutation; rollback');
        }),
      ).rejects.toMatchObject({ code: 'P2003' });
    }
    expect(await prisma.project.findUnique({ where: { id } })).not.toBeNull();
  });

  it('denies runtime ALTER/DROP and rolls back any unexpected DDL success', async () => {
    for (const sql of [
      'ALTER TABLE public.projects ADD COLUMN __test_forbidden integer',
      'DROP TABLE public.projects',
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
