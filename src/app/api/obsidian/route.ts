import { NextResponse } from 'next/server';
import { requireUser, UnauthorizedError } from '@/lib/auth';
import {
  vaultEnabled,
  vaultDir,
  vaultTree,
  searchNotes,
  readNote,
  listNotes
} from '@/lib/obsidian';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    await requireUser();
    const url = new URL(req.url);
    const mode = url.searchParams.get('mode') || 'tree';

    if (!vaultEnabled()) {
      // tree/list 属于探测性请求，返回 enabled:false 供前端渲染引导页
      if (mode === 'tree' || mode === 'list') {
        return NextResponse.json({
          ok: true,
          data: { enabled: false, dir: vaultDir(), message: '未配置或目录不可访问' }
        });
      }
      // 检索、读取等实质操作必须明确报错，避免把"未配置"误判为"无匹配结果"
      return NextResponse.json(
        { ok: false, error: 'Obsidian 知识库未配置或目录不可访问，请先在系统设置中填写容器内路径' },
        { status: 400 }
      );
    }

    if (mode === 'tree') {
      return NextResponse.json({
        ok: true,
        data: { enabled: true, dir: vaultDir(), ...vaultTree() }
      });
    }

    if (mode === 'search') {
      const q = url.searchParams.get('q') || '';
      const results = searchNotes(q, Number(url.searchParams.get('limit') || 20));
      return NextResponse.json({ ok: true, data: results });
    }

    if (mode === 'read') {
      const p = url.searchParams.get('path') || '';
      const note = readNote(p);
      if (!note)
        return NextResponse.json({ ok: false, error: '笔记不存在或路径非法' }, { status: 404 });
      return NextResponse.json({ ok: true, data: note });
    }

    if (mode === 'list') {
      return NextResponse.json({ ok: true, data: listNotes(true).slice(0, 200) });
    }

    return NextResponse.json({ ok: false, error: '未知操作' }, { status: 400 });
  } catch (e) {
    if (e instanceof UnauthorizedError)
      return NextResponse.json({ ok: false, error: e.message }, { status: 401 });
    console.error('[obsidian]', e);
    return NextResponse.json({ ok: false, error: '查询失败' }, { status: 500 });
  }
}
