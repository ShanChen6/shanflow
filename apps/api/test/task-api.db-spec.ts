import type { INestApplication } from '@nestjs/common';
import {
  MAX_TASKS_PER_WORKSPACE,
  listTasksResponseSchema,
  taskResponseSchema,
} from '@shanflow/contracts';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import {
  PASSWORD,
  createTestApp,
  createUser,
  deleteUsers,
} from './support/db-test-support.js';

describe('tasks API (database)', () => {
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
  const base = (workspaceId: string) => `/workspaces/${workspaceId}/tasks`;

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

  async function signedIn() {
    const user = await createUser(prisma, userIds);
    return { user, token: await login(user.email) };
  }

  /** A TEAM workspace (no API creates one in the MVP) with an owner, an admin and a plain member, plus an outsider. */
  async function scenario() {
    const owner = await signedIn();
    const admin = await signedIn();
    const member = await signedIn();
    const outsider = await signedIn();
    const workspace = await prisma.workspace.create({
      data: {
        name: 'Team',
        type: 'TEAM',
        ownerId: owner.user.id,
        members: {
          create: [
            { userId: owner.user.id, role: 'OWNER' },
            { userId: admin.user.id, role: 'ADMIN' },
            { userId: member.user.id, role: 'MEMBER' },
          ],
        },
      },
    });
    workspaceIds.push(workspace.id);
    return { owner, admin, member, outsider, ws: workspace.id };
  }

  const create = (token: string, ws: string, body: unknown) =>
    http()
      .post(base(ws))
      .set(auth(token))
      .send(body as object);

  describe('POST /workspaces/:w/tasks', () => {
    it('creates an Inbox task with server-owned defaults', async () => {
      const { owner, ws } = await scenario();
      const res = await create(owner.token, ws, {
        title: '  Buy milk  ',
      }).expect(201);
      expect(taskResponseSchema.safeParse(res.body).success).toBe(true);
      expect(res.body.task).toMatchObject({
        workspaceId: ws,
        projectId: null,
        title: 'Buy milk',
        description: null,
        status: 'TODO',
        priority: 'MEDIUM',
        dueAt: null,
        assigneeId: null,
        createdById: owner.user.id,
        position: '1024',
        version: 1,
        completedAt: null,
        deletedAt: null,
      });
      expect(res.headers['cache-control']).toBe('private, no-store');
    });

    it('stores every optional field and returns the deadline in UTC', async () => {
      const { owner, ws } = await scenario();
      const project = await prisma.project.create({
        data: { workspaceId: ws, name: 'P' },
      });
      const res = await create(owner.token, ws, {
        title: 'Plan',
        description: 'line1\nline2',
        priority: 'URGENT',
        dueAt: '2026-10-12T09:00:00+07:00',
        projectId: project.id,
        assigneeId: owner.user.id,
      }).expect(201);
      expect(res.body.task).toMatchObject({
        description: 'line1\nline2',
        priority: 'URGENT',
        dueAt: '2026-10-12T02:00:00.000Z',
        projectId: project.id,
        assigneeId: owner.user.id,
      });
    });

    it('appends to the end of its own lane, and lanes do not share ranks', async () => {
      const { owner, ws } = await scenario();
      const project = await prisma.project.create({
        data: { workspaceId: ws, name: 'P' },
      });
      const positions = async (body: object) =>
        (await create(owner.token, ws, { title: 't', ...body }).expect(201))
          .body.task.position;
      expect(await positions({})).toBe('1024');
      expect(await positions({})).toBe('2048');
      expect(await positions({})).toBe('3072');
      expect(await positions({ projectId: project.id })).toBe('1024'); // another lane
      expect(await positions({ projectId: project.id })).toBe('2048');
      expect(await positions({ projectId: null })).toBe('4096'); // null is Inbox
    });

    it('keeps ranks unique when many tasks are created at once', async () => {
      const { owner, ws } = await scenario();
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          create(owner.token, ws, { title: `t${i}` }),
        ),
      );
      expect(results.map((r) => r.status)).toEqual(Array(8).fill(201));
      const positions = results.map((r) => r.body.task.position as string);
      expect(new Set(positions).size).toBe(8);
      expect([...positions].sort((a, b) => Number(a) - Number(b))).toEqual(
        Array.from({ length: 8 }, (_, i) => String((i + 1) * 1024)),
      );
    });

    it('lets every member create, including a plain member', async () => {
      const { admin, member, ws } = await scenario();
      await create(admin.token, ws, { title: 'by admin' }).expect(201);
      const res = await create(member.token, ws, { title: 'by member' }).expect(
        201,
      );
      expect(res.body.task.createdById).toBe(member.user.id);
    });

    it('answers 401 without a token and 404 to outsiders, even for malformed workspace ids', async () => {
      const { outsider, ws } = await scenario();
      await http().post(base(ws)).send({ title: 'x' }).expect(401);
      await create(outsider.token, ws, { title: 'x' }).expect(404);
      await create(outsider.token, 'not-a-uuid', { title: 'x' }).expect(404);
      expect(await prisma.task.count({ where: { workspaceId: ws } })).toBe(0);
    });

    it('rejects invalid input and every server-owned or unknown field', async () => {
      const { owner, ws } = await scenario();
      for (const body of [
        {},
        { title: '   ' },
        { title: 'x'.repeat(201) },
        { title: 'a\nb' },
        { title: 'x', status: 'DONE' },
        { title: 'x', position: '1' },
        { title: 'x', version: 9 },
        { title: 'x', createdById: owner.user.id },
        { title: 'x', workspaceId: ws },
        { title: 'x', priority: 'NOW' },
        { title: 'x', dueAt: '2026-10-12' },
        { title: 'x', dueAt: '2026-10-12T09:00:00' },
        { title: 'x', description: 'a\u0000b' },
      ]) {
        await create(owner.token, ws, body).expect(400);
      }
      expect(await prisma.task.count({ where: { workspaceId: ws } })).toBe(0);
    });

    it('rejects archived, foreign and unknown projects', async () => {
      const { owner, ws } = await scenario();
      const other = await scenario();
      const archived = await prisma.project.create({
        data: { workspaceId: ws, name: 'Old', archivedAt: new Date() },
      });
      const foreign = await prisma.project.create({
        data: { workspaceId: other.ws, name: 'F' },
      });
      const blocked = await create(owner.token, ws, {
        title: 'x',
        projectId: archived.id,
      }).expect(409);
      expect(blocked.body.code).toBe('PROJECT_ARCHIVED');
      await create(owner.token, ws, {
        title: 'x',
        projectId: foreign.id,
      }).expect(404);
      await create(owner.token, ws, {
        title: 'x',
        projectId: '00000000-0000-4000-8000-000000000000',
      }).expect(404);
      expect(await prisma.task.count({ where: { workspaceId: ws } })).toBe(0);
      await prisma.project.deleteMany({ where: { workspaceId: other.ws } });
    });

    it('applies the assignment policy at creation', async () => {
      const { owner, admin, member, outsider, ws } = await scenario();
      // Managers may assign any active member; the assignee must really belong to the workspace.
      expect(
        (
          await create(admin.token, ws, {
            title: 'a',
            assigneeId: member.user.id,
          }).expect(201)
        ).body.task.assigneeId,
      ).toBe(member.user.id);
      expect(
        (
          await create(owner.token, ws, {
            title: 'b',
            assigneeId: admin.user.id,
          }).expect(201)
        ).body.task.assigneeId,
      ).toBe(admin.user.id);
      const stranger = await create(owner.token, ws, {
        title: 'c',
        assigneeId: outsider.user.id,
      }).expect(422);
      expect(stranger.body.code).toBe('INVALID_ASSIGNEE');
      await prisma.workspaceMember.updateMany({
        where: { workspaceId: ws, userId: admin.user.id },
        data: { membershipStatus: 'INACTIVE' },
      });
      await create(owner.token, ws, {
        title: 'd',
        assigneeId: admin.user.id,
      }).expect(422);
      // A plain member may only assign themselves.
      await create(member.token, ws, {
        title: 'e',
        assigneeId: member.user.id,
      }).expect(201);
      await create(member.token, ws, {
        title: 'f',
        assigneeId: owner.user.id,
      }).expect(403);
    });

    it('takes effect at once when a role is revoked', async () => {
      const { member, ws } = await scenario();
      await create(member.token, ws, { title: 'one' }).expect(201);
      await prisma.workspaceMember.updateMany({
        where: { workspaceId: ws, userId: member.user.id },
        data: { membershipStatus: 'INACTIVE' },
      });
      await create(member.token, ws, { title: 'two' }).expect(404);
    });

    it('enforces the per-workspace limit, also under concurrent creation', async () => {
      const { owner, ws } = await scenario();
      await prisma.task.createMany({
        data: Array.from({ length: MAX_TASKS_PER_WORKSPACE - 2 }, (_, i) => ({
          workspaceId: ws,
          createdById: owner.user.id,
          title: `t${i}`,
          position: BigInt((i + 1) * 1024),
          status: i % 2 === 0 ? ('DONE' as const) : ('CANCELED' as const),
          completedAt: i % 2 === 0 ? new Date() : null,
        })),
      });
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          create(owner.token, ws, { title: `race${i}` }),
        ),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(2);
      const rejected = results.filter((r) => r.status === 409);
      expect(rejected).toHaveLength(3);
      expect(rejected[0]!.body.code).toBe('TASK_LIMIT_REACHED');
      expect(await prisma.task.count({ where: { workspaceId: ws } })).toBe(
        MAX_TASKS_PER_WORKSPACE,
      );
    }, 60_000);
  });

  describe('GET /workspaces/:w/tasks/:id', () => {
    const get = (token: string, ws: string, id: string) =>
      http()
        .get(`${base(ws)}/${id}`)
        .set(auth(token));

    it('returns a live task to any member', async () => {
      const { owner, member, ws } = await scenario();
      const { id } = (
        await create(owner.token, ws, { title: 'Read me' }).expect(201)
      ).body.task;
      const res = await get(member.token, ws, id).expect(200);
      expect(taskResponseSchema.safeParse(res.body).success).toBe(true);
      expect(res.body.task).toMatchObject({ id, title: 'Read me', version: 1 });
      expect(res.headers['cache-control']).toBe('private, no-store');
    });

    it('is a plain 404 for outsiders, deleted tasks, other workspaces and bad ids', async () => {
      const { owner, outsider, ws } = await scenario();
      const other = await scenario();
      const { id } = (
        await create(owner.token, ws, { title: 'Mine' }).expect(201)
      ).body.task;
      const gone = await prisma.task.create({
        data: {
          workspaceId: ws,
          createdById: owner.user.id,
          title: 'Gone',
          position: 9999n,
          deletedAt: new Date(),
        },
      });

      await http()
        .get(`${base(ws)}/${id}`)
        .expect(401);
      await get(outsider.token, ws, id).expect(404);
      await get(owner.token, ws, gone.id).expect(404); // the trash is a separate path
      await get(other.owner.token, other.ws, id).expect(404); // right user, wrong workspace for this task
      await get(owner.token, ws, 'not-a-uuid').expect(404);
      await get(owner.token, ws, '00000000-0000-4000-8000-000000000000').expect(
        404,
      );
    });
  });

  describe('GET /workspaces/:w/tasks', () => {
    const list = (token: string, ws: string, query = '') =>
      http()
        .get(`${base(ws)}${query}`)
        .set(auth(token));
    const titles = (res: { body: { tasks: Array<{ title: string }> } }) =>
      res.body.tasks.map((t) => t.title);

    it('lists live tasks only, never deleted ones, and is readable by any member', async () => {
      const { owner, member, ws } = await scenario();
      await create(owner.token, ws, { title: 'one' }).expect(201);
      await create(owner.token, ws, { title: 'two' }).expect(201);
      await prisma.task.create({
        data: {
          workspaceId: ws,
          createdById: owner.user.id,
          title: 'deleted',
          position: 9999n,
          deletedAt: new Date(),
        },
      });
      const res = await list(member.token, ws).expect(200);
      expect(listTasksResponseSchema.safeParse(res.body).success).toBe(true);
      expect(titles(res)).toEqual(['one', 'two']);
      expect(res.body.nextCursor).toBeNull();
      expect(res.headers['cache-control']).toBe('private, no-store');
    });

    it('filters by project / Inbox, status, priority, assignee and title text', async () => {
      const { owner, member, ws } = await scenario();
      const project = await prisma.project.create({
        data: { workspaceId: ws, name: 'P' },
      });
      await create(owner.token, ws, {
        title: 'Inbox milk',
        priority: 'LOW',
      }).expect(201);
      await create(owner.token, ws, {
        title: 'Project report',
        projectId: project.id,
        priority: 'HIGH',
        assigneeId: member.user.id,
      }).expect(201);
      await create(owner.token, ws, {
        title: 'Project MILK run',
        projectId: project.id,
      }).expect(201);
      await prisma.task.updateMany({
        where: { workspaceId: ws, title: 'Project report' },
        data: { status: 'IN_PROGRESS' },
      });

      expect(
        titles(await list(owner.token, ws, '?projectId=inbox').expect(200)),
      ).toEqual(['Inbox milk']);
      expect(
        titles(
          await list(owner.token, ws, `?projectId=${project.id}`).expect(200),
        ).sort(),
      ).toEqual(['Project MILK run', 'Project report']);
      expect(
        titles(await list(owner.token, ws, '?status=IN_PROGRESS').expect(200)),
      ).toEqual(['Project report']);
      expect(
        titles(await list(owner.token, ws, '?priority=LOW').expect(200)),
      ).toEqual(['Inbox milk']);
      expect(
        titles(
          await list(owner.token, ws, `?assigneeId=${member.user.id}`).expect(
            200,
          ),
        ),
      ).toEqual(['Project report']);
      expect(
        titles(
          await list(owner.token, ws, '?assigneeId=unassigned').expect(200),
        ).sort(),
      ).toEqual(['Inbox milk', 'Project MILK run']);
      expect(
        titles(await list(owner.token, ws, '?q=milk').expect(200)).sort(),
      ).toEqual(['Inbox milk', 'Project MILK run']);
      expect(
        titles(
          await list(owner.token, ws, `?q=milk&projectId=${project.id}`).expect(
            200,
          ),
        ),
      ).toEqual(['Project MILK run']);
    });

    it('treats search text literally, not as a pattern', async () => {
      const { owner, ws } = await scenario();
      await create(owner.token, ws, { title: '100% done' }).expect(201);
      await create(owner.token, ws, { title: 'plain' }).expect(201);
      expect(titles(await list(owner.token, ws, '?q=%25').expect(200))).toEqual(
        ['100% done'],
      );
      expect(titles(await list(owner.token, ws, '?q=_').expect(200))).toEqual(
        [],
      );
    });

    it('does not show another workspace project through a filter', async () => {
      const { owner, ws } = await scenario();
      const other = await scenario();
      const foreign = await prisma.project.create({
        data: { workspaceId: other.ws, name: 'F' },
      });
      await create(other.owner.token, other.ws, {
        title: 'theirs',
        projectId: foreign.id,
      }).expect(201);
      expect(
        (await list(owner.token, ws, `?projectId=${foreign.id}`).expect(200))
          .body.tasks,
      ).toEqual([]);
      await prisma.task.deleteMany({ where: { workspaceId: other.ws } });
      await prisma.project.deleteMany({ where: { workspaceId: other.ws } });
    });

    it('pages through results with a cursor, without gaps or repeats', async () => {
      const { owner, ws } = await scenario();
      for (let i = 1; i <= 5; i++)
        await create(owner.token, ws, { title: `t${i}` }).expect(201);
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const query: string = `?limit=2${cursor ? `&cursor=${cursor}` : ''}`;
        const res = await list(owner.token, ws, query).expect(200);
        seen.push(...titles(res));
        cursor = res.body.nextCursor as string | null;
        pages++;
      } while (cursor && pages < 10);
      expect(pages).toBe(3);
      expect(seen).toEqual(['t1', 't2', 't3', 't4', 't5']);
    });

    it('rejects unknown filters (there is no way to ask for deleted tasks), bad values and bad cursors', async () => {
      const { owner, ws } = await scenario();
      for (const query of [
        '?deleted=true',
        '?includeDeleted=1',
        '?status=NOPE',
        '?projectId=x',
        '?limit=0',
        '?limit=101',
        '?cursor=***',
        '?cursor=aaaa',
      ]) {
        await list(owner.token, ws, query).expect(400);
      }
    });

    it('answers 401 without a token and 404 to outsiders', async () => {
      const { outsider, ws } = await scenario();
      await http().get(base(ws)).expect(401);
      await list(outsider.token, ws).expect(404);
    });
  });

  describe('PATCH /workspaces/:w/tasks/:id', () => {
    const patch = (token: string, ws: string, id: string, body: unknown) =>
      http()
        .patch(`${base(ws)}/${id}`)
        .set(auth(token))
        .send(body as object);
    const stored = (id: string) =>
      prisma.task.findUniqueOrThrow({ where: { id } });

    async function oneTask(extra: Record<string, unknown> = {}) {
      const s = await scenario();
      const { id } = (
        await create(s.owner.token, s.ws, {
          title: 'Original',
          description: 'old',
          priority: 'LOW',
          dueAt: '2026-10-12T00:00:00Z',
          ...extra,
        }).expect(201)
      ).body.task;
      return { ...s, id };
    }

    it('changes details, bumps the version and leaves everything else alone', async () => {
      const { owner, ws, id } = await oneTask();
      const before = await stored(id);
      const res = await patch(owner.token, ws, id, {
        version: 1,
        title: '  Renamed ',
        priority: 'URGENT',
        dueAt: '2026-11-01T10:00:00+01:00',
      }).expect(200);
      expect(taskResponseSchema.safeParse(res.body).success).toBe(true);
      expect(res.body.task).toMatchObject({
        title: 'Renamed',
        description: 'old',
        priority: 'URGENT',
        dueAt: '2026-11-01T09:00:00.000Z',
        version: 2,
        status: 'TODO',
        position: '1024',
      });
      const after = await stored(id);
      expect(after.updatedAt.getTime()).toBeGreaterThan(
        before.updatedAt.getTime(),
      );
      expect(after.createdAt).toEqual(before.createdAt);
      expect(after.createdById).toBe(before.createdById);
    });

    it('clears the description and the deadline with blank / null', async () => {
      const { owner, ws, id } = await oneTask();
      const res = await patch(owner.token, ws, id, {
        version: 1,
        description: '   ',
        dueAt: null,
      }).expect(200);
      expect(res.body.task).toMatchObject({
        description: null,
        dueAt: null,
        version: 2,
      });
    });

    it('lets any member edit any live task, but not an outsider', async () => {
      const { member, outsider, ws, id } = await oneTask();
      await patch(member.token, ws, id, {
        version: 1,
        title: 'By member',
      }).expect(200);
      await patch(outsider.token, ws, id, { version: 2, title: 'Nope' }).expect(
        404,
      );
      await http()
        .patch(`${base(ws)}/${id}`)
        .send({ version: 2, title: 'x' })
        .expect(401);
      expect((await stored(id)).title).toBe('By member');
    });

    it('rejects a stale version and changes nothing', async () => {
      const { owner, ws, id } = await oneTask();
      await patch(owner.token, ws, id, { version: 1, title: 'First' }).expect(
        200,
      );
      const stale = await patch(owner.token, ws, id, {
        version: 1,
        title: 'Second',
      }).expect(409);
      expect(stale.body.code).toBe('TASK_VERSION_CONFLICT');
      await patch(owner.token, ws, id, { version: 99, title: 'Future' }).expect(
        409,
      );
      expect(await stored(id)).toMatchObject({ title: 'First', version: 2 });
    });

    it('lets exactly one of several concurrent edits with the same version win', async () => {
      const { owner, ws, id } = await oneTask();
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          patch(owner.token, ws, id, { version: 1, title: `edit ${i}` }),
        ),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(5);
      expect((await stored(id)).version).toBe(2);
    });

    it('rejects fields that belong to other operations, and empty changes', async () => {
      const { owner, member, ws, id } = await oneTask();
      for (const body of [
        { version: 1 },
        { title: 'no version' },
        { version: 0, title: 'x' },
        { version: 1, status: 'DONE' },
        { version: 1, assigneeId: member.user.id },
        { version: 1, projectId: null },
        { version: 1, position: '5' },
        { version: 1, deletedAt: null },
        { version: 1, createdById: member.user.id },
        { version: 1, title: ' ' },
        { version: 1, dueAt: '2026-10-12' },
      ]) {
        await patch(owner.token, ws, id, body).expect(400);
      }
      expect(await stored(id)).toMatchObject({
        title: 'Original',
        version: 1,
        status: 'TODO',
      });
    });

    it('keeps completedAt when editing a finished task', async () => {
      const { owner, ws, id } = await oneTask();
      const finished = new Date('2026-10-10T10:00:00Z');
      await prisma.task.update({
        where: { id },
        data: { status: 'DONE', completedAt: finished },
      });
      await patch(owner.token, ws, id, {
        version: 1,
        title: 'Still done',
      }).expect(200);
      expect(await stored(id)).toMatchObject({
        status: 'DONE',
        completedAt: finished,
      });
    });

    it('is frozen while its project is archived', async () => {
      const { owner, ws } = await oneTask();
      const project = await prisma.project.create({
        data: { workspaceId: ws, name: 'P' },
      });
      const { id } = (
        await create(owner.token, ws, {
          title: 'In project',
          projectId: project.id,
        }).expect(201)
      ).body.task;
      await prisma.project.update({
        where: { id: project.id },
        data: { archivedAt: new Date() },
      });
      const blocked = await patch(owner.token, ws, id, {
        version: 1,
        title: 'Nope',
      }).expect(409);
      expect(blocked.body.code).toBe('PROJECT_ARCHIVED');
      await http()
        .get(`${base(ws)}/${id}`)
        .set(auth(owner.token))
        .expect(200); // still readable
      expect((await stored(id)).title).toBe('In project');
    });

    it('is a plain 404 for deleted tasks, other workspaces and bad ids', async () => {
      const { owner, ws, id } = await oneTask();
      const other = await scenario();
      const gone = await prisma.task.create({
        data: {
          workspaceId: ws,
          createdById: owner.user.id,
          title: 'Gone',
          position: 9999n,
          deletedAt: new Date(),
        },
      });
      await patch(owner.token, ws, gone.id, { version: 1, title: 'x' }).expect(
        404,
      );
      await patch(other.owner.token, other.ws, id, {
        version: 1,
        title: 'x',
      }).expect(404);
      await patch(owner.token, ws, 'not-a-uuid', {
        version: 1,
        title: 'x',
      }).expect(404);
      expect((await stored(gone.id)).title).toBe('Gone');
    });
  });
});
