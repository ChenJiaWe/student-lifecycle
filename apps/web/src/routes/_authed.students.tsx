import { useMemo, useState } from 'react'
import { createFileRoute, Link, Outlet, useChildMatches } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { CalendarPlus, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState, ErrorState, LoadingRows } from '@/components/DataState'
import { BalanceBadge, StudentStatusBadge } from '@/components/StatusBadges'
import { EnrollDrawer } from '@/components/EnrollDrawer'
import {
  STUDENT_STATUS_LABELS,
  studentsQueryOptions,
  type StudentListRow,
  type StudentStatus,
} from '@/lib/queries'

export const Route = createFileRoute('/_authed/students')({
  component: StudentsPage,
})

/** 服务端 CreditAccount.lowBalanceThreshold 的默认值。列表接口不返回它，所以只用于筛选和染色 */
const LOW_BALANCE_DEFAULT = 4

type ScopeFilter = 'mine' | 'all'

/**
 * 学生列表 —— 二级页面。
 *
 * 工作台回答"今天处理谁"，这里回答"我有哪些学生"。两个问题分开放，
 * 因为第二个问题一天问一次，第一个问题一天问二十次。
 *
 * 筛选全在客户端做：接口一次返回（take 50），没必要为几个复选框
 * 来回打服务器。真到上千人时该换成服务端分页 + 查询参数，那是另一个
 * 量级的问题，现在做就是过度设计。
 */
function StudentsPage() {
  const childMatches = useChildMatches()
  const hasChild = childMatches.length > 0

  const students = useQuery(studentsQueryOptions)

  const [scope, setScope] = useState<ScopeFilter>('mine')
  const [status, setStatus] = useState<StudentStatus | 'ALL'>('ALL')
  const [lowOnly, setLowOnly] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [enrollTarget, setEnrollTarget] = useState<StudentListRow | null>(null)

  if (hasChild) return <Outlet />

  const rows = students.data ?? []

  const filtered = useMemo(() => {
    const needle = keyword.trim().toLowerCase()

    return rows.filter((row) => {
      if (scope === 'mine' && !row.isMine) return false
      if (status !== 'ALL' && row.status !== status) return false
      if (lowOnly && (row.account?.balance ?? 0) > LOW_BALANCE_DEFAULT) return false
      if (needle && !row.name.toLowerCase().includes(needle)) return false
      return true
    })
  }, [rows, scope, status, lowOnly, keyword])

  const hasFilters = scope !== 'mine' || status !== 'ALL' || lowOnly || keyword.trim() !== ''

  function clearFilters() {
    setScope('mine')
    setStatus('ALL')
    setLowOnly(false)
    setKeyword('')
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">学生</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          admin 之间要能互相接手，所以这里能看到全部学生；但只有名下的才能改。
        </p>
      </header>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 py-4">
          <div className="space-y-1.5">
            <Label className="text-xs">归属</Label>
            <Tabs value={scope} onValueChange={(value) => setScope(value as ScopeFilter)}>
              <TabsList>
                <TabsTrigger value="mine">我的</TabsTrigger>
                <TabsTrigger value="all">全部</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="filter-status" className="text-xs">
              状态
            </Label>
            <select
              id="filter-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as StudentStatus | 'ALL')}
              className="border-input bg-background ring-offset-background focus-visible:ring-ring h-9 rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              <option value="ALL">全部状态</option>
              {(Object.keys(STUDENT_STATUS_LABELS) as StudentStatus[]).map((key) => (
                <option key={key} value={key}>
                  {STUDENT_STATUS_LABELS[key]}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="filter-name" className="text-xs">
              姓名
            </Label>
            <div className="relative">
              <Search className="text-muted-foreground absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2" />
              <Input
                id="filter-name"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜姓名"
                className="h-9 w-40 pl-8"
              />
            </div>
          </div>

          <label className="flex h-9 cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={lowOnly}
              onChange={(e) => setLowOnly(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            只看低余额（≤ {LOW_BALANCE_DEFAULT} 课时）
          </label>

          {hasFilters ? (
            <Button variant="ghost" size="sm" className="ml-auto" onClick={clearFilters}>
              清除筛选
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {students.isPending ? (
        <Card>
          <CardContent className="py-6">
            <LoadingRows rows={6} />
          </CardContent>
        </Card>
      ) : students.isError ? (
        <ErrorState
          error={students.error}
          title="学生列表加载失败"
          onRetry={() => void students.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="还没有学生"
          description="导入或录入第一个学生后，这里会列出来。"
        />
      ) : filtered.length === 0 ? (
        /* 筛完为空和本来就没数据是两件事 —— 前者该给"清除筛选" */
        <EmptyState
          title="没有符合条件的学生"
          description="当前筛选条件下一个也没匹配上。放宽条件再看看。"
          action={
            <Button variant="outline" onClick={clearFilters}>
              清除筛选
            </Button>
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>姓名</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>课时余额</TableHead>
                  <TableHead>归属 admin</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      {/* 不是自己的学生也能点进详情 —— admin 可读全部 */}
                      <Link
                        to="/students/$id"
                        params={{ id: row.id }}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {row.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StudentStatusBadge status={row.status} />
                    </TableCell>
                    <TableCell>
                      <BalanceBadge balance={row.account?.balance ?? 0} />
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {row.isMine ? (
                        <Badge variant="outline">我的</Badge>
                      ) : (
                        (row.ownerAdmin?.name ?? '未分配')
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {/* isMine=false 不显示写入口。服务端仍会挡，这里只是不让人白点 */}
                      {row.isMine ? (
                        <Button variant="ghost" size="sm" onClick={() => setEnrollTarget(row)}>
                          <CalendarPlus className="mr-1 h-3.5 w-3.5" />
                          排课
                        </Button>
                      ) : (
                        <span className="text-muted-foreground text-xs">只读</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <p className="text-muted-foreground text-xs">
        显示 {filtered.length} / {rows.length} 人（接口一次最多返回 50 条）
      </p>

      {enrollTarget ? (
        <EnrollDrawer
          studentId={enrollTarget.id}
          studentName={enrollTarget.name}
          open
          onOpenChange={(open) => {
            if (!open) setEnrollTarget(null)
          }}
        />
      ) : null}
    </div>
  )
}
