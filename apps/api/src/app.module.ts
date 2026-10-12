import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './database/prisma.module.js';
import { AppConfigModule } from './config/app.config.js';
import { HealthModule } from './health/health.module.js';
import { DomainErrorFilter } from './shared/http/problem-details.filter.js';
import { AuthModule } from './features/auth/auth.module.js';
import { ProjectModule } from './features/project/project.module.js';
import { TaskModule } from './features/task/task.module.js';
import { UserModule } from './features/user/user.module.js';
import { WorkspaceModule } from './features/workspace/workspace.module.js';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    HealthModule,
    AuthModule,
    UserModule,
    WorkspaceModule,
    ProjectModule,
    TaskModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Global for DomainError only: a feature route without a filter would otherwise answer 500 for a guard failure.
    { provide: APP_FILTER, useClass: DomainErrorFilter },
  ],
})
export class AppModule {}
