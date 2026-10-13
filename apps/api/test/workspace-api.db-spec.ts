import type { INestApplication } from '@nestjs/common';
import {
  getWorkspaceResponseSchema,
  listMembersResponseSchema,
  listWorkspacesResponseSchema,
} from '@shanflow/contracts';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import { PersonalWorkspaceService } from '../src/features/workspace/shared/personal-workspace.service.js';
import { WorkspaceAccessService } from '../src/features/workspace/shared/workspace-access.service.js';
import {
  PASSWORD,
  createTestApp,
  createUser,
  deleteUsers,
  type TestUser,
} from './support/db-test-support.js';

describe('workspaces (database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let personal: PersonalWorkspaceService;
  let access: WorkspaceAccessService;
  const userIds: string[] = [];
  const http = () => request(app.getHttpServer());
  const login = async (email: string) =>
    (
      await http()
        .post('/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200)
    ).body.accessToken as string;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    ({ app } = await createTestApp());
    prisma = app.get(PrismaService);
    personal = app.get(PersonalWorkspaceService);
    access = app.get(WorkspaceAccessService);
  });
  afterEach(async () => {
    await deleteUsers(prisma, userIds);
  });
  afterAll(async () => {
    await app.close();
  });

  async function signedIn(options: Parameters<typeof createUser>[2] = {}) {
    const user = await createUser(prisma, userIds, options);
    return { user, token: await login(user.email) };
  }

  /** A TEAM workspace with the given members, created directly (there is no API for it in the MVP). */
  async function team(
    owner: TestUser,
    members: Array<[TestUser, 'ADMIN' | 'MEMBER']>,
  ) {
    return prisma.workspace.create({
      data: {
        name: 'Team',
        type: 'TEAM',
        ownerId: owner.id,
        members: {
          create: [
            { userId: owner.id, role: 'OWNER' },
            ...members.map(([user, role]) => ({ userId: user.id, role })),
          ],
        },
      },
    });
  }

  describe('personal workspace bootstrap', () => {
    it('is created atomically with the account at signup', async () => {
      const email = `ws-signup-${Date.now()}@example.invalid`;
      const res = await http()
        .post('/auth/register')
        .send({ email, password: PASSWORD, displayName: 'Signup' })
        .expect(201);
      userIds.push(res.body.user.id);
      const workspaces = await prisma.workspace.findMany({
        where: { ownerId: res.body.user.id },
        include: { members: true },
      });
      expect(workspaces).toHaveLength(1);
      expect(workspaces[0]).toMatchObject({
        type: 'PERSONAL',
        name: 'Personal',
      });
      expect(workspaces[0]!.members).toEqual([
        expect.objectContaining({
          userId: res.body.user.id,
          role: 'OWNER',
          membershipStatus: 'ACTIVE',
        }),
      ]);
    });

    it('is idempotent and safe when called concurrently', async () => {
      const { user } = await signedIn();
      const results = await Promise.all(
        Array.from({ length: 6 }, () => personal.ensure(user.id)),
      );
      expect(new Set(results.map((r) => r.workspaceId)).size).toBe(1);
      expect(
        await prisma.workspace.count({ where: { ownerId: user.id } }),
      ).toBe(1);
      expect(
        await prisma.workspaceMember.count({ where: { userId: user.id } }),
      ).toBe(1);
    });

    it('repairs a missing or deactivated owner membership', async () => {
      const { user } = await signedIn();
      const { workspaceId } = await personal.ensure(user.id);
      await prisma.workspaceMember.updateMany({
        where: { workspaceId },
        data: { membershipStatus: 'INACTIVE' },
      });
      await personal.ensure(user.id);
      expect(
        await prisma.workspaceMember.findFirstOrThrow({
          where: { workspaceId },
        }),
      ).toMatchObject({ role: 'OWNER', membershipStatus: 'ACTIVE' });
      await prisma.workspaceMember.deleteMany({ where: { workspaceId } });
      await personal.ensure(user.id);
      expect(
        await prisma.workspaceMember.count({ where: { workspaceId } }),
      ).toBe(1);
    });

    it('rolls back with the surrounding transaction', async () => {
      const { user } = await signedIn();
      await expect(
        prisma.$transaction(async (tx) => {
          await personal.ensure(user.id, tx);
          throw new Error('abort');
        }),
      ).rejects.toThrow('abort');
      expect(
        await prisma.workspace.count({ where: { ownerId: user.id } }),
      ).toBe(0);
    });
  });

  describe('GET /workspaces', () => {
    it('creates the personal workspace for an account that predates workspaces', async () => {
      const { user, token } = await signedIn();
      expect(
        await prisma.workspace.count({ where: { ownerId: user.id } }),
      ).toBe(0);
      const res = await http().get('/workspaces').set(auth(token)).expect(200);
      expect(listWorkspacesResponseSchema.safeParse(res.body).success).toBe(
        true,
      );
      expect(res.body.workspaces).toEqual([
        expect.objectContaining({
          name: 'Personal',
          type: 'PERSONAL',
          role: 'OWNER',
        }),
      ]);
      expect(res.headers['cache-control']).toBe('private, no-store');
      await http().get('/workspaces').set(auth(token)).expect(200);
      expect(
        await prisma.workspace.count({ where: { ownerId: user.id } }),
      ).toBe(1);
    });

    it('lists only my ACTIVE memberships with my own role', async () => {
      const a = await signedIn();
      const b = await signedIn();
      const t = await team(b.user, [[a.user, 'ADMIN']]);
      await personal.ensure(a.user.id);
      const res = await http()
        .get('/workspaces')
        .set(auth(a.token))
        .expect(200);
      expect(
        res.body.workspaces.map((w: { role: string }) => w.role).sort(),
      ).toEqual(['ADMIN', 'OWNER']);
      await prisma.workspaceMember.updateMany({
        where: { workspaceId: t.id, userId: a.user.id },
        data: { membershipStatus: 'INACTIVE' },
      });
      const after = await http()
        .get('/workspaces')
        .set(auth(a.token))
        .expect(200);
      expect(after.body.workspaces).toHaveLength(1);
    });

    it('requires authentication', async () => {
      await http().get('/workspaces').expect(401);
    });
  });

  describe('GET /workspaces/:id and members', () => {
    it('returns the workspace and the members without emails', async () => {
      const owner = await signedIn();
      const member = await signedIn();
      const t = await team(owner.user, [[member.user, 'MEMBER']]);
      const res = await http()
        .get(`/workspaces/${t.id}`)
        .set(auth(member.token))
        .expect(200);
      expect(getWorkspaceResponseSchema.safeParse(res.body).success).toBe(true);
      expect(res.body.workspace).toMatchObject({
        id: t.id,
        type: 'TEAM',
        role: 'MEMBER',
      });
      const members = await http()
        .get(`/workspaces/${t.id}/members`)
        .set(auth(member.token))
        .expect(200);
      expect(listMembersResponseSchema.safeParse(members.body).success).toBe(
        true,
      );
      expect(members.body.members).toHaveLength(2);
      expect(JSON.stringify(members.body)).not.toContain('@');
    });

    it('answers 404 for strangers, inactive members, suspended accounts, unknown and malformed ids alike', async () => {
      const owner = await signedIn();
      const stranger = await signedIn();
      const inactive = await signedIn();
      const t = await team(owner.user, [[inactive.user, 'MEMBER']]);
      await prisma.workspaceMember.updateMany({
        where: { workspaceId: t.id, userId: inactive.user.id },
        data: { membershipStatus: 'INACTIVE' },
      });
      for (const token of [stranger.token, inactive.token]) {
        await http().get(`/workspaces/${t.id}`).set(auth(token)).expect(404);
        await http()
          .get(`/workspaces/${t.id}/members`)
          .set(auth(token))
          .expect(404);
      }
      await http()
        .get('/workspaces/00000000-0000-4000-8000-000000000000')
        .set(auth(owner.token))
        .expect(404);
      await http()
        .get('/workspaces/not-a-uuid')
        .set(auth(owner.token))
        .expect(404);
      await prisma.user.update({
        where: { id: owner.user.id },
        data: { accountStatus: 'SUSPENDED' },
      });
      await http()
        .get(`/workspaces/${t.id}`)
        .set(auth(owner.token))
        .expect(404);
    });
  });

  describe('PATCH /workspaces/:id', () => {
    const rename = (token: string, id: string, body: unknown) =>
      http()
        .patch(`/workspaces/${id}`)
        .set(auth(token))
        .send(body as object);

    it('lets OWNER and ADMIN rename, and forbids MEMBER', async () => {
      const owner = await signedIn();
      const admin = await signedIn();
      const member = await signedIn();
      const t = await team(owner.user, [
        [admin.user, 'ADMIN'],
        [member.user, 'MEMBER'],
      ]);
      const res = await rename(owner.token, t.id, {
        name: '  Renamed  ',
      }).expect(200);
      expect(res.body.workspace).toMatchObject({
        name: 'Renamed',
        role: 'OWNER',
      });
      await rename(admin.token, t.id, { name: 'By admin' }).expect(200);
      await rename(member.token, t.id, { name: 'By member' }).expect(403);
      expect(
        (await prisma.workspace.findUniqueOrThrow({ where: { id: t.id } }))
          .name,
      ).toBe('By admin');
    });

    it('does not reveal or change a workspace of someone else', async () => {
      const owner = await signedIn();
      const stranger = await signedIn();
      const t = await team(owner.user, []);
      await rename(stranger.token, t.id, { name: 'Hijack' }).expect(404);
      expect(
        (await prisma.workspace.findUniqueOrThrow({ where: { id: t.id } }))
          .name,
      ).toBe('Team');
    });

    it('rejects invalid names and any other field', async () => {
      const { user, token } = await signedIn();
      const { workspaceId } = await personal.ensure(user.id);
      for (const body of [
        {},
        { name: '   ' },
        { name: 'a'.repeat(81) },
        { name: 'x', ownerId: user.id },
        { name: 'x', type: 'TEAM' },
      ]) {
        await rename(token, workspaceId, body).expect(400);
      }
      expect(
        (
          await prisma.workspace.findUniqueOrThrow({
            where: { id: workspaceId },
          })
        ).name,
      ).toBe('Personal');
    });

    it('requires authentication', async () => {
      await http()
        .patch('/workspaces/00000000-0000-4000-8000-000000000000')
        .send({ name: 'x' })
        .expect(401);
    });

    it('takes effect immediately when a role is revoked', async () => {
      const owner = await signedIn();
      const admin = await signedIn();
      const t = await team(owner.user, [[admin.user, 'ADMIN']]);
      await rename(admin.token, t.id, { name: 'One' }).expect(200);
      await prisma.workspaceMember.updateMany({
        where: { workspaceId: t.id, userId: admin.user.id },
        data: { role: 'MEMBER' },
      });
      await rename(admin.token, t.id, { name: 'Two' }).expect(403);
      await prisma.workspaceMember.updateMany({
        where: { workspaceId: t.id, userId: admin.user.id },
        data: { membershipStatus: 'INACTIVE' },
      });
      await rename(admin.token, t.id, { name: 'Three' }).expect(404);
    });
  });

  describe('WorkspaceAccessService', () => {
    it('share-locks the membership so a concurrent demotion waits for the write transaction', async () => {
      const owner = await signedIn();
      const admin = await signedIn();
      const t = await team(owner.user, [[admin.user, 'ADMIN']]);
      let demoted = false;
      let demotion!: Promise<unknown>;
      await prisma.$transaction(async (tx) => {
        await access.require(
          admin.user.id,
          t.id,
          { roles: ['OWNER', 'ADMIN'], lock: true },
          tx,
        );
        demotion = prisma.workspaceMember
          .updateMany({
            where: { workspaceId: t.id, userId: admin.user.id },
            data: { role: 'MEMBER' },
          })
          .then(() => (demoted = true));
        await new Promise((resolve) => setTimeout(resolve, 300));
        // Still blocked while the permission-checking transaction is open.
        expect(demoted).toBe(false);
      });
      await demotion;
      expect(demoted).toBe(true);
    });
  });
});
