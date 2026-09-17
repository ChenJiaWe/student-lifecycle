import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AttendanceStatus, Role } from '@prisma/client';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.module';
import { OwnershipService } from '../auth/ownership.service';
import type { AuthUser } from '../auth/auth.decorators';

/**
 * LLM 输出的 schema。服务端强校验，不信模型的输出形状。
 *
 * 注意这里刻意没有任何数字字段：剩余课时、上课次数、出勤率、金额
 * 一律由数据库渲染。模型只做定性归纳 —— 不让 LLM 碰钱。
 */
export const digestSchema = z.object({
  progress_summary: z.string().min(1).max(200),
  strengths: z.array(z.string().max(60)).min(1).max(3),
  concerns: z.array(z.string().max(60)).max(3),
  risk_level: z.enum(['low', 'medium', 'high']),
  parent_message_draft: z.string().min(1).max(300),
  talking_points: z.array(z.string().max(80)).min(2).max(4),
});

export type Digest = z.infer<typeof digestSchema>;

export type DigestResult =
  | { available: true; digest: Digest; model: string; cached: boolean; generatedAt: Date }
  /** 降级：简报不可用，但续费流程完全不受影响 */
  | { available: false; reason: string };

@Injectable()
export class DigestService {
  private readonly logger = new Logger(DigestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly config: ConfigService,
  ) {}

  /**
   * 续费沟通简报的输入：该学生近 8 次出勤与老师反馈原文。
   *
   * PII 最小化：只传学生代号与课程名，不传真名、电话、家长信息。
   */
  async collectInput(user: AuthUser, studentId: string) {
    if (user.role !== Role.ADMIN) {
      throw new ForbiddenException('简报仅供 admin 使用');
    }
    await this.ownership.assertCanReadStudent(user, studentId);

    const records = await this.prisma.attendance.findMany({
      where: { studentId },
      orderBy: { recordedAt: 'desc' },
      take: 8,
      select: {
        status: true,
        teacherNote: true,
        recordedAt: true,
        session: {
          select: {
            startsAt: true,
            classGroup: { select: { course: { select: { name: true } } } },
          },
        },
      },
    });

    const courseNames = [
      ...new Set(records.map((r) => r.session.classGroup?.course.name).filter(Boolean)),
    ] as string[];

    return {
      // 代号而非真名
      studentRef: `学生${studentId.slice(-4)}`,
      courseNames,
      lessons: records.reverse().map((r) => ({
        date: r.session.startsAt.toISOString().slice(0, 10),
        status: r.status,
        note: r.teacherNote ?? '',
      })),
    };
  }

  /** 输入的指纹，用于缓存（同样输入不重复调用） */
  inputHash(input: unknown): string {
    return createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 32);
  }

  /** 命中缓存则直接返回，省一次调用 */
  async findCached(studentId: string, hash: string): Promise<DigestResult | null> {
    const row = await this.prisma.lessonDigest.findUnique({ where: { inputHash: hash } });
    if (!row) return null;

    const parsed = digestSchema.safeParse(row.payload);
    if (!parsed.success) return null;

    return {
      available: true,
      digest: parsed.data,
      model: row.model,
      cached: true,
      generatedAt: row.createdAt,
    };
  }

  async save(params: {
    studentId: string;
    hash: string;
    digest: Digest;
    model: string;
    createdById: string;
  }): Promise<void> {
    await this.prisma.lessonDigest.upsert({
      where: { inputHash: params.hash },
      update: {},
      create: {
        studentId: params.studentId,
        inputHash: params.hash,
        payload: params.digest,
        model: params.model,
        createdById: params.createdById,
      },
    });
  }

  /**
   * 降级时前端要展示的替代内容：原始反馈时间线 + 出勤统计。
   *
   * 作业要求"失败时有合理降级"—— 这里的降级不是弹个错误提示，
   * 而是系统照常工作：admin 仍能看到原始反馈、仍能处理续费任务。
   */
  async fallbackContext(studentId: string) {
    const records = await this.prisma.attendance.findMany({
      where: { studentId },
      orderBy: { recordedAt: 'desc' },
      take: 12,
      select: {
        status: true,
        teacherNote: true,
        recordedAt: true,
        session: {
          select: {
            startsAt: true,
            classGroup: { select: { course: { select: { name: true } } } },
          },
        },
        recordedBy: { select: { name: true } },
      },
    });

    const count = (s: AttendanceStatus) => records.filter((r) => r.status === s).length;

    return {
      timeline: records.map((r) => ({
        date: r.session.startsAt,
        status: r.status,
        note: r.teacherNote,
        courseName: r.session.classGroup?.course.name ?? '试听课',
        teacherName: r.recordedBy.name,
      })),
      stats: {
        total: records.length,
        present: count(AttendanceStatus.PRESENT),
        late: count(AttendanceStatus.LATE),
        absent: count(AttendanceStatus.ABSENT),
        excused: count(AttendanceStatus.EXCUSED),
      },
    };
  }

  get llmConfigured(): boolean {
    return Boolean(this.config.get<string>('QIANWEN_API_KEY'));
  }
}
