import { useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { apiErrorMessage } from '@/lib/errors'
import { formatMoney } from '@/lib/format'
import { purchaseCredits } from '@/lib/queries'

/**
 * 购买课时。
 *
 * 金额在表单里按"元"输入，提交前乘 100 变成整数分 —— 服务端只认分，
 * 浮点数不进接口。让 admin 直接输入整数分会算错（1200 元还是 120000 分？），
 * 所以换算放在这一层，并且把换算结果实时回显出来让他自己核对。
 */
export function PurchaseCreditsDialog({
  studentId,
  studentName,
  trigger,
}: {
  studentId: string
  studentName: string
  trigger: ReactNode
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [credits, setCredits] = useState('20')
  const [amountYuan, setAmountYuan] = useState('')
  const [note, setNote] = useState('')

  const creditsNum = Number(credits)
  // 先四舍五入再取整：12.34 * 100 在浮点下是 1233.9999…，直接截断会少记一分
  const amountCents = Math.round(Number(amountYuan) * 100)

  const creditsValid = Number.isInteger(creditsNum) && creditsNum >= 1 && creditsNum <= 500
  const amountValid = amountYuan.trim() !== '' && Number.isFinite(amountCents) && amountCents >= 0

  const mutation = useMutation({
    mutationFn: () =>
      purchaseCredits(studentId, {
        credits: creditsNum,
        amountCents,
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    onSuccess: async () => {
      // 购买会顺带关掉 LOW_BALANCE 任务、把学生状态从 AT_RISK 拉回 ENROLLED
      // （见 CreditsService.purchase），所以工作台也要一起刷新
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['students'] }),
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
      ])
      reset()
      setOpen(false)
    },
  })

  function reset() {
    setCredits('20')
    setAmountYuan('')
    setNote('')
    mutation.reset()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>为 {studentName} 购买课时</DialogTitle>
          <DialogDescription>
            会写入一条课时流水并记录操作人。购买后该学生的「课时将尽」任务会自动关闭。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="purchase-credits">课时数</Label>
            <Input
              id="purchase-credits"
              type="number"
              min={1}
              max={500}
              step={1}
              value={credits}
              onChange={(e) => setCredits(e.target.value)}
            />
            {credits !== '' && !creditsValid ? (
              <p className="text-destructive text-xs">课时数须是 1–500 的整数</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="purchase-amount">金额</Label>
            <Input
              id="purchase-amount"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              placeholder="1200.00"
              value={amountYuan}
              onChange={(e) => setAmountYuan(e.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              {amountValid
                ? `记账 ${formatMoney(amountCents)}（${amountCents} 分）`
                : '按元输入，两位小数'}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="purchase-note">备注（可选）</Label>
          <Textarea
            id="purchase-note"
            rows={2}
            maxLength={200}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="家长微信转账，已收款"
          />
        </div>

        {mutation.isError ? (
          <p className="text-destructive text-sm">{apiErrorMessage(mutation.error)}</p>
        ) : null}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              setOpen(false)
              reset()
            }}
            disabled={mutation.isPending}
          >
            取消
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !creditsValid || !amountValid}
          >
            {mutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            确认购买
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
