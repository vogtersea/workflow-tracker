'use client';

import { useState, useEffect } from 'react';
import { Loading } from '@/components/ui';
import { useShell } from '@/components/Shell';
import { api } from '@/lib/api-client';

export default function SettingsPage() {
  const { user, toast } = useShell();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');

  const [llm, setLlm] = useState({
    baseUrl: '',
    apiKey: '',
    model: '',
    temperature: 0.4,
    maxTokens: 3000
  });
  const [models, setModels] = useState<string[]>([]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; latencyMs: number } | null>(null);

  const [remind, setRemind] = useState({
    enabled: true,
    aheadDays: 3,
    time: '09:00',
    webhookEnabled: false,
    webhookUrl: '',
    webhookType: 'generic'
  });

  const [obsidian, setObsidian] = useState({ dir: '', writeback: '99-收件箱' });
  const [system, setSystem] = useState<Record<string, unknown>>({});
  const [llmConfigured, setLlmConfigured] = useState(false);

  // 修改自己密码
  const [pwdForm, setPwdForm] = useState({ oldPassword: '', password: '', confirm: '' });
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdMsg, setPwdMsg] = useState<{ ok: boolean; text: string } | null>(null);

  /** 探测容器内路径是否可访问，辅助填写 Obsidian 路径 */
  const [probe, setProbe] = useState<{
    checking: boolean;
    result: { ok: boolean; message: string; total?: number } | null;
  }>({ checking: false, result: null });

  async function checkVaultPath() {
    setProbe({ checking: true, result: null });
    try {
      // 先保存再探测，确保探测的是当前填写的路径
      await api('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section: 'obsidian', obsidian })
      });
      const res = await api('/api/obsidian?mode=tree');
      const json = await res.json();
      if (json.ok && json.data.enabled) {
        setProbe({
          checking: false,
          result: {
            ok: true,
            message: `路径可访问，检测到 ${json.data.total ?? 0} 篇 Markdown 笔记`,
            total: json.data.total
          }
        });
      } else {
        setProbe({
          checking: false,
          result: {
            ok: false,
            message:
              json.data?.message ||
              json.error ||
              '路径不可访问。请确认该目录已通过 docker-compose 的 volumes 挂载进容器。'
          }
        });
      }
    } catch {
      setProbe({ checking: false, result: { ok: false, message: '探测失败，请稍后重试' } });
    }
  }

  async function changeOwnPassword() {
    setPwdMsg(null);
    if (pwdForm.password.length < 6) {
      setPwdMsg({ ok: false, text: '新密码至少 6 位' });
      return;
    }
    if (pwdForm.password !== pwdForm.confirm) {
      setPwdMsg({ ok: false, text: '两次输入的新密码不一致' });
      return;
    }
    setPwdSaving(true);
    try {
      const res = await api('/api/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'changeOwnPassword',
          oldPassword: pwdForm.oldPassword,
          password: pwdForm.password
        })
      });
      const json = await res.json();
      if (json.ok) {
        setPwdMsg({ ok: true, text: '密码已修改，其他设备上的登录已失效' });
        setPwdForm({ oldPassword: '', password: '', confirm: '' });
      } else {
        setPwdMsg({ ok: false, text: json.error || '修改失败' });
      }
    } catch {
      setPwdMsg({ ok: false, text: '网络异常' });
    } finally {
      setPwdSaving(false);
    }
  }

  useEffect(() => {
    api('/api/settings')
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) {
          setLlm(j.data.llm);
          setRemind(j.data.remind);
          setObsidian(j.data.obsidian);
          setSystem(j.data.system);
          setLlmConfigured(j.data.llmConfigured);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function saveLlm() {
    setSaving('llm');
    try {
      const res = await api('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section: 'llm', llm })
      });
      const json = await res.json();
      if (json.ok) {
        toast('大模型配置已保存', 'success');
        setLlmConfigured(Boolean(llm.baseUrl && llm.model));
      } else toast(json.error || '保存失败', 'error');
    } finally {
      setSaving('');
    }
  }

  async function testLlm() {
    setTesting(true);
    setTestResult(null);
    try {
      // 先保存再测试，确保测的是当前填写的值
      await api('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section: 'llm', llm })
      });
      const res = await api('/api/settings?mode=testLlm');
      const json = await res.json();
      if (json.ok) setTestResult(json.data);
      else setTestResult({ ok: false, message: json.error || '测试失败', latencyMs: 0 });
    } catch {
      setTestResult({ ok: false, message: '网络异常', latencyMs: 0 });
    } finally {
      setTesting(false);
    }
  }

  async function fetchModels() {
    try {
      const res = await api('/api/settings?mode=models');
      const json = await res.json();
      if (json.ok && json.data.length) {
        setModels(json.data);
        toast(`获取到 ${json.data.length} 个可用模型`, 'success');
      } else toast('该接口未提供模型列表，请手动填写模型名', 'error');
    } catch {
      toast('获取失败', 'error');
    }
  }

  async function saveRemind() {
    setSaving('remind');
    try {
      const res = await api('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section: 'remind', remind })
      });
      const json = await res.json();
      if (json.ok) toast('提醒配置已保存', 'success');
      else toast(json.error || '保存失败', 'error');
    } finally {
      setSaving('');
    }
  }

  async function saveObsidian() {
    setSaving('obsidian');
    try {
      const res = await api('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section: 'obsidian', obsidian })
      });
      const json = await res.json();
      if (json.ok) toast('Obsidian 配置已保存', 'success');
      else toast(json.error || '保存失败', 'error');
    } finally {
      setSaving('');
    }
  }

  if (loading) return <Loading />;

  const isAdmin = user?.role === 'admin';

  return (
    <>
      {!isAdmin && (
        <div className="alert alert-info" style={{ marginBottom: 16 }}>
          当前账号为成员权限，系统配置项仅管理员可修改。
        </div>
      )}

      {/* 大模型 */}
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-header">
          <div className="panel-title">大模型接入</div>
          <div style={{ marginLeft: 'auto' }}>
            <span className={`chip ${llmConfigured ? 'chip-ok' : 'chip-warn'}`}>
              {llmConfigured ? '已配置' : '未配置'}
            </span>
          </div>
        </div>
        <div className="panel-body">
          <div className="alert alert-info">
            采用 OpenAI 兼容协议，可对接 DeepSeek、通义千问、Kimi、豆包等云端服务，也可对接 one-api、9router 网关或本地 Ollama。
            接口地址示例：<code>https://api.deepseek.com</code>、<code>http://192.168.1.x:11434/v1</code>。
          </div>

          <div className="field">
            <label className="field-label">接口地址（Base URL）</label>
            <input
              className="input"
              value={llm.baseUrl}
              onChange={(e) => setLlm({ ...llm, baseUrl: e.target.value })}
              placeholder="https://api.deepseek.com"
              disabled={!isAdmin}
            />
            <div className="field-hint">填写到 /v1 之前即可，系统会自动补全 /v1/chat/completions</div>
          </div>

          <div className="form-row">
            <div className="field">
              <label className="field-label">API Key</label>
              <input
                className="input"
                type="password"
                value={llm.apiKey}
                onChange={(e) => setLlm({ ...llm, apiKey: e.target.value })}
                placeholder="sk-..."
                disabled={!isAdmin}
              />
            </div>
            <div className="field">
              <label className="field-label">模型名称</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {models.length > 0 ? (
                  <select
                    className="select"
                    value={llm.model}
                    onChange={(e) => setLlm({ ...llm, model: e.target.value })}
                    disabled={!isAdmin}
                  >
                    <option value="">请选择模型</option>
                    {models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="input"
                    value={llm.model}
                    onChange={(e) => setLlm({ ...llm, model: e.target.value })}
                    placeholder="deepseek-chat"
                    disabled={!isAdmin}
                  />
                )}
                <button className="btn btn-sm" onClick={fetchModels} disabled={!isAdmin}>
                  获取
                </button>
              </div>
            </div>
          </div>

          <div className="form-row">
            <div className="field">
              <label className="field-label">温度（0-1）</label>
              <input
                type="number"
                className="input"
                min="0"
                max="1"
                step="0.1"
                value={llm.temperature}
                onChange={(e) => setLlm({ ...llm, temperature: Number(e.target.value) })}
                disabled={!isAdmin}
              />
              <div className="field-hint">公文类写作建议 0.3 至 0.5，过高会偏离材料事实</div>
            </div>
            <div className="field">
              <label className="field-label">最大输出 Token</label>
              <input
                type="number"
                className="input"
                min="500"
                step="500"
                value={llm.maxTokens}
                onChange={(e) => setLlm({ ...llm, maxTokens: Number(e.target.value) })}
                disabled={!isAdmin}
              />
            </div>
          </div>

          {testResult && (
            <div className={`alert ${testResult.ok ? 'alert-ok' : 'alert-error'}`}>
              {testResult.ok
                ? `连接成功（${testResult.latencyMs} ms）：${testResult.message}`
                : `连接失败：${testResult.message}`}
            </div>
          )}

          {isAdmin && (
            <div style={{ display: 'flex', gap: 9 }}>
              <button className="btn btn-primary" onClick={saveLlm} disabled={saving === 'llm'}>
                {saving === 'llm' ? '保存中…' : '保存配置'}
              </button>
              <button className="btn" onClick={testLlm} disabled={testing}>
                {testing ? (
                  <>
                    <span className="spinner dark" />
                    测试中…
                  </>
                ) : (
                  '测试连接'
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 提醒 */}
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-header">
          <div className="panel-title">提醒设置</div>
        </div>
        <div className="panel-body">
          <div className="form-row">
            <div className="field">
              <label className="field-label">站内提醒</label>
              <select
                className="select"
                value={remind.enabled ? '1' : '0'}
                onChange={(e) => setRemind({ ...remind, enabled: e.target.value === '1' })}
                disabled={!isAdmin}
              >
                <option value="1">启用</option>
                <option value="0">停用</option>
              </select>
              <div className="field-hint">在待办中心与页面红点提示临近、逾期工作</div>
            </div>
            <div className="field">
              <label className="field-label">提前提醒天数</label>
              <input
                type="number"
                className="input"
                min="1"
                max="30"
                value={remind.aheadDays}
                onChange={(e) => setRemind({ ...remind, aheadDays: Number(e.target.value) })}
                disabled={!isAdmin}
              />
            </div>
            <div className="field">
              <label className="field-label">每日推送时刻</label>
              <input
                type="time"
                className="input"
                value={remind.time}
                onChange={(e) => setRemind({ ...remind, time: e.target.value })}
                disabled={!isAdmin}
              />
              <div className="field-hint">到点后由后台自动推送，不需要开着页面</div>
            </div>
          </div>

          <div className="divider" />

          <div className="form-row">
            <div className="field">
              <label className="field-label">Webhook 推送</label>
              <select
                className="select"
                value={remind.webhookEnabled ? '1' : '0'}
                onChange={(e) => setRemind({ ...remind, webhookEnabled: e.target.value === '1' })}
                disabled={!isAdmin}
              >
                <option value="0">停用</option>
                <option value="1">启用</option>
              </select>
            </div>
            <div className="field">
              <label className="field-label">推送格式</label>
              <select
                className="select"
                value={remind.webhookType}
                onChange={(e) => setRemind({ ...remind, webhookType: e.target.value })}
                disabled={!isAdmin}
              >
                <option value="generic">通用 JSON</option>
                <option value="wecom">企业微信群机器人</option>
                <option value="dingtalk">钉钉群机器人</option>
                <option value="feishu">飞书群机器人</option>
              </select>
            </div>
          </div>

          <div className="field">
            <label className="field-label">Webhook 地址</label>
            <input
              className="input"
              value={remind.webhookUrl}
              onChange={(e) => setRemind({ ...remind, webhookUrl: e.target.value })}
              placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..."
              disabled={!isAdmin || !remind.webhookEnabled}
            />
            <div className="field-hint">
              配置后，可在「待办提醒」页手动触发推送，或由外部定时任务调用 /api/notifications 触发
            </div>
          </div>

          {isAdmin && (
            <button className="btn btn-primary" onClick={saveRemind} disabled={saving === 'remind'}>
              {saving === 'remind' ? '保存中…' : '保存提醒配置'}
            </button>
          )}
        </div>
      </div>

      {/* Obsidian */}
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-header">
          <div className="panel-title">Obsidian 知识库</div>
        </div>
        <div className="panel-body">
          <div className="alert alert-info">
            容器只能访问已挂载的目录，因此<strong>挂载点</strong>需在 docker-compose 中定义（如把 NAS 的
            Obsidian 总目录挂到 <code>/vault</code>）；而<strong>具体使用哪个子目录</strong>可在此处随时修改，
            改完保存立即生效，无需重启容器。
          </div>

          <div className="form-row">
            <div className="field">
              <label className="field-label">知识库路径（容器内）</label>
              <input
                className="input"
                value={obsidian.dir}
                onChange={(e) => setObsidian({ ...obsidian, dir: e.target.value })}
                placeholder="/vault 或 /vault/my-notes"
                disabled={!isAdmin}
              />
              <div className="field-hint">
                建议挂载总目录、这里再选子库，这样切换知识库不必重建容器
              </div>
            </div>
            <div className="field">
              <label className="field-label">报告写回目录</label>
              <input
                className="input"
                value={obsidian.writeback}
                onChange={(e) => setObsidian({ ...obsidian, writeback: e.target.value })}
                placeholder="99-收件箱"
                disabled={!isAdmin}
              />
              <div className="field-hint">相对知识库根目录的子路径，不存在会自动创建</div>
            </div>
          </div>

          {probe.result && (
            <div className={`alert ${probe.result.ok ? 'alert-ok' : 'alert-error'}`}>
              {probe.result.message}
              {!probe.result.ok && (
                <div style={{ marginTop: 6, fontSize: 11.5, lineHeight: 1.7 }}>
                  排查方向：1）确认 docker-compose.yml 的 volumes 中已添加该目录映射；
                  2）路径区分大小写，且必须是容器内路径（如 <code>/vault</code>），不是 NAS 上的路径；
                  3）若只需检索、不写回，挂载加 <code>:ro</code> 即可，写回会明确报只读错误。
                </div>
              )}
            </div>
          )}

          {isAdmin && (
            <div style={{ display: 'flex', gap: 9 }}>
              <button className="btn btn-primary" onClick={saveObsidian} disabled={saving === 'obsidian'}>
                {saving === 'obsidian' ? '保存中…' : '保存'}
              </button>
              <button className="btn" onClick={checkVaultPath} disabled={probe.checking}>
                {probe.checking ? (
                  <>
                    <span className="spinner dark" />
                    检测中…
                  </>
                ) : (
                  '检测路径'
                )}
              </button>
              <a href="/obsidian" className="btn">
                浏览知识库
              </a>
            </div>
          )}
        </div>
      </div>

      {/* 修改密码 */}
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-header">
          <div className="panel-title">修改密码</div>
        </div>
        <div className="panel-body">
          <div className="alert alert-info">
            首次部署时 <code>ADMIN_PASSWORD</code> 只在数据库为空时生效一次。之后若需更换密码，
            请在此处修改，改 docker-compose 中的环境变量不会再影响已存在的账号。
          </div>

          <div className="form-row-3">
            <div className="field">
              <label className="field-label">原密码</label>
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                value={pwdForm.oldPassword}
                onChange={(e) => setPwdForm({ ...pwdForm, oldPassword: e.target.value })}
                placeholder="当前登录密码"
              />
            </div>
            <div className="field">
              <label className="field-label">新密码</label>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={pwdForm.password}
                onChange={(e) => setPwdForm({ ...pwdForm, password: e.target.value })}
                placeholder="至少 6 位"
              />
            </div>
            <div className="field">
              <label className="field-label">确认新密码</label>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={pwdForm.confirm}
                onChange={(e) => setPwdForm({ ...pwdForm, confirm: e.target.value })}
                placeholder="再输入一次"
              />
            </div>
          </div>

          {pwdMsg && (
            <div className={`alert ${pwdMsg.ok ? 'alert-ok' : 'alert-error'}`}>{pwdMsg.text}</div>
          )}

          <button className="btn btn-primary" onClick={changeOwnPassword} disabled={pwdSaving}>
            {pwdSaving ? '提交中…' : '修改密码'}
          </button>
        </div>
      </div>

      {/* 系统信息 */}
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">系统信息</div>
        </div>
        <div className="panel-body">
          <dl className="kv">
            <dt>数据库路径</dt>
            <dd style={{ fontFamily: 'monospace', fontSize: 12 }}>{String(system.dbPath || '')}</dd>
            <dt>数据目录</dt>
            <dd style={{ fontFamily: 'monospace', fontSize: 12 }}>{String(system.dataDir || '')}</dd>
            <dt>数据文件大小</dt>
            <dd>{system.dbSize ? `${(Number(system.dbSize) / 1024).toFixed(1)} KB` : '—'}</dd>
            <dt>Node 版本</dt>
            <dd style={{ fontFamily: 'monospace', fontSize: 12 }}>{String(system.nodeVersion || '')}</dd>
            <dt>当前账号</dt>
            <dd>
              {user?.display_name}（{user?.role === 'admin' ? '管理员' : '成员'}）
            </dd>
          </dl>
          <div style={{ marginTop: 14, fontSize: 11.5, color: 'var(--ink-400)', lineHeight: 1.8 }}>
            全部数据保存在本地 SQLite 文件中，不依赖任何外部云服务。备份时只需复制 data 目录下的
            workflow.db 文件（建议在系统空闲时备份，并同时复制 -wal、-shm 文件）。
          </div>
        </div>
      </div>
    </>
  );
}
