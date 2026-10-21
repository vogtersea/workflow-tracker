import { getDb, getSetting, setSetting } from './db-registry';
import { ymd } from './date';

/**
 * 大模型接入 — OpenAI 兼容协议
 * 兼容：DeepSeek / 通义千问 / Kimi / 豆包 / one-api / 9router / Ollama / vLLM
 */

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  /** 部分网关需要额外的 header，JSON 字符串 */
  extraHeaders?: string;
}

const DEFAULTS: LlmConfig = {
  baseUrl: '',
  apiKey: '',
  model: '',
  temperature: 0.4,
  maxTokens: 3000
};

export function getLlmConfig(): LlmConfig {
  const db = getDb();
  const rows = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'llm.%'").all() as {
    key: string;
    value: string;
  }[];
  const m: Record<string, string> = {};
  for (const r of rows) m[r.key] = r.value;
  return {
    baseUrl: m['llm.baseUrl'] ?? DEFAULTS.baseUrl,
    apiKey: m['llm.apiKey'] ?? DEFAULTS.apiKey,
    model: m['llm.model'] ?? DEFAULTS.model,
    temperature: Number(m['llm.temperature'] ?? DEFAULTS.temperature),
    maxTokens: Number(m['llm.maxTokens'] ?? DEFAULTS.maxTokens),
    extraHeaders: m['llm.extraHeaders'] || ''
  };
}

export function saveLlmConfig(cfg: Partial<LlmConfig>) {
  const map: Record<string, string | undefined> = {
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    model: cfg.model,
    temperature: cfg.temperature !== undefined ? String(cfg.temperature) : undefined,
    maxTokens: cfg.maxTokens !== undefined ? String(cfg.maxTokens) : undefined,
    extraHeaders: cfg.extraHeaders
  };
  for (const [k, v] of Object.entries(map)) {
    if (v !== undefined) setSetting(`llm.${k}`, v);
  }
}

export function isLlmConfigured(): boolean {
  const c = getLlmConfig();
  return Boolean(c.baseUrl && c.model);
}

function headers(cfg: LlmConfig): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${cfg.apiKey}`
  };
  if (cfg.extraHeaders) {
    try {
      Object.assign(h, JSON.parse(cfg.extraHeaders));
    } catch {
      /* 忽略非法 JSON */
    }
  }
  return h;
}

function endpoint(baseUrl: string): string {
  const b = baseUrl.replace(/\/+$/, '');
  if (/\/chat\/completions$/.test(b)) return b;
  if (/\/v1$/.test(b)) return `${b}/chat/completions`;
  return `${b}/v1/chat/completions`;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** 统一包装网络异常，给出可定位的中文提示 */
async function doFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/ECONNREFUSED|fetch failed|ENOTFOUND|EAI_AGAIN|ETIMEDOUT/i.test(msg)) {
      throw new Error(
        `无法连接大模型服务（${url}）。请检查：1）接口地址是否正确，容器内不能用 127.0.0.1，需用宿主机局域网 IP 或服务名；2）服务是否已启动；3）NAS 能否访问外网。原始错误：${msg}`
      );
    }
    if (/aborted|timeout/i.test(msg)) {
      throw new Error(`大模型请求超时（${url}）。可尝试减小最大输出 Token，或更换响应更快的模型。`);
    }
    throw new Error(`大模型请求失败：${msg}`);
  }
}

/** 非流式调用，返回完整文本 */
export async function chat(
  messages: ChatMessage[],
  opts?: { temperature?: number; maxTokens?: number; signal?: AbortSignal }
): Promise<{ text: string; usage?: { prompt_tokens: number; completion_tokens: number } }> {
  const cfg = getLlmConfig();
  if (!cfg.baseUrl || !cfg.model) throw new Error('尚未配置大模型，请先在「系统设置」中填写接口地址与模型名');

  const res = await doFetch(endpoint(cfg.baseUrl), {
    method: 'POST',
    headers: headers(cfg),
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: opts?.temperature ?? cfg.temperature,
      max_tokens: opts?.maxTokens ?? cfg.maxTokens,
      stream: false
    }),
    signal: opts?.signal
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`大模型调用失败 [${res.status}]：${text.slice(0, 500)}`);
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens: number; completion_tokens: number };
    error?: { message: string };
  };

  if (json.error) throw new Error(`大模型返回错误：${json.error.message}`);
  const text = json.choices?.[0]?.message?.content ?? '';
  if (!text) throw new Error('大模型返回内容为空');
  return { text, usage: json.usage };
}

/** 流式调用，产出增量文本 */
export async function* chatStream(
  messages: ChatMessage[],
  opts?: { temperature?: number; maxTokens?: number; signal?: AbortSignal }
): AsyncGenerator<string> {
  const cfg = getLlmConfig();
  if (!cfg.baseUrl || !cfg.model) throw new Error('尚未配置大模型，请先在「系统设置」中填写接口地址与模型名');

  const res = await doFetch(endpoint(cfg.baseUrl), {
    method: 'POST',
    headers: headers(cfg),
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: opts?.temperature ?? cfg.temperature,
      max_tokens: opts?.maxTokens ?? cfg.maxTokens,
      stream: true
    }),
    signal: opts?.signal
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`大模型调用失败 [${res.status}]：${text.slice(0, 500)}`);
  }
  if (!res.body) throw new Error('大模型未返回流式响应');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const s = line.trim();
      if (!s || !s.startsWith('data:')) continue;
      const payload = s.slice(5).trim();
      if (payload === '[DONE]') return;
      try {
        const json = JSON.parse(payload);
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        /* 忽略不完整行 */
      }
    }
  }
}

/** 连通性测试 */
export async function testLlm(): Promise<{ ok: boolean; message: string; latencyMs: number; model?: string }> {
  const cfg = getLlmConfig();
  const started = Date.now();
  try {
    const res = await fetch(endpoint(cfg.baseUrl), {
      method: 'POST',
      headers: headers(cfg),
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: 'user', content: '回复"连接成功"四个字，不要其他内容。' }],
        max_tokens: 20,
        stream: false
      })
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      const t = await res.text();
      return { ok: false, message: `HTTP ${res.status}：${t.slice(0, 300)}`, latencyMs };
    }
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return {
      ok: true,
      message: j.choices?.[0]?.message?.content?.trim() || '连接成功',
      latencyMs,
      model: cfg.model
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
      latencyMs: Date.now() - started
    };
  }
}

/** 提取模型列表（部分兼容网关支持 /v1/models） */
export async function listModels(): Promise<string[]> {
  const cfg = getLlmConfig();
  if (!cfg.baseUrl) return [];
  const base = cfg.baseUrl.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  const candidates = [/\/v1$/.test(base) ? `${base}/models` : `${base}/v1/models`];
  for (const url of candidates) {
    try {
      const res = await fetch(url, { headers: headers(cfg), signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const j = (await res.json()) as { data?: { id: string }[] };
      if (j.data?.length) return j.data.map((d) => d.id).sort();
    } catch {
      /* 尝试下一个 */
    }
  }
  return [];
}
