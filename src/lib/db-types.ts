/**
 * 数据库抽象接口
 *
 * 只描述「怎么执行 SQL」，不关心底层是什么引擎：
 *   - 服务端：node:sqlite（src/lib/db.ts）
 *   - 手机/浏览器：SQLite WASM（src/lib/db-browser.ts）
 *
 * 之所以单独抽一个文件，是为了避免 schema.ts 反向依赖 db.ts 造成循环引用。
 * 所有业务模块（tasks / reports / templates / week ...）都只依赖这个接口，
 * 因此换底层实现不需要改业务代码。
 */
export interface DbLike {
  prepare: (sql: string) => {
    run: (...params: unknown[]) => { changes: number; lastInsertRowid: number | bigint };
    get: (...params: unknown[]) => unknown;
    all: (...params: unknown[]) => unknown[];
  };
  exec: (sql: string) => void;
  pragma: (stmt: string) => void;
  tx: <T>(fn: () => T) => T;
}

/** 迁移前的快照钩子：服务端落文件，浏览器端可省 */
export type SnapshotHook = (version: number) => void;
