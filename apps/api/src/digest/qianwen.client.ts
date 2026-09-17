/**
 * 通义千问调用。用原生 fetch 打 OpenAI 兼容接口，不装 openai SDK ——
 * 整个项目只有这一处 LLM 调用，一个 POST 不值得引入一个依赖树。
 *
 * 端点：POST {QIANWEN_BASE_URL}/chat/completions
 * 认证：Authorization: Bearer {QIANWEN_API_KEY}
 */

/** 失败原因分类。每一类都映射成一句给 admin 看的人话（见 REASON_TEXT） */
export type LlmFailureKind =
  | 'not_configured'
  | 'timeout'
  | 'network'
  | 'http_error'
  | 'empty_response'
  | 'invalid_json'
  | 'schema_rejected';

/**
 * 给 admin 看的降级文案。
 *
 * 刻意不暴露 ETIMEDOUT / 401 / stack trace：admin 是课程顾问不是工程师，
 * 他需要知道的只是"这次没生成，能不能重试，要不要找人"。
 * 技术细节走 logger，不走响应体。
 */
const REASON_TEXT: Record<LlmFailureKind, string> = {
  not_configured: '未配置 LLM key，简报功能暂不可用',
  timeout: '简报服务响应超时，请稍后重试',
  network: '暂时无法连接简报服务，请稍后重试',
  http_error: '简报服务暂时不可用，请稍后重试',
  empty_response: '简报服务未返回内容，请稍后重试',
  invalid_json: '简报内容格式异常，已跳过本次生成',
  schema_rejected: '简报内容未通过校验，已跳过本次生成',
};

export function reasonTextFor(kind: LlmFailureKind): string {
  return REASON_TEXT[kind];
}

export type LlmCallResult =
  | { ok: true; content: string; model: string }
  | { ok: false; kind: LlmFailureKind; detail: string };

export interface QianwenCallParams {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  systemPrompt: string;
  userContent: string;
  /** json_schema 模式用的 schema 与名字 */
  schemaName: string;
  jsonSchema: unknown;
}

export async function callQianwen(params: QianwenCallParams): Promise<LlmCallResult> {
  const url = `${params.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  // 超时必须自己实现：fetch 没有 timeout 选项，不设 signal 的话
  // 连接挂住就一直挂住，admin 点一下简报能等到浏览器超时。
  // AbortController + setTimeout 是唯一真正切断请求的方式。
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: params.model,
        messages: [
          { role: 'system', content: params.systemPrompt },
          { role: 'user', content: params.userContent },
        ],
        // structured output：strict 模式在该端点是真正的约束解码，
        // 字段名/枚举/数组条数由解码器保证，不靠模型自觉。
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: params.schemaName,
            strict: true,
            schema: params.jsonSchema,
          },
        },
        // 归纳类任务，压低随机性：同样的输入尽量得到同样的简报
        temperature: 0.3,
        max_tokens: 1200,
      }),
    });

    if (!response.ok) {
      // 读一小段 body 进日志便于排查（key 失效、模型名写错都在这里现形），
      // 但不会进响应体
      const body = await response.text().catch(() => '');
      return {
        ok: false,
        kind: 'http_error',
        detail: `HTTP ${response.status} ${body.slice(0, 300)}`,
      };
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
      model?: string;
    };

    const content = payload.choices?.[0]?.message?.content;
    if (!content || !content.trim()) {
      return { ok: false, kind: 'empty_response', detail: '响应中没有 message.content' };
    }

    return { ok: true, content, model: payload.model || params.model };
  } catch (error) {
    // AbortError 既可能是我们的超时，也可能是进程退出时的取消，
    // 对调用方来说都归为超时处理
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, kind: 'timeout', detail: `超过 ${params.timeoutMs}ms` };
    }
    return {
      ok: false,
      kind: 'network',
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    // 成功路径也要清掉，否则定时器会把进程拖住到超时时刻
    clearTimeout(timer);
  }
}
