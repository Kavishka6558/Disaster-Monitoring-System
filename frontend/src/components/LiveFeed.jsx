import { useEffect, useRef } from 'react'

function formatTime(dateStr) {
    const d = new Date(dateStr)
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

function formatDate(dateStr) {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const LANG_FLAG = { en: '🇬🇧', si: '🇱🇰', ta: '🇱🇰', unknown: '🌐' }
const LANG_LABEL = { en: 'EN', si: 'SI', ta: 'TA', unknown: '?' }

const SENTIMENT_CONFIG = {
    Positive: { emoji: '😊', color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
    Negative: { emoji: '😰', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
    Neutral: { emoji: '😐', color: '#94a3b8', bg: 'rgba(148,163,184,0.12)' },
}

/**
 * Renders a single media item — photo, video, or GIF.
 * Falls back gracefully if the URL fails to load.
 */
function MediaItem({ media, index }) {
    if (media.type === 'video') {
        return (
            <video
                key={index}
                src={media.url}
                poster={media.thumbnailUrl}
                controls
                muted
                playsInline
                className="rounded-lg flex-shrink-0 object-cover"
                style={{ height: '120px', width: '180px', background: '#000' }}
                onError={(e) => (e.target.style.display = 'none')}
            />
        )
    }

    // photo or gif
    return (
        <img
            key={index}
            src={media.thumbnailUrl || media.url}
            alt={media.type === 'gif' ? 'GIF' : 'photo'}
            className="rounded-lg flex-shrink-0 object-cover"
            style={{ height: '100px', width: '150px' }}
            onError={(e) => (e.target.style.display = 'none')}
        />
    )
}

export default function LiveFeed({ tweets, connected }) {
    const feedRef = useRef(null)

    // Auto-scroll to top when new tweet arrives
    useEffect(() => {
        if (feedRef.current) {
            feedRef.current.scrollTop = 0
        }
    }, [tweets.length])

    return (
        <div className="glass-card flex flex-col" style={{ height: '640px' }}>
            {/* Header */}
            <div
                className="flex items-center justify-between px-5 py-3.5 flex-shrink-0"
                style={{ borderBottom: '1px solid var(--border)' }}
            >
                <div className="flex items-center gap-2.5">
                    <div
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-sm"
                        style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)' }}
                    >
                        📡
                    </div>
                    <div>
                        <h2 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                            Live Disaster Feed
                        </h2>
                        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{tweets.length} posts</p>
                    </div>
                </div>
                <div className="flex items-center gap-1.5">
                    <div
                        className={`w-2 h-2 rounded-full ${connected ? 'pulse-green' : ''}`}
                        style={{
                            background: connected ? '#10b981' : '#f43f5e',
                        }}
                    />
                    <span
                        className="text-xs font-semibold"
                        style={{ color: connected ? '#10b981' : '#f43f5e' }}
                    >
                        {connected ? 'Live' : 'Offline'}
                    </span>
                </div>
            </div>

            {/* Feed list */}
            <div ref={feedRef} className="flex-1 overflow-y-auto p-3 space-y-3">
                {tweets.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full gap-3" style={{ color: 'var(--text-secondary)' }}>
                        <div
                            className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl"
                            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}
                        >
                            🔍
                        </div>
                        <div className="text-center">
                            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Waiting for reports</p>
                            <p className="text-xs mt-1">Posts will appear here in real-time</p>
                        </div>
                    </div>
                ) : (
                    tweets.map((tweet, i) => {
                        const isHigh = tweet.emergencyLevel === 'High'
                        const sentiment = tweet.sentiment || 'Neutral'
                        const sentCfg = SENTIMENT_CONFIG[sentiment] || SENTIMENT_CONFIG.Neutral

                        return (
                            <div
                                key={tweet.tweetId || tweet._id || i}
                                className={`rounded-xl p-4 transition-all duration-200 fade-in ${isHigh ? 'feed-card-high' : 'feed-card-medium'}`}
                                style={{
                                    background: isHigh
                                        ? 'rgba(244,63,94,0.04)'
                                        : 'rgba(255,255,255,0.025)',
                                    border: `1px solid ${isHigh ? 'rgba(244,63,94,0.18)' : 'var(--border)'}`,
                                    animationDelay: `${i * 0.03}s`,
                                }}
                            >
                                {/* Top row: author + badges */}
                                <div className="flex items-start justify-between gap-2 mb-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                        {tweet.author?.profileImageUrl ? (
                                            <img
                                                src={tweet.author.profileImageUrl}
                                                alt={tweet.author.username}
                                                className="w-7 h-7 rounded-full flex-shrink-0"
                                                onError={(e) => (e.target.style.display = 'none')}
                                            />
                                        ) : (
                                            <div
                                                className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold"
                                                style={{
                                                    background: isHigh ? 'rgba(244,63,94,0.15)' : 'rgba(59,130,246,0.12)',
                                                    border: `1px solid ${isHigh ? 'rgba(244,63,94,0.3)' : 'rgba(59,130,246,0.2)'}`,
                                                    color: isHigh ? '#f43f5e' : '#60a5fa',
                                                }}
                                            >
                                                {tweet.author?.username?.[0]?.toUpperCase() || '?'}
                                            </div>
                                        )}
                                        <div className="min-w-0">
                                            <span className="text-xs font-semibold truncate block" style={{ color: 'var(--text-primary)' }}>
                                                @{tweet.author?.username || 'unknown'}
                                                {tweet.author?.verified && (
                                                    <span className="ml-1" style={{ color: '#60a5fa' }}>✓</span>
                                                )}
                                            </span>
                                            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                                                {formatDate(tweet.createdAt)} · {formatTime(tweet.createdAt)}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
                                        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                                            {LANG_FLAG[tweet.language] || '🌐'} {LANG_LABEL[tweet.language] || '?'}
                                        </span>
                                        <span className={isHigh ? 'badge-high' : 'badge-neutral'}>
                                            {isHigh ? '🚨 High' : '⚠️ Medium'}
                                        </span>
                                        {/* Sentiment badge */}
                                        <span
                                            className="text-xs px-2 py-0.5 rounded-full font-medium"
                                            style={{
                                                color: sentCfg.color,
                                                background: sentCfg.bg,
                                            }}
                                        >
                                            {sentCfg.emoji} {sentiment}
                                        </span>
                                    </div>
                                </div>

                                {/* Tweet text */}
                                <p className="text-sm leading-relaxed mb-2" style={{ color: 'var(--text-primary)' }}>
                                    {tweet.text}
                                </p>

                                {/* Media: photos, videos, GIFs */}
                                {tweet.mediaUrls?.length > 0 && (
                                    <div className="flex gap-2 mb-2 overflow-x-auto pb-1">
                                        {tweet.mediaUrls.slice(0, 4).map((media, mi) => (
                                            <MediaItem key={mi} media={media} index={mi} />
                                        ))}
                                        {tweet.mediaUrls.length > 4 && (
                                            <div
                                                className="rounded-lg flex-shrink-0 flex items-center justify-center text-xs font-semibold"
                                                style={{
                                                    height: '100px',
                                                    width: '80px',
                                                    background: 'rgba(255,255,255,0.05)',
                                                    color: 'var(--text-secondary)',
                                                }}
                                            >
                                                +{tweet.mediaUrls.length - 4} more
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Bottom row: metadata */}
                                <div
                                    className="flex items-center justify-between pt-2 mt-2"
                                    style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
                                >
                                    <div className="flex items-center gap-2 text-xs flex-wrap" style={{ color: 'var(--text-secondary)' }}>
                                        {tweet.location?.district && (
                                            <span className="flex items-center gap-1">
                                                <span style={{ opacity: 0.7 }}>📍</span> {tweet.location.district}
                                            </span>
                                        )}
                                        <span
                                            className="px-1.5 py-0.5 rounded"
                                            style={{ background: 'rgba(59,130,246,0.08)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.15)' }}
                                        >
                                            🎯 {((tweet.confidence || 0) * 100).toFixed(0)}%
                                        </span>
                                        <span
                                            title="Similarity score"
                                            className="px-1.5 py-0.5 rounded"
                                            style={{
                                                background: (tweet.similarityScore || 0) >= 0.5
                                                    ? 'rgba(16,185,129,0.08)' : 'rgba(255,255,255,0.04)',
                                                color: (tweet.similarityScore || 0) >= 0.5
                                                    ? '#10b981'
                                                    : (tweet.similarityScore || 0) >= 0.25
                                                        ? '#f59e0b'
                                                        : 'var(--text-secondary)',
                                                border: `1px solid ${(tweet.similarityScore || 0) >= 0.5 ? 'rgba(16,185,129,0.18)' : 'var(--border)'}`,
                                            }}
                                        >
                                            🔗 {((tweet.similarityScore || 0) * 100).toFixed(0)}%
                                        </span>
                                        {(tweet.similarityScore || 0) >= 0.5 && (
                                            <span
                                                className="px-1.5 py-0.5 rounded font-semibold"
                                                style={{
                                                    background: 'rgba(16,185,129,0.08)',
                                                    color: '#10b981',
                                                    border: '1px solid rgba(16,185,129,0.18)',
                                                }}
                                            >
                                                ✓ Verified
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {tweet.isNudeFiltered && (
                                            <span className="text-xs" style={{ color: '#f59e0b' }}>🔞 Filtered</span>
                                        )}
                                        {tweet.isFiltered && !tweet.isNudeFiltered && (
                                            <span className="text-xs" style={{ color: '#f43f5e' }}>🚫 Filtered</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )
                    })
                )}
            </div>
        </div>
    )
}
