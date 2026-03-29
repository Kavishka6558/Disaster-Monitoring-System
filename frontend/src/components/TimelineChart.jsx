/**
 * TimelineChart — Monthly disaster activity over past 6 months
 * Shows High (red) vs Neutral/Medium (blue) tweet counts per month
 */
import { useMemo } from 'react'

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default function TimelineChart({ timeline = [], onImport, onClear, importing, clearing }) {
    const bars = useMemo(() => {
        if (!timeline || timeline.length === 0) return []
        const maxTotal = Math.max(...timeline.map((t) => t.total), 1)
        return timeline.map((t) => ({
            label: `${MONTH_NAMES[t._id.month - 1]} ${t._id.year}`,
            total: t.total,
            high: t.high,
            neutral: t.neutral,
            verified: t.verified,
            highPct: (t.high / maxTotal) * 100,
            neutralPct: (t.neutral / maxTotal) * 100,
        }))
    }, [timeline])

    return (
        <div className="glass-card p-5">
            {/* Header row */}
            <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
                <div>
                    <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                        📈 Disaster Activity — Last 6 Months
                    </h3>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                        {timeline.length > 0
                            ? `${timeline.reduce((s, t) => s + t.total, 0)} posts · Aug 2024 – Feb 2025`
                            : 'No historical data yet — click Import below'}
                    </p>
                </div>

                {/* Import controls */}
                <div className="flex items-center gap-2">
                    <button
                        onClick={onClear}
                        disabled={clearing || importing}
                        title="Clear all tweets from database"
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200"
                        style={{
                            background: 'rgba(239,68,68,0.1)',
                            border: '1px solid rgba(239,68,68,0.3)',
                            color: '#ef4444',
                            cursor: clearing || importing ? 'not-allowed' : 'pointer',
                            opacity: clearing || importing ? 0.6 : 1,
                        }}
                    >
                        {clearing ? '⏳ Clearing…' : '🗑️ Clear DB'}
                    </button>

                    <button
                        onClick={onImport}
                        disabled={importing || clearing}
                        title="Import 120 historical tweets (Aug 2024–Feb 2025) through the real AI pipeline"
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200"
                        style={{
                            background: importing ? 'rgba(59,130,246,0.2)' : 'rgba(59,130,246,0.15)',
                            border: '1px solid rgba(59,130,246,0.4)',
                            color: '#3b82f6',
                            cursor: importing || clearing ? 'not-allowed' : 'pointer',
                            opacity: importing || clearing ? 0.7 : 1,
                        }}
                    >
                        {importing ? '⏳ Importing…' : '📥 Import Historical Data'}
                    </button>
                </div>
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 mb-4 text-xs" style={{ color: 'var(--text-secondary)' }}>
                <span className="flex items-center gap-1">
                    <span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#ef4444' }} />
                    High Emergency
                </span>
                <span className="flex items-center gap-1">
                    <span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#3b82f6' }} />
                    Neutral/Medium
                </span>
            </div>

            {/* Bars */}
            {bars.length > 0 ? (
                <div className="flex items-end gap-2" style={{ height: '160px' }}>
                    {bars.map((bar) => (
                        <div key={bar.label} className="flex-1 flex flex-col items-center gap-1">
                            {/* Stacked bar */}
                            <div
                                className="w-full flex flex-col justify-end rounded-t-md overflow-hidden transition-all duration-700"
                                style={{ height: '130px', background: 'rgba(255,255,255,0.04)' }}
                                title={`${bar.label}: ${bar.total} total (${bar.high} high, ${bar.neutral} neutral)`}
                            >
                                {bar.high > 0 && (
                                    <div
                                        style={{
                                            height: `${bar.highPct}%`,
                                            background: 'linear-gradient(180deg, #ef4444, #dc2626)',
                                            minHeight: bar.high > 0 ? '4px' : '0',
                                        }}
                                    />
                                )}
                                {bar.neutral > 0 && (
                                    <div
                                        style={{
                                            height: `${bar.neutralPct}%`,
                                            background: 'linear-gradient(180deg, #3b82f6, #2563eb)',
                                            minHeight: bar.neutral > 0 ? '4px' : '0',
                                        }}
                                    />
                                )}
                            </div>
                            {/* Label */}
                            <div className="text-center">
                                <div className="text-xs font-semibold" style={{ color: 'var(--text-primary)', fontSize: '10px' }}>
                                    {bar.total}
                                </div>
                                <div style={{ color: 'var(--text-secondary)', fontSize: '9px' }}>{bar.label.split(' ')[0]}</div>
                                <div style={{ color: 'var(--text-secondary)', fontSize: '9px' }}>{bar.label.split(' ')[1]}</div>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                /* Empty state */
                <div
                    className="flex flex-col items-center justify-center rounded-xl"
                    style={{ height: '160px', background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.1)' }}
                >
                    <div className="text-3xl mb-2">📊</div>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>No data yet</p>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>
                        Click <strong style={{ color: '#3b82f6' }}>Import Historical Data</strong> to load 6 months of tweets
                    </p>
                </div>
            )}
        </div>
    )
}
