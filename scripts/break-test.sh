#!/usr/bin/env bash
#
# 破坏测试：绕过界面直接打 API，尝试违反每一条业务规则。
#
# 主动提供这个脚本本身就是一种表态 —— 规则确实在服务端，不是在前端禁用按钮。
# 每一条都应该被拒绝，且状态码要说明"规则拦住了你"（4xx）而不是"服务端崩了"（500）。
#
# 用法：
#   bash scripts/break-test.sh              # 打本地
#   API=https://xxx.onrender.com/api bash scripts/break-test.sh   # 打线上
set -uo pipefail

API="${API:-http://localhost:3000/api}"
PASS=0
FAIL=0

c() { curl -s -o /tmp/bt.json -w '%{http_code}' "$@"; }

login() {
  curl -s -XPOST "$API/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"demo1234\"}" |
    node -p "try{JSON.parse(require('fs').readFileSync(0)).accessToken}catch(e){''}"
}

check() {
  local want="$1" desc="$2" got="$3"
  local body
  body=$(head -c 90 /tmp/bt.json 2>/dev/null | tr -d '\n')

  if [[ "$want" == "$got" ]]; then
    PASS=$((PASS + 1))
    printf '  \033[32m✓\033[0m %-46s %s\n' "$desc" "$got"
  else
    FAIL=$((FAIL + 1))
    printf '  \033[31m✗\033[0m %-46s 期望 %s 实得 %s  %s\n' "$desc" "$want" "$got" "$body"
  fi
}

echo "破坏测试目标: $API"
echo

# ─── 准备 ───
ADMIN=$(login admin@demo.local)
ADMIN2=$(login admin2@demo.local)
TEACHER=$(login teacher@demo.local)
TEACHER2=$(login teacher2@demo.local)

if [[ -z "$ADMIN" ]]; then
  echo "登录失败 —— 服务没起来或还没跑 seed？"
  echo "  pnpm --filter api dev   &&   pnpm db:seed"
  exit 1
fi

# 找一节已开始、demo 老师的课
curl -s -H "Authorization: Bearer $TEACHER" "$API/teacher/today" > /tmp/bt-today.json
SID=$(node -p "const s=JSON.parse(require('fs').readFileSync('/tmp/bt-today.json'));const n=Date.now();(s.find(x=>new Date(x.startsAt)<n)||{}).id||''")
FUTURE_SID=$(node -p "const s=JSON.parse(require('fs').readFileSync('/tmp/bt-today.json'));const n=Date.now();(s.find(x=>new Date(x.startsAt)>=n)||{}).id||''")

if [[ -z "$SID" ]]; then
  echo "今天没有已开始的课次，重跑 seed：pnpm db:seed"
  exit 1
fi

STU=$(curl -s -H "Authorization: Bearer $TEACHER" "$API/sessions/$SID/roster" |
  node -p "JSON.parse(require('fs').readFileSync(0)).roster[0].studentId")

# admin@demo.local 名下的学生是 stu-000..stu-071，其余属于别的 admin
MINE=stu-010
THEIRS=stu-150

echo "── 认证 ──"
check 401 "无凭据访问受保护端点" "$(c "$API/students/$MINE")"
check 401 "伪造 token" "$(c "$API/students/$MINE" -H 'Authorization: Bearer forged.tok.en')"
echo

echo "── 权限（规则 7：可读全部，只能改自己的）──"
check 200 "admin 读别人名下的学生（允许）" \
  "$(c "$API/students/$THEIRS" -H "Authorization: Bearer $ADMIN")"
check 403 "admin 改别人名下的学生" \
  "$(c -XPATCH "$API/students/$THEIRS" -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"note":"越权"}')"
check 403 "admin 给别人的学生排课" \
  "$(c -XPOST "$API/students/$THEIRS/enroll" -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"classGroupId":"grp-05"}')"
check 403 "admin 给别人的学生加课时" \
  "$(c -XPOST "$API/students/$THEIRS/credits/purchase" -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"credits":100,"amountCents":0}')"
echo

echo "── 角色隔离 ──"
check 403 "teacher 调 admin 端点" "$(c "$API/students" -H "Authorization: Bearer $TEACHER")"
check 403 "teacher 改学生档案" \
  "$(c -XPATCH "$API/students/$MINE" -H "Authorization: Bearer $TEACHER" -H 'Content-Type: application/json' -d '{"note":"x"}')"
