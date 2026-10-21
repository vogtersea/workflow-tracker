#!/usr/bin/env node
/**
 * scrypt 纯 JS 实现验证
 *
 * 三层校验：
 *   1. RFC 7914 官方测试向量（含 N=16384/r=8 的推荐参数，正是本系统用的那一组）
 *   2. 与 Node crypto.scryptSync 交叉验证：纯 JS 算 → Node 验，Node 算 → 纯 JS 验
 *   3. 边界与非法参数
 *
 * 用法：node scripts/test-scrypt.cjs
 */
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '.tmp-scrypt');

function build() {
  if (fs.existsSync(OUT)) fs.rmSync(OUT, { recursive: true, force: true });
  // Windows 上不要 spawn node_modules/.bin/tsc.cmd（会 EINVAL），直接用 node 跑 tsc 的 JS 入口
  const tsc = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
  execFileSync(process.execPath, [tsc, path.join(ROOT, 'src/lib/scrypt.ts'), '--outDir', OUT,
    '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck'], { stdio: 'inherit', cwd: ROOT });
  return require(path.join(OUT, 'scrypt.js'));
}

let pass = 0;
let fail = 0;
const failures = [];

function check(name, actual, expected) {
  const a = Buffer.from(actual).toString('hex');
  const e = typeof expected === 'string' ? expected : Buffer.from(expected).toString('hex');
  if (a === e) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  ✗ ${name}\n      期望 ${e}\n      实际 ${a}`);
  }
}

function assert(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name); console.log(`  ✗ ${name} ${detail ?? ''}`); }
}

const hex = (s) => Buffer.from(s, 'utf8');

// RFC 7914 §12 测试向量
const RFC = [
  {
    label: 'RFC 7914 #1 (N=16, r=1, p=1)',
    P: '', S: '', N: 16, r: 1, p: 1, dkLen: 64,
    want:
      '77d6576238657b203b19ca42c18a0497f16b4844e3074ae8dfdffa3fede21442' +
      'fcd0069ded0948f8326a753a0fc81f17e8d3e0fb2e0d3628cf35e20c38d18906'
  },
  {
    label: 'RFC 7914 #2 (N=1024, r=8, p=16)',
    P: 'password', S: 'NaCl', N: 1024, r: 8, p: 16, dkLen: 64,
    want:
      'fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b373162' +
      '2eaf30d92e22a3886ff109279d9830dac727afb94a83ee6d8360cbdfa2cc0640'
  },
  {
    label: 'RFC 7914 #3 (N=16384, r=8, p=1) ← 本系统实际参数',
    P: 'pleaseletmein', S: 'SodiumChloride', N: 16384, r: 8, p: 1, dkLen: 64,
    want:
      '7023bdcb3afd7348461c06cd81fd38ebfda8fbba904f8e3ea9b543f6545da1f2' +
      'd5432955613f0fcf62d49705242a9af9e61e85dc0d651e40dfcf017b45575887'
  }
];

function main() {
  console.log('编译 src/lib/scrypt.ts …');
  const { scryptSync } = build();
  console.log('');

  console.log('【一】RFC 7914 官方测试向量');
  for (const v of RFC) {
    const t0 = Date.now();
    const got = scryptSync(hex(v.P), hex(v.S), { N: v.N, r: v.r, p: v.p, dkLen: v.dkLen });
    const ms = Date.now() - t0;
    check(`${v.label}  (${ms}ms)`, got, v.want);
  }
  console.log('');

  console.log('【二】与 Node crypto.scryptSync 交叉验证（本系统参数）');
  const cases = [
    ['典型口令', 'QsDbGF5VFx7NNx', 'a1b2c3d4e5f60718293a4b5c6d7e8f90'],
    ['含中文', '工作台密码123', '00112233445566778899aabbccddeeff'],
    ['含特殊字符', 'p@$$w0rd!#%^&*()', 'ffeeddccbbaa99887766554433221100'],
    ['超长口令512B', 'x'.repeat(512), 'deadbeefdeadbeefdeadbeefdeadbeef'],
    ['空口令', '', '00000000000000000000000000000000'],
    ['单字节盐', 'secret', 'ab'],
    ['长盐128B', 'another', 'c'.repeat(128)]
  ];

  for (const [label, pw, salt] of cases) {
    const t0 = Date.now();
    const jsOut = scryptSync(hex(pw), hex(salt), { dkLen: 64 });
    const jsMs = Date.now() - t0;

    const t1 = Date.now();
    const nodeOut = crypto.scryptSync(pw, salt, 64);
    const nodeMs = Date.now() - t1;

    const same = Buffer.compare(Buffer.from(jsOut), nodeOut) === 0;
    assert(
      `${label}：纯JS(${jsMs}ms) 与 Node(${nodeMs}ms) 结果一致`,
      same,
      same ? '' : `\n      JS   ${Buffer.from(jsOut).toString('hex')}\n      Node ${nodeOut.toString('hex')}`
    );
  }
  console.log('');

  console.log('【三】哈希格式互通（模拟 users.password_hash 的 salt:hash 形式）');
  // 服务端 hashPassword 的格式：`${salt}:${hash}`，salt 为 16 字节 hex
  function hashWithNode(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
  }
  function verifyWithJs(password, stored) {
    const [salt, hash] = stored.split(':');
    const test = Buffer.from(scryptSync(hex(password), hex(salt), { dkLen: 64 })).toString('hex');
    return test === hash;
  }
  function hashWithJs(password) {
    const saltBytes = new Uint8Array(16);
    crypto.getRandomValues ? crypto.getRandomValues(saltBytes) : saltBytes.set(crypto.randomBytes(16));
    const salt = Buffer.from(saltBytes).toString('hex');
    const hash = Buffer.from(scryptSync(hex(password), hex(salt), { dkLen: 64 })).toString('hex');
    return `${salt}:${hash}`;
  }
  function verifyWithNode(password, stored) {
    const [salt, hash] = stored.split(':');
    const test = crypto.scryptSync(password, salt, 64).toString('hex');
    return test === hash;
  }

  const pwd = '本机登录口令Test#2026';
  const fromNode = hashWithNode(pwd);
  assert('Node 生成 → 纯JS 验证通过（服务端建号，手机端能登）', verifyWithJs(pwd, fromNode), fromNode);
  assert('Node 生成 → 纯JS 拒绝错误口令', !verifyWithJs(pwd + 'x', fromNode));

  const fromJs = hashWithJs(pwd);
  assert('纯JS 生成 → Node 验证通过（手机端建号，服务端能登）', verifyWithNode(pwd, fromJs), fromJs);
  assert('纯JS 生成 → Node 拒绝错误口令', !verifyWithNode(pwd + 'x', fromJs));

  assert('两端格式一致（salt:hash，salt 32 位 hex，hash 128 位 hex）',
    /^[0-9a-f]{32}:[0-9a-f]{128}$/.test(fromJs) && /^[0-9a-f]{32}:[0-9a-f]{128}$/.test(fromNode));
  console.log('');

  console.log('【四】参数与边界');
  assert('dkLen=16 输出长度正确', scryptSync(hex('a'), hex('b'), { N: 16, r: 1, p: 1, dkLen: 16 }).length === 16);
  assert('dkLen=100（非 32 倍数）长度正确', scryptSync(hex('a'), hex('b'), { N: 16, r: 1, p: 1, dkLen: 100 }).length === 100);
  assert('r=16 可用', scryptSync(hex('a'), hex('b'), { N: 16, r: 16, p: 1, dkLen: 32 }).length === 32);
  assert('p=4 可用', scryptSync(hex('a'), hex('b'), { N: 16, r: 2, p: 4, dkLen: 32 }).length === 32);

  let threw = false;
  try { scryptSync(hex('a'), hex('b'), { N: 15 }); } catch { threw = true; }
  assert('N 非 2 的幂应抛错', threw);

  threw = false;
  try { scryptSync(hex('a'), hex('b'), { N: 1 }); } catch { threw = true; }
  assert('N=1 应抛错', threw);

  threw = false;
  try { scryptSync(hex('a'), hex('b'), { r: 0 }); } catch { threw = true; }
  assert('r=0 应抛错', threw);

  // 同输入必须同输出
  const t2 = Date.now();
  const a = Buffer.from(scryptSync(hex('determinism'), hex('salt'), {})).toString('hex');
  const b = Buffer.from(scryptSync(hex('determinism'), hex('salt'), {})).toString('hex');
  assert(`同输入两次结果相同（默认参数，单次 ${Date.now() - t2}ms×2）`, a === b);
  void t2;

  // 不同口令不能撞
  const c1 = Buffer.from(scryptSync(hex('p1'), hex('s'), { N: 1024, r: 8 })).toString('hex');
  const c2 = Buffer.from(scryptSync(hex('p2'), hex('s'), { N: 1024, r: 8 })).toString('hex');
  assert('不同口令结果不同', c1 !== c2);
  console.log('');

  console.log('【五】性能（N=16384, r=8, p=1，默认参数）');
  const runs = [];
  for (let i = 0; i < 3; i++) {
    const t = Date.now();
    scryptSync(hex('bench' + i), hex('saltsalt'), {});
    runs.push(Date.now() - t);
  }
  const avg = Math.round(runs.reduce((x, y) => x + y, 0) / runs.length);
  const nodeRuns = [];
  for (let i = 0; i < 3; i++) {
    const t = Date.now();
    crypto.scryptSync('bench' + i, 'saltsalt', 64);
    nodeRuns.push(Date.now() - t);
  }
  const nodeAvg = Math.round(nodeRuns.reduce((x, y) => x + y, 0) / nodeRuns.length);
  console.log(`  纯JS 平均 ${avg}ms（${runs.join('/')}）  Node 原生平均 ${nodeAvg}ms`);
  assert('纯JS 单次耗时 < 3000ms（手机端可接受阈值）', avg < 3000, `实测 ${avg}ms`);

  console.log('');
  console.log(`=== 结果：通过 ${pass} 项，失败 ${fail} 项 ===`);
  if (fail) {
    console.log('失败项：' + failures.join('、'));
    process.exit(1);
  }
}

main();
