import { runReminderJob } from './reminders';

/**
 * 进程内提醒循环
 *
 * 触发链原本只有「浏览器打开 → 轮询 badges → syncNotifications」，
 * 没人开页面就不会提醒。这里加一个常驻循环，每 30 分钟唤醒一次，
 * 真正的「是否到点、今天是否已推」判断在 runReminderJob 内部，
 * 因此多触发几次也不会重复推送。
 */

let started = false;

export function startReminderLoop() {
  if (started) return;
  started = true;

  const tick = async () => {
    try {
      const r = await runReminderJob();
      if (!r.skipped) {
        console.log(
          `[reminder] 已执行：扫描 ${r.scanned} 项，新增 ${r.created} 条，推送 ${r.pushed ? '成功' : '未推送'}${
            r.pushMessage ? `（${r.pushMessage}）` : ''
          }`
        );
      }
    } catch (e) {
      console.error('[reminder] 执行失败', e);
    }
  };

  // 启动 1 分钟后先探一次，之后每 30 分钟一次
  setTimeout(tick, 60_000);
  setInterval(tick, 30 * 60_000);

  console.log('[reminder] loop started（每 30 分钟检查一次，默认 09:00 触发）');
}
