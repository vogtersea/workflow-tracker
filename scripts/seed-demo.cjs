/** 真实公文场景数据填充：用于验证报告生成与界面展示效果 */
const BASE = 'http://127.0.0.1:3080';
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
  const login = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'Su@2026Niuyan' })
  });
  console.log('登录:', login.json?.ok ? '成功' : '失败');
  if (!login.json?.ok) return;

  // 标签
  const tagDefs = [
    ['党课材料', '#b91c1c'],
    ['中心组学习', '#a16207'],
    ['监管汇报', '#c2410c'],
    ['网讯宣传', '#15803d'],
    ['承接工作', '#1d4ed8']
  ];
  const tagIds = {};
  for (const [name, color] of tagDefs) {
    const r = await api('/api/tags', {
      method: 'POST',
      body: JSON.stringify({ name, color })
    });
    tagIds[name] = r.json?.data?.id;
  }
  console.log('标签:', Object.keys(tagIds).join('、'));

  // 工作项（含贴近真实的分工与描述）
  const tasks = [
    {
      title: '撰写"树立和践行正确政绩观"专题党课讲稿',
      detail:
        '按照党委统一部署，为分管条线党员干部讲授专题党课。需结合中央关于树立正确政绩观的部署要求，联系服务区域发展大局的实际，讲清"为谁创造业绩、创造什么样的业绩、怎样创造业绩"。',
      done_criteria:
        '形成6000字左右讲稿一份，配套PPT不少于20页，经分管行领导审定后报党委组织部备案',
      due_date: d(3),
      priority: 'urgent',
      tags: ['党课材料', '中心组学习'],
      progress: [
        ['完成中央相关论述与总行文件梳理，列出参考文献12篇', 20],
        ['拟定讲稿三级提纲并报分管领导审阅，要求增加本地案例', 40],
        ['补充某片区片区网点服务、承接企业融资两个案例，完成初稿5000字', 70]
      ]
    },
    {
      title: '三季度监管数据报送材料汇总',
      detail:
        '按金融监管总局河北监管局要求，汇总三季度各项业务数据并撰写分析说明，重点说明服务实体经济与风险防控情况。',
      done_criteria: '完成数据核对并经三级审核，按期报送监管局，留存报送回执',
      due_date: d(-2),
      priority: 'urgent',
      tags: ['监管汇报'],
      progress: [
        ['完成基础数据提取，正在核对口径差异', 30],
        ['数据核对完成，初稿已形成，送部门负责人初审', 60]
      ]
    },
    {
      title: '中心组理论学习第八次集体学习发言材料',
      detail:
        '围绕"学习习近平总书记关于党的建设的重要思想"主题准备发言材料，结合办公室、人力资源部、个人金融业务部工作实际谈体会。',
      done_criteria: '形成3000字发言稿，会上作15分钟发言',
      due_date: d(6),
      priority: 'high',
      tags: ['中心组学习'],
      progress: [['完成理论原著与辅导读本研读，列出四个问题清单', 25]]
    },
    {
      title: '区域金融服务专报（第12期）',
      detail:
        '梳理本期承接央企及二三级子公司落地进展、配套金融服务举措与典型案例，形成专报报送新区管委会。',
      done_criteria: '专报形成并经行长办公会审定，报新区管委会及总行相关部门',
      due_date: d(9),
      priority: 'high',
      tags: ['承接工作', '监管汇报'],
      progress: [['完成本期承接企业名单更新，正在收集典型案例', 35]]
    },
    {
      title: '内宣网讯稿件撰写与投稿',
      detail: '围绕分行服务区域建设成果，撰写内宣网讯稿并向上级行投稿。',
      done_criteria: '完成1500字网讯稿1篇并成功投稿，力争采用',
      due_date: d(-8),
      priority: 'normal',
      tags: ['网讯宣传'],
      progress: [
        ['完成素材收集与采访', 40],
        ['稿件完成并投稿，等待采用通知', 100]
      ],
      status: 'done'
    },
    {
      title: '办公室党支部主题党日活动方案',
      detail: '策划第四季度主题党日活动方案，含活动主题、形式、时间地点与经费预算。',
      done_criteria: '方案获支部委员会通过并报党委组织部备案',
      due_date: d(-15),
      priority: 'normal',
      tags: ['中心组学习'],
      progress: [['初稿完成，已提交支部委员会', 80]],
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
        tag_ids: t.tags.map((x) => tagIds[x]).filter(Boolean),
        owner_id: 1
      })
    });
    const id = r.json?.data?.id;
    if (!id) {
      console.log('创建工作失败:', t.title, r.json?.error);
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
    console.log(`已创建: ${t.title} (ID ${id}, ${t.progress.length} 条进展)`);
  }

  // 周期模板
  const tpl = await api('/api/templates', {
    method: 'POST',
    body: JSON.stringify({
      title: '每周网讯稿件报送',
      detail: '每周整理本周工作动态，撰写网讯稿并向上级行投稿。',
      done_criteria: '完成网讯稿1篇并完成投稿',
      cadence: 'weekly',
      weekday: 5,
      priority: 'normal',
      owner_id: 1
    })
  });
  console.log('周期模板:', tpl.json?.ok ? `已创建（生成 ${tpl.json.data.generated} 个实例）` : tpl.json?.error);

  console.log('\n数据准备完成，共', created.length, '项工作');
})();
