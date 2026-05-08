'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { EvaluateResponseBody, SecureGateResponseType, AuthRequest } from '@/lib/types';
import styles from './Dashboard.module.css';

// ─── Preset Scenarios ─────────────────────────────────────────────────────────
// Built as a function to avoid hydration mismatch — Date.now() at module scope
// produces different values on server vs client.

function buildPresets() {
  const now = Date.now();
  return [
    {
      id: 'trusted',
      label: 'Trusted Session',
      description: 'Known device, within active hours, same city.',
      request: {
        ip: '192.168.1.100',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0',
        location: { label: 'New York, US', lat: 40.7128, lon: -74.006, countryCode: 'US' },
        timestamp: new Date(now - 30 * 60 * 1000).toISOString(),
        userBaseline: {
          lastLoginLocation: { label: 'New York, US', lat: 40.7128, lon: -74.006, countryCode: 'US' },
          lastLoginTimestamp: new Date(now - 8 * 3600 * 1000).toISOString(),
          typicalActiveHoursUTC: [12, 22] as [number, number],
          knownUserAgents: ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0'],
        },
      } satisfies AuthRequest,
    },
    {
      id: 'cross-country',
      label: 'Cross-Country Jump',
      description: 'Login from London after a recent New York session.',
      request: {
        ip: '84.39.112.6',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) Safari/605.1 Chrome/124.0',
        location: { label: 'London, UK', lat: 51.5074, lon: -0.1278, countryCode: 'GB' },
        timestamp: new Date(now - 2 * 3600 * 1000).toISOString(),
        userBaseline: {
          lastLoginLocation: { label: 'New York, US', lat: 40.7128, lon: -74.006, countryCode: 'US' },
          lastLoginTimestamp: new Date(now - 3 * 3600 * 1000).toISOString(),
          typicalActiveHoursUTC: [12, 22] as [number, number],
          knownUserAgents: ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0'],
        },
      } satisfies AuthRequest,
    },
    {
      id: 'impossible',
      label: 'Impossible Velocity',
      description: 'Tokyo to London in 30 minutes — physically impossible.',
      request: {
        ip: '185.220.101.45',
        userAgent: 'Mozilla/5.0 HeadlessChrome/124 Safari/537.36',
        location: { label: 'London, UK', lat: 51.5074, lon: -0.1278, countryCode: 'GB' },
        timestamp: new Date(now - 30 * 60 * 1000).toISOString(),
        userBaseline: {
          lastLoginLocation: { label: 'Tokyo, JP', lat: 35.6895, lon: 139.6917, countryCode: 'JP' },
          lastLoginTimestamp: new Date(now - 60 * 60 * 1000).toISOString(),
          typicalActiveHoursUTC: [12, 22] as [number, number],
          knownUserAgents: ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0'],
        },
      } satisfies AuthRequest,
    },
    {
      id: 'bot',
      label: 'Automation Attack',
      description: 'python-requests bot with no user baseline.',
      request: {
        ip: '0.0.0.0',
        userAgent: 'python-requests/2.28.0',
        location: { label: 'Unknown', lat: 0, lon: 0, countryCode: '' },
        timestamp: new Date(now).toISOString(),
      } satisfies AuthRequest,
    },
    {
      id: 'custom',
      label: 'Custom Request',
      description: 'Manually test a specific IP, User-Agent, and Location.',
      request: {
        ip: '127.0.0.1',
        userAgent: 'Mozilla/5.0 (Custom Request)',
        location: { label: 'Localhost', lat: 0, lon: 0, countryCode: 'US' },
        timestamp: new Date(now).toISOString(),
      } satisfies AuthRequest,
    },
  ];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getActionStyle(action: string) {
  if (action === 'ALLOW') return styles.allow;
  if (action === 'CHALLENGE') return styles.challenge;
  return styles.block;
}

function getScoreColor(score: number) {
  if (score <= 0.3) return '#4caf50';
  if (score <= 0.6) return '#ffc107';
  return '#f44336';
}

function formatTs(iso: string) {
  try {
    const d = new Date(iso);
    // Use UTC to avoid server/client locale mismatch
    return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  } catch { return iso; }
}

// ─── AuditEntry ───────────────────────────────────────────────────────────────

interface AuditEntry {
  id: string;
  ts: string;
  presetLabel: string;
  result: SecureGateResponseType;
  durationMs: number;
}

// ─── ScoreBar ────────────────────────────────────────────────────────────────