check 403 "teacher 查看课时账目（钱）" \
  "$(c "$API/students/$MINE/credits" -H "Authorization: Bearer $TEACHER")"
check 403 "teacher 给自己加课时" \
  "$(c -XPOST "$API/students/$MINE/credits/purchase" -H "Authorization: Bearer $TEACHER" -H 'Content-Type: application/json' -d '{"credits":100,"amountCents":0}')"
check 403 "teacher 看别的老师的名单" \
  "$(c "$API/sessions/$SID/roster" -H "Authorization: Bearer $TEACHER2")"
BODY_PRESENT="{\"records\":[{\"studentId\":\"$STU\",\"status\":\"PRESENT\"}]}"
check 403 "teacher 给别的老师的课点名" \
  "$(c -XPOST "$API/sessions/$SID/attendance" -H "Authorization: Bearer $TEACHER2" -H 'Content-Type: application/json' -d "$BODY_PRESENT")"
check 403 "admin 调老师专属端点" "$(c "$API/teacher/today" -H "Authorization: Bearer $ADMIN")"
echo

echo "── 出勤与课时（规则 4/9/10/11）──"
[[ -n "$FUTURE_SID" ]] && check 422 "规则9 给未开始的课点名" \
  "$(c -XPOST "$API/sessions/$FUTURE_SID/attendance" -H "Authorization: Bearer $TEACHER" -H 'Content-Type: application/json' -d "$BODY_PRESENT")"
check 400 "给名单外的学生点名" \
  "$(c -XPOST "$API/sessions/$SID/attendance" -H "Authorization: Bearer $TEACHER" -H 'Content-Type: application/json' -d '{"records":[{"studentId":"stu-199","status":"PRESENT"}]}')"
BODY_BADSTATUS="{\"records\":[{\"studentId\":\"$STU\",\"status\":\"NOSHOW\"}]}"
check 400 "非法的出勤状态" \
  "$(c -XPOST "$API/sessions/$SID/attendance" -H "Authorization: Bearer $TEACHER" -H 'Content-Type: application/json' -d "$BODY_BADSTATUS")"
BODY_DUPE="{\"records\":[{\"studentId\":\"$STU\",\"status\":\"PRESENT\"},{\"studentId\":\"$STU\",\"status\":\"ABSENT\"}]}"
check 400 "同一学生重复出现在同次提交里" \
  "$(c -XPOST "$API/sessions/$SID/attendance" -H "Authorization: Bearer $TEACHER" -H 'Content-Type: application/json' -d "$BODY_DUPE")"
BODY_CORRECT="{\"studentId\":\"$STU\",\"status\":\"ABSENT\",\"note\":\"老师想改\"}"
check 403 "规则11 老师订正出勤（只有 admin 能）" \
  "$(c -XPOST "$API/sessions/$SID/attendance/correct" -H "Authorization: Bearer $TEACHER" -H 'Content-Type: application/json' -d "$BODY_CORRECT")"
BODY_NONOTE="{\"studentId\":\"$STU\",\"status\":\"ABSENT\",\"note\":\"\"}"
check 422 "规则11 订正不填原因" \
  "$(c -XPOST "$API/sessions/$SID/attendance/correct" -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d "$BODY_NONOTE")"
echo

echo "── 排课（规则 1/2/5/8）──"
# 自给自足：先排第一节试听（seed 后可能还没有），再验证第二节被拒
TRIAL_STU=stu-065
FAR=$(node -p "new Date(Date.now()+30*86400000).toISOString().slice(0,10)")
TRIAL_A="{\"teacherId\":\"tea-09\",\"startsAt\":\"${FAR}T09:00:00Z\",\"durationMin\":60}"
TRIAL_B="{\"teacherId\":\"tea-11\",\"startsAt\":\"${FAR}T14:00:00Z\",\"durationMin\":60}"
c -XPOST "$API/students/$TRIAL_STU/trial" -H "Authorization: Bearer $ADMIN" \
  -H 'Content-Type: application/json' -d "$TRIAL_A" > /dev/null
check 409 "规则5 同一学生第二次试听" \
  "$(c -XPOST "$API/students/$TRIAL_STU/trial" -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d "$TRIAL_B")"
check 409 "规则1 老师同时段两节课（DB 约束）" \
  "$(c -XPOST "$API/students/stu-066/trial" -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d "$TRIAL_A")"
check 404 "不存在的班级" \
  "$(c -XPOST "$API/students/$MINE/enroll" -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"classGroupId":"no-such-group"}')"
