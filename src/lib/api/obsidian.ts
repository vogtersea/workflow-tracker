import { requireUserFrom } from '@/lib/auth';
import { ok, fail } from './http';
import { guard } from './guard';

/**
 * Obsidian 知识库接口（同构）
 *
 * 文件系统访问全部收敛在 @/lib/obsidian，而那个库依赖 node:fs，浏览器里跑不了。
 * 所以这里不直接 import 它，改为由调用方注入适配器：
 *   - 服务端 route.ts：注入真实的 @/lib/obsidian 命名空间
 *   - 手机端：注入一个返回「本机版不支持」的实现
 * 这样本文件保持零 node 依赖，两端都能安全打包。
 */

export interface ObsidianAdapter {
  vaultEnabled: () => boolean;
  vaultDir: () => string;
  vaultTree: () => unknown;
  searchNotes: (q: string, limit: number) => unknown;
  readNote: (path: string) => unknown;
  listNotes: (withMeta: boolean) => unknown[];
}

export function obsidianGet(req: Request, obs: ObsidianAdapter): Promise<Response> {
  return guard(async () => {
    requireUserFrom(req);
    const url = new URL(req.url);
    const mode = url.searchParams.get('mode') || 'tree';

    if (!obs.vaultEnabled()) {
      // tree/list 属于探测性请求，返回 enabled:false 供前端渲染引导页
      if (mode === 'tree' || mode === 'list') {
        return ok({ enabled: false, dir: obs.vaultDir(), message: '未配置或目录不可访问' });
      }
      // 检索、读取等实质操作必须明确报错，避免把「未配置」误判为「无匹配结果」
      return fail('Obsidian 知识库未配置或目录不可访问，请先在系统设置中填写容器内路径', 400);
    }

    if (mode === 'tree') {
      return ok({ enabled: true, dir: obs.vaultDir(), ...(obs.vaultTree() as object) });
    }

    if (mode === 'search') {
      const q = url.searchParams.get('q') || '';
      return ok(obs.searchNotes(q, Number(url.searchParams.get('limit') || 20)));
    }

    if (mode === 'read') {
      const p = url.searchParams.get('path') || '';
      const note = obs.readNote(p);
      if (!note) return fail('笔记不存在或路径非法', 404);
      return ok(note);
    }

    if (mode === 'list') {
      return ok(obs.listNotes(true).slice(0, 200));
    }

    return fail('未知操作', 400);
  });
}