function ScoreBar({ score, label }: { score: number; label: string }) {
  const pct = (score * 100).toFixed(1);
  const color = getScoreColor(score);
  return (
    <div className={styles.scoreBarWrap}>
      <div className={styles.scoreBarHeader}>
        <span className={styles.scoreBarLabel}>{label}</span>
        <span className={styles.scoreBarValue} style={{ color }}>{score.toFixed(3)}</span>
      </div>
      <div className={styles.scoreBarTrack}>
        <div
          className={styles.scoreBarFill}
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const PRESETS = useMemo(() => buildPresets(), []);
  const [activePreset, setActivePreset] = useState(() => buildPresets()[0]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<EvaluateResponseBody | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [evalCount, setEvalCount] = useState(0);
  const resultRef = useRef<HTMLDivElement>(null);

  const evaluate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: activePreset.request, scenario: activePreset.label }),
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data: EvaluateResponseBody = await res.json();
      setResult(data);
      setEvalCount(c => c + 1);
      setAuditLog(prev => [
        {
          id: crypto.randomUUID(),
          ts: new Date().toISOString(),
          presetLabel: activePreset.label,
          result: data.result,
          durationMs: data.durationMs,
        },
        ...prev.slice(0, 19),
      ]);
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [activePreset]);

  // Run initial evaluation on mount
  useEffect(() => {
    fetch('/api/evaluations')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setAuditLog(data.map((d: any) => ({
            id: d.id,
            ts: d.ts,
            presetLabel: d.scenario,
            result: { action: d.action, riskScore: d.riskScore } as any,
            durationMs: d.durationMs,
          })));
        }
      })
      .catch(console.error);
    evaluate();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={styles.root}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.headerBrand}>
            <span className={styles.headerIcon}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" strokeLinejoin="miter" aria-hidden>
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </span>
            <div>
              <h1 className={styles.headerTitle}>Secure-Gate</h1>
              <p className={styles.headerSubtitle}>Control Plane · AI Risk Engine</p>
            </div>
          </div>
          <div className={styles.headerStats}>
            <div className={styles.stat}>
              <span className={styles.statValue}>{evalCount}</span>
              <span className={styles.statLabel}>Evaluations</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>{auditLog.filter(a => a.result.action === 'BLOCK').length}</span>
              <span className={styles.statLabel}>Blocked</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>{auditLog.filter(a => a.result.action === 'CHALLENGE').length}</span>
              <span className={styles.statLabel}>Challenged</span>
            </div>
            <div className={styles.statusDot} title="Engine Online">
              <span className={styles.statusPulse} />
              <span className={styles.statusText}>Online</span>
            </div>
          </div>
        </div>
      </header>

      {/* ── Main Grid ───────────────────────────────────────────────────────── */}
      <main className={styles.main}>
        <div className={styles.grid}>

          {/* ── LEFT: Configuration Panel ──────────────────────────────────── */}
          <section className={styles.panel} aria-label="Configuration">
            <div className={styles.panelHeader}>
              <span className={styles.panelIcon}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" strokeLinejoin="miter" aria-hidden>
                  <circle cx="12" cy="12" r="3" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14" />
                </svg>
              </span>
              <h2 className={styles.panelTitle}>Attack Scenarios</h2>
            </div>

            <div className={styles.presetList}>
              {PRESETS.map(p => (
                <button
                  key={p.id}
                  id={`preset-${p.id}`}
                  className={`${styles.presetBtn} ${activePreset.id === p.id ? styles.presetActive : ''}`}
                  onClick={() => { setActivePreset(p); setResult(null); }}
                >
                  <span className={styles.presetLabel}>{p.label}</span>
                  <span className={styles.presetDesc}>{p.description}</span>
                </button>
              ))}
            </div>

            {/* Request Preview */}
            <div className={styles.previewBlock}>
              <p className={styles.previewTitle}>Request Context</p>
              <div className={styles.previewGrid}>
                <span className={styles.previewKey}>IP</span>
                {activePreset.id === 'custom' ? (
                  <input className={styles.customInput} value={activePreset.request.ip} onChange={e => setActivePreset(p => ({ ...p, request: { ...p.request, ip: e.target.value } as any }))} />
                ) : (
                  <span className={styles.previewVal}>{activePreset.request.ip}</span>
                )}

                <span className={styles.previewKey}>Location</span>
                {activePreset.id === 'custom' ? (
                  <input className={styles.customInput} value={activePreset.request.location.label} onChange={e => setActivePreset(p => ({ ...p, request: { ...p.request, location: { ...p.request.location, label: e.target.value } } as any }))} />
                ) : (
                  <span className={styles.previewVal}>{activePreset.request.location.label}</span>
                )}

                <span className={styles.previewKey}>Timestamp</span>
                <span className={styles.previewVal}>{formatTs(activePreset.request.timestamp)}</span>

                <span className={styles.previewKey}>User-Agent</span>
                {activePreset.id === 'custom' ? (
                  <input className={styles.customInput} value={activePreset.request.userAgent} onChange={e => setActivePreset(p => ({ ...p, request: { ...p.request, userAgent: e.target.value } as any }))} />
                ) : (
                  <span className={`${styles.previewVal} ${styles.previewUa}`}>{activePreset.request.userAgent}</span>
                )}
                <span className={styles.previewKey}>Baseline</span>
                <span className={styles.previewVal}>
                  {activePreset.request.userBaseline
                    ? `Last: ${activePreset.request.userBaseline.lastLoginLocation.label}`
                    : 'None (first login)'}
                </span>
              </div>
            </div>

            <button
              id="evaluate-btn"
              className={styles.evaluateBtn}
              onClick={evaluate}
              disabled={loading}
              aria-busy={loading}
            >
              {loading ? (
                <><span className={styles.spinner} aria-hidden /> Analyzing…</>
              ) : (
                <>▸ Run Evaluation</>
              )}
            </button>
          </section>

          {/* ── CENTER: Live Result ─────────────────────────────────────────── */}
          <section className={styles.panel} ref={resultRef} aria-label="Evaluation Result">
            <div className={styles.panelHeader}>
              <span className={styles.panelIcon}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" strokeLinejoin="miter" aria-hidden>
                  <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
                </svg>
              </span>
              <h2 className={styles.panelTitle}>Real-Time Evaluation</h2>
            </div>

            {error && (
              <div className={styles.errorBox} role="alert">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" strokeLinejoin="miter" aria-hidden>
                  <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                {error}
              </div>
            )}

            {loading && !result && (
              <div className={styles.loadingState}>
                <div className={styles.loadingSpinner} aria-hidden />
                <p>Running Behavioral Analysis…</p>
              </div>
            )}

            {result && (
              <div className={styles.resultArea} style={{ animation: 'slide-in-up 350ms ease both' }}>
                {/* Big Action Badge */}
                <div className={`${styles.actionBadge} ${getActionStyle(result.result.action)}`}>
                  <span className={styles.actionIcon}>
                    {result.result.action === 'ALLOW' ? '■' : result.result.action === 'CHALLENGE' ? '▲' : '✕'}
                  </span>
                  <span className={styles.actionLabel}>{result.result.action}</span>
                  <span className={styles.actionDuration}>{result.durationMs}ms</span>
                </div>

                {/* Aggregate Score */}
                <div className={styles.aggregateWrap}>
                  <span className={styles.aggregateLabel}>Aggregate Risk Score</span>
                  <span
                    className={`${styles.aggregateScore} mono`}
                    style={{ color: getScoreColor(result.result.riskScore) }}
                  >
                    {result.result.riskScore.toFixed(4)}
                  </span>
                </div>

                {/* Signal Bars */}
                <div className={styles.signals}>
                  {result.result.signals.map(s => (
                    <ScoreBar
                      key={s.dimension}
                      label={s.dimension.replace(/([A-Z])/g, ' $1').trim()}
                      score={s.score}
                    />
                  ))}
                </div>

                {/* Reasoning Inspector */}
                <details className={styles.reasoningDetails}>
                  <summary className={styles.reasoningSummary}>
                    <span>Dimension Findings</span>
                    <span className={styles.expandHint}>click to expand</span>
                  </summary>
                  <div className={styles.reasoningBody}>
                    {result.result.signals.map(s => (
                      <div key={s.dimension} className={styles.findingCard}>
                        <div className={styles.findingHeader}>
                          <span className={styles.findingDim}>{s.dimension}</span>
                          <span className={`${styles.findingScore} mono`} style={{ color: getScoreColor(s.score) }}>
                            {s.score.toFixed(3)}
                          </span>
                        </div>
                        <p className={styles.findingText}>{s.finding}</p>
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            )}

            {!result && !loading && !error && (
              <div className={styles.emptyState}>
                <svg className={styles.emptyIcon} width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" strokeLinejoin="miter" aria-hidden>
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
                <p>Select a scenario and run an evaluation.</p>
              </div>
            )}
          </section>

          {/* ── RIGHT: Audit Log ────────────────────────────────────────────── */}
          <section className={styles.panel} aria-label="Audit Log">
            <div className={styles.panelHeader}>
              <span className={styles.panelIcon}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" strokeLinejoin="miter" aria-hidden>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" />
                </svg>
              </span>
              <h2 className={styles.panelTitle}>Audit Log</h2>
              <span className={styles.logCount}>{auditLog.length}</span>
            </div>

            {auditLog.length === 0 ? (
              <p className={styles.emptyLog}>No evaluations recorded.</p>
            ) : (
              <ul className={styles.logList} role="list">
                {auditLog.map(entry => (
                  <li key={entry.id} className={styles.logEntry}>
                    <div className={styles.logEntryTop}>
                      <span className={`${styles.logBadge} ${getActionStyle(entry.result.action)}`}>
                        {entry.result.action}
                      </span>
                      <span className={`${styles.logScore} mono`} style={{ color: getScoreColor(entry.result.riskScore) }}>
                        {entry.result.riskScore.toFixed(4)}
                      </span>
                      <span className={styles.logDuration}>{entry.durationMs}ms</span>
                    </div>
                    <p className={styles.logScenario}>{entry.presetLabel}</p>
                    <time className={styles.logTime} dateTime={entry.ts}>{formatTs(entry.ts)}</time>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer className={styles.footer}>
        <span>Secure-Gate Control Plane · IS322 Enterprise AI Security</span>
        <span className={styles.footerTag}>Zero Trust · TDD-Verified · Vercel AI SDK</span>
      </footer>
    </div>
  );
}
