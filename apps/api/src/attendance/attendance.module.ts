import { Module } from '@nestjs/common';
import { CreditsModule } from '../credits/credits.module';
import { TasksModule } from '../tasks/tasks.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';

@Module({
  imports: [CreditsModule, TasksModule],
  controllers: [AttendanceController],
  providers: [AttendanceService],
})
export class AttendanceModule {}
