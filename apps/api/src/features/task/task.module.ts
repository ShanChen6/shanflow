import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { WorkspaceCoreModule } from '../workspace/workspace-core.module.js';
import { TaskStore } from './shared/task-store.service.js';

/**
 * Tasks inside a workspace. 7.1 provides the shared foundation (store, ordering, mapping); the CRUD, lifecycle and
 * ordering routes are added by the following stages.
 */
@Module({
  imports: [PrismaModule, AuthModule, WorkspaceCoreModule],
  providers: [TaskStore],
  exports: [TaskStore],
})
export class TaskModule {}
