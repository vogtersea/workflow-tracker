/** Obsidian 集成专项测试 */
const BASE = 'http://127.0.0.1:3080';
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
  const nc = parseCookie(res);
  if (nc) cookie = nc;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return { status: res.status, json: await res.json() };
  return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()) };
}

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

(async () => {
  await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'admin123456' })
  });

  console.log('\n========== Obsidian 集成测试 ==========');

  const tree = await api('/api/obsidian?mode=tree');
  check('目录概览', tree.json?.data?.enabled === true, `共 ${tree.json?.data?.total} 篇`);
  check('识别到子目录', (tree.json?.data?.folders || []).length >= 2,
    (tree.json?.data?.folders || []).map((f) => `${f.name}(${f.count})`).join(', '));

  const s1 = await api('/api/obsidian?mode=search&q=' + encodeURIComponent('党课'));
  check('按标题检索"党课"', (s1.json?.data || []).length > 0,
    (s1.json?.data || []).map((n) => n.title).join(', '));

  const s2 = await api('/api/obsidian?mode=search&q=' + encodeURIComponent('三级审核'));
  check('按正文检索"三级审核"', (s2.json?.data || []).length > 0,
    (s2.json?.data || [])[0]?.title);
  check('返回上下文摘要', Boolean((s2.json?.data || [])[0]?.excerpt),
    ((s2.json?.data || [])[0]?.excerpt || '').slice(0, 40));

  const read = await api('/api/obsidian?mode=read&path=' + encodeURIComponent('01-工作/监管报送要点.md'));
  check('读取笔记正文', read.json?.ok === true && read.json?.data?.content?.includes('三级审核'));

  // 路径穿越防护
  const traverse1 = await api('/api/obsidian?mode=read&path=' + encodeURIComponent('../../../windows/win.ini'));
  check('阻止 ../ 路径穿越', traverse1.status === 404 || traverse1.json?.ok === false,
    `HTTP ${traverse1.status}`);

  const traverse2 = await api('/api/obsidian?mode=read&path=' + encodeURIComponent('..\\..\\boot.ini'));
  check('阻止 ..\\ 路径穿越', traverse2.status === 404 || traverse2.json?.ok === false,
    `HTTP ${traverse2.status}`);

  const missing = await api('/api/obsidian?mode=read&path=' + encodeURIComponent('不存在的笔记.md'));
  check('不存在的笔记返回 404', missing.status === 404);

  console.log('\n========== 报告写回 vault ==========');

  const reports = await api('/api/reports');
  const reportId = reports.json?.data?.[0]?.id;
  check('存在可写回的报告', Boolean(reportId), `ID ${reportId}`);

  const w1 = await api(`/api/reports/${reportId}/export?format=vault`);
  check('写回成功', w1.json?.ok === true, w1.json?.data?.path || w1.json?.error);

  const w2 = await api(`/api/reports/${reportId}/export?format=vault`);
  check('重复写回不覆盖（自动加序号）',
    w2.json?.ok === true && w2.json?.data?.path !== w1.json?.data?.path,
    `第一次 ${w1.json?.data?.path} / 第二次 ${w2.json?.data?.path}`);

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Obsidian 测试：通过 ${pass} 项，失败 ${fail} 项`);
  console.log(`${'='.repeat(50)}\n`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error('异常:', e); process.exit(1); });
