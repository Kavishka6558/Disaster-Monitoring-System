import { useState, useEffect, useCallback, useMemo } from 'react'
import { io } from 'socket.io-client'
import axios from 'axios'

import DisasterMap from './components/DisasterMap'
import LiveFeed from './components/LiveFeed'
import StatsCards from './components/StatsCards'
import TestTool from './components/TestTool'
import TimelineChart from './components/TimelineChart'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000'

const NAV_ITEMS = [
    { id: 'dashboard', icon: '🏠', label: 'Dashboard' },
    { id: 'map', icon: '🗺️', label: 'Live Map' },
    { id: 'feed', icon: '📡', label: 'Live Feed' },
    { id: 'test', icon: '🧪', label: 'Test Tool' },
]

export default function App() {
    const [activeTab, setActiveTab] = useState('dashboard')
    const [tweets, setTweets] = useState([])
    const [mapTweets, setMapTweets] = useState([])
    const [stats, setStats] = useState(null)
    const [connected, setConnected] = useState(false)
    const [lastUpdated, setLastUpdated] = useState(null)
    const [fetching, setFetching] = useState(false)
    const [timeline, setTimeline] = useState([])
    const [importing, setImporting] = useState(false)
    const [clearing, setClearing] = useState(false)

    // Search & filter state
    const [searchQuery, setSearchQuery] = useState('')
    const [filterLevel, setFilterLevel] = useState('all')      // all | High | Neutral/Medium
    const [filterLang, setFilterLang] = useState('all')        // all | en | si | ta
    const [filterVerified, setFilterVerified] = useState(false)
    const [filterDistrict, setFilterDistrict] = useState('all')

    // Derived: all unique districts present in current tweet list
    const districtOptions = useMemo(() => {
        const set = new Set(tweets.map(t => t.location?.district).filter(Boolean))
        return ['all', ...Array.from(set).sort()]
    }, [tweets])

    // Filtered tweets (client-side, instant)
    const filteredTweets = useMemo(() => {
        const q = searchQuery.trim().toLowerCase()
        return tweets.filter(t => {
            if (q && !t.text?.toLowerCase().includes(q) &&
                !t.author?.username?.toLowerCase().includes(q) &&
                !t.location?.district?.toLowerCase().includes(q)) return false
            if (filterLevel !== 'all' && t.emergencyLevel !== filterLevel) return false
            if (filterLang !== 'all' && t.language !== filterLang) return false
            if (filterVerified && !t.isVerified) return false
            if (filterDistrict !== 'all' && t.location?.district !== filterDistrict) return false
            return true
        })
    }, [tweets, searchQuery, filterLevel, filterLang, filterVerified, filterDistrict])

    const clearSearch = () => {
        setSearchQuery('')
        setFilterLevel('all')
        setFilterLang('all')
        setFilterVerified(false)
        setFilterDistrict('all')
    }

    // Fetch initial data
    const fetchData = useCallback(async () => {
        try {
            const [tweetsRes, statsRes, mapRes, timelineRes] = await Promise.all([
                axios.get(`${API_URL}/api/tweets?limit=50`),
                axios.get(`${API_URL}/api/stats`),
                axios.get(`${API_URL}/api/tweets/map`),
                axios.get(`${API_URL}/api/stats/timeline`),
            ])
            setTweets(tweetsRes.data.tweets || [])
            setStats(statsRes.data)
            setMapTweets(mapRes.data || [])
            setTimeline(timelineRes.data || [])
            setLastUpdated(new Date())
        } catch (err) {
            console.error('Failed to fetch data:', err.message)
        }
    }, [])

    // Socket.io connection
    useEffect(() => {
        fetchData()

        const socket = io(API_URL, { transports: ['websocket', 'polling'] })

        socket.on('connect', () => {
            setConnected(true)
            console.log('🔌 Socket connected')
        })

        socket.on('disconnect', () => {
            setConnected(false)
            console.log('🔌 Socket disconnected')
        })

        socket.on('new_tweet', (tweet) => {
            setTweets((prev) => [tweet, ...prev.slice(0, 99)])
            if (tweet.location?.coordinates?.lat) {
                setMapTweets((prev) => [tweet, ...prev.slice(0, 199)])
            }
            // Refresh stats
            axios.get(`${API_URL}/api/stats`).then((r) => setStats(r.data)).catch(() => { })
            setLastUpdated(new Date())
        })

        // Refresh data every 2 minutes
        const interval = setInterval(fetchData, 120000)

        return () => {
            socket.disconnect()
            clearInterval(interval)
        }
    }, [fetchData])

    const handleManualFetch = async () => {
        setFetching(true)
        try {
            await axios.post(`${API_URL}/api/fetch`)
            await fetchData()
        } catch (err) {
            console.error('Manual fetch failed:', err.message)
        } finally {
            setFetching(false)
        }
    }

    const handleImportHistorical = async () => {
        setImporting(true)
        try {
            await axios.post(`${API_URL}/api/import-historical`)
            await fetchData()
        } catch (err) {
            console.error('Import failed:', err.message)
        } finally {
            setImporting(false)
        }
    }

    const handleClearDB = async () => {
        if (!window.confirm('Clear ALL tweets from the database?')) return
        setClearing(true)
        try {
            await axios.delete(`${API_URL}/api/tweets`)
            await fetchData()
        } catch (err) {
            console.error('Clear failed:', err.message)
        } finally {
            setClearing(false)
        }
    }

    return (
        <div className="flex min-h-screen" style={{ background: 'var(--bg-primary)' }}>
            {/* ── Sidebar ─────────────────────────── */}
            <aside
                className="w-60 flex-shrink-0 flex flex-col"
                style={{
                    background: 'rgba(7, 10, 20, 0.96)',
                    backdropFilter: 'blur(20px)',
                    WebkitBackdropFilter: 'blur(20px)',
                    borderRight: '1px solid var(--border)',
                    position: 'sticky',
                    top: 0,
                    height: '100vh',
                }}
            >
                {/* Brand area */}
                <div
                    className="px-5 pt-6 pb-5"
                    style={{ borderBottom: '1px solid var(--border)' }}
                >
                    <div className="flex items-center gap-3">
                        <div
                            className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                            style={{
                                background: 'linear-gradient(135deg, rgba(59,130,246,0.25), rgba(167,139,250,0.2))',
                                border: '1px solid rgba(59,130,246,0.3)',
                                boxShadow: '0 0 20px rgba(59,130,246,0.15)',
                            }}
                        >
                            🌊
                        </div>
                        <div>
                            <h1
                                className="text-sm font-bold leading-tight gradient-text-blue"
                            >
                                DisasterWatch
                            </h1>
                            <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                                Sri Lanka · AI Monitor
                            </p>
                        </div>
                    </div>
                </div>

                {/* Nav */}
                <nav className="flex-1 px-3 py-4 space-y-0.5">
                    {NAV_ITEMS.map((item) => {
                        const isActive = activeTab === item.id
                        return (
                            <button
                                key={item.id}
                                onClick={() => setActiveTab(item.id)}
                                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${isActive ? 'nav-item-active' : ''}`}
                                style={{
                                    background: isActive
                                        ? 'linear-gradient(135deg, rgba(59,130,246,0.14), rgba(99,102,241,0.1))'
                                        : 'transparent',
                                    color: isActive ? '#60a5fa' : 'var(--text-secondary)',
                                    border: isActive ? '1px solid rgba(59,130,246,0.22)' : '1px solid transparent',
                                    cursor: 'pointer',
                                    textAlign: 'left',
                                }}
                                onMouseEnter={e => {
                                    if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
                                }}
                                onMouseLeave={e => {
                                    if (!isActive) e.currentTarget.style.background = 'transparent'
                                }}
                            >
                                <span className="text-base">{item.icon}</span>
                                <span>{item.label}</span>
                                {isActive && (
                                    <div
                                        className="ml-auto w-1.5 h-1.5 rounded-full"
                                        style={{ background: '#3b82f6', boxShadow: '0 0 6px #3b82f6' }}
                                    />
                                )}
                            </button>
                        )
                    })}
                </nav>

                {/* Status panel */}
                <div
                    className="mx-3 mb-4 p-3 rounded-2xl text-xs"
                    style={{
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid var(--border)',
                    }}
                >
                    <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)', letterSpacing: '0.08em', textTransform: 'uppercase', fontSize: '0.65rem' }}>
                        System Status
                    </p>
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <span style={{ color: 'var(--text-secondary)' }}>Connection</span>
                            <div className="flex items-center gap-1.5">
                                <div
                                    className={`w-1.5 h-1.5 rounded-full ${connected ? 'pulse-green' : ''}`}
                                    style={{ background: connected ? '#10b981' : '#f43f5e' }}
                                />
                                <span style={{ color: connected ? '#10b981' : '#f43f5e' }}>
                                    {connected ? 'Live' : 'Offline'}
                                </span>
                            </div>
                        </div>
                        <div className="flex items-center justify-between">
                            <span style={{ color: 'var(--text-secondary)' }}>Posts loaded</span>
                            <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{tweets.length}</span>
                        </div>
                        {lastUpdated && (
                            <div className="flex items-center justify-between">
                                <span style={{ color: 'var(--text-secondary)' }}>Updated</span>
                                <span style={{ color: 'var(--text-secondary)' }}>{lastUpdated.toLocaleTimeString()}</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Actions */}
                <div className="px-3 pb-5 space-y-2">
                    <button
                        onClick={handleManualFetch}
                        disabled={fetching}
                        className="w-full py-2 rounded-xl text-xs font-semibold transition-all duration-200"
                        style={{
                            background: fetching
                                ? 'rgba(59,130,246,0.08)'
                                : 'linear-gradient(135deg, rgba(59,130,246,0.18), rgba(99,102,241,0.14))',
                            border: '1px solid rgba(59,130,246,0.28)',
                            color: fetching ? 'var(--text-secondary)' : '#60a5fa',
                            cursor: fetching ? 'not-allowed' : 'pointer',
                            boxShadow: fetching ? 'none' : '0 0 12px rgba(59,130,246,0.1)',
                        }}
                    >
                        {fetching ? '⏳ Fetching…' : '🔄 Fetch Now'}
                    </button>
                </div>
            </aside>

            {/* ── Main content ─────────────────────── */}
            <main className="flex-1 overflow-auto">
                {/* Top header bar */}
                <div
                    className="sticky top-0 z-20 flex items-center justify-between px-6 py-4"
                    style={{
                        background: 'rgba(5,8,15,0.85)',
                        backdropFilter: 'blur(20px)',
                        WebkitBackdropFilter: 'blur(20px)',
                        borderBottom: '1px solid var(--border)',
                    }}
                >
                    <div>
                        <h2
                            className="text-lg font-bold gradient-text-blue"
                        >
                            {NAV_ITEMS.find((n) => n.id === activeTab)?.icon}{' '}
                            {NAV_ITEMS.find((n) => n.id === activeTab)?.label}
                        </h2>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                            Trilingual AI-powered disaster monitoring · Sinhala · Tamil · English
                        </p>
                    </div>
                    {stats?.highPriority > 0 && (
                        <div
                            className="flex items-center gap-2 px-4 py-2 rounded-xl pulse-red"
                            style={{
                                background: 'rgba(244,63,94,0.08)',
                                border: '1px solid rgba(244,63,94,0.35)',
                            }}
                        >
                            <span className="text-sm">🚨</span>
                            <span className="text-sm font-bold gradient-text-red">
                                {stats.highPriority} High Alert{stats.highPriority !== 1 ? 's' : ''}
                            </span>
                        </div>
                    )}
                </div>

                {/* Content area padding */}
                <div className="p-6">

                {/* Search bar — visible on dashboard and feed tabs */}
                {(activeTab === 'dashboard' || activeTab === 'feed') && (
                    <div
                        className="mb-5 rounded-2xl overflow-hidden"
                        style={{ border: '1px solid var(--border)', background: 'rgba(255,255,255,0.025)' }}
                    >
                        {/* Text search row */}
                        <div
                            className="flex items-center gap-3 px-4 py-3"
                            style={{ borderBottom: '1px solid var(--border)' }}
                        >
                            <span className="text-base" style={{ color: 'var(--text-secondary)' }}>🔍</span>
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                placeholder="Search tweets, author, district…"
                                className="flex-1 text-sm bg-transparent outline-none"
                                style={{
                                    color: 'var(--text-primary)',
                                    caretColor: '#3b82f6',
                                }}
                            />
                            <span
                                className="text-xs px-2 py-0.5 rounded-lg flex-shrink-0"
                                style={{
                                    background: 'rgba(255,255,255,0.06)',
                                    color: 'var(--text-secondary)',
                                    border: '1px solid var(--border)',
                                }}
                            >
                                {filteredTweets.length}
                                <span style={{ color: 'var(--text-muted)' }}> / {tweets.length}</span>
                            </span>
                            {(searchQuery || filterLevel !== 'all' || filterLang !== 'all' || filterVerified || filterDistrict !== 'all') && (
                                <button
                                    onClick={clearSearch}
                                    className="flex-shrink-0 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all"
                                    style={{
                                        background: 'rgba(244,63,94,0.1)',
                                        border: '1px solid rgba(244,63,94,0.22)',
                                        color: '#f87171',
                                        cursor: 'pointer',
                                    }}
                                >
                                    ✕ Clear
                                </button>
                            )}
                        </div>

                        {/* Filter chips row */}
                        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                            {/* Emergency level */}
                            {['all', 'High', 'Neutral/Medium'].map(v => (
                                <button
                                    key={v}
                                    onClick={() => setFilterLevel(v)}
                                    className="px-3 py-1 rounded-lg text-xs font-semibold transition-all"
                                    style={{
                                        background: filterLevel === v
                                            ? v === 'High' ? 'rgba(244,63,94,0.18)' : v === 'Neutral/Medium' ? 'rgba(245,158,11,0.18)' : 'rgba(59,130,246,0.18)'
                                            : 'rgba(255,255,255,0.04)',
                                        border: `1px solid ${
                                            filterLevel === v
                                                ? v === 'High' ? 'rgba(244,63,94,0.35)' : v === 'Neutral/Medium' ? 'rgba(245,158,11,0.35)' : 'rgba(59,130,246,0.35)'
                                                : 'var(--border)'
                                        }`,
                                        color: filterLevel === v
                                            ? v === 'High' ? '#f43f5e' : v === 'Neutral/Medium' ? '#f59e0b' : '#60a5fa'
                                            : 'var(--text-secondary)',
                                        cursor: 'pointer',
                                    }}
                                >
                                    {v === 'all' ? '📊 All' : v === 'High' ? '🚨 High' : '⚠️ Medium'}
                                </button>
                            ))}

                            <div className="w-px self-stretch" style={{ background: 'var(--border)' }} />

                            {/* Language */}
                            {[['all', '🌐'], ['en', '🇬🇧 EN'], ['si', 'SI'], ['ta', 'TA']].map(([v, label]) => (
                                <button
                                    key={v}
                                    onClick={() => setFilterLang(v)}
                                    className="px-3 py-1 rounded-lg text-xs font-semibold transition-all"
                                    style={{
                                        background: filterLang === v ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.04)',
                                        border: `1px solid ${filterLang === v ? 'rgba(99,102,241,0.35)' : 'var(--border)'}`,
                                        color: filterLang === v ? '#a5b4fc' : 'var(--text-secondary)',
                                        cursor: 'pointer',
                                    }}
                                >
                                    {label}
                                </button>
                            ))}

                            <div className="w-px self-stretch" style={{ background: 'var(--border)' }} />

                            {/* Verified toggle */}
                            <button
                                onClick={() => setFilterVerified(v => !v)}
                                className="px-3 py-1 rounded-lg text-xs font-semibold transition-all"
                                style={{
                                    background: filterVerified ? 'rgba(16,185,129,0.18)' : 'rgba(255,255,255,0.04)',
                                    border: `1px solid ${filterVerified ? 'rgba(16,185,129,0.35)' : 'var(--border)'}`,
                                    color: filterVerified ? '#10b981' : 'var(--text-secondary)',
                                    cursor: 'pointer',
                                }}
                            >
                                ✓ Verified
                            </button>

                            {/* District dropdown */}
                            <select
                                value={filterDistrict}
                                onChange={e => setFilterDistrict(e.target.value)}
                                className="px-3 py-1 rounded-lg text-xs font-semibold"
                                style={{
                                    background: filterDistrict !== 'all' ? 'rgba(59,130,246,0.18)' : 'rgba(255,255,255,0.04)',
                                    border: `1px solid ${filterDistrict !== 'all' ? 'rgba(59,130,246,0.35)' : 'var(--border)'}`,
                                    color: filterDistrict !== 'all' ? '#60a5fa' : 'var(--text-secondary)',
                                    cursor: 'pointer',
                                    outline: 'none',
                                }}
                            >
                                {districtOptions.map(d => (
                                    <option key={d} value={d} style={{ background: '#0b1120' }}>
                                        {d === 'all' ? '📍 District' : `📍 ${d}`}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                )}

                {/* Dashboard */}
                {activeTab === 'dashboard' && (
                    <div className="space-y-6">
                        <StatsCards stats={stats} />
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                            <DisasterMap tweets={mapTweets} />
                            <LiveFeed tweets={filteredTweets.slice(0, 20)} connected={connected} />
                        </div>
                        {/* Geo Distribution */}
                        {stats?.geoDistribution?.length > 0 && (
                            <div className="glass-card p-5">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                                        📍 Geographic Distribution
                                    </h3>
                                    <span
                                        className="text-xs px-2 py-0.5 rounded-md"
                                        style={{ color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}
                                    >
                                        Top {stats.geoDistribution.length} districts
                                    </span>
                                </div>
                                <div className="space-y-3">
                                    {stats.geoDistribution.map((d, i) => {
                                        const pct = stats.totalPosts > 0 ? (d.count / stats.totalPosts) * 100 : 0
                                        const max = stats.geoDistribution[0]?.count || 1
                                        const relPct = (d.count / max) * 100
                                        return (
                                            <div key={d._id} className="flex items-center gap-3">
                                                <span
                                                    className="text-xs w-5 text-center font-mono"
                                                    style={{ color: i === 0 ? '#f59e0b' : 'var(--text-muted)' }}
                                                >
                                                    {i + 1}
                                                </span>
                                                <span className="text-xs w-28 truncate" style={{ color: 'var(--text-secondary)' }}>
                                                    {d._id}
                                                </span>
                                                <div className="flex-1 h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
                                                    <div
                                                        className="h-1.5 rounded-full progress-gradient transition-all duration-700"
                                                        style={{ width: `${relPct}%`, animationDelay: `${i * 0.1}s` }}
                                                    />
                                                </div>
                                                <div className="flex items-center gap-2 w-16 justify-end">
                                                    <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                                                        {d.count}
                                                    </span>
                                                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                                                        {pct.toFixed(0)}%
                                                    </span>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'map' && (
                    <div style={{ height: 'calc(100vh - 140px)' }}>
                        <DisasterMap tweets={mapTweets} />
                    </div>
                )}

                {activeTab === 'feed' && (
                    <LiveFeed tweets={filteredTweets} connected={connected} />
                )}

                {activeTab === 'test' && (
                    <div className="max-w-2xl">
                        <TestTool />
                    </div>
                )}
                </div>{/* end content padding div */}
            </main>
        </div>
    )
}
