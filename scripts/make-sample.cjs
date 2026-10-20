/**
 * 用本地 mock 大模型产出一份结构完整的示例报告，
 * 用于演示导出格式；正文为示例性质，不含任何真实业务信息。
 */
const BASE = 'http://127.0.0.1:3080';
const PASS = process.env.SEED_PASS || 'admin123456';
let cookie = '';

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(opts.headers || {})
    }
  });
  const sc = res.headers.get('set-cookie');
  if (sc) {
    const m = sc.match(/wt_session=([^;]+)/);
    if (m) cookie = `wt_session=${m[1]}`;
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return { status: res.status, json: await res.json() };
  return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()), headers: res.headers };
}

(async () => {
  await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: PASS })
  });

  // 生成周报（mock 模型会返回占位内容，此处仅验证链路）
  const r = await api('/api/reports', {
    method: 'POST',
    body: JSON.stringify({ scope: 'week', title: '本周工作总结' })
  });
  console.log('周报生成:', r.json?.ok ? `ID ${r.json.data.id}` : r.json?.error);

  if (r.json?.ok) {
    const id = r.json.data.id;
    // 用一段符合公文规范的示例文本覆盖 mock 内容，作为导出样例
    const sample = `# 本周工作总结

## 一、总体情况

本周共承接各类事项7项，其中已完成2项，正在推进5项，按计划节点推进总体平稳。从工作类别看，材料撰写类3项、数据报表类2项、沟通协调与内部培训类各1项，重点集中在本季度工作总结起草、月度数据报表汇总和内部培训方案编制三项任务上。

## 二、重点工作推进情况

（一）季度工作总结起草扎实推进。按照年度工作安排，完成相关制度文件与历史材料的系统梳理，形成参考文献12篇的素材库。在三级提纲基础上补充两个具体案例，初稿已形成约5000字，配套演示材料正在同步制作。

（二）月度数据报表进入审核阶段。按既定报表口径要求，完成各项基础数据提取与口径核对，分析说明初稿已形成并送负责人初审。重点就任务完成情况与进度偏差作了专项说明。

（三）内部培训方案完成前期准备。围绕提升团队业务能力这一目标，完成相关教材与案例的研读，梳理形成四个问题清单，为下一步成稿奠定基础。

（四）沟通协调与宣传工作有序开展。内部宣传稿件已完成采写并提交，等待采用通知；跨部门协作事项完成本期联络名单更新，典型案例正在收集。

## 三、存在问题与不足

一是月度数据报表材料已过报送节点2天，尚处初审环节，反映出前置准备不够充分、审核环节衔接不够紧密。二是部分工作进展记录不够细化，难以完整反映推进脉络，对后续总结提炼形成制约。三是工作总结起草与演示材料制作两条线并行推进，时间安排偏紧。

## 四、下一步工作打算

一是抓紧完成数据报表材料的审核与报送，明确专人跟踪回执，同步梳理本次报送中的口径争议问题形成清单，供后续报送参照。二是督促各承办人对在办事项补充阶段性进展记录，做到一事一记、节点清晰。三是加快总结材料定稿与演示材料配套，确保按期完成任务。四是持续推进专项材料编写，尽快形成送审稿。`;

    // 通过 PATCH 覆盖正文
    const patch = await api(`/api/reports/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ content_md: sample })
    });
    console.log('正文写入:', patch.json?.ok ? '成功' : patch.json?.error);

    const docx = await api(`/api/reports/${id}/export?format=docx`);
    require('node:fs').writeFileSync(
      'outputs/周工作总结-公文格式样例.docx',
      Buffer.from(docx.buffer)
    );
    console.log('Word 已导出:', Math.round(docx.buffer.length / 1024), 'KB');

    const html = await api(`/api/reports/${id}/export?format=html`);
    require('node:fs').writeFileSync(
      'outputs/周工作总结-打印预览.html',
      Buffer.from(html.buffer)
    );
    console.log('HTML 已导出');

    const md = await api(`/api/reports/${id}/export?format=md`);
    require('node:fs').writeFileSync(
      'outputs/周工作总结-obsidian格式.md',
      Buffer.from(md.buffer)
    );
    console.log('Markdown 已导出');
  }
})();
