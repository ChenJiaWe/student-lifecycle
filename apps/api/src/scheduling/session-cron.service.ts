import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SchedulingService } from './scheduling.service';

/**
 * 课次滚动补齐 cron。
 *
 * enrollStudent 入学时只生成 2 周课次，之后由这里每周一凌晨 2 时
 * （墨尔本）补全未来 4 周的空缺课次。幂等操作——已有课次不重建。
 */
@Injectable()
export class SessionCronService {
  private readonly logger = new Logger(SessionCronService.name);

  constructor(private readonly scheduling: SchedulingService) {}

  @Cron('0 2 * * 1', { timeZone: 'Australia/Melbourne' })
  async rollUpcomingSessions() {
    this.logger.log('开始课次滚动补齐…');
    const result = await this.scheduling.extendUpcomingSessions(4);
    this.logger.log(
      `课次补齐完成：检查 ${result.groupsChecked} 个班，新建 ${result.sessionsCreated} 节课次`,
    );
  }
}
