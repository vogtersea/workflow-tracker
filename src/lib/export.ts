import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  HeadingLevel,
  convertMillimetersToTwip
} from 'docx';

/**
 * Word 导出 — 严格套用《关于规范公文写作格式的通知》格式
 * 页边距 上3.5 下3.3 左2.7 右2.7 cm
 * 正文 仿宋_GB2312 三号(16pt)，固定行距 29.5 磅，首行缩进 2 字符，两端对齐
 * 大标题 方正小标宋简体 二号(22pt) 居中
 * 一级标题 黑体 三号；二级标题 楷体_GB2312 三号
 */

const FONT_BODY = '仿宋_GB2312';
const FONT_TITLE = '方正小标宋简体';
const FONT_H1 = '黑体';
const FONT_H2 = '楷体_GB2312';

const SIZE_BODY = 32; // 半磅单位，32 = 16pt = 三号
const SIZE_TITLE = 44; // 22pt = 二号

/** 固定行距 29.5 磅 → 缇(twips)：29.5 * 20 */
const LINE_FIXED = Math.round(29.5 * 20);

interface MdBlock {
  type: 'h1' | 'h2' | 'h3' | 'h4' | 'p' | 'li' | 'quote' | 'hr';
  text: string;
  level?: number;
}

/** 极简 Markdown 解析，只识别公文常用结构 */
function parseMarkdown(md: string): MdBlock[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks: MdBlock[] = [];

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;

    if (/^---+$/.test(line.trim())) {
      blocks.push({ type: 'hr', text: '' });
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const lv = h[1].length;
      const type = lv === 1 ? 'h1' : lv === 2 ? 'h2' : lv === 3 ? 'h3' : 'h4';
      blocks.push({ type, text: cleanInline(h[2]) });
      continue;
    }

    if (/^>\s?/.test(line)) {
      blocks.push({ type: 'quote', text: cleanInline(line.replace(/^>\s?/, '')) });
      continue;
    }

    if (/^[-*+]\s+/.test(line)) {
      blocks.push({ type: 'li', text: cleanInline(line.replace(/^[-*+]\s+/, '')) });
      continue;
    }

    if (/^\d+[.、)]\s+/.test(line)) {
      blocks.push({ type: 'li', text: cleanInline(line.replace(/^\d+[.、)]\s+/, '')) });
      continue;
    }

    blocks.push({ type: 'p', text: cleanInline(line) });
  }

  return blocks;
}

/**
 * 段落式标题识别
 * 模型输出常把「（一）xxx」写成独立段落而非 markdown 标题，
 * 公文规范要求（一）为楷体二级标题，故对以编号开头的段落做标题化处理。
 * 若段落为「（一）标题。正文……」格式，则拆成标题行 + 正文段。
 */
function splitParagraphHeading(
  text: string
): { level: 1 | 2 | 3 | 4; heading: string; rest: string } | null {
  const t = text.trim();
  if (!t) return null;

  let level: 1 | 2 | 3 | 4 | 0 = 0;
  if (/^[（(]\s*[一二三四五六七八九十]+\s*[)）]/.test(t)) level = 2;
  else if (/^[（(]\s*\d+\s*[)）]/.test(t)) level = 4;
  else if (/^[一二三四五六七八九十]+\s*[、.．]/.test(t)) level = 1;
  else if (/^\d+\s*[.．、]\s*\S/.test(t)) level = 3;
  else return null;

  const idx = t.search(/[。！？]/);
  if (idx < 0 || idx > 32) return null;

  const heading = t.slice(0, idx + 1).trim();
  const rest = t.slice(idx + 1).trim();
  return { level: level as 1 | 2 | 3 | 4, heading, rest };
}

/** 去掉行内 markdown 标记，保留可读文本 */
function cleanInline(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[(.+?)\]\((.+?)\)/g, '$1')
    .trim();
}

