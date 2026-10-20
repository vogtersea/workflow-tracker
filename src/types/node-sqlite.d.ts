/** node:sqlite 类型声明补充（Node 22/24 内置模块，@types/node 尚未覆盖全部 API） */
declare module 'node:sqlite' {
  export interface StatementResult {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  }

  export interface Statement {
    run(...params: unknown[]): StatementResult;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    iterate(...params: unknown[]): IterableIterator<unknown>;
  }

  export class DatabaseSync {
    constructor(path: string, options?: Record<string, unknown>);
    prepare(sql: string): Statement;
    exec(sql: string): void;
    close(): void;
  }
}
