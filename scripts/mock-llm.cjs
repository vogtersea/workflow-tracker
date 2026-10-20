/**
 * 本地大模型 Mock 服务
 * 用于在没有真实 API Key 的情况下验证 OpenAI 兼容协议、提示词构造与报告解析链路
 */

const http = require('node:http');

const PORT = 9911;

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    console.log(`[mock] ${req.method} ${req.url}`);

    if (req.url.includes('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          data: [{ id: 'mock-gpt-cn' }, { id: 'mock-gpt-cn-pro' }]
        })
      );
      return;
    }

    if (req.url.includes('/chat/completions')) {
      let payload = {};
      try {
        payload = JSON.parse(body);
      } catch {
        /* ignore */
      }

      const userMsg = payload.messages?.find((m) => m.role === 'user')?.content || '';
      const sysMsg = payload.messages?.find((m) => m.role === 'system')?.content || '';

      // 落盘最近一次提示词，便于人工核查注入内容
      try {
        require('node:fs').writeFileSync(require('node:path').join(__dirname,'..','.last-prompt.txt'), '===SYSTEM===\n' + sysMsg + '\n\n===USER===\n' + userMsg);
      } catch {}


      console.log('[mock] system prompt length:', sysMsg.length);
      console.log('[mock] user prompt length:', userMsg.length);
      console.log('[mock] contains 统计事实:', userMsg.includes('统计事实'));
      console.log('[mock] contains 工作明细:', userMsg.includes('工作明细'));
      console.log('[mock] task title found:', /季度工作总结/.test(userMsg));

      // 回显关键信息，便于断言
      const reply = `# 测试报告

## 一、总体情况

本期共涉及工作 1 项。材料已成功注入，系统提示词长度 ${sysMsg.length} 字符，用户提示词长度 ${userMsg.length} 字符。

## 二、重点工作推进情况

已完成「起草季度工作总结材料」的阶段性推进，形成初稿并完成初步审核。

## 三、存在问题与不足

部分工作的进展记录尚需细化。

## 四、下一步工作打算

按要求完成材料报送并归档留存。

---
MOCK_ECHO:${userMsg.includes('统计事实')}:${/季度工作总结/.test(userMsg)}`;

      if (payload.stream) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive'
        });
        const chunks = reply.match(/[\s\S]{1,20}/g) || [];
        let i = 0;
        const timer = setInterval(() => {
          if (i >= chunks.length) {
            res.write('data: [DONE]\n\n');
            res.end();
            clearInterval(timer);
            return;
          }
          res.write(
            `data: ${JSON.stringify({ choices: [{ delta: { content: chunks[i] } }] })}\n\n`
          );
          i++;
        }, 10);
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: reply } }],
          usage: { prompt_tokens: 1000, completion_tokens: 500 }
        })
      );
      return;
    }

    res.writeHead(404);
    res.end('not found');
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock] LLM listening on http://127.0.0.1:${PORT}`);
});
