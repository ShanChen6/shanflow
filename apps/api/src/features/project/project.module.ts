import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { WorkspaceCoreModule } from '../workspace/workspace-core.module.js';
import { ProjectController } from './project.controller.js';
import { ProjectHandlers } from './project.handlers.js';

/** Projects inside a workspace. Authorization comes from WorkspaceAccessService; authentication from AuthModule. */
@Module({
  imports: [PrismaModule, AuthModule, WorkspaceCoreModule],
  controllers: [ProjectController],
  providers: [ProjectHandlers],
})
export class ProjectModule {}
