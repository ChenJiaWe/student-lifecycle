import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from '../auth/auth.module';
import { CreditsModule } from '../credits/credits.module';
import { SchedulingController } from './scheduling.controller';
import { SchedulingService } from './scheduling.service';
import { TrialsController, SessionsExtendController } from './trials.controller';
import { SessionCronService } from './session-cron.service';

@Module({
  imports: [ScheduleModule.forRoot(), AuthModule, CreditsModule],
  controllers: [SchedulingController, TrialsController, SessionsExtendController],
  providers: [SchedulingService, SessionCronService],
  exports: [SchedulingService],
})
export class SchedulingModule {}