/** 归一化标题用于比对：去除标点空白与序号前缀 */
function normalize(s: string): string {
  return s
    .replace(/^[一二三四五六七八九十]+[、.．]\s*/, '')
    .replace(/[（(][一二三四五六七八九十\d]+[)）]\s*/, '')
    .replace(/[\s　:：、，,。.．\-—_·「」『』《》〈〉"'"'（）()]/g, '')
    .toLowerCase();
}

/**
 * 判定公文标题层级
 * 公文规范以标题文字形态定级，而非 markdown 井号数量：
 *   一、      → 一级标题（黑体三号）
 *   （一）    → 二级标题（楷体_GB2312 三号）
 *   1.        → 三级标题（仿宋_GB2312 三号）
 *   （1）     → 四级标题（仿宋_GB2312 三号）
 * 文字形态无法判定时，退回按 markdown 井号层级映射。
 */
function gongwenLevel(text: string, mdLevel: number): 1 | 2 | 3 | 4 {
  const t = text.trim();
  if (/^[一二三四五六七八九十]+\s*[、.．]/.test(t)) return 1;
  if (/^[（(]\s*[一二三四五六七八九十]+\s*[)）]/.test(t)) return 2;
  if (/^[（(]\s*\d+\s*[)）]/.test(t)) return 4;
  if (/^\d+\s*[.．、]/.test(t)) return 3;
  // 无编号：h1 视作一级，h2 视作二级，其余按正文
  if (mdLevel === 1) return 1;
  if (mdLevel === 2) return 2;
  return 3;
}

function bodyPara(text: string, opts?: { indent?: boolean; bold?: boolean; font?: string }): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { line: LINE_FIXED, lineRule: 'exact', before: 0, after: 0 },
    indent: opts?.indent === false ? undefined : { firstLine: SIZE_BODY * 2 * 10 }, // 2字符 ≈ 2*16pt
    children: [
      new TextRun({
        text,
        font: opts?.font || FONT_BODY,
        size: SIZE_BODY,
        bold: opts?.bold ?? false
      })
    ]
  });
}

