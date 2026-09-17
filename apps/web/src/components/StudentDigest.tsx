import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Check, ClipboardCopy, Info, Loader2, MessageSquareQuote, Sparkles } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AttendanceStatusBadge } from '@/components/StatusBadges'
import { ErrorState, LoadingRows } from '@/components/DataState'
import { apiErrorMessage } from '@/lib/errors'
import { formatDateTime, formatShortDate } from '@/lib/format'
import { digestFallbackQueryOptions, generateDigest, type Digest } from '@/lib/queries'

/**
 * 续费沟通简报。
 *
 * ## 为什么左右并列，而不是让简报替换掉原始数据
 *
 * 评审一定会问"AI 说错了怎么办"。答案不能是"我们让模型更准"——只能是让
 * admin 在两秒内自己核对。所以右边永远是老师反馈的原文时间线，左边是
 * 模型的归纳；admin 看到"进步明显"就能立刻在右边查到是哪几次课的反馈
 * 支撑了这句话。人在环中不是加一行免责声明，是把证据摆在结论旁边。
 *
 * ## 降级不是弹个错误提示
 *
 * 简报不可用（没配 key、超时、模型输出不合 schema）时，右边的原始时间线
 * 照常展示，续费流程一点不受影响 —— 那才是这个页面的主线。所以 fallback
 * 是页面加载就取的 GET，简报是点击才发的 POST（只在 admin 主动要时才
 * 花钱调模型）。
 */
