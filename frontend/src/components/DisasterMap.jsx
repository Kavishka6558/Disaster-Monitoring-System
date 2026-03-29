import { MapContainer, TileLayer, CircleMarker, Popup, ZoomControl } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

const SRI_LANKA_CENTER = [7.8731, 80.7718]
const DEFAULT_ZOOM = 7

export default function DisasterMap({ tweets }) {
    const mapTweets = tweets.filter(
        (t) => t.location?.coordinates?.lat && t.location?.coordinates?.lng
    )

    return (
        <div className="glass-card overflow-hidden" style={{ height: '480px' }}>
            <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-center gap-2">
                    <span className="text-lg">🗺️</span>
                    <h2 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                        Live Disaster Map — Sri Lanka
                    </h2>
                </div>
                <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    <span className="flex items-center gap-1">
                        <span className="inline-block w-3 h-3 rounded-full bg-red-500"></span> High
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="inline-block w-3 h-3 rounded-full bg-yellow-400"></span> Neutral/Medium
                    </span>
                    <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                        {mapTweets.length} pins
                    </span>
                </div>
            </div>

            <MapContainer
                center={SRI_LANKA_CENTER}
                zoom={DEFAULT_ZOOM}
                style={{ height: 'calc(100% - 52px)', width: '100%' }}
                zoomControl={false}
            >
                <ZoomControl position="bottomright" />
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

                {mapTweets.map((tweet) => {
                    const isHigh = tweet.emergencyLevel === 'High'
                    return (
                        <CircleMarker
                            key={tweet.tweetId || tweet._id}
                            center={[tweet.location.coordinates.lat, tweet.location.coordinates.lng]}
                            radius={isHigh ? 14 : 9}
                            pathOptions={{
                                color: isHigh ? '#ef4444' : '#f59e0b',
                                fillColor: isHigh ? '#ef4444' : '#f59e0b',
                                fillOpacity: 0.75,
                                weight: 2,
                            }}
                        >
                            <Popup>
                                <div style={{ fontFamily: 'Inter, sans-serif', minWidth: '200px' }}>
                                    <div style={{ marginBottom: '6px' }}>
                                        <span
                                            style={{
                                                background: isHigh ? '#fee2e2' : '#fef3c7',
                                                color: isHigh ? '#dc2626' : '#d97706',
                                                padding: '2px 8px',
                                                borderRadius: '999px',
                                                fontSize: '11px',
                                                fontWeight: '700',
                                            }}
                                        >
                                            {tweet.emergencyLevel}
                                        </span>
                                    </div>
                                    <p style={{ fontSize: '13px', marginBottom: '6px', lineHeight: '1.4' }}>
                                        {tweet.text?.substring(0, 120)}
                                        {tweet.text?.length > 120 ? '...' : ''}
                                    </p>
                                    <div style={{ fontSize: '11px', color: '#6b7280' }}>
                                        <div>📍 {tweet.location?.district || tweet.location?.primary || 'Unknown'}</div>
                                        <div>👤 @{tweet.author?.username}</div>
                                        <div>🎯 Confidence: {(tweet.confidence * 100).toFixed(1)}%</div>
                                        {tweet.isVerified && (
                                            <div style={{ color: '#10b981', fontWeight: '600' }}>✅ Verified</div>
                                        )}
                                    </div>
                                </div>
                            </Popup>
                        </CircleMarker>
                    )
                })}
            </MapContainer>
        </div>
    )
}
