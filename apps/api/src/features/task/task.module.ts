import { Module } from '@nestjs/common';
import { Clock, SystemClock } from '../../shared/clock.js';
import { PrismaModule } from '../../database/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { WorkspaceCoreModule } from '../workspace/workspace-core.module.js';
import {
  LifecycleController,
  TrashController,
} from './lifecycle/lifecycle.controller.js';
import { LifecycleHandlers } from './lifecycle/lifecycle.handlers.js';
import { TaskMutationService } from './shared/task-mutation.service.js';
import { TaskController } from './task.controller.js';
import { TaskHandlers } from './task.handlers.js';
import { TaskStore } from './shared/task-store.service.js';

/**
 * Tasks inside a workspace. 7.1 provides the shared foundation (store, ordering, mapping); the CRUD, lifecycle and
 * ordering routes are added by the following stages.
 */
@Module({
  imports: [PrismaModule, AuthModule, WorkspaceCoreModule],
  controllers: [TaskController, LifecycleController, TrashController],
  providers: [
    { provide: Clock, useClass: SystemClock },
    TaskStore,
    TaskMutationService,
    TaskHandlers,
    LifecycleHandlers,
  ],
  exports: [TaskStore],
})
export class TaskModule {}
