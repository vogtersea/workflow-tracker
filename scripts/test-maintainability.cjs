/**
 * 验证部署后可维护性：
 *  1. Obsidian 路径界面优先于环境变量
 *  2. 任意角色都能改自己的密码（含原密码校验）
 *  3. ADMIN_PASSWORD 只在空库时生效一次
 */
const BASE = 'http://127.0.0.1:3080';
let cookie = '';

function pickCookie(res) {
  const sc = res.headers.get('set-cookie');
  if (!sc) return;
  const m = sc.match(/wt_session=([^;]+)/);
  if (m) cookie = `wt_session=${m[1]}`;
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
  pickCookie(res);
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return { status: res.status, json: await res.json() };
  return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()) };
}

let pass = 0, fail = 0;
const check = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`); }
  else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); }
};

(async () => {
  // 管理员登录
  const login = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'Su@2026Niuyan' })
  });
  if (!login.json?.ok) {
    console.error('登录失败:', login.json?.error);
    process.exit(1);
  }

  console.log('\n========== 一、Obsidian 路径优先级 ==========');
  const before = await api('/api/settings');
  console.log('   当前配置:', before.json?.data?.obsidian?.dir,
    '(来源:', before.json?.data?.obsidian?.dirSource, ')');

  // 通过界面接口设置路径
  const setUi = await api('/api/settings', {
    method: 'POST',
    body: JSON.stringify({ section: 'obsidian', obsidian: { dir: '/nonexistent-path', writeback: '99-收件箱' } })
  });
  check('界面保存路径', setUi.json?.ok === true);

  const after = await api('/api/settings');
  check('界面设置覆盖环境变量',
    after.json?.data?.obsidian?.dir === '/nonexistent-path' &&
    after.json?.data?.obsidian?.dirSource === 'ui',
    `dir=${after.json?.data?.obsidian?.dir} source=${after.json?.data?.obsidian?.dirSource}`);

  check('无效路径时 enabled=false', after.json?.data?.obsidian?.enabled === false);

  // 探测接口对无效路径应给出明确提示
  const probeBad = await api('/api/obsidian?mode=tree');
  check('探测无效路径返回未启用',
    probeBad.json?.data?.enabled === false,
    probeBad.json?.data?.message || '');

  // 恢复为有效路径（项目内临时目录）
  const fs = require('node:fs');
  const path = require('node:path');
  const goodDir = path.join(process.cwd(), '.vaulttest');
  fs.mkdirSync(path.join(goodDir, '99-收件箱'), { recursive: true });
  fs.writeFileSync(path.join(goodDir, '测试笔记.md'), '# 测试\n内容', 'utf-8');

  await api('/api/settings', {
    method: 'POST',
    body: JSON.stringify({ section: 'obsidian', obsidian: { dir: goodDir, writeback: '99-收件箱' } })
  });
  const probeGood = await api('/api/obsidian?mode=tree');
  check('探测有效路径成功',
    probeGood.json?.data?.enabled === true,
    `检测到 ${probeGood.json?.data?.total ?? 0} 篇笔记`);

  console.log('\n========== 二、成员自助改密 ==========');
  const adminCookie = cookie;

  // 创建/登录成员
  cookie = '';
  const memberLogin = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'test_member', password: 'test123456' })
  });

  if (!memberLogin.json?.ok) {
    // 成员不存在则用管理员创建
    cookie = adminCookie;
    await api('/api/users', {
      method: 'POST',
      body: JSON.stringify({
        username: 'test_member', display_name: '测试成员',
        password: 'test123456', role: 'member'
      })
    });
    cookie = '';
    await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'test_member', password: 'test123456' })
    });
  }

  const me = await api('/api/auth/me');
  check('成员身份确认', me.json?.data?.role === 'member', me.json?.data?.display_name);

  // 成员改自己密码（原密码错误应被拒）
  const wrongOld = await api('/api/users', {
    method: 'PATCH',
    body: JSON.stringify({
      action: 'changeOwnPassword', oldPassword: 'wrongpwd', password: 'newpass123'
    })
  });
  check('原密码错误被拒绝', wrongOld.status === 400, wrongOld.json?.error);

  // 原密码正确
  const okOld = await api('/api/users', {
    method: 'PATCH',
    body: JSON.stringify({
      action: 'changeOwnPassword', oldPassword: 'test123456', password: 'newpass123'
    })
  });
  check('成员可改自己密码', okOld.json?.ok === true, okOld.json?.error || '');

  // 用新密码重新登录
  cookie = '';
  const reLogin = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'test_member', password: 'newpass123' })
  });
  check('新密码可登录', reLogin.json?.ok === true);

  // 成员仍不能重置他人密码
  const resetOther = await api('/api/users', {
    method: 'PATCH',
    body: JSON.stringify({ action: 'resetPassword', id: 1, password: 'hacked123' })
  });
  check('成员不能重置他人密码（403）', resetOther.status === 403);

  // 改回原密码，保持环境整洁
  await api('/api/users', {
    method: 'PATCH',
    body: JSON.stringify({
      action: 'changeOwnPassword', oldPassword: 'newpass123', password: 'test123456'
    })
  });

  console.log('\n========== 三、环境变量密码只在空库生效 ==========');
  cookie = adminCookie;
  // 用错误的 ADMIN_PASSWORD 尝试登录（compose 里是 admin123456，实际已改成 Su@2026Niuyan）
  const envPwd = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'admin123456' })
  });
  check('环境变量中的默认密码无法登录（已建账号不受影响）',
    envPwd.status === 401, envPwd.json?.error);

  cookie = '';
  const realPwd = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'Su@2026Niuyan' })
  });
  check('实际密码仍可登录', realPwd.json?.ok === true);

  // 清理临时 vault
  fs.rmSync(goodDir, { recursive: true, force: true });

  console.log(`\n${'='.repeat(50)}`);
  console.log(`可维护性测试：通过 ${pass} 项，失败 ${fail} 项`);
  console.log(`${'='.repeat(50)}\n`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error('异常:', e); process.exit(1); });