export async function markdownToDocx(
  markdown: string,
  meta: { title: string; subtitle?: string; author?: string; date?: string }
): Promise<Buffer> {
  const blocks = parseMarkdown(markdown);
  const children: Paragraph[] = [];

  // 大标题
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { line: LINE_FIXED, lineRule: 'exact', before: 0, after: 240 },
      children: [
        new TextRun({ text: meta.title, font: FONT_TITLE, size: SIZE_TITLE, bold: false })
      ]
    })
  );

  if (meta.subtitle) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { line: LINE_FIXED, lineRule: 'exact', before: 0, after: 240 },
        children: [new TextRun({ text: meta.subtitle, font: FONT_H2, size: SIZE_BODY })]
      })
    );
  }

  // 正文开头的 H1 若与文档大标题重复，跳过，避免标题出现两次
  let bodyBlocks = blocks;
  const firstIdx = blocks.findIndex((b) => b.text);
  if (
    firstIdx >= 0 &&
    blocks[firstIdx].type === 'h1' &&
    normalize(blocks[firstIdx].text) === normalize(meta.title)
  ) {
    bodyBlocks = blocks.filter((_, i) => i !== firstIdx);
  }

  for (const b of bodyBlocks) {
    if (b.type === 'h1' || b.type === 'h2' || b.type === 'h3' || b.type === 'h4') {
      const mdLevel = b.type === 'h1' ? 1 : b.type === 'h2' ? 2 : b.type === 'h3' ? 3 : 4;
      const level = gongwenLevel(b.text, mdLevel);
      const font = level === 1 ? FONT_H1 : level === 2 ? FONT_H2 : FONT_BODY;
      children.push(
        new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          spacing: {
            line: LINE_FIXED,
            lineRule: 'exact',
            before: level === 1 ? 120 : level === 2 ? 60 : 0,
            after: 0
          },
          indent: { firstLine: SIZE_BODY * 2 * 10 },
          children: [new TextRun({ text: b.text, font, size: SIZE_BODY, bold: false })]
        })
      );
      continue;
    }

    switch (b.type) {
      case 'li':
        children.push(
          new Paragraph({
            alignment: AlignmentType.JUSTIFIED,
            spacing: { line: LINE_FIXED, lineRule: 'exact', before: 0, after: 0 },
            indent: { firstLine: SIZE_BODY * 2 * 10 },
            children: [new TextRun({ text: b.text, font: FONT_BODY, size: SIZE_BODY })]
          })
        );
        break;
      case 'quote':
        children.push(bodyPara(b.text, { font: FONT_H2 }));
        break;
      case 'hr':
        break;
      case 'p': {
        // 模型常把「（一）标题。正文」写成一段，按公文规范拆为楷体标题 + 仿宋正文
        const split = splitParagraphHeading(b.text);
        if (split) {
          const font = split.level === 1 ? FONT_H1 : split.level === 2 ? FONT_H2 : FONT_BODY;
          children.push(
            new Paragraph({
              alignment: AlignmentType.JUSTIFIED,
              spacing: {
                line: LINE_FIXED,
                lineRule: 'exact',
                before: split.level === 1 ? 120 : 60,
                after: 0
              },
              indent: { firstLine: SIZE_BODY * 2 * 10 },
              children: [new TextRun({ text: split.heading, font, size: SIZE_BODY })]
            })
          );
          if (split.rest) children.push(bodyPara(split.rest));
        } else {
          children.push(bodyPara(b.text));
        }
        break;
      }
      default:
        children.push(bodyPara(b.text));
    }
  }

  // 落款
  if (meta.author || meta.date) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        spacing: { line: LINE_FIXED, lineRule: 'exact', before: 480, after: 0 },
        children: [new TextRun({ text: meta.author || '', font: FONT_BODY, size: SIZE_BODY })]
      })
    );
    children.push(
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        spacing: { line: LINE_FIXED, lineRule: 'exact', before: 0, after: 0 },
        children: [new TextRun({ text: meta.date || '', font: FONT_BODY, size: SIZE_BODY })]
      })
    );
  }

  const doc = new Document({
    creator: '工作流程跟踪工作台',
    title: meta.title,
    styles: {
      default: {
        document: {
          run: { font: FONT_BODY, size: SIZE_BODY }
        }
      }
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertMillimetersToTwip(35),
              bottom: convertMillimetersToTwip(33),
              left: convertMillimetersToTwip(27),
              right: convertMillimetersToTwip(27)
            }
          }
        },
        children
      }
    ]
  });

  return await Packer.toBuffer(doc);
}

