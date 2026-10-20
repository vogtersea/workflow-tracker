import { NextResponse } from 'next/server';
import { requireUser, UnauthorizedError } from '@/lib/auth';
import { getReport } from '@/lib/reports';
import { markdownToDocx, markdownToPrintHtml, toObsidianMarkdown } from '@/lib/export';
import { writeReportToVault, vaultEnabled } from '@/lib/obsidian';
import { cnDate } from '@/lib/date';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const url = new URL(req.url);
    const format = url.searchParams.get('format') || 'docx';

    const report = getReport(Number(id)) as
      | {
          id: number;
          title: string;
          content_md: string;
          scope: string;
          range_start: string | null;
          range_end: string | null;
          author: string | null;
          created_at: string;
        }
      | undefined;

    if (!report) return NextResponse.json({ ok: false, error: '报告不存在' }, { status: 404 });

    const subtitle =
      report.range_start && report.range_end
        ? `${cnDate(report.range_start)} — ${cnDate(report.range_end)}`
        : undefined;

    const todayStr = new Date();
    const dateText = `${todayStr.getFullYear()}年${todayStr.getMonth() + 1}月${todayStr.getDate()}日`;

    if (format === 'md') {
      const md = toObsidianMarkdown(report.content_md, {
        title: report.title,
        category: '工作总结',
        tags: [report.scope]
      });
      return new NextResponse(md, {
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(report.title)}.md`
        }
      });
    }

    if (format === 'html' || format === 'pdf') {
      const html = markdownToPrintHtml(report.content_md, {
        title: report.title,
        subtitle,
        author: report.author || '',
        date: dateText
      });
      return new NextResponse(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    if (format === 'vault') {
      if (!vaultEnabled())
        return NextResponse.json(
          { ok: false, error: '未配置 Obsidian 知识库目录，请先在系统设置中填写' },
          { status: 400 }
        );
      const r = writeReportToVault({
        title: report.title,
        contentMd: report.content_md,
        tags: [report.scope],
        category: '工作总结'
      });
      return NextResponse.json({ ok: r.ok, data: r, error: r.ok ? undefined : r.message });
    }

    // 默认 Word
    const buf = await markdownToDocx(report.content_md, {
      title: report.title,
      subtitle,
      author: report.author || '',
      date: dateText
    });

    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(report.title)}.docx`
      }
    });
  } catch (e) {
    if (e instanceof UnauthorizedError)
      return NextResponse.json({ ok: false, error: e.message }, { status: 401 });
    console.error('[report export]', e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : '导出失败' },
      { status: 500 }
    );
  }
}
