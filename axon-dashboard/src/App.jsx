import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

const API = 'http://localhost:8000'

const get = (url) => fetch(API + url).then(r => r.json())
const post = (url, body) => fetch(API + url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
}).then(r => r.json())

// ── Status badge ─────────────────────────────────────────────────────────────
function Badge({ status }) {
  const map = {
    pending:   { color: 'var(--yellow)', bg: 'var(--yellow-dim)', label: 'PENDING' },
    delivered: { color: 'var(--green)',  bg: 'var(--green-dim)',  label: 'DELIVERED' },
    failed:    { color: 'var(--red)',    bg: 'var(--red-dim)',    label: 'FAILED' },
  }
  const s = map[status] || map.pending
  return (
    <span style={{
      background: s.bg, color: s.color,
      border: `1px solid ${s.color}44`,
      padding: '1px 7px', borderRadius: 3,
      fontSize: 10, letterSpacing: '0.08em', fontWeight: 600
    }}>{s.label}</span>
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, color, pulse }) {
  return (
    <div style={{
      background: 'var(--bg2)', border: '1px solid var(--border)',
      borderTop: `2px solid ${color}`,
      padding: '18px 22px', borderRadius: 6,
      animation: 'fadeIn 0.4s ease forwards'
    }}>
      <div style={{ color: 'var(--text-dim)', fontSize: 10, letterSpacing: '0.12em', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{
        color, fontSize: 32, fontWeight: 600, lineHeight: 1,
        animation: pulse ? 'pulse 2s infinite' : 'none'
      }}>{value ?? '—'}</div>
    </div>
  )
}

// ── Section header ────────────────────────────────────────────────────────────
function SectionHeader({ title, subtitle }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 3, height: 16, background: 'var(--cyan)', borderRadius: 2 }} />
        <span style={{ color: 'var(--cyan)', fontWeight: 600, letterSpacing: '0.1em', fontSize: 11 }}>
          {title}
        </span>
      </div>
      {subtitle && <div style={{ color: 'var(--text-dim)', fontSize: 11, marginTop: 4, paddingLeft: 13 }}>{subtitle}</div>}
    </div>
  )
}

