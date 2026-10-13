import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module.js';
import { PersonalWorkspaceService } from './shared/personal-workspace.service.js';
import { WorkspaceAccessService } from './shared/workspace-access.service.js';

/**
 * The workspace services other features depend on. It needs only the database, so both AuthModule (signup creates the
 * personal workspace) and WorkspaceModule (routes) can import it without a circular dependency.
 */
@Module({
  imports: [PrismaModule],
  providers: [WorkspaceAccessService, PersonalWorkspaceService],
  exports: [WorkspaceAccessService, PersonalWorkspaceService],
})
export class WorkspaceCoreModule {}
