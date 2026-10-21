import { requireUserFrom } from '@/lib/auth';
import { getReport } from '@/lib/reports';
import { markdownToDocx, markdownToPrintHtml, toObsidianMarkdown } from '@/lib/export';
import { cnDate } from '@/lib/date';
import { fail, json } from './http';
import { guard } from './guard';

/**
 * 报告导出接口（同构）
 *
 * docx / md / html 返回的是文件本身，不是 JSON，因此不包 ok()，保持原始响应形态。
 *
 * Obsidian 写回依赖 node:fs，浏览器里没有，所以通过 deps 注入：
 * 服务端传真实实现，手机端传「本机版不支持」的实现，本文件保持零 node 依赖。
 */

export interface ReportExportDeps {
  vaultEnabled: () => boolean;
  writeReportToVault: (opts: {
    title: string;
    contentMd: string;
    tags: string[];
    category: string;
  }) => { ok: boolean; message?: string; [k: string]: unknown };
}

export function reportExportGet(
  req: Request,
  id: string,
  deps: ReportExportDeps
): Promise<Response> {
  return guard(async () => {
    requireUserFrom(req);
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

    if (!report) return fail('报告不存在', 404);

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
      return new Response(md, {
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
      return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    if (format === 'vault') {
      if (!deps.vaultEnabled())
        return fail('未配置 Obsidian 知识库目录，请先在系统设置中填写', 400);
      const r = deps.writeReportToVault({
        title: report.title,
        contentMd: report.content_md,
        tags: [report.scope],
        category: '工作总结'
      });
      return json({ ok: r.ok, data: r, error: r.ok ? undefined : r.message });
    }

    // 默认 Word
    const buf = await markdownToDocx(report.content_md, {
      title: report.title,
      subtitle,
      author: report.author || '',
      date: dateText
    });

    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(report.title)}.docx`
      }
    });
  });
}
