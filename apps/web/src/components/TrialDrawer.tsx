import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface Teacher {
  id: string
  name: string
  subjects: string[]
}

interface TrialDrawerProps {
  studentId: string
  studentName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TrialDrawer({ studentId, studentName, open, onOpenChange }: TrialDrawerProps) {
  const qc = useQueryClient()
  const [teacherId, setTeacherId] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [durationMin, setDurationMin] = useState('60')
  const [room, setRoom] = useState('')
  const [error, setError] = useState<string | null>(null)

  const teachers = useQuery({
    queryKey: ['teachers'],
    queryFn: () => api<Teacher[]>('/teachers'),
    enabled: open,
  })

  const mutation = useMutation({
    mutationFn: () =>
      api(`/students/${studentId}/trial`, {
        method: 'POST',
        json: {
          teacherId,
          startsAt: new Date(startsAt).toISOString(),
          durationMin: Number(durationMin),
          ...(room ? { room } : {}),
        },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['trials'] })
      void qc.invalidateQueries({ queryKey: ['student', studentId] })
      onOpenChange(false)
      setTeacherId('')
      setStartsAt('')
      setDurationMin('60')
      setRoom('')
      setError(null)
    },
    onError: (e: Error) => {
      setError(e.message || '安排试听失败，请重试')
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!teacherId || !startsAt || !durationMin) {
      setError('请填写所有必填项')
      return
    }
    mutation.mutate()
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>为 {studentName} 安排试听</SheetTitle>
          <SheetDescription>
            试听课与正式课共用冲突检测，安排后学生状态变为"试听已排"。
            每名学生只能试听一次。
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          {/* 老师 */}
          <div className="space-y-1.5">
            <Label htmlFor="teacher">老师 *</Label>
            {teachers.isPending ? (
              <div className="text-sm text-muted-foreground">加载老师列表…</div>
            ) : teachers.isError ? (
              <div className="text-sm text-destructive">无法加载老师列表</div>
            ) : (
              <select
                id="teacher"
                value={teacherId}
                onChange={(e) => setTeacherId(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                required
              >
                <option value="">选择老师…</option>
                {(teachers.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.subjects?.length ? `（${t.subjects.join('、')}）` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* 时间 */}
          <div className="space-y-1.5">
            <Label htmlFor="startsAt">试听时间 *</Label>
            <Input
              id="startsAt"
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">
              时间按本地时区选择，服务端会换算到墨尔本时区
            </p>
          </div>

          {/* 时长 */}
          <div className="space-y-1.5">
            <Label htmlFor="duration">时长（分钟）*</Label>
            <Input
              id="duration"
              type="number"
              min={15}
              max={300}
              value={durationMin}
              onChange={(e) => setDurationMin(e.target.value)}
              required
            />
          </div>

          {/* 教室（选填） */}
          <div className="space-y-1.5">
            <Label htmlFor="room">教室（选填）</Label>
            <Input
              id="room"
              placeholder="例：101 教室"
              value={room}
              onChange={(e) => setRoom(e.target.value)}
            />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <SheetFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? '安排中…' : '确认安排试听'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