export function StudentDigest({ studentId }: { studentId: string }) {
  const fallback = useQuery(digestFallbackQueryOptions(studentId))
  const digest = useMutation({ mutationFn: () => generateDigest(studentId) })

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* 左：模型的归纳 */}
      <Card className="flex flex-col">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <Sparkles className="h-4 w-4" />
            沟通简报
            <Badge variant="outline" className="ml-auto text-xs font-normal">
              AI 生成，供参考
            </Badge>
          </CardTitle>
          <CardDescription>
            由近期老师反馈归纳而成，不含任何数字 —— 课时、金额、出勤率一律以右侧原始记录和课时流水为准。
          </CardDescription>
        </CardHeader>

        <CardContent className="flex-1">
          {digest.isPending ? (
            <div className="text-muted-foreground flex items-center gap-2 py-8 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在生成…（超时会自动降级，不会卡住页面）
            </div>
          ) : digest.isError ? (
            // 网络层失败也用降级的语气：右边的原始反馈还在，流程不断
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>简报暂时生成不了</AlertTitle>
              <AlertDescription className="space-y-2">
                <p>{apiErrorMessage(digest.error)}</p>
                <p className="text-xs">右侧的老师反馈原文不受影响，续费沟通可以照常进行。</p>
                <Button variant="outline" size="sm" onClick={() => digest.mutate()}>
                  重试
                </Button>
              </AlertDescription>
            </Alert>
          ) : digest.data === undefined ? (
            <div className="space-y-3 py-6 text-center">
              <p className="text-muted-foreground text-sm">
                还没有生成简报。点击后会把近 8 次的老师反馈交给模型，归纳成一段可以直接和家长说的话。
              </p>
              <Button onClick={() => digest.mutate()}>
                <Sparkles className="mr-1 h-4 w-4" />
                生成沟通简报
              </Button>
            </div>
          ) : digest.data.available ? (
            <DigestBody
              digest={digest.data.digest}
              model={digest.data.model}
              cached={digest.data.cached}
              generatedAt={digest.data.generatedAt}
              onRegenerate={() => digest.mutate()}
            />
          ) : (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>简报不可用</AlertTitle>
              <AlertDescription className="space-y-2">
                <p>{digest.data.reason}</p>
                <p className="text-xs">
                  这不影响续费：右侧是老师逐次反馈的原文，配上课时流水，已经够把话和家长说清楚。
                </p>
                <Button variant="outline" size="sm" onClick={() => digest.mutate()}>
                  再试一次
                </Button>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* 右：核对用的原始证据，任何情况下都在 */}
      <Card className="flex flex-col">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquareQuote className="h-4 w-4" />
            老师反馈原文
          </CardTitle>
          <CardDescription>
            未经处理的逐次记录。左侧简报里的每一句都应该能在这里找到依据。
          </CardDescription>
        </CardHeader>

        <CardContent className="flex-1">
          {fallback.isPending ? (
            <LoadingRows rows={4} />
          ) : fallback.isError ? (
            <ErrorState
              error={fallback.error}
              title="无法加载反馈记录"
              onRetry={() => void fallback.refetch()}
            />
          ) : fallback.data.timeline.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              还没有出勤记录。老师第一次点名后，反馈会出现在这里。
            </p>
          ) : (
            <>
              <div className="text-muted-foreground mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <span>共 {fallback.data.stats.total} 次</span>
                <span>到课 {fallback.data.stats.present}</span>
                <span>迟到 {fallback.data.stats.late}</span>
                <span>缺勤 {fallback.data.stats.absent}</span>
                <span>请假 {fallback.data.stats.excused}</span>
              </div>

              <ol className="max-h-96 space-y-2.5 overflow-y-auto pr-1">
                {fallback.data.timeline.map((entry, index) => (
                  <li key={`${entry.date}-${index}`} className="border-l-2 pl-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-muted-foreground font-mono text-xs tabular-nums">
                        {formatShortDate(entry.date)}
                      </span>
                      <AttendanceStatusBadge status={entry.status} />
                      <span className="text-muted-foreground text-xs">{entry.courseName}</span>
                    </div>
                    {entry.note ? (
                      <p className="mt-1 text-sm">{entry.note}</p>
                    ) : (
                      <p className="text-muted-foreground mt-1 text-sm italic">未填写反馈</p>
                    )}
                    <p className="text-muted-foreground mt-0.5 text-xs">{entry.teacherName}</p>
                  </li>
                ))}
              </ol>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

const RISK_LABELS: Record<
  Digest['risk_level'],
  { text: string; variant: 'outline' | 'secondary' | 'destructive' }
> = {
  low: { text: '风险低', variant: 'outline' },
  medium: { text: '风险中等', variant: 'secondary' },
  high: { text: '风险高', variant: 'destructive' },
}

function DigestBody({
  digest,
  model,
  cached,
  generatedAt,
  onRegenerate,
}: {
  digest: Digest
  model: string
  cached: boolean
  generatedAt: string
  onRegenerate: () => void
}) {
  const risk = RISK_LABELS[digest.risk_level]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={risk.variant}>{risk.text}</Badge>
        <span className="text-muted-foreground text-xs">
          {model} · {cached ? '缓存结果' : '刚刚生成'} · {formatDateTime(generatedAt)}
        </span>
      </div>

      <p className="text-sm leading-relaxed">{digest.progress_summary}</p>

      {digest.strengths.length > 0 ? (
        <section>
          <h4 className="mb-1 text-xs font-medium">做得好的地方</h4>
          <ul className="list-disc space-y-0.5 pl-5 text-sm">
            {digest.strengths.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {digest.concerns.length > 0 ? (
        <section>
          <h4 className="mb-1 text-xs font-medium">需要注意的地方</h4>
          <ul className="list-disc space-y-0.5 pl-5 text-sm">
            {digest.concerns.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <div className="mb-1 flex items-center justify-between">
          <h4 className="text-xs font-medium">给家长的话（草稿）</h4>
          <CopyButton text={digest.parent_message_draft} />
        </div>
        <blockquote className="bg-muted/50 rounded-md border-l-2 px-3 py-2 text-sm leading-relaxed">
          {digest.parent_message_draft}
        </blockquote>
        <p className="text-muted-foreground mt-1 text-xs">
          发出前请对照右侧原文核对一遍 —— 这是草稿，不是已核实的结论。
        </p>
      </section>

      {digest.talking_points.length > 0 ? (
        <section>
          <h4 className="mb-1 text-xs font-medium">通话要点</h4>
          <ul className="space-y-1 text-sm">
            {digest.talking_points.map((point) => (
              <li key={point} className="flex gap-2">
                <span className="text-muted-foreground">·</span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Button variant="ghost" size="sm" onClick={onRegenerate}>
        重新生成
      </Button>
    </div>
  )
}

/** 草稿是要发给家长的，所以一键复制比让 admin 手选文本靠谱 */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 px-2"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1800)
        })
      }}
    >
      {copied ? (
        <>
          <Check className="mr-1 h-3.5 w-3.5" />
          已复制
        </>
      ) : (
        <>
          <ClipboardCopy className="mr-1 h-3.5 w-3.5" />
          复制
        </>
      )}
    </Button>
  )
}
