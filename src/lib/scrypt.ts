/**
 * 纯 JavaScript scrypt（RFC 7914）
 *
 * 为什么需要它：
 *   服务端用 Node 的 crypto.scryptSync 生成密码哈希，手机单机版跑在浏览器/WebView 里，
 *   没有 node:crypto。但两边的 password_hash 必须能互相验证——将来做跨平台同步时，
 *   用户表可以直接对拷，不需要「换设备就重设密码」。
 *   所以这里按 Node 的默认参数（N=16384, r=8, p=1, dkLen=64）原样实现一遍。
 *
 * 性能：N=16384 时约 16MB 工作内存、数十万次 Salsa20/8，桌面约 100–300ms，
 *   手机约 0.3–1s。只在登录和改密时跑一次，可以接受。
 *
 * 全部同步实现，与 scryptSync 对齐。
 */

/* eslint-disable no-bitwise */

// ---------------- SHA-256 ----------------

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

/** SHA-256，输入字节，输出 32 字节 */
export function sha256(msg: Uint8Array): Uint8Array {
  const len = msg.length;
  const blocks = ((len + 8) >> 6) + 1;
  const total = blocks * 64;
  const buf = new Uint8Array(total);
  buf.set(msg);
  buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, Math.floor((len * 8) / 0x100000000));
  dv.setUint32(total - 4, (len * 8) >>> 0);

  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ]);
  const W = new Uint32Array(64);

  for (let b = 0; b < blocks; b++) {
    const off = b * 64;
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }

    let a = H[0], bb = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + SHA256_K[i] + W[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & bb) ^ (a & c) ^ (bb & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e;
      e = (d + t1) >>> 0;
      d = c; c = bb; bb = a;
      a = (t1 + t2) >>> 0;
    }

    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + bb) >>> 0;
    H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) odv.setUint32(i * 4, H[i]);
  return out;
}

// ---------------- HMAC-SHA256 ----------------

const BLOCK = 64;

interface HmacCtx {
  inner: Uint8Array; // 64 字节 ipad 块（key 不足补零后异或 0x36）
  outer: Uint8Array; // 64 字节 opad 块
}

function hmacSetup(key: Uint8Array): HmacCtx {
  let k = key;
  if (k.length > BLOCK) k = sha256(k);
  const ipad = new Uint8Array(BLOCK);
  const opad = new Uint8Array(BLOCK);
  for (let i = 0; i < BLOCK; i++) {
    const b = i < k.length ? k[i] : 0;
    ipad[i] = b ^ 0x36;
    opad[i] = b ^ 0x5c;
  }
  return { inner: ipad, outer: opad };
}

function hmacFrom(ctx: HmacCtx, ...parts: Uint8Array[]): Uint8Array {
  let n = ctx.inner.length;
  for (const p of parts) n += p.length;
  const inner = new Uint8Array(n);
  inner.set(ctx.inner);
  let o = ctx.inner.length;
  for (const p of parts) {
    inner.set(p, o);
    o += p.length;
  }
  const ih = sha256(inner);

  const outer = new Uint8Array(ctx.outer.length + 32);
  outer.set(ctx.outer);
  outer.set(ih, ctx.outer.length);
  return sha256(outer);
}

// ---------------- PBKDF2-HMAC-SHA256 ----------------

function pbkdf2(
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  dkLen: number
): Uint8Array {
  const ctx = hmacSetup(password);
  const out = new Uint8Array(dkLen);
  let offset = 0;
  let blockIndex = 1;

  while (offset < dkLen) {
    const ib = new Uint8Array(4);
    new DataView(ib.buffer).setUint32(0, blockIndex);
    let u = hmacFrom(ctx, salt, ib);
    const t = new Uint8Array(u);

    for (let i = 1; i < iterations; i++) {
      u = hmacFrom(ctx, u);
      for (let j = 0; j < 32; j++) t[j] ^= u[j];
    }

    const take = Math.min(32, dkLen - offset);
    out.set(t.subarray(0, take), offset);
    offset += take;
    blockIndex++;
  }
  return out;
}

// ---------------- Salsa20/8 ----------------

