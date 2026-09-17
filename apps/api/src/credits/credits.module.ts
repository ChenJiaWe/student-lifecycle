import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CreditsService } from './credits.service';

@Module({
  imports: [AuthModule],
  providers: [CreditsService],
  exports: [CreditsService],
})
export class CreditsModule {}