/** 生成打印用 HTML（浏览器可直接 Ctrl+P 存 PDF） */
export function markdownToPrintHtml(
  markdown: string,
  meta: { title: string; subtitle?: string; author?: string; date?: string }
): string {
  const blocks = parseMarkdown(markdown);

  // 正文开头 H1 与大标题重复时跳过，避免标题出现两次
  let bodyBlocks = blocks;
  const firstIdx = blocks.findIndex((b) => b.text);
  if (
    firstIdx >= 0 &&
    blocks[firstIdx].type === 'h1' &&
    normalize(blocks[firstIdx].text) === normalize(meta.title)
  ) {
    bodyBlocks = blocks.filter((_, i) => i !== firstIdx);
  }

  const body = bodyBlocks
    .map((b) => {
      switch (b.type) {
        case 'h1':
        case 'h2':
        case 'h3':
        case 'h4': {
          const mdLevel = b.type === 'h1' ? 1 : b.type === 'h2' ? 2 : b.type === 'h3' ? 3 : 4;
          const level = gongwenLevel(b.text, mdLevel);
          return `<h${level} class="gw${level}">${esc(b.text)}</h${level}>`;
        }
        case 'li':
          return `<p class="li">${esc(b.text)}</p>`;
        case 'quote':
          return `<p class="quote">${esc(b.text)}</p>`;
        case 'hr':
          return '<hr/>';
        default: {
          const split = splitParagraphHeading(b.text);
          if (split) {
            const h = `<h${split.level} class="gw${split.level}">${esc(split.heading)}</h${split.level}>`;
            return split.rest ? `${h}<p>${esc(split.rest)}</p>` : h;
          }
          return `<p>${esc(b.text)}</p>`;
        }
      }
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"/>
<title>${esc(meta.title)}</title>
<style>
  @page { size: A4; margin: 35mm 27mm 33mm 27mm; }
  body {
    font-family: "仿宋_GB2312","仿宋",FangSong,serif;
    font-size: 16pt; line-height: 29.5pt; text-align: justify;
    color: #000; margin: 0; padding: 0;
  }
  h1.doc-title {
    font-family: "方正小标宋简体","宋体",SimSun,serif;
    font-size: 22pt; text-align: center; font-weight: normal;
    line-height: 29.5pt; margin: 0 0 12pt 0;
  }
  .subtitle { text-align:center; font-family:"楷体_GB2312","楷体",KaiTi,serif; font-size:16pt; margin:0 0 12pt 0; }
  h1 { font-family: "黑体",SimHei,sans-serif; font-size:16pt; font-weight:normal; text-indent:2em; margin:6pt 0 0; }
  h1.gw1 { font-family: "黑体",SimHei,sans-serif; }
  h2 { font-family: "楷体_GB2312","楷体",KaiTi,serif; font-size:16pt; font-weight:normal; text-indent:2em; margin:3pt 0 0; }
  h2.gw1 { font-family: "黑体",SimHei,sans-serif; }
  h3, h4 { font-family: "仿宋_GB2312",FangSong,serif; font-size:16pt; font-weight:normal; text-indent:2em; margin:0; }
  h3.gw1 { font-family: "黑体",SimHei,sans-serif; }
  h3.gw2 { font-family: "楷体_GB2312",KaiTi,serif; }
  h4.gw1 { font-family: "黑体",SimHei,sans-serif; }
  h4.gw2 { font-family: "楷体_GB2312",KaiTi,serif; }
  p { text-indent: 2em; margin: 0; }
  p.quote { font-family:"楷体_GB2312",KaiTi,serif; }
  hr { border:none; border-top:1px solid #999; margin:6pt 0; }
  .sign { text-align:right; margin-top:24pt; text-indent:0; }
  @media print { .noprint { display:none; } }
  .noprint { text-align:center; padding:12px; font-family:sans-serif; }
  .noprint button { padding:8px 24px; font-size:14px; cursor:pointer; }
</style></head>
<body>
<div class="noprint"><button onclick="window.print()">打印 / 另存为 PDF</button></div>
<h1 class="doc-title">${esc(meta.title)}</h1>
${meta.subtitle ? `<div class="subtitle">${esc(meta.subtitle)}</div>` : ''}
${body}
${meta.author ? `<p class="sign">${esc(meta.author)}</p>` : ''}
${meta.date ? `<p class="sign">${esc(meta.date)}</p>` : ''}
</body></html>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 导出 Markdown（带 Obsidian frontmatter） */
export function toObsidianMarkdown(
  markdown: string,
  meta: { title: string; tags?: string[]; category?: string }
): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const created = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const tags = ['WorkBuddy', ...(meta.tags || [])];
  return [
    '---',
    `title: "${meta.title}"`,
    `created: ${created}`,
    `category: "${meta.category || '工作总结'}"`,
    `tags: [${tags.map((t) => `"${t}"`).join(', ')}]`,
    `source: "工作流程跟踪工作台"`,
    '---',
    '',
    markdown
  ].join('\n');
}
