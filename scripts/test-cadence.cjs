/**
 * 例行工作周期推导的边界测试
 * 覆盖每天/每周/每月/每季度/每半年/每年六种周期，以及月末/闰年/顺延/跨周期顺延等边界
 *
 * 运行：node scripts/test-cadence.cjs
 * 脚本会先把 src/lib/templates.ts 与 date.ts 编译到 .tmp-cadence/ 再执行断言，无需另外构建。
 */
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '.tmp-cadence');

fs.rmSync(OUT, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
    'src/lib/templates.ts',
    'src/lib/date.ts',
    '--outDir',
    '.tmp-cadence',
    '--module',
    'commonjs',
    '--target',
    'es2020',
    '--moduleResolution',
    'node',
    '--skipLibCheck',
    '--esModuleInterop'
  ],
  { cwd: ROOT, stdio: 'inherit' }
);

process.env.DATA_DIR = path.join(OUT, 'data');

const t = require(path.join(OUT, 'templates.js'));

let pass = 0;
let fail = 0;

function eq(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}\n      期望 ${JSON.stringify(expected)}\n      实际 ${JSON.stringify(actual)}`);
  }
}

function tpl(o) {
  return {
    id: 1,
    title: 'x',
    detail: '',
    done_criteria: '',
    cadence: 'monthly',
    weekday: null,
    month_day: null,
    month_no: null,
    due_offset: 0,
    priority: 'normal',
    owner_id: null,
    tag_ids: '[]',
    enabled: 1,
    last_run_period: null,
    ...o
  };
}

console.log('\n===== 周期标识 periodOf =====');
const D = (s) => new Date(s + 'T10:00:00');
eq('每天 2026-10-20', t.periodOf('daily', D('2026-10-20')), {
  period: '2026-10-20',
  label: '2026年10月20日'
});
eq('每周 2026-10-20', t.periodOf('weekly', D('2026-10-20')), {
  period: '2026-W43',
  label: '2026年第43周'
});
eq('每月 2026-10-20', t.periodOf('monthly', D('2026-10-20')), {
  period: '2026-10',
  label: '2026年10月'
});
eq('每季度 2026-10-20（Q4）', t.periodOf('quarterly', D('2026-10-20')), {
  period: '2026-Q4',
  label: '2026年第4季度'
});
eq('每半年 2026-10-20（下半年）', t.periodOf('halfyearly', D('2026-10-20')), {
  period: '2026-H2',
  label: '2026年下半年'
});
eq('每年 2026-10-20', t.periodOf('yearly', D('2026-10-20')), {
  period: '2026',
  label: '2026年'
});
eq('每季度 2026-01-05（Q1）', t.periodOf('quarterly', D('2026-01-05')).period, '2026-Q1');
eq('每半年 2026-06-30（上半年末）', t.periodOf('halfyearly', D('2026-06-30')).period, '2026-H1');
eq('每半年 2026-07-01（下半年首日）', t.periodOf('halfyearly', D('2026-07-01')).period, '2026-H2');

console.log('\n===== 到期日推导 computeDue =====');
eq(
  '每天：当天到期',
  t.computeDue(tpl({ cadence: 'daily' }), D('2026-10-20')).due,
  '2026-10-20'
);
eq(
  '每周：默认周五',
  t.computeDue(tpl({ cadence: 'weekly', weekday: 5 }), D('2026-10-20')).due,
  '2026-10-23'
);
eq(
  '每周：指定周一，本周一已过则顺延至下周一',
  t.computeDue(tpl({ cadence: 'weekly', weekday: 1 }), D('2026-10-20')).due,
  '2026-10-26'
);
eq(
  '每周：周日属于同一周',
  t.computeDue(tpl({ cadence: 'weekly', weekday: 7 }), D('2026-10-20')).due,
  '2026-10-25'
);
eq(
  '每月 25 日',
  t.computeDue(tpl({ cadence: 'monthly', month_day: 25 }), D('2026-10-20')).due,
  '2026-10-25'
);
eq(
  '每月 31 日遇 2 月按月末（2026-02 非闰年）',
  t.computeDue(tpl({ cadence: 'monthly', month_day: 31 }), D('2026-02-10')).due,
  '2026-02-28'
);
eq(
  '每月 31 日遇闰年 2 月（2028-02）',
  t.computeDue(tpl({ cadence: 'monthly', month_day: 31 }), D('2028-02-10')).due,
  '2028-02-29'
);
eq(
  '每季度 15 日，Q4 → 12-15',
  t.computeDue(tpl({ cadence: 'quarterly', month_day: 15 }), D('2026-10-20')).due,
  '2026-12-15'
);
eq(
  '每季度 15 日，Q1 → 03-15',
  t.computeDue(tpl({ cadence: 'quarterly', month_day: 15 }), D('2026-02-01')).due,
  '2026-03-15'
);
eq(
  '每半年 10 日，下半年 → 12-10',
  t.computeDue(tpl({ cadence: 'halfyearly', month_day: 10 }), D('2026-10-20')).due,
  '2026-12-10'
);
eq(
  '每半年 10 日，上半年 → 06-10',
  t.computeDue(tpl({ cadence: 'halfyearly', month_day: 10 }), D('2026-03-20')).due,
  '2026-06-10'
);
eq(
  '每年 12 月 31 日',
  t.computeDue(tpl({ cadence: 'yearly', month_day: 31, month_no: 12 }), D('2026-10-20')).due,
  '2026-12-31'
);
eq(
  '每年 1 月 10 日（当前 10 月，本年已过则顺延到次年）',
  t.computeDue(tpl({ cadence: 'yearly', month_day: 10, month_no: 1 }), D('2026-10-20')).due,
  '2027-01-10'
);
eq(
  '每年 1 月 10 日顺延后周期标识为 2027',
  t.computeDue(tpl({ cadence: 'yearly', month_day: 10, month_no: 1 }), D('2026-10-20')).period,
  '2027'
);
eq(
  '每年 1 月 10 日：1 月 5 日查看仍是当年 1 月 10 日',
  t.computeDue(tpl({ cadence: 'yearly', month_day: 10, month_no: 1 }), D('2026-01-05')).due,
  '2026-01-10'
);
eq(
  '每季度 15 日，Q4 查看 10 月时 Q4 未到期，仍取 12-15',
  t.computeDue(tpl({ cadence: 'quarterly', month_day: 15 }), D('2026-10-20')).due,
  '2026-12-15'
);
eq(
  '每季度 15 日，Q1 已过期则顺延到 Q2 的 06-15',
  t.computeDue(tpl({ cadence: 'quarterly', month_day: 15 }), D('2026-04-20')).due,
  '2026-06-15'
);
eq(
  '顺延 +5 天',
  t.computeDue(tpl({ cadence: 'monthly', month_day: 25, due_offset: 5 }), D('2026-10-20')).due,
  '2026-10-30'
);
eq(
  '提前 -3 天且本周期已过，顺延到下周期再回退（11-02 减 3 天）',
  t.computeDue(tpl({ cadence: 'monthly', month_day: 2, due_offset: -3 }), D('2026-10-20')).due,
  '2026-10-30'
);
eq(
  '每年 12 月 31 日 +2 天跨年',
  t.computeDue(tpl({ cadence: 'yearly', month_day: 31, month_no: 12, due_offset: 2 }), D('2026-10-20'))
    .due,
  '2027-01-02'
);

console.log('\n===== 提前窗口 lead =====');
eq('每天 1 天', t.computeDue(tpl({ cadence: 'daily' }), D('2026-10-20')).lead, 1);
eq('每周 7 天', t.computeDue(tpl({ cadence: 'weekly' }), D('2026-10-20')).lead, 7);
eq('每月 7 天', t.computeDue(tpl({ cadence: 'monthly' }), D('2026-10-20')).lead, 7);
eq('每季度 14 天', t.computeDue(tpl({ cadence: 'quarterly' }), D('2026-10-20')).lead, 14);
eq('每半年 21 天', t.computeDue(tpl({ cadence: 'halfyearly' }), D('2026-10-20')).lead, 21);
eq('每年 30 天', t.computeDue(tpl({ cadence: 'yearly' }), D('2026-10-20')).lead, 30);

console.log('\n===== 规则文案 ruleText =====');
eq('每天', t.ruleText(tpl({ cadence: 'daily' })), '每天到期');
eq('每周五', t.ruleText(tpl({ cadence: 'weekly', weekday: 5 })), '每周五到期');
eq('每月 25 日', t.ruleText(tpl({ cadence: 'monthly', month_day: 25 })), '每月 25 日到期');
eq(
  '每季度',
  t.ruleText(tpl({ cadence: 'quarterly', month_day: 15 })),
  '每季度末月（3/6/9/12 月）15 日到期'
);
eq('每半年', t.ruleText(tpl({ cadence: 'halfyearly', month_day: 10 })), '每半年末月（6/12 月）10 日到期');
eq('每年', t.ruleText(tpl({ cadence: 'yearly', month_day: 31, month_no: 12 })), '每年 12 月 31 日到期');
eq(
  '带顺延',
  t.ruleText(tpl({ cadence: 'monthly', month_day: 25, due_offset: 3 })),
  '每月 25 日到期，顺延 3 天'
);

console.log(`\n${'='.repeat(46)}`);
console.log(`周期推导测试：通过 ${pass} 项，失败 ${fail} 项`);
console.log(`${'='.repeat(46)}\n`);

fs.rmSync(OUT, { recursive: true, force: true });
process.exit(fail > 0 ? 1 : 0);
