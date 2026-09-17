import { z } from 'zod';

/**
 * 启动时校验环境变量，缺失或格式错误立即失败 —— 不要等到运行时才发现。
 *
 * LLM 相关变量故意全部可选：简报功能在 key 缺失时降级，
 * 其余功能不受影响（见 DESIGN.md「LLM 落点」）。
 */
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  DATABASE_URL_UNPOOLED: z.string().url().optional(),
  SHADOW_DATABASE_URL: z.string().url().optional(),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET 至少 32 字符，用 openssl rand -base64 32 生成'),
  JWT_EXPIRES_IN: z.string().default('7d'),

  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // 业务时区固定，不做多时区切换（作业要求）
  BUSINESS_TIMEZONE: z.string().default('Australia/Melbourne'),

  QIANWEN_API_KEY: z.string().optional(),
  QIANWEN_BASE_URL: z.string().url().optional(),
  QIANWEN_MODEL_NAME: z.string().default('qwen-plus'),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`环境变量校验失败:\n${issues}`);
  }

  return parsed.data;
}
