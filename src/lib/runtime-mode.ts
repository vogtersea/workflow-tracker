/**
 * 运行形态
 *
 * 两种形态共用同一份源码：
 *   server —— Docker / Windows 服务版，页面通过 HTTP 调 API，数据在服务端 SQLite
 *   local  —— 手机单机版，页面直接调本地处理函数，数据在浏览器里的 SQLite
 *
 * 构建时用 NEXT_PUBLIC_WT_LOCAL=1 打手机版；不设该变量就是服务端版。
 * NEXT_PUBLIC_ 前缀会被 Next 在构建期内联成字面量，因此服务端版的产物里
 * 这段判断会被摇树优化掉，连带 db-browser 与 wasm 都不会进包。
 */

export const IS_LOCAL_BUILD = process.env.NEXT_PUBLIC_WT_LOCAL === '1';

let _local = false;

/** 由手机端启动流程在数据库就绪后调用 */
export function enableLocalMode(): void {
  _local = true;
}

export function isLocalMode(): boolean {
  return _local;
}