const rotl = (a: number, b: number) => ((a << b) | (a >>> (32 - b))) >>> 0;

/** Salsa20/8 core，逐字内联展开；out 可与 B 相同 */
function salsa208(B: Uint32Array, out: Uint32Array): void {
  let x0 = B[0], x1 = B[1], x2 = B[2], x3 = B[3];
  let x4 = B[4], x5 = B[5], x6 = B[6], x7 = B[7];
  let x8 = B[8], x9 = B[9], x10 = B[10], x11 = B[11];
  let x12 = B[12], x13 = B[13], x14 = B[14], x15 = B[15];

  for (let i = 0; i < 8; i += 2) {
    x4 ^= rotl((x0 + x12) >>> 0, 7);
    x8 ^= rotl((x4 + x0) >>> 0, 9);
    x12 ^= rotl((x8 + x4) >>> 0, 13);
    x0 ^= rotl((x12 + x8) >>> 0, 18);
    x9 ^= rotl((x5 + x1) >>> 0, 7);
    x13 ^= rotl((x9 + x5) >>> 0, 9);
    x1 ^= rotl((x13 + x9) >>> 0, 13);
    x5 ^= rotl((x1 + x13) >>> 0, 18);
    x14 ^= rotl((x10 + x6) >>> 0, 7);
    x2 ^= rotl((x14 + x10) >>> 0, 9);
    x6 ^= rotl((x2 + x14) >>> 0, 13);
    x10 ^= rotl((x6 + x2) >>> 0, 18);
    x3 ^= rotl((x15 + x11) >>> 0, 7);
    x7 ^= rotl((x3 + x15) >>> 0, 9);
    x11 ^= rotl((x7 + x3) >>> 0, 13);
    x15 ^= rotl((x11 + x7) >>> 0, 18);

    x1 ^= rotl((x0 + x3) >>> 0, 7);
    x2 ^= rotl((x1 + x0) >>> 0, 9);
    x3 ^= rotl((x2 + x1) >>> 0, 13);
    x0 ^= rotl((x3 + x2) >>> 0, 18);
    x6 ^= rotl((x5 + x4) >>> 0, 7);
    x7 ^= rotl((x6 + x5) >>> 0, 9);
    x4 ^= rotl((x7 + x6) >>> 0, 13);
    x5 ^= rotl((x4 + x7) >>> 0, 18);
    x11 ^= rotl((x10 + x9) >>> 0, 7);
    x8 ^= rotl((x11 + x10) >>> 0, 9);
    x9 ^= rotl((x8 + x11) >>> 0, 13);
    x10 ^= rotl((x9 + x8) >>> 0, 18);
    x12 ^= rotl((x15 + x14) >>> 0, 7);
    x13 ^= rotl((x12 + x15) >>> 0, 9);
    x14 ^= rotl((x13 + x12) >>> 0, 13);
    x15 ^= rotl((x14 + x13) >>> 0, 18);
  }

  out[0] = (x0 + B[0]) >>> 0; out[1] = (x1 + B[1]) >>> 0;
  out[2] = (x2 + B[2]) >>> 0; out[3] = (x3 + B[3]) >>> 0;
  out[4] = (x4 + B[4]) >>> 0; out[5] = (x5 + B[5]) >>> 0;
  out[6] = (x6 + B[6]) >>> 0; out[7] = (x7 + B[7]) >>> 0;
  out[8] = (x8 + B[8]) >>> 0; out[9] = (x9 + B[9]) >>> 0;
  out[10] = (x10 + B[10]) >>> 0; out[11] = (x11 + B[11]) >>> 0;
  out[12] = (x12 + B[12]) >>> 0; out[13] = (x13 + B[13]) >>> 0;
  out[14] = (x14 + B[14]) >>> 0; out[15] = (x15 + B[15]) >>> 0;
}

// ---------------- BlockMix ----------------

