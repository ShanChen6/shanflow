import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './database/prisma.module.js';
import { AppConfigModule } from './config/app.config.js';
import { HealthModule } from './health/health.module.js';
import { AuthModule } from './features/auth/auth.module.js';

@Module({
  imports: [AppConfigModule, PrismaModule, HealthModule, AuthModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
