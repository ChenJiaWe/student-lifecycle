import {
  ArgumentsHost,
  Catch,
  ConflictException,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

/**
 * 把 Prisma 错误翻译成合适的 HTTP 状态码。
 *
 * 为什么必须做：不转换的话，违反数据库约束（余额为负、老师时段重叠、
 * 重复试听）全都返回 500 —— 而这些正是破坏测试要打的点。
 * 500 说明"服务端崩了"，409/422 说明"规则拦住了你"，是两回事。
 */
@Catch(Prisma.PrismaClientKnownRequestError, Prisma.PrismaClientUnknownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(
    err: Prisma.PrismaClientKnownRequestError | Prisma.PrismaClientUnknownRequestError,
    host: ArgumentsHost,
  ): void {
    const res = host.switchToHttp().getResponse<Response>();
    const mapped = this.toHttpException(err);

    if (mapped.getStatus() >= 500) {
      this.logger.error(err.message);
    }

    res.status(mapped.getStatus()).json(mapped.getResponse());
  }

  private toHttpException(err: unknown): HttpException {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      switch (err.code) {
        // 唯一约束冲突：重复点名、重复试听（规则 4、5）
        case 'P2002': {
          const target = (err.meta?.target as string[] | string | undefined) ?? '';
          const name = Array.isArray(target) ? target.join(',') : String(target);

          if (name.includes('one_trial_per_student')) {
            return new ConflictException('该学生已经试听过了');
          }
          if (name.includes('idempotencyKey')) {
            return new ConflictException('该操作已执行过');
          }
          return new ConflictException(`唯一约束冲突: ${name}`);
        }

        case 'P2003':
          return new ConflictException('关联数据不存在');

        // 记录不存在：findUniqueOrThrow / update 找不到目标
        case 'P2025':
          return new NotFoundException('记录不存在');

        default:
          break;
      }
    }

    // CHECK / EXCLUDE 约束违反走原始 SQL 错误，只能按消息判断。
    // 这些是业务规则的最后一道墙，必须翻译成 409/422 而不是 500
    const raw = err instanceof Error ? err.message : String(err);

    if (raw.includes('teacher_no_overlap')) {
      return new ConflictException('该老师在这个时段已有其他课程');
    }
    if (raw.includes('credit_balance_non_negative')) {
      return new HttpException('课时余额不足', HttpStatus.UNPROCESSABLE_ENTITY);
    }
    if (raw.includes('one_trial_per_student')) {
      return new ConflictException('该学生已经试听过了');
    }
    if (raw.includes('one_open_task_per_type')) {
      return new ConflictException('该学生已有同类型的待处理任务');
    }
    if (raw.includes('correction_requires_note')) {
      return new HttpException('订正出勤必须填写原因', HttpStatus.UNPROCESSABLE_ENTITY);
    }
    if (raw.includes('session_ends_after_starts')) {
      return new HttpException('课程结束时间必须晚于开始时间', HttpStatus.UNPROCESSABLE_ENTITY);
    }

    return new HttpException('数据库操作失败', HttpStatus.INTERNAL_SERVER_ERROR);
  }
}
