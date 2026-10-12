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

// Explicit test:db invocation only; reject remote/administrative targets before Nest connects.
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
      'Workspace tests require a local shanflow_app/shanflow/public connection.',
    );
  }
}

describe('Workspace database integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerId: string;
  let workspaceIds: string[];

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
    workspaceIds = [];
    ownerId = randomUUID();
    await prisma.user.create({
      data: {
        id: ownerId,
        email: `workspace.${ownerId}@example.invalid`,
        displayName: 'Workspace fixture',
      },
    });
  });

  afterEach(async () => {
    // IDs are allocated before writes, so even an unexpected successful negative test is cleaned up.
    await prisma.workspace.deleteMany({
      where: { id: { in: workspaceIds }, ownerId },
    });
    await prisma.user.deleteMany({ where: { id: ownerId } });
  });

  afterAll(async () => {
    await app?.close();
  });

  function fixtureId(): string {
    const id = randomUUID();
    workspaceIds.push(id);
    return id;
  }

  it('creates default PERSONAL, reads owner relation and updates timestamps through runtime CRUD', async () => {
    const id = fixtureId();
    const past = new Date('2020-01-01T00:00:00.000Z');
    const created = await prisma.workspace.create({
      data: { id, ownerId, name: 'Personal', updatedAt: past },
    });
    expect(created.type).toBe('PERSONAL');
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.updatedAt).toEqual(past);
    const read = await prisma.workspace.findUniqueOrThrow({
      where: { id },
      include: { owner: true },
    });
    expect(read.owner.id).toBe(ownerId);
    const updated = await prisma.workspace.update({
      where: { id },
      data: { name: 'Renamed' },
    });
    expect(updated.name).toBe('Renamed');
    expect(updated.createdAt).toEqual(created.createdAt);
    expect(updated.updatedAt.getTime()).toBeGreaterThan(past.getTime());
    await prisma.workspace.delete({ where: { id } });
    expect(await prisma.workspace.findUnique({ where: { id } })).toBeNull();
  });

  it('generates UUID and allows multiple TEAM workspaces alongside PERSONAL', async () => {
    await prisma.workspace.create({
      data: { id: fixtureId(), ownerId, name: 'Personal' },
    });
    // Transaction rolls back the generated-ID fixture even if an assertion fails.
    const rollback = new Error('rollback UUID fixture');
    await expect(
      prisma.$transaction(async (tx) => {
        const workspace = await tx.workspace.create({
          data: { ownerId, name: 'Generated', type: 'TEAM' },
        });
        expect(workspace.id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        );
        expect(workspace.createdAt).toBeInstanceOf(Date);
        expect(workspace.updatedAt).toBeInstanceOf(Date);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    for (let i = 0; i < 2; i++) {
      const team = await prisma.workspace.create({
        data: { id: fixtureId(), ownerId, name: 'Team', type: 'TEAM' },
      });
      expect(team.type).toBe('TEAM');
    }
    expect(await prisma.workspace.count({ where: { ownerId } })).toBe(3);
  });

  it('rejects an owner that does not exist', async () => {
    const rollback = new Error('unexpected valid owner');
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.workspace.create({
          data: { id: fixtureId(), ownerId: randomUUID(), name: 'Invalid' },
        });
        throw rollback;
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('rejects duplicate PERSONAL on insert and on TEAM type update', async () => {
    await prisma.workspace.create({
      data: { id: fixtureId(), ownerId, name: 'First' },
    });
    await expect(
      prisma.workspace.create({
        data: { id: fixtureId(), ownerId, name: 'Second' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    const team = await prisma.workspace.create({
      data: { id: fixtureId(), ownerId, name: 'Team', type: 'TEAM' },
    });
    await expect(
      prisma.workspace.update({
        where: { id: team.id },
        data: { type: 'PERSONAL' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(
      (await prisma.workspace.findUniqueOrThrow({ where: { id: team.id } }))
        .type,
    ).toBe('TEAM');
  });

  it('restricts owner deletion and owner primary-key update without cascading', async () => {
    const id = fixtureId();
    await prisma.workspace.create({ data: { id, ownerId, name: 'Retained' } });
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.user.delete({ where: { id: ownerId } });
        throw new Error('Unexpected delete; rollback');
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: ownerId },
          data: { id: randomUUID() },
        });
        throw new Error('Unexpected update; rollback');
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    expect(
      (await prisma.workspace.findUniqueOrThrow({ where: { id } })).ownerId,
    ).toBe(ownerId);
    expect(
      await prisma.user.findUnique({ where: { id: ownerId } }),
    ).not.toBeNull();
  });

  it('rejects blank workspace names', async () => {
    await expect(
      prisma.workspace.create({
        data: { id: fixtureId(), ownerId, name: '   ' },
      }),
    ).rejects.toMatchObject({ code: 'P2039' });
  });

  it('denies runtime ALTER and DROP without changing the workspace table', async () => {
    for (const statement of [
      'ALTER TABLE public.workspaces ADD COLUMN __test_forbidden integer',
      'DROP TABLE public.workspaces',
    ]) {
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(statement);
          throw new Error('Unexpected DDL; rollback');
        }),
      ).rejects.toMatchObject({
        code: 'P2010',
        meta: { driverAdapterError: { cause: { code: '42501' } } },
      });
    }
    expect(await prisma.workspace.count({ where: { ownerId } })).toBe(0);
  });
});
