import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { AppConfigModule } from '../config/app.config.js';

@Module({
  imports: [AppConfigModule],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
