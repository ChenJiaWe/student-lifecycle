import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { ApiError } from '@/lib/api'
import { login } from '@/lib/queries'
import type { AuthUser } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { ErrorState } from '@/components/error-state'

export const Route = createFileRoute('/login')({
  // 守卫跳转过来时带上原地址，登录成功后回到那里。
  // 键本身是可选的（而不是"值可能是 undefined"），这样 <Link to="/login">
  // 不必被迫写 search={{ redirect: undefined }}。
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search.redirect === 'string' ? { redirect: search.redirect } : {},
  component: LoginPage,
})

/** 各角色登录后该落在哪个页面 */
function landingFor(user: AuthUser): string {
  return user.role === 'TEACHER' ? '/teacher/today' : '/'
}

const DEMO_ACCOUNTS = [
  { label: '老师', email: 'teacher@demo.local' },
  { label: '教务 admin', email: 'admin@demo.local' },
] as const
const DEMO_PASSWORD = 'demo1234'

function LoginPage() {
  const { redirect } = Route.useSearch()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const signIn = useMutation({
    mutationFn: () => login(email.trim(), password),
    onSuccess: ({ user }) => {
      // redirect 来自 URL，只接受站内路径。"//evil.com" 是协议相对地址，
      // 会跳出站外，所以单独排掉。
      const target =
        redirect && redirect.startsWith('/') && !redirect.startsWith('//')
          ? redirect
          : landingFor(user)
      // 整页跳转而不是路由跳转：cookie 刚刚才写上，重新加载一次能保证
      // 所有 loader 都在已登录状态下跑，缓存里不会留着未登录时的残留。
      window.location.assign(target)
    },
  })

  // 401（邮箱或密码不对）值得就地说清楚，不该套用通用错误标题
  const credentialsRejected = signIn.error instanceof ApiError && signIn.error.status === 401

  return (
    <main className="flex min-h-svh items-center justify-center px-6 py-12">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">教务控制台</h1>
          <p className="text-sm text-muted-foreground">墨尔本校区 · 排课、出勤与跟进</p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>登录</CardTitle>
            <CardDescription>用学校分配的邮箱登录。</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-col gap-5"
              onSubmit={(event) => {
                event.preventDefault()
                signIn.mutate()
              }}
            >
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="email">邮箱</FieldLabel>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="username"
                    required
                    autoFocus
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    aria-invalid={credentialsRejected || undefined}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="password">密码</FieldLabel>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    aria-invalid={credentialsRejected || undefined}
                  />
                  {credentialsRejected ? (
                    <FieldDescription className="text-destructive">
                      邮箱或密码不对。再试一次，或让 admin 重置密码。
                    </FieldDescription>
                  ) : null}
                </Field>
              </FieldGroup>

              {signIn.error && !credentialsRejected ? <ErrorState error={signIn.error} /> : null}

              <Button type="submit" size="lg" disabled={signIn.isPending}>
                {signIn.isPending ? <Spinner data-icon="inline-start" /> : null}
                {signIn.isPending ? '登录中' : '登录'}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* 演示环境的账号。真实部署会删掉这一段 —— 它只为了让评审不必翻 seed 文件。 */}
        <section className="flex flex-col gap-2 rounded-lg border border-dashed px-3 py-2.5">
          <p className="text-xs text-muted-foreground">
            演示账号，密码都是 <code className="font-medium">{DEMO_PASSWORD}</code>
          </p>
          <div className="flex flex-col gap-1">
            {DEMO_ACCOUNTS.map((account) => (
              <button
                key={account.email}
                type="button"
                className="flex items-baseline justify-between rounded-md px-1.5 py-1 text-left text-xs hover:bg-muted"
                onClick={() => {
                  setEmail(account.email)
                  setPassword(DEMO_PASSWORD)
                }}
              >
                <span className="text-muted-foreground">{account.label}</span>
                <span className="font-medium tabular-nums">{account.email}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}
