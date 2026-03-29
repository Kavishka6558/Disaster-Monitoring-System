export default function StatsCards({ stats }) {
    const highPct = stats?.totalPosts
        ? ((stats.highPriority / stats.totalPosts) * 100).toFixed(1)
        : '0.0'

    const cards = [
        {
            icon: '📡',
            label: 'Total Posts',
            value: stats?.totalPosts ?? '—',
            sub: 'Processed by AI pipeline',
            accent: '#3b82f6',
            glowColor: 'rgba(59,130,246,0.14)',
            iconBg: 'rgba(59,130,246,0.1)',
            iconBorder: 'rgba(59,130,246,0.2)',
        },
        {
            icon: '🚨',
            label: 'High Priority',
            value: stats?.highPriority ?? '—',
            sub: `${highPct}% of total posts`,
            accent: '#f43f5e',
            glowColor: 'rgba(244,63,94,0.14)',
            iconBg: 'rgba(244,63,94,0.1)',
            iconBorder: 'rgba(244,63,94,0.22)',
        },
        {
            icon: '⚠️',
            label: 'Medium Priority',
            value: stats?.neutralMedium ?? '—',
            sub: 'Lower severity events',
            accent: '#f59e0b',
            glowColor: 'rgba(245,158,11,0.14)',
            iconBg: 'rgba(245,158,11,0.1)',
            iconBorder: 'rgba(245,158,11,0.22)',
        },
        {
            icon: '✅',
            label: 'Verified Reports',
            value: stats?.verified ?? '—',
            sub: 'Multi-source confirmed',
            accent: '#10b981',
            glowColor: 'rgba(16,185,129,0.14)',
            iconBg: 'rgba(16,185,129,0.1)',
            iconBorder: 'rgba(16,185,129,0.22)',
        },
    ]

    return (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {cards.map((card) => (
                <div
                    key={card.label}
                    className="card-stat glass-card p-5 cursor-default"
                    style={{ '--stat-accent': card.accent }}
                    onMouseEnter={e => {
                        e.currentTarget.style.boxShadow = `0 8px 32px ${card.glowColor}, 0 0 0 1px ${card.accent}22`
                        e.currentTarget.style.transform = 'translateY(-2px)'
                    }}
                    onMouseLeave={e => {
                        e.currentTarget.style.boxShadow = ''
                        e.currentTarget.style.transform = ''
                    }}
                >
                    {/* Icon + live dot row */}
                    <div className="flex items-center justify-between mb-4">
                        <div
                            className="w-10 h-10 rounded-xl flex items-center justify-center text-xl"
                            style={{ background: card.iconBg, border: `1px solid ${card.iconBorder}` }}
                        >
                            {card.icon}
                        </div>
                        <div
                            className="w-2 h-2 rounded-full"
                            style={{ background: card.accent, boxShadow: `0 0 8px ${card.accent}` }}
                        />
                    </div>

                    {/* Number */}
                    <p
                        className="text-3xl font-bold tracking-tight mb-1"
                        style={{ color: card.accent }}
                    >
                        {typeof card.value === 'number' ? card.value.toLocaleString() : card.value}
                    </p>

                    {/* Label + sub */}
                    <p className="text-sm font-semibold leading-snug" style={{ color: 'var(--text-primary)' }}>
                        {card.label}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                        {card.sub}
                    </p>
                </div>
            ))}
        </div>
    )
}