/**
 * BlockMix：输入 2r 个 64 字节块，输出同样大小。
 *
 * src 与 dst **必须是两个不同的缓冲**。原因：
 *   输出洗牌规则为 Y[i] 写到偶数半区 (i/2) 或奇数半区 (r+(i-1)/2)，
 *   i=1 时写位置 r，而位置 r 对应的块要等到 i=r 才被读取——就地写会把尚未读取的块覆盖。
 *
 * @param src 输入，长度 32r 个 32 位字
 * @param dst 输出，长度同上
 * @param tmp 长度 32 个 32 位字的临时区（X 与异或结果各 16 字）
 */
function blockMix(src: Uint32Array, r: number, dst: Uint32Array, tmp: Uint32Array): void {
  const twoR = 2 * r;
  const X = tmp.subarray(0, 16);
  const T = tmp.subarray(16, 32);

  X.set(src.subarray((twoR - 1) * 16, twoR * 16));

  for (let i = 0; i < twoR; i++) {
    for (let k = 0; k < 16; k++) T[k] = (X[k] ^ src[i * 16 + k]) >>> 0;
    salsa208(T, X);
    const at = i % 2 === 0 ? (i >> 1) * 16 : (r + ((i - 1) >> 1)) * 16;
    dst.set(X, at);
  }
}

// ---------------- 对外接口 ----------------

export interface ScryptOptions {
  /** CPU/内存代价，必须是 2 的幂。Node 默认 16384 */
  N?: number;
  /** 块大小。Node 默认 8 */
  r?: number;
  /** 并行度。Node 默认 1 */
  p?: number;
  /** 输出长度。Node 默认 64 */
  dkLen?: number;
}

/**
 * scrypt 同步实现，参数默认值与 Node 的 crypto.scryptSync 完全一致，
 * 因此同一口令 + 同一盐在两个环境算出的哈希逐字节相同。
 */
export function scryptSync(
  password: Uint8Array,
  salt: Uint8Array,
  opts: ScryptOptions = {}
): Uint8Array {
  const N = opts.N ?? 16384;
  const r = opts.r ?? 8;
  const p = opts.p ?? 1;
  const dkLen = opts.dkLen ?? 64;

  if (N <= 1 || (N & (N - 1)) !== 0) throw new Error('scrypt: N 必须是大于 1 的 2 的幂');
  if (r <= 0 || p <= 0) throw new Error('scrypt: r 与 p 必须为正整数');
  if (r * p >= 1 << 30) throw new Error('scrypt: 参数过大');

  const words = 32 * r;          // 每个 128r 字节块对应的 32 位字数
  const blockBytes = 128 * r;

  // B = PBKDF2(P, S, 1, p * 128 * r)
  const B = pbkdf2(password, salt, 1, p * blockBytes);

  const bdv = new DataView(B.buffer, B.byteOffset, B.byteLength);
  const X = new Uint32Array(words);
  const T = new Uint32Array(words);
  const tmp = new Uint32Array(32);
  const V = new Uint32Array(N * words);

  // 注意：RFC 7914 规定 Salsa20/8 把输入视为 16 个 **小端** 32 位字，
  // 所以字节串与 32 位字互转时必须显式指定小端（DataView 默认是大端）。
  for (let i = 0; i < p; i++) {
    const base = i * blockBytes;
    for (let k = 0; k < words; k++) X[k] = bdv.getUint32(base + k * 4, true);

    // 填表阶段：每轮 BlockMix 后换到另一个缓冲，避免就地覆盖
    let src = X;
    let dst = T;
    for (let j = 0; j < N; j++) {
      V.set(src, j * words);
      blockMix(src, r, dst, tmp);
      const t = src;
      src = dst;
      dst = t;
    }

    // 混合阶段：Integerify(src) 取最后一个 64 字节块的低 32 位，N 是 2 的幂
    for (let j = 0; j < N; j++) {
      const idx = src[(2 * r - 1) * 16] & (N - 1);
      const vb = idx * words;
      for (let k = 0; k < words; k++) dst[k] = (src[k] ^ V[vb + k]) >>> 0;
      blockMix(dst, r, src, tmp);
    }

    for (let k = 0; k < words; k++) bdv.setUint32(base + k * 4, src[k], true);
  }

  return pbkdf2(password, B, 1, dkLen);
}
