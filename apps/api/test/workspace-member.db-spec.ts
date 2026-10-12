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
      'Membership tests require local shanflow_app/shanflow/public.',
    );
  }
}

describe('WorkspaceMember database integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let workspaceId: string;
  let ownerId: string;
  let memberId: string;

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
    workspaceId = randomUUID();
    ownerId = randomUUID();
    memberId = randomUUID();
    await prisma.$transaction(async (tx) => {
      for (const id of [ownerId, memberId]) {
        await tx.user.create({
          data: {
            id,
            email: `membership.${id}@example.invalid`,
            displayName: 'Membership fixture',
          },
        });
      }
      await tx.workspace.create({
        data: {
          id: workspaceId,
          ownerId,
          name: 'Membership fixture',
          type: 'TEAM',
        },
      });
    });
  });

  afterEach(async () => {
    // Only this test's randomly allocated workspace/user IDs are cleanup targets.
    await prisma.$transaction(async (tx) => {
      await tx.workspaceMember.deleteMany({ where: { workspaceId } });
      await tx.workspace.deleteMany({ where: { id: workspaceId } });
      await tx.user.deleteMany({ where: { id: { in: [ownerId, memberId] } } });
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('creates UUID/defaults and reads both relations and inverse lists through runtime CRUD', async () => {
    const row = await prisma.workspaceMember.create({
      data: { workspaceId, userId: memberId },
    });
    expect(row.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(row).toMatchObject({ role: 'MEMBER', membershipStatus: 'ACTIVE' });
    for (const date of [row.joinedAt, row.createdAt, row.updatedAt])
      expect(date).toBeInstanceOf(Date);
    const read = await prisma.workspaceMember.findUniqueOrThrow({
      where: { workspaceId_userId: { workspaceId, userId: memberId } },
      include: { workspace: true, user: true },
    });
    expect(read.workspace.id).toBe(workspaceId);
    expect(read.user.id).toBe(memberId);
    expect(
      (
        await prisma.workspace.findUniqueOrThrow({
          where: { id: workspaceId },
          include: { members: true },
        })
      ).members.map((m) => m.id),
    ).toContain(row.id);
    expect(
      (
        await prisma.user.findUniqueOrThrow({
          where: { id: memberId },
          include: { memberships: true },
        })
      ).memberships.map((m) => m.id),
    ).toContain(row.id);
    await prisma.workspaceMember.delete({ where: { id: row.id } });
    expect(
      await prisma.workspaceMember.findUnique({ where: { id: row.id } }),
    ).toBeNull();
  });

  it('rejects duplicate membership even when status or role differs', async () => {
    await prisma.workspaceMember.create({
      data: { workspaceId, userId: memberId, membershipStatus: 'INACTIVE' },
    });
    await expect(
      prisma.workspaceMember.create({
        data: { workspaceId, userId: memberId, role: 'ADMIN' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it.each(['workspaceId', 'userId'] as const)(
    'rejects nonexistent %s',
    async (key) => {
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.workspaceMember.create({
            data: { workspaceId, userId: memberId, [key]: randomUUID() },
          });
          throw new Error('Unexpected FK success; rollback');
        }),
      ).rejects.toMatchObject({ code: 'P2003' });
    },
  );

  it.each(['ACTIVE', 'INACTIVE'] as const)(
    'reserves the OWNER slot for an %s OWNER on insert and promotion',
    async (membershipStatus) => {
      await prisma.workspaceMember.create({
        data: { workspaceId, userId: ownerId, role: 'OWNER', membershipStatus },
      });
      await expect(
        prisma.workspaceMember.create({
          data: { workspaceId, userId: memberId, role: 'OWNER' },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
      const member = await prisma.workspaceMember.create({
        data: { workspaceId, userId: memberId },
      });
      await expect(
        prisma.workspaceMember.update({
          where: { id: member.id },
          data: { role: 'OWNER', membershipStatus: 'INACTIVE' },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    },
  );

  it('allows ADMIN/MEMBER and preserves joinedAt through deactivation/reactivation', async () => {
    const past = new Date('2020-01-01T00:00:00Z');
    await prisma.workspaceMember.create({
      data: { workspaceId, userId: ownerId, role: 'ADMIN' },
    });
    const member = await prisma.workspaceMember.create({
      data: { workspaceId, userId: memberId, joinedAt: past, updatedAt: past },
    });
    const inactive = await prisma.workspaceMember.update({
      where: { id: member.id },
      data: { membershipStatus: 'INACTIVE' },
    });
    expect(inactive.membershipStatus).toBe('INACTIVE');
    expect(inactive.joinedAt).toEqual(past);
    expect(inactive.updatedAt.getTime()).toBeGreaterThan(past.getTime());
    const active = await prisma.workspaceMember.update({
      where: { id: member.id },
      data: { membershipStatus: 'ACTIVE' },
    });
    expect(active.membershipStatus).toBe('ACTIVE');
    expect(active.joinedAt).toEqual(past);
    expect(active.createdAt).toEqual(member.createdAt);
  });

  it.each([
    'user-delete',
    'user-update',
    'workspace-delete',
    'workspace-update',
  ] as const)('enforces RESTRICT/NO ACTION for %s', async (operation) => {
    await prisma.workspaceMember.create({
      data: { workspaceId, userId: memberId },
    });
    // memberId is not Workspace.ownerId: User FK rejection comes from membership.
    await expect(
      prisma.$transaction(async (tx) => {
        if (operation === 'user-delete')
          await tx.user.delete({ where: { id: memberId } });
        if (operation === 'user-update')
          await tx.user.update({
            where: { id: memberId },
            data: { id: randomUUID() },
          });
        if (operation === 'workspace-delete')
          await tx.workspace.delete({ where: { id: workspaceId } });
        if (operation === 'workspace-update')
          await tx.workspace.update({
            where: { id: workspaceId },
            data: { id: randomUUID() },
          });
        throw new Error('Unexpected referential action success; rollback');
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    expect(
      await prisma.workspaceMember.count({
        where: { workspaceId, userId: memberId },
      }),
    ).toBe(1);
  });

  it('demonstrates atomic Workspace then matching ACTIVE OWNER bootstrap, without circular FK', async () => {
    // Reuse only this fixture Workspace ID; demonstrate the actual creation order.
    await prisma.workspace.delete({ where: { id: workspaceId } });
    await prisma.$transaction(async (tx) => {
      const workspace = await tx.workspace.create({
        data: {
          id: workspaceId,
          ownerId,
          name: 'Atomic bootstrap',
          type: 'TEAM',
        },
      });
      const owner = await tx.workspaceMember.create({
        data: { workspaceId, userId: workspace.ownerId, role: 'OWNER' },
      });
      expect(owner.userId).toBe(workspace.ownerId);
      expect(owner.membershipStatus).toBe('ACTIVE');
      expect(
        await tx.workspaceMember.count({
          where: { workspaceId, role: 'OWNER' },
        }),
      ).toBe(1);
    });
    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      include: { owner: true, members: true },
    });
    expect(workspace.owner.id).toBe(ownerId);
    expect(workspace.members).toHaveLength(1);
    expect(workspace.members[0]).toMatchObject({
      userId: ownerId,
      role: 'OWNER',
      membershipStatus: 'ACTIVE',
    });
  });

  it('documents direct-SQL gaps: missing, mismatched, inactive and deleted OWNER are accepted', async () => {
    expect(
      await prisma.workspaceMember.count({
        where: { workspaceId, role: 'OWNER' },
      }),
    ).toBe(0);
    const id = randomUUID();
    // Parameterized SQL using runtime role; deliberately inconsistent test fixture.
    await prisma.$executeRaw`
      INSERT INTO public.workspace_members (id, workspace_id, user_id, role, membership_status)
      VALUES (${id}::uuid, ${workspaceId}::uuid, ${memberId}::uuid, 'OWNER', 'INACTIVE')
    `;
    const row = await prisma.workspaceMember.findUniqueOrThrow({
      where: { id },
    });
    expect(row.userId).not.toBe(ownerId);
    expect(row.membershipStatus).toBe('INACTIVE');
    // Positive service contract above is not an automatic database guarantee.
    await prisma.$executeRaw`UPDATE public.workspace_members SET role = 'MEMBER' WHERE id = ${id}::uuid`;
    expect(
      await prisma.workspaceMember.count({
        where: { workspaceId, role: 'OWNER' },
      }),
    ).toBe(0);
    await prisma.$executeRaw`DELETE FROM public.workspace_members WHERE id = ${id}::uuid`;
    expect(
      await prisma.workspace.findUnique({ where: { id: workspaceId } }),
    ).not.toBeNull();
  });

  it('rejects runtime ALTER/DROP with permission errors and always rolls back probes', async () => {
    for (const sql of [
      'ALTER TABLE public.workspace_members ADD COLUMN __test_forbidden integer',
      'DROP TABLE public.workspace_members',
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
