'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Empty, Loading, Modal } from '@/components/ui';
import { useShell } from '@/components/Shell';

interface Note {
  path: string;
  title: string;
  folder: string;
  size: number;
  mtime: string;
  excerpt?: string;
  score?: number;
}

export default function ObsidianPage() {
  const { user, toast } = useShell();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [dir, setDir] = useState('');
  const [tree, setTree] = useState<{
    total: number;
    folders: { name: string; count: number }[];
    recent: Note[];
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<Note[] | null>(null);
  const [searching, setSearching] = useState(false);

  const [preview, setPreview] = useState<{ path: string; content: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    fetch('/api/obsidian?mode=tree')
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) {
          setEnabled(j.data.enabled);
          setDir(j.data.dir || '');
          if (j.data.enabled) setTree(j.data);
        } else setEnabled(false);
      })
      .catch(() => setEnabled(false))
      .finally(() => setLoading(false));
  }, []);

  async function search() {
    if (!keyword.trim()) {
      setResults(null);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(`/api/obsidian?mode=search&q=${encodeURIComponent(keyword)}&limit=30`);
      const json = await res.json();
      if (json.ok) setResults(json.data);
      else toast(json.error || '检索失败', 'error');
    } finally {
      setSearching(false);
    }
  }

  async function openNote(path: string) {
    setPreviewLoading(true);
    setPreview({ path, content: '' });
    try {
      const res = await fetch(`/api/obsidian?mode=read&path=${encodeURIComponent(path)}`);
      const json = await res.json();
      if (json.ok) setPreview(json.data);
      else {
        toast(json.error || '读取失败', 'error');
        setPreview(null);
      }
    } finally {
      setPreviewLoading(false);
    }
  }

  if (loading) return <Loading />;

  if (!enabled) {
    return (
      <div className="panel">
        <Empty
          title="Obsidian 知识库尚未接入"
          desc="需在容器启动时将 vault 目录挂载到容器内，并在系统设置中填写容器内路径（如 /vault）"
          action={
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <Link href="/settings" className="btn btn-sm btn-primary">
                前往系统设置
              </Link>
            </div>
          }
        />
        <div className="panel-body" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="section-title">接入方式</div>
          <div
            style={{
              fontSize: 12.5,
              color: 'var(--ink-600)',
              lineHeight: 2,
              background: 'var(--ink-50)',
              padding: '12px 16px',
              borderRadius: 'var(--radius)',
              fontFamily: 'monospace'
            }}
          >
            # docker-compose.yml 中增加挂载
            <br />
            volumes:
            <br />
            &nbsp;&nbsp;- /volume1/docker/workflow/data:/app/data
            <br />
            &nbsp;&nbsp;- /path/to/your/vault:/vault:ro
          </div>
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--ink-500)', lineHeight: 1.9 }}>
            挂载后，系统可对笔记做关键词检索，为报告生成提供素材参考；报告也可写回指定子目录（需读写权限）。
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="toolbar">
        <div className="search-input" style={{ width: 320 }}>
          <input
            placeholder="检索知识库标题与正文"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
          />
        </div>
        <button className="btn btn-sm btn-primary" onClick={search} disabled={searching}>
          {searching ? '检索中…' : '检索'}
        </button>
        {results && (
          <button
            className="btn btn-sm"
            onClick={() => {
              setResults(null);
              setKeyword('');
            }}
          >
            清除结果
          </button>
        )}
        <div className="toolbar-spacer" />
        <span className="chip chip-ok">已接入</span>
        <span style={{ fontSize: 11.5, color: 'var(--ink-400)', fontFamily: 'monospace' }}>{dir}</span>
      </div>

      {results ? (
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">检索结果</div>
            <div style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-400)' }}>
              共 {results.length} 条
            </div>
          </div>
          {results.length === 0 ? (
            <Empty title="未找到匹配笔记" desc="尝试更换关键词，或使用更简短的核心词" />
          ) : (
            <div>
              {results.map((n) => (
                <button
                  key={n.path}
                  onClick={() => openNote(n.path)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '12px 18px',
                    borderBottom: '1px solid var(--ink-100)',
                    background: 'transparent',
                    border: 'none',
                    borderBottomWidth: 1,
                    borderBottomStyle: 'solid',
                    borderBottomColor: 'var(--ink-100)'
                  }}
                >
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-900)', marginBottom: 3 }}>
                    {n.title}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-400)', marginBottom: n.excerpt ? 4 : 0 }}>
                    {n.folder || '根目录'} · {n.path}
                  </div>
                  {n.excerpt && (
                    <div style={{ fontSize: 12, color: 'var(--ink-600)', lineHeight: 1.7 }}>
                      …{n.excerpt}…
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="split split-side-320">
          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">目录概览</div>
              <div style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-400)' }}>
                {tree?.total || 0} 篇
              </div>
            </div>
            <div style={{ maxHeight: 480, overflowY: 'auto' }}>
              {tree?.folders.map((f) => (
                <div
                  key={f.name}
                  style={{
                    padding: '8px 18px',
                    borderBottom: '1px solid var(--ink-100)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 12.5
                  }}
                >
                  <span style={{ color: 'var(--gold-600)' }}>◫</span>
                  <span style={{ flex: 1, color: 'var(--ink-700)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {f.name}
                  </span>
                  <span style={{ color: 'var(--ink-400)', fontSize: 11 }}>{f.count}</span>
                </div>
              ))}
              {(!tree?.folders || tree.folders.length === 0) && (
                <Empty title="目录为空" desc="知识库中暂无 Markdown 笔记" />
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">最近更新</div>
            </div>
            {(!tree?.recent || tree.recent.length === 0) ? (
              <Empty title="暂无笔记" />
            ) : (
              <div>
                {tree.recent.map((n) => (
                  <button
                    key={n.path}
                    onClick={() => openNote(n.path)}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '9px 18px',
                      border: 'none',
                      borderBottom: '1px solid var(--ink-100)',
                      background: 'transparent'
                    }}
                  >
                    <div style={{ fontSize: 12.5, color: 'var(--ink-800)', fontWeight: 500 }}>
                      {n.title}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ink-400)' }}>
                      {n.folder || '根目录'} · {n.mtime.slice(0, 10)}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {preview && (
        <Modal title={preview.path} onClose={() => setPreview(null)} wide>
          {previewLoading ? (
            <Loading text="读取中" />
          ) : (
            <pre
              style={{
                fontSize: 12.5,
                lineHeight: 1.85,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontFamily: 'var(--font-sans)',
                margin: 0,
                color: 'var(--ink-700)'
              }}
            >
              {preview.content}
            </pre>
          )}
        </Modal>
      )}
    </>
  );
}
