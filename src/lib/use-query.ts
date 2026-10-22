'use client';

import { useEffect, useState } from 'react';

/**
 * 从查询串读取参数（如 ?id=3）。
 *
 * 为什么不用 useSearchParams：Next 静态导出要求它必须包在 Suspense
 * 边界里，否则构建报错；而本页数据全部在客户端拉取，直接读
 * window.location.search 最简单，也彻底避开构建期限制。
 * SSR/导出预渲染首帧返回 null，水合后由 effect 补齐。
 */
export function useQueryParam(name: string): string | null {
  const [value, setValue] = useState<string | null>(null);
  useEffect(() => {
    setValue(new URLSearchParams(window.location.search).get(name));
  }, [name]);
  return value;
}
