/**
 * 演示数据填充脚本（通用示例，不含任何真实业务信息）
 *
 * 用途：为系统填充一批示例工作项，便于查看界面与报告生成效果。
 * 使用：确保服务已启动，然后执行：
 *   SEED_PASS=你的密码 node scripts/seed-demo.cjs
 *
 * 环境变量：
 *   BASE_URL   服务地址，默认 http://127.0.0.1:3080
 *   SEED_USER  登录用户名，默认 admin
 *   SEED_PASS  登录密码（必须提供）
 */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3080';
const USER = process.env.SEED_USER || 'admin';
const PASS = process.env.SEED_PASS || '';

let cookie = '';

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(opts.headers || {})
    }
  });
  const sc = res.headers.get('set-cookie');
  if (sc) {
    const m = sc.match(/wt_session=([^;]+)/);
    if (m) cookie = `wt_session=${m[1]}`;
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return { status: res.status, json: await res.json() };
  return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()) };
}

const d = (offset) => {
  const t = new Date();
  t.setDate(t.getDate() + offset);
  return t.toISOString().slice(0, 10);
};

(async () => {
  if (!PASS) {
    console.error('请通过环境变量 SEED_PASS 提供登录密码，例如：');
    console.error('  SEED_PASS=你的密码 node scripts/seed-demo.cjs');
    process.exit(1);
  }

  const login = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: USER, password: PASS })
  });
  if (!login.json?.ok) {
    console.error('登录失败：', login.json?.error);
    process.exit(1);
  }
  console.log('登录成功');

  // ---------- 标签 ----------
  const tagDefs = [
    ['日常事务', '#a16207'],
    ['项目推进', '#b91c1c'],
    ['材料撰写', '#1d4ed8'],
    ['沟通协调', '#15803d'],
    ['学习提升', '#6d28d9']
  ];
  const tagIds = {};
  for (const [name, color] of tagDefs) {
    const r = await api('/api/tags', {
      method: 'POST',
      body: JSON.stringify({ name, color })
    });
    if (r.json?.ok) {
      tagIds[name] = r.json.data.id;
    } else {
      const list = await api('/api/tags');
      const hit = (list.json?.data || []).find((t) => t.name === name);
      if (hit) tagIds[name] = hit.id;
    }
  }
  console.log('标签：', Object.keys(tagIds).join('、'));

  // ---------- 工作项 ----------
  const tasks = [
    {
      title: '季度工作总结材料撰写',
      detail: '汇总本季度各项工作推进情况，梳理关键成果与存在问题，形成总结材料报部门负责人审阅。',
      done_criteria: '形成3000字以上总结材料，经负责人审阅后定稿归档',
      due_date: d(3),
      priority: 'urgent',
      tags: ['材料撰写'],
      progress: [
        ['完成各条线情况收集，列出材料框架', 25],
        ['框架确认，补充关键数据与案例', 50],
        ['完成初稿约5000字，送审', 75]
      ]
    },
    {
      title: '月度数据报表核对与报送',
      detail: '核对本月各项数据口径，编制报表并按要求报送。',
      done_criteria: '数据经复核无误，按期完成报送并留存回执',
      due_date: d(-2),
      priority: 'urgent',
      tags: ['日常事务'],
      progress: [
        ['完成基础数据提取，正在核对差异', 30],
        ['数据核对完成，初稿已形成，送复核', 60]
      ]
    },
    {
      title: '内部培训方案设计',
      detail: '针对团队能力短板设计下季度培训方案，含课程设置、时间安排与考核方式。',
      done_criteria: '方案通过评审，明确讲师与排期',
      due_date: d(6),
      priority: 'high',
      tags: ['学习提升'],
      progress: [['完成需求调研，梳理出三个重点方向', 25]]
    },
    {
      title: '重点项目进度跟踪专报',
      detail: '梳理重点项目本期进展、存在问题与下阶段安排，形成专报供决策参考。',
      done_criteria: '专报完成并经评审，报分管负责人及相关部门',
      due_date: d(9),
      priority: 'high',
      tags: ['项目推进'],
      progress: [['完成项目清单更新，正在收集典型案例', 35]]
    },
    {
      title: '对外宣传稿件撰写与投稿',
      detail: '围绕本季度重点工作成效撰写宣传稿件，完成后对外投稿。',
      done_criteria: '完成1500字稿件1篇并完成投稿',
      due_date: d(-8),
      priority: 'normal',
      tags: ['材料撰写'],
      progress: [
        ['完成素材收集与访谈', 40],
        ['稿件完成并投出，等待反馈', 100]
      ],
      status: 'done'
    },
    {
      title: '部门季度例会筹备方案',
      detail: '策划季度例会方案，含议程、参会范围、材料准备分工。',
      done_criteria: '方案经确认，议程与分工明确到人',
      due_date: d(-15),
      priority: 'normal',
      tags: ['沟通协调'],
      progress: [['初稿完成，已提交负责人', 80]],
      status: 'archived'
    }
  ];

  const created = [];
  for (const t of tasks) {
    const r = await api('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: t.title,
        detail: t.detail,
        done_criteria: t.done_criteria,
        due_date: t.due_date,
        priority: t.priority,
        tag_ids: t.tags.map((x) => tagIds[x]).filter(Boolean)
      })
    });
    const id = r.json?.data?.id;
    if (!id) {
      console.log('创建失败：', t.title, r.json?.error);
      continue;
    }
    created.push({ id, title: t.title });

    for (const [content, percent] of t.progress) {
      await api(`/api/tasks/${id}`, {
        method: 'POST',
        body: JSON.stringify({ content, percent })
      });
    }
    if (t.status === 'done') {
      await api(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'done' }) });
    } else if (t.status === 'archived') {
      await api(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'done' }) });
      await api(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'archived' }) });
    }
    console.log(`已创建：${t.title}（ID ${id}，${t.progress.length} 条进展）`);
  }

  // ---------- 周期模板 ----------
  const tpl = await api('/api/templates', {
    method: 'POST',
    body: JSON.stringify({
      title: '每周周报报送',
      detail: '每周整理本周工作动态，形成周报并报送。',
      done_criteria: '完成周报1份并按时报送',
      cadence: 'weekly',
      weekday: 5,
      priority: 'normal'
    })
  });
  console.log(
    '周期模板：',
    tpl.json?.ok ? `已创建（生成 ${tpl.json.data.generated} 个实例）` : tpl.json?.error
  );

  console.log(`\n数据准备完成，共 ${created.length} 项工作`);
})().catch((e) => {
  console.error('执行异常：', e);
  process.exit(1);
});
