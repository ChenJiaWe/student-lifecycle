import { useEffect, useState } from 'react'

/**
 * 一个会走的时钟。
 *
 * 今日课程页整页都在回答"现在能不能点名了"，而这个答案只随时间变化，
 * 不随数据变化。如果只在首次渲染时算一次，"还有 1 分钟开始"会一直挂在
 * 那里 —— 课都上完了按钮还是灰的。所以让它自己走。
 */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])

  return now
}