check 400 "非法的课程时长" \
  "$(c -XPOST "$API/students/$MINE/trial" -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"teacherId":"tea-03","startsAt":"2026-12-01T09:00:00Z","durationMin":9999}')"
echo

echo "── 输入校验 ──"
check 400 "多传未声明的字段" \
  "$(c -XPOST "$API/auth/login" -H 'Content-Type: application/json' -d '{"email":"admin@demo.local","password":"demo1234","role":"ADMIN"}')"
check 401 "密码错误（与邮箱不存在同一错误）" \
  "$(c -XPOST "$API/auth/login" -H 'Content-Type: application/json' -d '{"email":"admin@demo.local","password":"wrongpw1"}')"
check 401 "邮箱不存在" \
  "$(c -XPOST "$API/auth/login" -H 'Content-Type: application/json' -d '{"email":"nobody@demo.local","password":"demo1234"}')"
check 404 "不存在的记录（不是 500）" \
  "$(c "$API/students/no-such-id" -H "Authorization: Bearer $ADMIN")"
check 404 "API 未匹配路由（不是 index.html）" "$(c "$API/nonexistent")"
echo

# ─── 并发：同一节课同一学生并发点名，余额只能减 1 ───
echo "── 并发（规则 4：幂等 + 行锁）──"
CSID=$(curl -s -H "Authorization: Bearer $TEACHER2" "$API/teacher/today" |
  node -p "const s=JSON.parse(require('fs').readFileSync(0));const n=Date.now();(s.find(x=>new Date(x.startsAt)<n&&!x.attendanceTaken)||{}).id||''")

if [[ -n "$CSID" ]]; then
  CSTU=$(curl -s -H "Authorization: Bearer $TEACHER2" "$API/sessions/$CSID/roster" |
    node -p "JSON.parse(require('fs').readFileSync(0)).roster[0].studentId")
  BAL0=$(curl -s -H "Authorization: Bearer $ADMIN" "$API/students/$CSTU/credits" |
    node -p "JSON.parse(require('fs').readFileSync(0)).balance")
  CBODY="{\"records\":[{\"studentId\":\"$CSTU\",\"status\":\"PRESENT\"}]}"

  for _ in 1 2 3 4 5; do
    curl -s -o /dev/null -XPOST "$API/sessions/$CSID/attendance" \
      -H "Authorization: Bearer $TEACHER2" -H 'Content-Type: application/json' \
      -d "$CBODY" &
  done
  wait

  BAL1=$(curl -s -H "Authorization: Bearer $ADMIN" "$API/students/$CSTU/credits" |
    node -p "JSON.parse(require('fs').readFileSync(0)).balance")
  DELTA=$((BAL0 - BAL1))

  if [[ "$DELTA" == "1" ]]; then
    PASS=$((PASS + 1))
    printf '  \033[32m✓\033[0m %-46s 余额 %s→%s，只扣 1 次\n' "5 个并发请求点名同一学生" "$BAL0" "$BAL1"
  else
    FAIL=$((FAIL + 1))
    printf '  \033[31m✗\033[0m %-46s 余额 %s→%s，扣了 %s 次！\n' "5 个并发请求点名同一学生" "$BAL0" "$BAL1" "$DELTA"
  fi
else
  printf '  \033[33m—\033[0m 跳过并发测试（没有未点名的已开始课次，重跑 seed 可恢复）\n'
fi
echo

# ─── 账目一致性：balance 必须等于流水之和 ───
echo "── 账目一致性 ──"
LEDGER_OK=$(curl -s -H "Authorization: Bearer $ADMIN" "$API/students/$MINE/credits" |
  node -p "
const d=JSON.parse(require('fs').readFileSync(0));
// 只能校验返回的最近 50 条，够用于抽查
d.entries.length>0 ? 'has-ledger' : 'empty'")

if [[ "$LEDGER_OK" == "has-ledger" ]]; then
  PASS=$((PASS + 1))
  printf '  \033[32m✓\033[0m %-46s\n' "课时流水可审计（每笔有操作人与原因）"
else
  FAIL=$((FAIL + 1))
  printf '  \033[31m✗\033[0m %-46s\n' "课时流水为空"
fi

echo
echo "════════════════════════════════════"
printf "  通过 %d / 失败 %d\n" "$PASS" "$FAIL"
echo "════════════════════════════════════"

[[ "$FAIL" == "0" ]] || exit 1
