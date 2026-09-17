import { ArrowDownRight, ArrowUpRight, Receipt } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatDelta, formatMoney, formatShortDate, formatTimeOfDay } from '@/lib/format'
import { LEDGER_REASON_LABELS, type LedgerEntry } from '@/lib/queries'

/**
 * 课时流水时间线。
 *
 * 为什么是流水而不是一个余额数字：课时是钱。admin 接到的电话是
 * "我买了 20 节课，怎么就剩 3 节了？"——一个余额数字回答不了这个问题，
 * 一条按时间倒序、每条带操作人的账才回答得了。
 *
 * 订正在这里表现为一条 +1 的「人工调整」，而不是原来那条扣减被改掉 ——
 * 账本只追加不修改，所以家长质疑时整条链都摆在桌面上，包括"谁在什么
 * 时候因为什么把这一节课还回来了"。
 */
export function CreditLedgerTimeline({ entries }: { entries: LedgerEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="text-muted-foreground py-6 text-center text-sm">
        还没有课时记录。购买课时后，每一次扣减和调整都会记在这里。
      </p>
    )
  }

  return (
    <ol>
      {entries.map((entry, index) => {
        const isCredit = entry.delta > 0
        const isLast = index === entries.length - 1

        return (
          <li key={entry.id} className="flex gap-3 py-2.5">
            {/* 竖线 + 圆点：时间线的视觉骨架，比表格更容易看出"这段时间发生了什么" */}
            <div className="flex flex-col items-center">
              <span
                className={
                  isCredit
                    ? 'mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700'
                    : 'bg-muted text-muted-foreground mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full'
                }
              >
                {isCredit ? (
                  <ArrowUpRight className="h-3.5 w-3.5" />
                ) : (
                  <ArrowDownRight className="h-3.5 w-3.5" />
                )}
              </span>
              {isLast ? null : <span className="bg-border mt-1 w-px flex-1" />}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span
                  className={
                    isCredit
                      ? 'font-mono text-sm font-semibold text-emerald-700 tabular-nums'
                      : 'font-mono text-sm font-semibold tabular-nums'
                  }
                >
                  {formatDelta(entry.delta)}
                </span>
                <Badge variant="outline" className="text-xs">
                  {LEDGER_REASON_LABELS[entry.reason]}
                </Badge>
                {entry.purchase ? (
                  <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                    <Receipt className="h-3 w-3" />
                    {formatMoney(entry.purchase.amountCents)}
                  </span>
                ) : null}
                <span className="text-muted-foreground ml-auto shrink-0 text-xs">
                  {formatShortDate(entry.createdAt)} {formatTimeOfDay(entry.createdAt)}
                </span>
              </div>

              {entry.note ? <p className="mt-0.5 text-sm">{entry.note}</p> : null}
              <p className="text-muted-foreground mt-0.5 text-xs">
                操作人 {entry.createdBy?.name ?? '系统'}
              </p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
