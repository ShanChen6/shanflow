import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { GetWorkspaceHandler } from './get/get.handler.js';
import { ListWorkspacesHandler } from './list/list.handler.js';
import { ListMembersHandler } from './members/members.handler.js';
import { UpdateWorkspaceHandler } from './update/update.handler.js';
import { WorkspaceController } from './workspace.controller.js';
import { WorkspaceCoreModule } from './workspace-core.module.js';

/** The signed-in user's workspaces. Authentication lives in AuthModule; MVP workspaces are PERSONAL only. */
@Module({
  imports: [PrismaModule, AuthModule, WorkspaceCoreModule],
  controllers: [WorkspaceController],
  providers: [
    ListWorkspacesHandler,
    GetWorkspaceHandler,
    UpdateWorkspaceHandler,
    ListMembersHandler,
  ],
})
export class WorkspaceModule {}
