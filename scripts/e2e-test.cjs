/** 端到端功能测试脚本 */
const fs = require('node:fs');

const BASE = 'http://127.0.0.1:3080';
const PASS = process.env.SEED_PASS || 'admin123456';
let cookie = '';

function parseCookie(res) {
  const sc = res.headers.get('set-cookie');
  if (!sc) return '';
  const m = sc.match(/wt_session=([^;]+)/);
  return m ? `wt_session=${m[1]}` : '';
}

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(opts.headers || {})
    }
  });
  const newCookie = parseCookie(res);
  if (newCookie) cookie = newCookie;

  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    return { status: res.status, json: await res.json() };
  }
  return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()), headers: res.headers };
}

let pass = 0;
let fail = 0;
function check(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

(async () => {
  console.log('\n========== 一、认证 ==========');
  const login = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: PASS })
  });
  check('管理员登录', login.json?.ok === true, login.json?.data?.display_name);
  check('会话 Cookie 已下发', cookie.length > 20);

  const wrongPwd = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'wrongpass' })
  });
  check('错误密码被拒绝', wrongPwd.status === 401);

  const me = await api('/api/auth/me');
  check('获取当前用户', me.json?.data?.role === 'admin');

  console.log('\n========== 二、标签与工作 ==========');
  const tagRes = await api('/api/tags', {
    method: 'POST',
    body: JSON.stringify({ name: '项目推进', color: '#a16207' })
  });
  check('创建标签', tagRes.json?.ok === true);
  const tagId = tagRes.json?.data?.id;

  const tasksRes = await api('/api/tasks?status=open');
  const existing = tasksRes.json?.data?.rows || [];
  check('工作列表可查询', Array.isArray(existing), `${existing.length} 条`);

  let taskId = existing[0]?.id;
  if (!taskId) {
    const created = await api('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: '起草季度工作总结材料',
        detail: '围绕年度任务完成情况撰写总结材料',
        done_criteria: '形成3000字总结材料并经负责人审定',
        due_date: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
        priority: 'high',
        tag_ids: tagId ? [tagId] : []
      })
    });
    taskId = created.json?.data?.id;
    check('创建工作', created.json?.ok === true, `ID ${taskId}`);
  }

  console.log('\n========== 三、进展记录 ==========');
  await api(`/api/tasks/${taskId}`, {
    method: 'POST',
    body: JSON.stringify({ content: '已完成提纲拟定，正在收集素材', percent: 30 })
  });
  const addP = await api(`/api/tasks/${taskId}`, {
    method: 'POST',
    body: JSON.stringify({ content: '初稿完成，进入润色阶段', percent: 65 })
  });
  check('追加进展记录', addP.json?.ok === true);
  check('进展条数正确', addP.json?.data?.progress?.length >= 2, `${addP.json?.data?.progress?.length} 条`);
  check(
    '进展按时间倒序',
    addP.json?.data?.progress?.[0]?.percent === 65
  );

  console.log('\n========== 四、DDL 与提醒 ==========');
  const scan = await api('/api/notifications?mode=scan');
  check('提醒扫描可用', scan.json?.ok === true, `${scan.json?.data?.length} 项待提醒`);

  const badges = await api('/api/dashboard/badges');
  check('徽标统计', badges.json?.ok === true,
    `逾期${badges.json?.data?.overdue} 临近${badges.json?.data?.dueSoon} 未读${badges.json?.data?.unseen}`);

  console.log('\n========== 五、销号与归档 ==========');
  const doneRes = await api(`/api/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'done' })
  });
  check('销号标记完成', doneRes.json?.data?.status === 'done');
  check('完成时间已写入', Boolean(doneRes.json?.data?.done_at), doneRes.json?.data?.done_at);

  const archRes = await api(`/api/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'archived' })
  });
  check('归档', archRes.json?.data?.status === 'archived');
  check('归档时间已写入', Boolean(archRes.json?.data?.archived_at));

  const archList = await api('/api/tasks?status=archived');
  check('归档区可查询', (archList.json?.data?.rows || []).some((t) => t.id === taskId));

  const restore = await api(`/api/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'open' })
  });
  check('恢复为进行中', restore.json?.data?.status === 'open');
  check('恢复后清除完成时间', restore.json?.data?.done_at === null);

  console.log('\n========== 六、大模型报告 ==========');
  const cfg = await api('/api/settings', {
    method: 'POST',
    body: JSON.stringify({
      section: 'llm',
      llm: {
        baseUrl: 'http://127.0.0.1:9911',
        apiKey: 'mock-key',
        model: 'mock-gpt-cn',
        temperature: 0.4,
        maxTokens: 3000
      }
    })
  });
  check('保存大模型配置', cfg.json?.ok === true);

  const testConn = await api('/api/settings?mode=testLlm');
  check('大模型连接测试', testConn.json?.data?.ok === true, `${testConn.json?.data?.latencyMs}ms`);

  const single = await api('/api/reports', {
    method: 'POST',
    body: JSON.stringify({ scope: 'single', taskId, taskTitle: '起草季度工作总结材料' })
  });
  check('单工作报告生成', single.json?.ok === true, `ID ${single.json?.data?.id}`);
  const singleContent = single.json?.data?.content || '';
  check('单报返回非空内容', singleContent.length > 50, `${singleContent.length} 字符`);

  const week = await api('/api/reports', {
    method: 'POST',
    body: JSON.stringify({ scope: 'week' })
  });
  check('周报生成', week.json?.ok === true, `纳入 ${week.json?.data?.taskCount} 项工作`);
  check(
    '周报提示词含统计事实与工作明细',
    (week.json?.data?.content || '').includes('MOCK_ECHO:true:true')
  );

  const month = await api('/api/reports', { method: 'POST', body: JSON.stringify({ scope: 'month' }) });
  check('月报生成', month.json?.ok === true);

  const half = await api('/api/reports', { method: 'POST', body: JSON.stringify({ scope: 'half_year' }) });
  check('半年报生成', half.json?.ok === true);

  const year = await api('/api/reports', { method: 'POST', body: JSON.stringify({ scope: 'year' }) });
  check('年报生成', year.json?.ok === true);

  const custom = await api('/api/reports?start=2026-10-01&end=2026-10-31', {
    method: 'POST',
    body: JSON.stringify({ scope: 'custom' })
  });
  check('自定义区间报告', custom.json?.ok === true);

  console.log('\n========== 七、导出 ==========');
  const reportId = single.json?.data?.id;

  const docx = await api(`/api/reports/${reportId}/export?format=docx`);
  const isDocx =
    docx.status === 200 &&
    docx.buffer &&
    docx.buffer[0] === 0x50 &&
    docx.buffer[1] === 0x4b; // PK zip 头
  check('Word 导出（合法 docx）', isDocx, `${Math.round((docx.buffer?.length || 0) / 1024)} KB`);

  const md = await api(`/api/reports/${reportId}/export?format=md`);
  const mdText = md.buffer ? md.buffer.toString('utf-8') : '';
  check('Markdown 导出', mdText.includes('---') && mdText.includes('title:'), `${mdText.length} 字符`);
  check('frontmatter 首标签为 WorkBuddy', mdText.includes('"WorkBuddy"'));

  const html = await api(`/api/reports/${reportId}/export?format=html`);
  const htmlText = html.buffer ? html.buffer.toString('utf-8') : '';
  check('打印 HTML 导出', htmlText.includes('仿宋_GB2312') && htmlText.includes('29.5pt'));
  check('页边距符合公文规范', htmlText.includes('35mm 27mm 33mm 27mm'));

  console.log('\n========== 八、Obsidian ==========');
  const vaultTree = await api('/api/obsidian?mode=tree');
  check('Obsidian 目录接口可用', vaultTree.json?.ok === true, `enabled=${vaultTree.json?.data?.enabled}`);

  const badRead = await api('/api/obsidian?mode=read&path=' + encodeURIComponent('../../../windows/win.ini'));
  check('路径穿越被阻止', badRead.status === 404 || badRead.json?.ok === false, `HTTP ${badRead.status}`);

  console.log('\n========== 九、权限隔离 ==========');
  const newUser = await api('/api/users', {
    method: 'POST',
    body: JSON.stringify({
      username: 'test_member',
      display_name: '测试成员',
      password: 'test123456',
      role: 'member'
    })
  });
  check('创建成员账号', newUser.json?.ok === true || newUser.status === 409);

  const adminCookie = cookie;
  cookie = '';
  const memberLogin = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'test_member', password: 'test123456' })
  });
  check('成员登录成功', memberLogin.json?.ok === true);

  const memberSettings = await api('/api/settings', {
    method: 'POST',
    body: JSON.stringify({ section: 'llm', llm: { model: 'hacked' } })
  });
  check('成员无法修改系统配置（403）', memberSettings.status === 403);

  const memberUsers = await api('/api/users');
  check('成员可查看用户列表', memberUsers.status === 200);

  const memberCreateUser = await api('/api/users', {
    method: 'POST',
    body: JSON.stringify({ username: 'hacker', display_name: 'x', password: '123456', role: 'admin' })
  });
  check('成员无法创建用户（403）', memberCreateUser.status === 403);

  cookie = adminCookie;

  console.log('\n========== 十、周期模板 ==========');
  const tpl = await api('/api/templates', {
    method: 'POST',
    body: JSON.stringify({
      title: '每周进度周报报送',
      detail: '每周五前报送进度周报',
      done_criteria: '完成周报报送并归档',
      cadence: 'weekly',
      weekday: 5,
      priority: 'normal'
    })
  });
  check('创建周期模板', tpl.json?.ok === true, `生成 ${tpl.json?.data?.generated ?? 0} 个实例`);

  const tplList = await api('/api/templates');
  check('模板列表查询', (tplList.json?.data || []).length > 0);

  console.log('\n========== 十一、未登录防护 ==========');
  cookie = '';
  const noAuth = await api('/api/tasks');
  check('未登录访问 API 返回 401', noAuth.status === 401);

  console.log(`\n${'='.repeat(50)}`);
  console.log(`测试结果：通过 ${pass} 项，失败 ${fail} 项`);
  console.log(`${'='.repeat(50)}\n`);

  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('测试异常:', e);
  process.exit(1);
});
