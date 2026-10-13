import type { INestApplication } from '@nestjs/common';
import {
  MAX_PROJECTS_PER_WORKSPACE,
  listProjectsResponseSchema,
  projectResponseSchema,
} from '@shanflow/contracts';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import {
  PASSWORD,
  createTestApp,
  createUser,
  deleteUsers,
  type TestUser,
} from './support/db-test-support.js';

describe('projects (database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const userIds: string[] = [];
  const workspaceIds: string[] = [];
  const http = () => request(app.getHttpServer());
  const login = async (email: string) =>
    (
      await http()
        .post('/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200)
    ).body.accessToken as string;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const base = (workspaceId: string) => `/workspaces/${workspaceId}/projects`;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    prisma = app.get(PrismaService);
  });
  afterEach(async () => {
    await prisma.project.deleteMany({
      where: { workspaceId: { in: workspaceIds.splice(0) } },
    });
    await deleteUsers(prisma, userIds);
  });
  afterAll(async () => {
    await app.close();
  });

  async function signedIn() {
    const user = await createUser(prisma, userIds);
    return { user, token: await login(user.email) };
  }

  /** A TEAM workspace (no API creates one in the MVP) with an owner, an admin and a plain member. */
  async function teamOf(
    members: Array<[TestUser, 'ADMIN' | 'MEMBER']>,
    owner: TestUser,
  ) {
    const workspace = await prisma.workspace.create({
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
    workspaceIds.push(workspace.id);
    return workspace.id;
  }

  async function scenario() {
    const owner = await signedIn();
    const admin = await signedIn();
    const member = await signedIn();
    const outsider = await signedIn();
    const ws = await teamOf(
      [
        [admin.user, 'ADMIN'],
        [member.user, 'MEMBER'],
      ],
      owner.user,
    );
    return { owner, admin, member, outsider, ws };
  }

  const create = (token: string, ws: string, body: unknown) =>
    http()
      .post(base(ws))
      .set(auth(token))
      .send(body as object);

  it('lets OWNER and ADMIN create, and returns a contract-valid project', async () => {
    const { owner, admin, ws } = await scenario();
    const res = await create(owner.token, ws, {
      name: '  Website  ',
      description: 'Redesign\n\nQ4',
      color: 'blue',
      icon: 'rocket',
    }).expect(201);
    expect(projectResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.project).toMatchObject({
      workspaceId: ws,
      name: 'Website',
      description: 'Redesign\n\nQ4',
      color: 'blue',
      icon: 'rocket',
      archivedAt: null,
    });
    expect(res.headers['cache-control']).toBe('private, no-store');
    await create(admin.token, ws, { name: 'By admin' }).expect(201);
  });

  it('forbids MEMBER from every write but lets them read', async () => {
    const { owner, member, ws } = await scenario();
    const { id } = (await create(owner.token, ws, { name: 'P' }).expect(201))
      .body.project;
    await create(member.token, ws, { name: 'X' }).expect(403);
    await http()
      .patch(`${base(ws)}/${id}`)
      .set(auth(member.token))
      .send({ name: 'Y' })
      .expect(403);
    await http()
      .post(`${base(ws)}/${id}/archive`)
      .set(auth(member.token))
      .expect(403);
    await http()
      .post(`${base(ws)}/${id}/restore`)
      .set(auth(member.token))
      .expect(403);
    await http()
      .get(`${base(ws)}/${id}`)
      .set(auth(member.token))
      .expect(200);
    const list = await http().get(base(ws)).set(auth(member.token)).expect(200);
    expect(listProjectsResponseSchema.safeParse(list.body).success).toBe(true);
    expect(list.body.projects).toHaveLength(1);
    expect(await prisma.project.count({ where: { workspaceId: ws } })).toBe(1);
  });

  it('answers 404 to outsiders for every route, and never crosses workspaces', async () => {
    const { owner, outsider, ws } = await scenario();
    const { id } = (await create(owner.token, ws, { name: 'P' }).expect(201))
      .body.project;
    await http().get(base(ws)).set(auth(outsider.token)).expect(404);
    await create(outsider.token, ws, { name: 'X' }).expect(404);
    await http()
      .get(`${base(ws)}/${id}`)
      .set(auth(outsider.token))
      .expect(404);
    await http()
      .patch(`${base(ws)}/${id}`)
      .set(auth(outsider.token))
      .send({ name: 'Y' })
      .expect(404);
    await http()
      .post(`${base(ws)}/${id}/archive`)
      .set(auth(outsider.token))
      .expect(404);

    // The owner of ANOTHER workspace cannot reach this project through their own workspace id either.
    const other = await signedIn();
    const otherWs = await teamOf([], other.user);
    await http()
      .get(`${base(otherWs)}/${id}`)
      .set(auth(other.token))
      .expect(404);
    await http()
      .patch(`${base(otherWs)}/${id}`)
      .set(auth(other.token))
      .send({ name: 'Hijack' })
      .expect(404);
    await http()
      .post(`${base(otherWs)}/${id}/archive`)
      .set(auth(other.token))
      .expect(404);
    expect(
      (await prisma.project.findUniqueOrThrow({ where: { id } })).name,
    ).toBe('P');
    await http()
      .get(`${base(ws)}/not-a-uuid`)
      .set(auth(owner.token))
      .expect(404);
    await http().get(base('not-a-uuid')).set(auth(owner.token)).expect(404);
  });

  it('requires authentication', async () => {
    const { ws } = await scenario();
    await http().get(base(ws)).expect(401);
    await http().post(base(ws)).send({ name: 'x' }).expect(401);
  });

  it('rejects invalid input and any field outside the contract', async () => {
    const { owner, ws } = await scenario();
    for (const body of [
      {},
      { name: '  ' },
      { name: 'x'.repeat(81) },
      { name: 'x', color: 'chartreuse' },
      { name: 'x', icon: 'skull' },
      { name: 'x', description: 'a\u0000b' },
      { name: 'x', workspaceId: ws },
      { name: 'x', archivedAt: null },
    ]) {
      await create(owner.token, ws, body).expect(400);
    }
    expect(await prisma.project.count({ where: { workspaceId: ws } })).toBe(0);
  });

  it('updates part of a project and clears optional fields with null', async () => {
    const { admin, owner, ws } = await scenario();
    const { id } = (
      await create(owner.token, ws, {
        name: 'P',
        description: 'd',
        color: 'red',
        icon: 'star',
      }).expect(201)
    ).body.project;
    const res = await http()
      .patch(`${base(ws)}/${id}`)
      .set(auth(admin.token))
      .send({ name: 'Renamed', color: null })
      .expect(200);
    expect(res.body.project).toMatchObject({
      name: 'Renamed',
      description: 'd',
      color: null,
      icon: 'star',
    });
    const cleared = await http()
      .patch(`${base(ws)}/${id}`)
      .set(auth(owner.token))
      .send({ description: '   ', icon: null })
      .expect(200);
    expect(cleared.body.project).toMatchObject({
      description: null,
      icon: null,
    });
    await http()
      .patch(`${base(ws)}/${id}`)
      .set(auth(owner.token))
      .send({})
      .expect(400);
    await http()
      .patch(`${base(ws)}/${id}`)
      .set(auth(owner.token))
      .send({ workspaceId: ws })
      .expect(400);
  });

  it('archives and restores idempotently, filters the list, and makes archived projects read-only', async () => {
    const { owner, member, ws } = await scenario();
    const { id } = (await create(owner.token, ws, { name: 'P' }).expect(201))
      .body.project;
    await create(owner.token, ws, { name: 'Other' }).expect(201);

    const first = await http()
      .post(`${base(ws)}/${id}/archive`)
      .set(auth(owner.token))
      .expect(200);
    expect(first.body.project.archivedAt).toEqual(expect.any(String));
    const again = await http()
      .post(`${base(ws)}/${id}/archive`)
      .set(auth(owner.token))
      .expect(200);
    expect(again.body.project.archivedAt).toBe(first.body.project.archivedAt); // not rewritten

    const names = async (status?: string) =>
      (
        await http()
          .get(`${base(ws)}${status ? `?status=${status}` : ''}`)
          .set(auth(member.token))
          .expect(200)
      ).body.projects.map((p: { name: string }) => p.name);
    expect(await names()).toEqual(['Other']);
    expect(await names('archived')).toEqual(['P']);
    expect(await names('all')).toEqual(['P', 'Other']);
    await http()
      .get(`${base(ws)}?status=deleted`)
      .set(auth(member.token))
      .expect(400);

    // Archived is read-only and still readable.
    const blocked = await http()
      .patch(`${base(ws)}/${id}`)
      .set(auth(owner.token))
      .send({ name: 'Nope' })
      .expect(409);
    expect(blocked.body.code).toBe('PROJECT_ARCHIVED');
    await http()
      .get(`${base(ws)}/${id}`)
      .set(auth(member.token))
      .expect(200);

    const restored = await http()
      .post(`${base(ws)}/${id}/restore`)
      .set(auth(owner.token))
      .expect(200);
    expect(restored.body.project.archivedAt).toBeNull();
    await http()
      .post(`${base(ws)}/${id}/restore`)
      .set(auth(owner.token))
      .expect(200);
    await http()
      .patch(`${base(ws)}/${id}`)
      .set(auth(owner.token))
      .send({ name: 'Back' })
      .expect(200);
  });

  it('enforces the per-workspace limit, also under concurrent creation', async () => {
    const { owner, ws } = await scenario();
    await prisma.project.createMany({
      data: Array.from({ length: MAX_PROJECTS_PER_WORKSPACE - 2 }, (_, i) => ({
        workspaceId: ws,
        name: `p${i}`,
      })),
    });
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        create(owner.token, ws, { name: `race${i}` }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    const rejected = results.filter((r) => r.status === 409);
    expect(rejected).toHaveLength(3);
    expect(rejected[0]!.body.code).toBe('PROJECT_LIMIT_REACHED');
    expect(await prisma.project.count({ where: { workspaceId: ws } })).toBe(
      MAX_PROJECTS_PER_WORKSPACE,
    );
  });

  it('takes effect immediately when a role is revoked, and for suspended accounts', async () => {
    const { owner, admin, ws } = await scenario();
    await create(admin.token, ws, { name: 'One' }).expect(201);
    await prisma.workspaceMember.updateMany({
      where: { workspaceId: ws, userId: admin.user.id },
      data: { role: 'MEMBER' },
    });
    await create(admin.token, ws, { name: 'Two' }).expect(403);
    await prisma.user.update({
      where: { id: owner.user.id },
      data: { accountStatus: 'SUSPENDED' },
    });
    await http().get(base(ws)).set(auth(owner.token)).expect(404);
  });

  it('works for the personal workspace created at signup', async () => {
    const { token } = await signedIn();
    const list = await http().get('/workspaces').set(auth(token)).expect(200);
    const ws = list.body.workspaces[0].id as string;
    workspaceIds.push(ws);
    await create(token, ws, { name: 'Mine' }).expect(201);
    expect(
      (await http().get(base(ws)).set(auth(token)).expect(200)).body.projects,
    ).toHaveLength(1);
  });
});
