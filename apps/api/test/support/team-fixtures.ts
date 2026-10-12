import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaService } from '../../src/database/prisma.service.js';
import { PASSWORD, createUser } from './db-test-support.js';

/** A TEAM workspace (no API creates one in the MVP) with an owner, an admin and a plain member, plus an outsider. */
export function teamFixtures(
  getApp: () => INestApplication,
  getPrisma: () => PrismaService,
  userIds: string[],
  workspaceIds: string[],
) {
  const http = () => request(getApp().getHttpServer());

  async function signedIn() {
    const user = await createUser(getPrisma(), userIds);
    const login = await http()
      .post('/auth/login')
      .send({ email: user.email, password: PASSWORD })
      .expect(200);
    return { user, token: login.body.accessToken as string };
  }

  async function scenario() {
    const [owner, admin, member, outsider] = [
      await signedIn(),
      await signedIn(),
      await signedIn(),
      await signedIn(),
    ];
    const workspace = await getPrisma().workspace.create({
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

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const base = (workspaceId: string) => `/workspaces/${workspaceId}/tasks`;

  return {
    http,
    auth,
    base,
    signedIn,
    scenario,
    createTask: (
      token: string,
      ws: string,
      body: Record<string, unknown> = {},
    ) =>
      http()
        .post(base(ws))
        .set(auth(token))
        .send({ title: 'Task', ...body }),
  };
}
