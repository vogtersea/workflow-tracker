/**
 * Obsidian 集成专项测试
 *
 * 该脚本会在 scripts/.vaulttest/ 下自动生成一个临时知识库夹具（已 gitignore），
 * 通过设置接口把 vault 路径指向它，测试完成后不修改任何外部目录。
 * 因此无需准备真实知识库即可直接运行。
 */
const fs = require('node:fs');
const path = require('node:path');

const BASE = 'http://127.0.0.1:3080';
const PASS = process.env.SEED_PASS || 'admin123456';
const VAULT = path.join(__dirname, '.vaulttest');
let cookie = '';

function parseCookie(res) {
  const sc = res.headers.get('set-cookie');
  if (!sc) return '';
  const m = sc.match(/wt_session=([^;]+)/);
  return m ? `wt_session=${m[1]}` : '';
}

async function api(p, opts = {}) {
  const res = await fetch(BASE + p, {
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

/** 生成临时知识库夹具 */
function buildFixture() {
  fs.rmSync(VAULT, { recursive: true, force: true });
  const files = {
    '01-工作/项目进度跟踪要点.md': [
      '---',
      'title: 项目进度跟踪要点',
      'tags: [模板]',
      '---',
      '',
      '# 项目进度跟踪要点',
      '',
      '进展记录遵循三级审核流程：承办人自校、负责人复核、分管领导审定。',
      '每项工作按节点登记，做到一事一记。'
    ].join('\n'),
    '02-学习/季度总结写作要点.md': [
      '---',
      'title: 季度总结写作要点',
      'tags: [模板]',
      '---',
      '',
      '# 季度总结写作要点',
      '',
      '总体情况先列数据，再讲工作推进，最后写问题与打算。',
      '标题层级按「一、（一）1.」四层组织。'
    ].join('\n')
  };
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(VAULT, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content + '\n', 'utf-8');
  }
  fs.mkdirSync(path.join(VAULT, '99-收件箱'), { recursive: true });
}

(async () => {
  await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: PASS })
  });

  // 指向临时夹具，避免读写真实知识库
  buildFixture();
  const cfg = await api('/api/settings', {
    method: 'POST',
    body: JSON.stringify({
      section: 'obsidian',
      obsidian: { dir: VAULT, writeback: '99-收件箱' }
    })
  });
  check('配置指向临时测试库', cfg.json?.ok === true, VAULT);

  console.log('\n========== Obsidian 集成测试 ==========');

  const tree = await api('/api/obsidian?mode=tree');
  check('目录概览', tree.json?.data?.enabled === true, `共 ${tree.json?.data?.total} 篇`);
  check('识别到子目录', (tree.json?.data?.folders || []).length >= 2,
    (tree.json?.data?.folders || []).map((f) => `${f.name}(${f.count})`).join(', '));

  const s1 = await api('/api/obsidian?mode=search&q=' + encodeURIComponent('季度总结'));
  check('按标题检索「季度总结」', (s1.json?.data || []).length > 0,
    (s1.json?.data || []).map((n) => n.title).join(', '));

  const s2 = await api('/api/obsidian?mode=search&q=' + encodeURIComponent('三级审核'));
  check('按正文检索「三级审核」', (s2.json?.data || []).length > 0,
    (s2.json?.data || [])[0]?.title);
  check('返回上下文摘要', Boolean((s2.json?.data || [])[0]?.excerpt),
    ((s2.json?.data || [])[0]?.excerpt || '').slice(0, 40));

  const read = await api('/api/obsidian?mode=read&path=' + encodeURIComponent('01-工作/项目进度跟踪要点.md'));
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

  const written = w1.json?.data?.path ? fs.readFileSync(path.join(VAULT, w1.json.data.path), 'utf-8') : '';
  check('frontmatter 首标签为 WorkBuddy', /tags:\s*\["WorkBuddy"/.test(written));

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Obsidian 测试：通过 ${pass} 项，失败 ${fail} 项`);
  console.log(`临时测试库：${VAULT}（可安全删除）`);
  console.log(`${'='.repeat(50)}\n`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error('异常:', e); process.exit(1); });