// ── Topics panel ──────────────────────────────────────────────────────────────
function TopicsPanel({ onSelect, selected }) {
  const qc = useQueryClient()
  const { data: topics = [] } = useQuery({ queryKey: ['topics'], queryFn: () => get('/topics') })

  const [name, setName] = useState('')
  const create = useMutation({
    mutationFn: () => post('/topics', { name }),
    onSuccess: () => { qc.invalidateQueries(['topics']); setName('') }
  })
  const del = useMutation({
    mutationFn: (n) => fetch(`${API}/topics/${n}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries(['topics'])
  })

  return (
    <div>
      <SectionHeader title="TOPICS" subtitle={`${topics.length} active`} />
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && name && create.mutate()}
          placeholder="new.topic.name"
          style={{
            flex: 1, background: 'var(--bg3)', border: '1px solid var(--border)',
            borderRadius: 4, padding: '7px 12px', color: 'var(--text)',
            fontFamily: 'var(--mono)', fontSize: 12, outline: 'none'
          }}
        />
        <button
          onClick={() => name && create.mutate()}
          style={{
            background: 'var(--cyan-dim)', border: '1px solid var(--cyan)',
            color: 'var(--cyan)', borderRadius: 4, padding: '7px 14px',
            cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 12
          }}>+ CREATE</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {topics.map(t => (
          <div
            key={t.name}
            onClick={() => onSelect(t.name)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 14px', borderRadius: 5, cursor: 'pointer',
              background: selected === t.name ? 'var(--cyan-dim)' : 'var(--bg2)',
              border: `1px solid ${selected === t.name ? 'var(--cyan)' : 'var(--border)'}`,
              transition: 'all 0.15s'
            }}>
            <span style={{ color: selected === t.name ? 'var(--cyan)' : 'var(--text)' }}>
              {t.name}
            </span>
            <button
              onClick={e => { e.stopPropagation(); del.mutate(t.name) }}
              style={{
                background: 'none', border: 'none', color: 'var(--text-dim)',
                cursor: 'pointer', fontSize: 14, lineHeight: 1,
                padding: '0 4px'
              }}>×</button>
          </div>
        ))}
        {topics.length === 0 && (
          <div style={{ color: 'var(--text-dim)', padding: '20px 0', textAlign: 'center' }}>
            no topics yet
          </div>
        )}
      </div>
    </div>
  )
}

// ── Messages table ─────────────────────────────────────────────────────────────
function MessagesTable({ topic }) {
  const { data: messages = [] } = useQuery({
    queryKey: ['messages', topic],
    queryFn: () => get(`/messages/${topic}`),
    enabled: !!topic
  })
  const { data: subs = [] } = useQuery({
    queryKey: ['subscribers', topic],
    queryFn: () => get(`/subscribers/${topic}`),
    enabled: !!topic
  })

  const pending   = messages.filter(m => m.status === 'pending').length
  const delivered = messages.filter(m => m.status === 'delivered').length
  const failed    = messages.filter(m => m.status === 'failed').length

  if (!topic) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: 'var(--text-dim)' }}>
      ← select a topic to inspect
    </div>
  )

  return (
    <div>
      <SectionHeader title={`MESSAGES — ${topic}`} subtitle={`${subs.length} subscriber${subs.length !== 1 ? 's' : ''}`} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 20 }}>
        <StatCard label="PENDING"   value={pending}   color="var(--yellow)" pulse={pending > 0} />
        <StatCard label="DELIVERED" value={delivered} color="var(--green)" />
        <StatCard label="FAILED"    value={failed}    color="var(--red)" />
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['ID', 'SUBSCRIBER', 'STATUS', 'RETRIES', 'PAYLOAD', 'TIME'].map(h => (
                <th key={h} style={{
                  textAlign: 'left', padding: '8px 12px',
                  color: 'var(--text-dim)', fontSize: 10,
                  letterSpacing: '0.1em', fontWeight: 500
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {messages.map((m, i) => (
              <tr key={m.id} style={{
                borderBottom: '1px solid var(--border)',
                background: i % 2 === 0 ? 'transparent' : 'var(--bg2)',
                animation: `fadeIn 0.3s ease ${i * 0.03}s both`
              }}>
                <td style={{ padding: '9px 12px', color: 'var(--text-dim)' }}>#{m.id}</td>
                <td style={{ padding: '9px 12px' }}>{m.subscriber_name}</td>
                <td style={{ padding: '9px 12px' }}><Badge status={m.status} /></td>
                <td style={{ padding: '9px 12px', color: m.retry_count > 0 ? 'var(--yellow)' : 'var(--text-dim)' }}>
                  {m.retry_count}
                </td>
                <td style={{ padding: '9px 12px', color: 'var(--text-dim)', maxWidth: 260 }}>
                  <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.payload}
                  </span>
                </td>
                <td style={{ padding: '9px 12px', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                  {m.created_at}
                </td>
              </tr>
            ))}
            {messages.length === 0 && (
              <tr><td colSpan={6} style={{ padding: '30px', textAlign: 'center', color: 'var(--text-dim)' }}>
                no messages yet
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── DLQ panel ─────────────────────────────────────────────────────────────────
function DLQPanel() {
  const qc = useQueryClient()
  const { data: dlq = [] } = useQuery({ queryKey: ['dlq'], queryFn: () => get('/dlq') })
  const retry = useMutation({
    mutationFn: (id) => post(`/dlq/${id}/retry`, {}),
    onSuccess: () => { qc.invalidateQueries(['dlq']); qc.invalidateQueries(['messages']) }
  })

  return (
    <div>
      <SectionHeader
        title="DEAD LETTER QUEUE"
        subtitle={dlq.length > 0 ? `${dlq.length} failed message${dlq.length !== 1 ? 's' : ''} awaiting inspection` : 'no failures'}
      />
      {dlq.length === 0 ? (
        <div style={{
          border: '1px solid var(--border)', borderRadius: 6,
          padding: '40px', textAlign: 'center', color: 'var(--green)',
          background: 'var(--green-dim)'
        }}>
          ✓ all clear — no failed messages
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {dlq.map(m => (
            <div key={m.id} style={{
              background: 'var(--bg2)', border: '1px solid var(--red)',
              borderLeft: '3px solid var(--red)', borderRadius: 6,
              padding: '14px 16px',
              display: 'grid', gridTemplateColumns: '1fr 1fr auto',
              gap: 16, alignItems: 'center',
              animation: 'fadeIn 0.3s ease forwards'
            }}>
              <div>
                <div style={{ color: 'var(--text-dim)', fontSize: 10, marginBottom: 4 }}>
                  #{m.id} · {m.topic_name}
                </div>
                <div style={{ color: 'var(--text)' }}>{m.subscriber_name}</div>
                <div style={{ color: 'var(--text-dim)', fontSize: 11, marginTop: 2 }}>{m.url}</div>
              </div>
              <div style={{ color: 'var(--text-dim)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {m.payload}
              </div>
              <button
                onClick={() => retry.mutate(m.id)}
                style={{
                  background: 'var(--red-dim)', border: '1px solid var(--red)',
                  color: 'var(--red)', borderRadius: 4, padding: '6px 14px',
                  cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 11,
                  whiteSpace: 'nowrap'
                }}>↺ RETRY</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Publish panel ─────────────────────────────────────────────────────────────
function PublishPanel() {
  const qc = useQueryClient()
  const { data: topics = [] } = useQuery({ queryKey: ['topics'], queryFn: () => get('/topics') })
  const [topic, setTopic] = useState('')
  const [payload, setPayload] = useState('{\n  "student_id": "S001",\n  "exam": "DSA Final",\n  "score": 87\n}')
  const [result, setResult] = useState(null)

  const publish = useMutation({
    mutationFn: () => {
      const parsed = JSON.parse(payload)
      return post('/publish', { topic_name: topic, payload: parsed })
    },
    onSuccess: (data) => {
      setResult(data)
      qc.invalidateQueries(['messages'])
      qc.invalidateQueries(['dlq'])
    },
    onError: () => setResult({ error: 'invalid JSON or topic not found' })
  })

  return (
    <div>
      <SectionHeader title="PUBLISH EVENT" subtitle="fire an event to a topic" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <select
          value={topic}
          onChange={e => setTopic(e.target.value)}
          style={{
            background: 'var(--bg3)', border: '1px solid var(--border)',
            borderRadius: 4, padding: '8px 12px', color: 'var(--text)',
            fontFamily: 'var(--mono)', fontSize: 12, outline: 'none'
          }}>
          <option value="">— select topic —</option>
          {topics.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
        </select>
        <textarea
          value={payload}
          onChange={e => setPayload(e.target.value)}
          rows={5}
          style={{
            background: 'var(--bg3)', border: '1px solid var(--border)',
            borderRadius: 4, padding: '10px 12px', color: 'var(--cyan)',
            fontFamily: 'var(--mono)', fontSize: 12, outline: 'none',
            resize: 'vertical'
          }} />
        <button
          onClick={() => topic && publish.mutate()}
          style={{
            background: topic ? 'var(--cyan-dim)' : 'var(--bg3)',
            border: `1px solid ${topic ? 'var(--cyan)' : 'var(--border)'}`,
            color: topic ? 'var(--cyan)' : 'var(--text-dim)',
            borderRadius: 4, padding: '10px',
            cursor: topic ? 'pointer' : 'not-allowed',
            fontFamily: 'var(--mono)', fontSize: 12, letterSpacing: '0.08em'
          }}>PUBLISH →</button>
        {result && (
          <div style={{
            background: result.error ? 'var(--red-dim)' : 'var(--green-dim)',
            border: `1px solid ${result.error ? 'var(--red)' : 'var(--green)'}`,
            borderRadius: 4, padding: '10px 12px',
            color: result.error ? 'var(--red)' : 'var(--green)',
            fontSize: 12
          }}>
            {result.error || `✓ ${result.message} (queued for ${result.queued_for})`}
          </div>
        )}
      </div>
    </div>
  )
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [selectedTopic, setSelectedTopic] = useState(null)
  const [tab, setTab] = useState('messages')

  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: () => get('/health'),
    retry: false
  })

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>

      {/* Header */}
      <header style={{
        borderBottom: '1px solid var(--border)',
        padding: '0 32px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        height: 52, position: 'sticky', top: 0,
        background: 'var(--bg)', zIndex: 10
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            border: '2px solid var(--cyan)',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              background: 'var(--cyan)',
              animation: 'pulse 2s infinite'
            }} />
          </div>
          <span style={{ fontWeight: 600, fontSize: 15, letterSpacing: '0.15em', color: 'var(--cyan)' }}>
            AXON
          </span>
          <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>
            event delivery engine
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 7, height: 7, borderRadius: '50%',
            background: health ? 'var(--green)' : 'var(--red)',
            animation: health ? 'pulse 2s infinite' : 'none'
          }} />
          <span style={{ fontSize: 11, color: health ? 'var(--green)' : 'var(--red)' }}>
            {health ? 'CONNECTED' : 'OFFLINE'}
          </span>
        </div>
      </header>

      {/* Body */}
      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', minHeight: 'calc(100vh - 52px)' }}>

        {/* Sidebar */}
        <aside style={{
          borderRight: '1px solid var(--border)',
          padding: '24px 20px',
          display: 'flex', flexDirection: 'column', gap: 32
        }}>
          <TopicsPanel onSelect={setSelectedTopic} selected={selectedTopic} />
          <PublishPanel />
        </aside>

        {/* Main content */}
        <main style={{ padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: 32 }}>

          {/* Tab nav */}
          <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)' }}>
            {[['messages', 'MESSAGES'], ['dlq', 'DEAD LETTER QUEUE']].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                style={{
                  background: 'none', border: 'none',
                  borderBottom: tab === key ? '2px solid var(--cyan)' : '2px solid transparent',
                  color: tab === key ? 'var(--cyan)' : 'var(--text-dim)',
                  padding: '8px 20px', cursor: 'pointer',
                  fontFamily: 'var(--mono)', fontSize: 11,
                  letterSpacing: '0.1em', marginBottom: -1
                }}>{label}</button>
            ))}
          </div>

          {tab === 'messages' && <MessagesTable topic={selectedTopic} />}
          {tab === 'dlq' && <DLQPanel />}
        </main>
      </div>
    </div>
  )
}
