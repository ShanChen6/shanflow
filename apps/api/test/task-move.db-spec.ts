import type { INestApplication } from '@nestjs/common';
import { moveTaskResponseSchema } from '@shanflow/contracts';
import { PrismaService } from '../src/database/prisma.service.js';
import { POSITION_MAX } from '../src/features/task/shared/position.js';
import { createTestApp, deleteUsers } from './support/db-test-support.js';
import { teamFixtures } from './support/team-fixtures.js';

describe('moving and reordering tasks (database)', () => {
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

  type Scenario = Awaited<ReturnType<typeof fx.scenario>>;
  const move = (
    token: string,
    ws: string,
    id: string,
    body: Record<string, unknown>,
  ) =>
    http()
      .post(`${base(ws)}/${id}/move`)
      .set(auth(token))
      .send(body);
  const stored = (id: string) =>
    prisma.task.findUniqueOrThrow({ where: { id } });
  const project = (ws: string, name = 'P', archivedAt: Date | null = null) =>
    prisma.project.create({ data: { workspaceId: ws, name, archivedAt } });

  /** Creates tasks "A", "B", … in one lane (Inbox by default) and returns their ids in lane order. */
  async function lane(
    s: Scenario,
    titles: string[],
    extra: Record<string, unknown> = {},
  ) {
    const ids: string[] = [];
    for (const title of titles)
      ids.push(
        (
          await fx
            .createTask(s.owner.token, s.ws, { title, ...extra })
            .expect(201)
        ).body.task.id,
      );
    return ids;
  }
  /** The titles of a lane in display order, straight from the database. */
  async function order(
    s: Scenario,
    projectId: string | null = null,
    status = 'TODO',
  ) {
    const rows = await prisma.task.findMany({
      where: {
        workspaceId: s.ws,
        projectId,
        status: status as never,
        deletedAt: null,
      },
      orderBy: { position: 'asc' },
      select: { title: true },
    });
    return rows.map((r) => r.title).join('');
  }

  describe('reordering inside a lane', () => {
    it('puts a task before a neighbour, using the gap and touching nobody else', async () => {
      const s = await fx.scenario();
      const [a, b, c] = await lane(s, ['A', 'B', 'C']); // 1024, 2048, 3072
      const res = await move(s.owner.token, s.ws, c!, {
        version: 1,
        beforeId: b,
      }).expect(200);
      expect(moveTaskResponseSchema.safeParse(res.body).success).toBe(true);
      expect(res.body.task).toMatchObject({
        position: '1536',
        version: 2,
        projectId: null,
        status: 'TODO',
      });
      expect(res.body.laneRebalanced).toBe(false);
      expect(await order(s)).toBe('ACB');
      expect(await stored(a!)).toMatchObject({ position: 1024n, version: 1 });
      expect(await stored(b!)).toMatchObject({ position: 2048n, version: 1 });
      expect(res.headers['cache-control']).toBe('private, no-store');
    });

    it('puts a task after a neighbour, at the very start, and at the very end', async () => {
      const s = await fx.scenario();
      const [a, b, c] = await lane(s, ['A', 'B', 'C']);
      await move(s.owner.token, s.ws, a!, { version: 1, afterId: b }).expect(
        200,
      );
      expect(await order(s)).toBe('BAC');
      await move(s.owner.token, s.ws, c!, { version: 1, beforeId: b }).expect(
        200,
      ); // before the first task
      expect(await order(s)).toBe('CBA');
      await move(s.owner.token, s.ws, c!, { version: 2 }).expect(200); // no neighbour: the end
      expect(await order(s)).toBe('BAC');
      expect((await stored(c!)).position).toBeGreaterThan(
        (await stored(a!)).position,
      );
    });

    it('leaves every other lane alone: other statuses, other projects', async () => {
      const s = await fx.scenario();
      const p = await project(s.ws);
      const [a, b] = await lane(s, ['A', 'B']);
      const [inProject] = await lane(s, ['P'], { projectId: p.id });
      const [started] = await lane(s, ['S']);
      await http()
        .post(`${base(s.ws)}/${started}/status`)
        .set(auth(s.owner.token))
        .send({ status: 'IN_PROGRESS', version: 1 })
        .expect(200);
      const before = [await stored(inProject!), await stored(started!)];

      await move(s.owner.token, s.ws, b!, { version: 1, beforeId: a }).expect(
        200,
      );

      expect(await order(s)).toBe('BA');
      const after = [await stored(inProject!), await stored(started!)];
      expect(after.map((t) => [t.position, t.version])).toEqual(
        before.map((t) => [t.position, t.version]),
      );
    });

    it('is a no-op when the task is already exactly there, even with an out-of-date version', async () => {
      const s = await fx.scenario();
      const [a, b, c] = await lane(s, ['A', 'B', 'C']);
      const before = await stored(b!);
      await new Promise((resolve) => setTimeout(resolve, 20));
      for (const body of [
        { version: 1, beforeId: c },
        { version: 1, afterId: a },
        { version: 9, beforeId: c },
      ]) {
        const res = await move(s.owner.token, s.ws, b!, body).expect(200);
        expect(res.body).toMatchObject({
          laneRebalanced: false,
          task: { version: 1, position: '2048' },
        });
      }
      await move(s.owner.token, s.ws, c!, { version: 1 }).expect(200); // already last
      const after = await stored(b!);
      expect(after.version).toBe(1);
      expect(after.updatedAt).toEqual(before.updatedAt);
      expect((await stored(c!)).version).toBe(1);
    });
  });

  describe('invalid placements', () => {
    it('refuses neighbours that are not in the destination lane, and the task itself', async () => {
      const s = await fx.scenario();
      const [a] = await lane(s, ['A', 'B']);
      const p = await project(s.ws);
      const [inProject] = await lane(s, ['P1'], { projectId: p.id });
      const [started] = await lane(s, ['S']);
      await http()
        .post(`${base(s.ws)}/${started}/status`)
        .set(auth(s.owner.token))
        .send({ status: 'IN_PROGRESS', version: 1 })
        .expect(200);
      const [gone] = await lane(s, ['G']);
      await http()
        .delete(`${base(s.ws)}/${gone}?version=1`)
        .set(auth(s.owner.token))
        .expect(200);
      const foreign = await fx.scenario();
      const foreignTask = (
        await fx.createTask(foreign.owner.token, foreign.ws).expect(201)
      ).body.task.id;

      const notNeighbours = {
        'another project': inProject,
        'another status': started,
        deleted: gone,
        'another workspace': foreignTask,
        unknown: '00000000-0000-4000-8000-000000000000',
        itself: a,
      };
      for (const [why, neighbour] of Object.entries(notNeighbours)) {
        for (const side of ['beforeId', 'afterId'] as const) {
          const res = await move(s.owner.token, s.ws, a!, {
            version: 1,
            [side]: neighbour,
          });
          expect([why, side, res.status, res.body.code]).toEqual([
            why,
            side,
            422,
            'INVALID_PLACEMENT',
          ]);
        }
      }
      expect(await stored(a!)).toMatchObject({ version: 1, position: 1024n });
    });
  });

  describe('between projects', () => {
    it('moves an Inbox task to the end of the same-status lane of a project, freeing its old rank', async () => {
      const s = await fx.scenario();
      const p = await project(s.ws);
      const [a, b] = await lane(s, ['A', 'B']);
      await lane(s, ['P1', 'P2'], { projectId: p.id });
      const res = await move(s.owner.token, s.ws, a!, {
        version: 1,
        projectId: p.id,
      }).expect(200);
      expect(res.body.task).toMatchObject({
        projectId: p.id,
        status: 'TODO',
        position: '3072',
        version: 2,
      });
      expect(await order(s, p.id)).toBe('P1P2A');
      expect(await order(s)).toBe('B');
      expect(await stored(b!)).toMatchObject({ position: 2048n, version: 1 });
      const next = await fx
        .createTask(s.owner.token, s.ws, { title: 'N' })
        .expect(201);
      expect(next.body.task.position).toBe('3072'); // appended after B; the old 1024 is free but not reused by appending
    });

    it('can land between two tasks of the destination project', async () => {
      const s = await fx.scenario();
      const p = await project(s.ws);
      const [a] = await lane(s, ['A']);
      const [p1, p2] = await lane(s, ['P1', 'P2'], { projectId: p.id });
      await move(s.owner.token, s.ws, a!, {
        version: 1,
        projectId: p.id,
        afterId: p1,
      }).expect(200);
      expect(await order(s, p.id)).toBe('P1AP2');
      expect(p2).toBeDefined();
    });

    it('moves back to Inbox with null, and between two projects', async () => {
      const s = await fx.scenario();
      const p = await project(s.ws, 'P');
      const q = await project(s.ws, 'Q');
      const [a] = await lane(s, ['A'], { projectId: p.id });
      expect(
        (
          await move(s.owner.token, s.ws, a!, {
            version: 1,
            projectId: q.id,
          }).expect(200)
        ).body.task.projectId,
      ).toBe(q.id);
      expect(
        (
          await move(s.owner.token, s.ws, a!, {
            version: 2,
            projectId: null,
          }).expect(200)
        ).body.task.projectId,
      ).toBeNull();
    });

    it("keeps the task's status and completion, joining the lane of that status", async () => {
      const s = await fx.scenario();
      const p = await project(s.ws);
      const [a] = await lane(s, ['A']);
      const done = (
        await http()
          .post(`${base(s.ws)}/${a}/status`)
          .set(auth(s.owner.token))
          .send({ status: 'DONE', version: 1 })
          .expect(200)
      ).body.task;
      const res = await move(s.owner.token, s.ws, a!, {
        version: 2,
        projectId: p.id,
      }).expect(200);
      expect(res.body.task).toMatchObject({
        status: 'DONE',
        completedAt: done.completedAt,
        projectId: p.id,
        position: '1024',
      });
    });

    it('keeps the assignee and every other detail', async () => {
      const s = await fx.scenario();
      const p = await project(s.ws);
      const [a] = await lane(s, ['A'], {
        assigneeId: s.member.user.id,
        priority: 'HIGH',
        dueAt: '2026-12-01T10:00:00Z',
      });
      const res = await move(s.owner.token, s.ws, a!, {
        version: 1,
        projectId: p.id,
      }).expect(200);
      expect(res.body.task).toMatchObject({
        assigneeId: s.member.user.id,
        priority: 'HIGH',
        dueAt: '2026-12-01T10:00:00.000Z',
        title: 'A',
      });
    });

    it('is a no-op to move into the project it is already in, at the place it already holds', async () => {
      const s = await fx.scenario();
      const p = await project(s.ws);
      const [a] = await lane(s, ['A'], { projectId: p.id });
      const res = await move(s.owner.token, s.ws, a!, {
        version: 1,
        projectId: p.id,
      }).expect(200);
      expect(res.body.task.version).toBe(1);
    });

    it('refuses archived, foreign and unknown projects, and freezes tasks of an archived one', async () => {
      const s = await fx.scenario();
      const archived = await project(s.ws, 'Old', new Date());
      const foreign = await fx.scenario();
      const foreignProject = await project(foreign.ws, 'F');
      const [a] = await lane(s, ['A']);
      expect(
        (
          await move(s.owner.token, s.ws, a!, {
            version: 1,
            projectId: archived.id,
          }).expect(409)
        ).body.code,
      ).toBe('PROJECT_ARCHIVED');
      await move(s.owner.token, s.ws, a!, {
        version: 1,
        projectId: foreignProject.id,
      }).expect(404);
      await move(s.owner.token, s.ws, a!, {
        version: 1,
        projectId: '00000000-0000-4000-8000-000000000000',
      }).expect(404);

      const live = await project(s.ws, 'Live');
      const [b] = await lane(s, ['B'], { projectId: live.id });
      await prisma.project.update({
        where: { id: live.id },
        data: { archivedAt: new Date() },
      });
      expect(
        (
          await move(s.owner.token, s.ws, b!, {
            version: 1,
            projectId: null,
          }).expect(409)
        ).body.code,
      ).toBe('PROJECT_ARCHIVED');
      expect(await stored(a!)).toMatchObject({ projectId: null, version: 1 });
      expect(await stored(b!)).toMatchObject({
        projectId: live.id,
        version: 1,
      });
    });
  });

  describe('when a lane has no room left', () => {
    it('renumbers the lane and still puts the task exactly where it was asked', async () => {
      const s = await fx.scenario();
      const [a, b, c] = await lane(s, ['A', 'B', 'C']);
      await prisma.task.update({ where: { id: a }, data: { position: 5n } });
      await prisma.task.update({ where: { id: b }, data: { position: 6n } });
      await prisma.task.update({ where: { id: c }, data: { position: 7n } });

      const res = await move(s.owner.token, s.ws, c!, {
        version: 1,
        beforeId: b,
      }).expect(200);
      expect(res.body.laneRebalanced).toBe(true);
      expect(await order(s)).toBe('ACB');
      const ranks = (
        await prisma.task.findMany({
          where: { workspaceId: s.ws },
          orderBy: { position: 'asc' },
        })
      ).map((t) => t.position);
      expect(ranks.length).toBe(new Set(ranks).size);
      expect(
        ranks.every((r) => r % 1024n === 0n || r === BigInt(res.body.task.position)),
      ).toBe(true);
      expect((await stored(a!)).version).toBe(2); // renumbered tasks are marked as changed
    });

    it('renumbers when the start of the lane is full (a task at rank 0)', async () => {
      const s = await fx.scenario();
      const [a, b] = await lane(s, ['A', 'B']);
      await prisma.task.update({ where: { id: a }, data: { position: 0n } });
      const res = await move(s.owner.token, s.ws, b!, {
        version: 1,
        beforeId: a,
      }).expect(200);
      expect(res.body.laneRebalanced).toBe(true);
      expect(await order(s)).toBe('BA');
    });

    it('renumbers when the end of the lane is at the top of the int64 range', async () => {
      const s = await fx.scenario();
      const [a, b, c] = await lane(s, ['A', 'B', 'C']);
      await prisma.task.update({
        where: { id: a },
        data: { position: POSITION_MAX - 1n },
      });
      await prisma.task.update({
        where: { id: b },
        data: { position: POSITION_MAX },
      });
      await prisma.task.update({ where: { id: c }, data: { position: 10n } });
      const res = await move(s.owner.token, s.ws, c!, { version: 1 }).expect(
        200,
      ); // to the end
      expect(res.body.laneRebalanced).toBe(true);
      expect(await order(s)).toBe('ABC');
      expect(BigInt(res.body.task.position)).toBeLessThan(POSITION_MAX);
    });

    it('does not disturb other lanes, tombstones or other workspaces', async () => {
      const s = await fx.scenario();
      const p = await project(s.ws);
      const [a, b] = await lane(s, ['A', 'B']);
      const [other] = await lane(s, ['O'], { projectId: p.id });
      const gone = (await lane(s, ['G']))[0]!;
      await http()
        .delete(`${base(s.ws)}/${gone}?version=1`)
        .set(auth(s.owner.token))
        .expect(200);
      await prisma.task.update({ where: { id: a }, data: { position: 5n } });
      await prisma.task.update({ where: { id: b }, data: { position: 6n } });
      const elsewhere = await fx.scenario();
      const foreign = (
        await fx.createTask(elsewhere.owner.token, elsewhere.ws).expect(201)
      ).body.task.id;

      await move(s.owner.token, s.ws, b!, { version: 1, beforeId: a }).expect(
        200,
      );
      expect(await stored(other!)).toMatchObject({
        position: 1024n,
        version: 1,
      });
      expect(await stored(gone)).toMatchObject({
        deletedAt: expect.any(Date),
        version: 2,
      });
      expect(await stored(foreign)).toMatchObject({
        position: 1024n,
        version: 1,
      });
    });
  });

  describe('concurrency', () => {
    it('gives distinct ranks to many tasks moved to the end of the same lane at once', async () => {
      const s = await fx.scenario();
      const ids = await lane(s, ['A', 'B', 'C', 'D', 'E', 'F']);
      const p = await project(s.ws);
      const results = await Promise.all(
        ids.map((id) =>
          move(s.owner.token, s.ws, id, { version: 1, projectId: p.id }),
        ),
      );
      expect(results.map((r) => r.status)).toEqual(Array(6).fill(200));
      const ranks = (
        await prisma.task.findMany({
          where: { projectId: p.id },
          select: { position: true },
        })
      ).map((t) => t.position);
      expect(new Set(ranks).size).toBe(6);
    });

    it('lets only one of several different moves of the same task with the same version win', async () => {
      const s = await fx.scenario();
      const [a, b, c] = await lane(s, ['A', 'B', 'C']);
      const results = await Promise.all(
        [{ beforeId: b }, { afterId: c }, { beforeId: c }].map((placement) =>
          move(s.owner.token, s.ws, a!, { version: 1, ...placement }),
        ),
      );
      expect(
        results.filter((r) => r.status === 200).length,
      ).toBeGreaterThanOrEqual(1);
      expect(results.every((r) => r.status === 200 || r.status === 409)).toBe(
        true,
      );
      expect((await stored(a!)).version).toBeLessThanOrEqual(2);
    });

    it('rejects a stale version when the move would really change the order', async () => {
      const s = await fx.scenario();
      const [a, b, c] = await lane(s, ['A', 'B', 'C']);
      await move(s.owner.token, s.ws, a!, { version: 1, afterId: c }).expect(
        200,
      );
      const stale = await move(s.owner.token, s.ws, a!, {
        version: 1,
        beforeId: b,
      }).expect(409);
      expect(stale.body.code).toBe('TASK_VERSION_CONFLICT');
    });
  });

  describe('guards', () => {
    it('lets any member move tasks', async () => {
      const s = await fx.scenario();
      const [a, b] = await lane(s, ['A', 'B']);
      await move(s.member.token, s.ws, b!, { version: 1, beforeId: a }).expect(
        200,
      );
    });

    it('answers 401 without a token and 404 to outsiders, deleted tasks, other workspaces and bad ids', async () => {
      const s = await fx.scenario();
      const other = await fx.scenario();
      const [a, b] = await lane(s, ['A', 'B']);
      await http()
        .post(`${base(s.ws)}/${a}/move`)
        .send({ version: 1 })
        .expect(401);
      await move(s.outsider.token, s.ws, a!, { version: 1 }).expect(404);
      await move(other.owner.token, other.ws, a!, { version: 1 }).expect(404);
      await move(s.owner.token, s.ws, 'not-a-uuid', { version: 1 }).expect(404);
      await http()
        .delete(`${base(s.ws)}/${b}?version=1`)
        .set(auth(s.owner.token))
        .expect(200);
      await move(s.owner.token, s.ws, b!, { version: 2 }).expect(404);
    });

    it('rejects ranks, statuses, both neighbours at once, a bad version and extra fields', async () => {
      const s = await fx.scenario();
      const [a, b, c] = await lane(s, ['A', 'B', 'C']);
      for (const body of [
        {},
        { version: 0 },
        { version: 1, position: '1024' },
        { version: 1, status: 'DONE' },
        { version: 1, beforeId: b, afterId: c },
        { version: 1, beforeId: 'first' },
        { version: 1, projectId: 'inbox' },
      ]) {
        await move(s.owner.token, s.ws, a!, body).expect(400);
      }
      expect(await stored(a!)).toMatchObject({ position: 1024n, version: 1 });
    });
  });
});
