import { useState, useRef } from 'react'
import axios from 'axios'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000'

export default function TestTool() {
    const [text, setText] = useState('')
    const [loading, setLoading] = useState(false)
    const [result, setResult] = useState(null)
    const [error, setError] = useState(null)

    // Simulate Live state
    const [simLoading, setSimLoading] = useState(false)
    const [simResult, setSimResult] = useState(null)
    const [simError, setSimError] = useState(null)
    const [simDistrict, setSimDistrict] = useState('Colombo')

    // Image state
    const [imageFile, setImageFile] = useState(null)
    const [imagePreview, setImagePreview] = useState(null)
    const [extracting, setExtracting] = useState(false)
    const [extractedText, setExtractedText] = useState(null)
    const [dragOver, setDragOver] = useState(false)
    const [imageAnalysis, setImageAnalysis] = useState(null)   // { isAIGenerated, aiConfidence, reason, isNude }
    const [analyzing, setAnalyzing] = useState(false)
    const fileInputRef = useRef(null)

    const SAMPLE_TEXTS = [
        { lang: '🇬🇧 EN', text: 'Major flood in Colombo, people need urgent evacuation help!' },
        { lang: '🇱🇰 SI', text: 'කොළඹ දිස්ත්‍රික්කයේ දැඩි ගංවතුර - ජනතාවට ආධාර අවශ්‍යයි' },
        { lang: '🇱🇰 TA', text: 'கொழும்பில் பெரும் வெள்ளம் - மக்களுக்கு உடனடி உதவி தேவை' },
        { lang: '🌤️ Normal', text: 'Beautiful weather in Kandy today, enjoying the view.' },
    ]

    // ── Image handling ──────────────────────────────────────────────────────
    const handleImageSelect = (file) => {
        if (!file || !file.type.startsWith('image/')) return
        setImageFile(file)
        setExtractedText(null)
        setResult(null)
        setError(null)
        setImageAnalysis(null)
        const reader = new FileReader()
        reader.onload = (e) => setImagePreview(e.target.result)
        reader.readAsDataURL(file)

        // Fire AI/real detection automatically as soon as image is selected
        const formData = new FormData()
        formData.append('image', file)
        setAnalyzing(true)
        axios.post(`${API_URL}/api/check-image`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 30000,
        })
            .then(r => setImageAnalysis(r.data))
            .catch(() => setImageAnalysis({ isAIGenerated: null, reason: 'Detection unavailable' }))
            .finally(() => setAnalyzing(false))
    }

    const handleDrop = (e) => {
        e.preventDefault()
        setDragOver(false)
        const file = e.dataTransfer.files[0]
        handleImageSelect(file)
    }

    const handleExtractAndRun = async () => {
        if (!imageFile) return
        setExtracting(true)
        setError(null)
        setResult(null)
        setExtractedText(null)

        try {
            const formData = new FormData()
            formData.append('image', imageFile)

            const res = await axios.post(`${API_URL}/api/extract-image`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
                timeout: 45000,
            })

            const extracted = res.data.text
            setExtractedText(extracted)
            setText(extracted)

            // Automatically run the full pipeline on the extracted text
            setExtracting(false)
            setLoading(true)
            const pipelineRes = await axios.post(`${API_URL}/api/test`, { text: extracted })
            setResult(pipelineRes.data)
        } catch (err) {
            setError(err.response?.data?.error || err.message)
        } finally {
            setExtracting(false)
            setLoading(false)
        }
    }

    const clearImage = () => {
        setImageFile(null)
        setImagePreview(null)
        setExtractedText(null)
        setImageAnalysis(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
    }

    // ── Text pipeline ───────────────────────────────────────────────────────
    const handleTest = async () => {
        if (!text.trim()) return
        setLoading(true)
        setError(null)
        setResult(null)
        try {
            const res = await axios.post(`${API_URL}/api/test`, { text })
            setResult(res.data)
        } catch (err) {
            setError(err.response?.data?.error || err.message)
        } finally {
            setLoading(false)
        }
    }

    const isHigh = result?.summary?.emergencyLevel === 'High'

    const SL_DISTRICTS = [
        'Colombo','Gampaha','Kalutara','Kandy','Matale','Nuwara Eliya',
        'Galle','Matara','Hambantota','Jaffna','Vavuniya','Batticaloa',
        'Ampara','Trincomalee','Kurunegala','Ratnapura','Kegalle',
        'Anuradhapura','Polonnaruwa','Badulla','Monaragala','Puttalam',
    ]

    const handleSimulateLive = async () => {
        if (!text.trim()) return
        setSimLoading(true)
        setSimResult(null)
        setSimError(null)
        try {
            const res = await axios.post(`${API_URL}/api/simulate`, {
                text,
                district: simDistrict,
                language: 'en',
            })
            setSimResult(res.data)
        } catch (err) {
            setSimError(err.response?.data?.error || err.message)
        } finally {
            setSimLoading(false)
        }
    }

    return (
        <div className="glass-card p-6 space-y-5">
            {/* Header */}
            <div className="flex items-center gap-2">
                <span className="text-xl">🧪</span>
                <h2 className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>
                    Manual Pipeline Test Tool
                </h2>
            </div>

            {/* ── IMAGE UPLOAD SECTION ──────────────────────────────────────── */}
            <div
                className="rounded-xl overflow-hidden"
                style={{ border: '1px solid var(--border)' }}
            >
                {/* Section header */}
                <div
                    className="px-4 py-2.5 flex items-center gap-2"
                    style={{ background: 'rgba(99,102,241,0.12)', borderBottom: '1px solid var(--border)' }}
                >
                    <span>📷</span>
                    <span className="text-xs font-semibold" style={{ color: '#a5b4fc' }}>
                        Image Analysis — Extract text from screenshot, photo, or news article
                    </span>
                </div>

                <div className="p-4 space-y-3">
                    {/* Drag-drop zone */}
                    {!imagePreview ? (
                        <div
                            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                            onDragLeave={() => setDragOver(false)}
                            onDrop={handleDrop}
                            onClick={() => fileInputRef.current?.click()}
                            className="rounded-xl flex flex-col items-center justify-center gap-2 cursor-pointer transition-all duration-200"
                            style={{
                                height: '120px',
                                border: `2px dashed ${dragOver ? '#6366f1' : 'rgba(255,255,255,0.15)'}`,
                                background: dragOver ? 'rgba(99,102,241,0.08)' : 'rgba(255,255,255,0.02)',
                            }}
                        >
                            <span className="text-3xl">🖼️</span>
                            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                                Drag & drop an image, or <span style={{ color: '#6366f1' }}>click to browse</span>
                            </p>
                            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
                                JPG, PNG, WebP — up to 10 MB
                            </p>
                        </div>
                    ) : (
                        <div className="flex gap-3">
                            {/* Image preview */}
                            <div className="relative flex-shrink-0">
                                <img
                                    src={imagePreview}
                                    alt="Selected"
                                    className="rounded-lg object-cover"
                                    style={{ width: '110px', height: '85px', border: '1px solid var(--border)' }}
                                />
                                <button
                                    onClick={clearImage}
                                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold"
                                    style={{ background: '#ef4444', color: 'white', border: 'none', cursor: 'pointer' }}
                                    title="Remove image"
                                >
                                    ✕
                                </button>
                            </div>

                            {/* Info + action */}
                            <div className="flex-1 min-w-0 space-y-2">
                                <p className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                                    {imageFile?.name}
                                </p>
                                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                                    {(imageFile?.size / 1024).toFixed(1)} KB
                                </p>

                                {/* AI / Real image detection badge */}
                                {analyzing && (
                                    <div className="text-xs px-2 py-1 rounded-lg" style={{ background: 'rgba(99,102,241,0.1)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.2)' }}>
                                        🔍 Checking if AI-generated…
                                    </div>
                                )}
                                {imageAnalysis && !analyzing && (
                                    <div
                                        className="px-2 py-1.5 rounded-lg text-xs space-y-0.5"
                                        style={{
                                            background: imageAnalysis.isAIGenerated === null
                                                ? 'rgba(107,114,128,0.1)'
                                                : imageAnalysis.isAIGenerated
                                                    ? 'rgba(245,158,11,0.1)'
                                                    : 'rgba(16,185,129,0.1)',
                                            border: `1px solid ${imageAnalysis.isAIGenerated === null
                                                ? 'rgba(107,114,128,0.3)'
                                                : imageAnalysis.isAIGenerated
                                                    ? 'rgba(245,158,11,0.3)'
                                                    : 'rgba(16,185,129,0.3)'}`,
                                        }}
                                    >
                                        <p className="font-semibold" style={{
                                            color: imageAnalysis.isAIGenerated === null ? '#9ca3af'
                                                : imageAnalysis.isAIGenerated ? '#f59e0b' : '#10b981'
                                        }}>
                                            {imageAnalysis.isAIGenerated === null
                                                ? '⚠️ Detection unavailable'
                                                : imageAnalysis.isAIGenerated
                                                    ? `🤖 AI-Generated (${imageAnalysis.aiConfidence || 'unknown'} confidence)`
                                                    : `📸 Real Photo (${imageAnalysis.aiConfidence || 'unknown'} confidence)`}
                                        </p>
                                        {imageAnalysis.reason && (
                                            <p style={{ color: 'rgba(255,255,255,0.45)' }}>{imageAnalysis.reason}</p>
                                        )}
                                        {imageAnalysis.isNude && (
                                            <p style={{ color: '#ef4444' }}>🔞 NSFW content detected</p>
                                        )}
                                    </div>
                                )}

                                {/* Extracted text preview */}
                                {extractedText && (
                                    <div
                                        className="p-2 rounded-lg text-xs"
                                        style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', color: '#6ee7b7' }}
                                    >
                                        ✅ Extracted: "{extractedText.slice(0, 80)}{extractedText.length > 80 ? '\u2026' : ''}"
                                    </div>
                                )}

                                <button
                                    onClick={handleExtractAndRun}
                                    disabled={extracting || loading}
                                    className="w-full py-1.5 rounded-lg text-xs font-semibold transition-all duration-200"
                                    style={{
                                        background: extracting || loading
                                            ? 'rgba(99,102,241,0.3)'
                                            : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                                        color: 'white',
                                        border: 'none',
                                        cursor: extracting || loading ? 'not-allowed' : 'pointer',
                                    }}
                                >
                                    {extracting
                                        ? '🔍 Extracting text…'
                                        : loading
                                            ? '⏳ Running pipeline…'
                                            : '🚀 Extract & Run Pipeline'}
                                </button>
                            </div>
                        </div>
                    )}

                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        onChange={(e) => handleImageSelect(e.target.files[0])}
                    />
                </div>
            </div>

            {/* ── DIVIDER ────────────────────────────────────────────────────── */}
            <div className="flex items-center gap-3">
                <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>or type / paste text</span>
                <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
            </div>

            {/* ── TEXT INPUT SECTION ────────────────────────────────────────── */}
            {/* Sample texts */}
            <div className="flex flex-wrap gap-2">
                {SAMPLE_TEXTS.map((s) => (
                    <button
                        key={s.lang}
                        onClick={() => { setText(s.text); setResult(null); setError(null) }}
                        className="text-xs px-3 py-1.5 rounded-lg transition-all duration-200"
                        style={{
                            background: 'rgba(255,255,255,0.05)',
                            border: '1px solid var(--border)',
                            color: 'var(--text-secondary)',
                            cursor: 'pointer',
                        }}
                        onMouseEnter={(e) => (e.target.style.background = 'rgba(255,255,255,0.1)')}
                        onMouseLeave={(e) => (e.target.style.background = 'rgba(255,255,255,0.05)')}
                    >
                        {s.lang}
                    </button>
                ))}
            </div>

            {/* Textarea */}
            <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Enter text in Sinhala, Tamil, or English...&#10;(or use the image section above to auto-fill this)"
                rows={3}
                className="w-full rounded-xl p-4 text-sm resize-none transition-all duration-200"
                style={{
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-primary)',
                    outline: 'none',
                }}
                onFocus={(e) => (e.target.style.borderColor = 'rgba(59,130,246,0.5)')}
                onBlur={(e) => (e.target.style.borderColor = 'var(--border)')}
            />

            {/* Run button */}
            <button
                onClick={handleTest}
                disabled={loading || !text.trim()}
                className="w-full py-3 rounded-xl font-semibold text-sm transition-all duration-200"
                style={{
                    background: loading || !text.trim()
                        ? 'rgba(59,130,246,0.3)'
                        : 'linear-gradient(135deg, #3b82f6, #6366f1)',
                    color: 'white',
                    cursor: loading || !text.trim() ? 'not-allowed' : 'pointer',
                    border: 'none',
                }}
            >
                {loading ? '⏳ Running Pipeline...' : '🚀 Run Full AI Pipeline'}
            </button>

            {/* ── SIMULATE LIVE SECTION ─────────────────────────────────── */}
            <div
                className="rounded-xl overflow-hidden"
                style={{ border: '1px solid rgba(16,185,129,0.25)' }}
            >
                <div
                    className="px-4 py-2.5 flex items-center gap-2"
                    style={{ background: 'rgba(16,185,129,0.1)', borderBottom: '1px solid rgba(16,185,129,0.2)' }}
                >
                    <span>📡</span>
                    <span className="text-xs font-semibold" style={{ color: '#6ee7b7' }}>
                        Simulate Live — Save to DB &amp; Broadcast to Feed
                    </span>
                </div>
                <div className="p-4 space-y-3">
                    {/* District picker */}
                    <div className="flex items-center gap-2">
                        <label className="text-xs flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>📍 District:</label>
                        <select
                            value={simDistrict}
                            onChange={e => setSimDistrict(e.target.value)}
                            className="flex-1 rounded-lg px-3 py-1.5 text-xs"
                            style={{
                                background: 'rgba(255,255,255,0.06)',
                                border: '1px solid var(--border)',
                                color: 'var(--text-primary)',
                                outline: 'none',
                            }}
                        >
                            {SL_DISTRICTS.map(d => (
                                <option key={d} value={d} style={{ background: '#1e293b' }}>{d}</option>
                            ))}
                        </select>
                    </div>

                    {/* Simulate button */}
                    <button
                        onClick={handleSimulateLive}
                        disabled={simLoading || !text.trim()}
                        className="w-full py-2.5 rounded-xl font-semibold text-sm transition-all duration-200"
                        style={{
                            background: simLoading || !text.trim()
                                ? 'rgba(16,185,129,0.2)'
                                : 'linear-gradient(135deg, #059669, #10b981)',
                            color: 'white',
                            cursor: simLoading || !text.trim() ? 'not-allowed' : 'pointer',
                            border: 'none',
                        }}
                    >
                        {simLoading ? '⏳ Simulating...' : '📡 Simulate Live Event'}
                    </button>

                    {/* Simulate error */}
                    {simError && (
                        <div className="p-3 rounded-xl text-xs" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444' }}>
                            ❌ {simError}
                        </div>
                    )}

                    {/* Simulate result */}
                    {simResult && (() => {
                        const simIsHigh = simResult.emergencyLevel === 'High'
                        const score = simResult.similarityScore || 0
                        const scoreColor = score >= 0.5 ? '#10b981' : score >= 0.25 ? '#f59e0b' : '#94a3b8'
                        const scoreBg   = score >= 0.5 ? 'rgba(16,185,129,0.1)' : score >= 0.25 ? 'rgba(245,158,11,0.1)' : 'rgba(148,163,184,0.1)'
                        const scoreBorder = score >= 0.5 ? 'rgba(16,185,129,0.3)' : score >= 0.25 ? 'rgba(245,158,11,0.3)' : 'rgba(148,163,184,0.25)'
                        return (
                            <div className="space-y-2 fade-in">
                                {/* Broadcast badge */}
                                <div className="flex items-center gap-1.5 text-xs" style={{ color: '#10b981' }}>
                                    <div className="w-2 h-2 rounded-full" style={{ background: '#10b981', boxShadow: '0 0 6px #10b981' }} />
                                    Broadcast to Live Feed · saved as <code style={{ color: '#6ee7b7' }}>{simResult.tweetId}</code>
                                </div>

                                {/* Result cards row */}
                                <div className="grid grid-cols-2 gap-2">
                                    {/* Emergency level */}
                                    <div className="p-3 rounded-xl" style={{
                                        background: simIsHigh ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)',
                                        border: `1px solid ${simIsHigh ? 'rgba(239,68,68,0.25)' : 'rgba(245,158,11,0.25)'}`,
                                    }}>
                                        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Emergency</p>
                                        <p className="text-sm font-bold mt-0.5" style={{ color: simIsHigh ? '#ef4444' : '#f59e0b' }}>
                                            {simIsHigh ? '🚨 High' : '⚠️ Medium'}
                                        </p>
                                        <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                                            {((simResult.confidence || 0) * 100).toFixed(1)}% confidence
                                        </p>
                                    </div>

                                    {/* Similarity score */}
                                    <div className="p-3 rounded-xl" style={{ background: scoreBg, border: `1px solid ${scoreBorder}` }}>
                                        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Similarity Score</p>
                                        <p className="text-sm font-bold mt-0.5" style={{ color: scoreColor }}>
                                            🔗 {(score * 100).toFixed(0)}% match
                                        </p>
                                        <p className="text-xs mt-0.5" style={{ color: scoreColor }}>
                                            {simResult.isVerified ? '✅ Verified news' : score >= 0.25 ? '⚠️ Partial match' : '❓ Unverified'}
                                        </p>
                                    </div>

                                    {/* Sentiment */}
                                    <div className="p-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)' }}>
                                        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Sentiment</p>
                                        <p className="text-sm font-bold mt-0.5" style={{ color: 'var(--text-primary)' }}>
                                            {simResult.sentiment === 'Negative' ? '😰' : simResult.sentiment === 'Positive' ? '😊' : '😐'} {simResult.sentiment}
                                        </p>
                                    </div>

                                    {/* District */}
                                    <div className="p-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)' }}>
                                        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Location</p>
                                        <p className="text-sm font-bold mt-0.5" style={{ color: 'var(--text-primary)' }}>
                                            📍 {simResult.district}
                                        </p>
                                    </div>
                                </div>

                                {/* Filtered warning */}
                                {simResult.isFiltered && (
                                    <div className="p-2 rounded-lg text-xs" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#ef4444' }}>
                                        🚫 Filtered — content did not pass safety check
                                    </div>
                                )}
                            </div>
                        )
                    })()}
                </div>
            </div>

            {/* Error */}
            {error && (
                <div className="p-4 rounded-xl text-sm" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444' }}>
                    ❌ {error}
                </div>
            )}

            {/* Results */}
            {result && (
                <div className="space-y-3 fade-in">
                    {/* Summary banner */}
                    <div
                        className="p-4 rounded-xl"
                        style={{
                            background: isHigh ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)',
                            border: `1px solid ${isHigh ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)'}`,
                        }}
                    >
                        <div className="flex items-center justify-between mb-2">
                            <span className={isHigh ? 'badge-high' : 'badge-neutral'}>
                                {isHigh ? '🚨 HIGH EMERGENCY' : '⚠️ NEUTRAL/MEDIUM'}
                            </span>
                            <span className="text-xs font-semibold" style={{ color: isHigh ? '#ef4444' : '#f59e0b' }}>
                                {(result.summary.confidence * 100).toFixed(1)}% confidence
                            </span>
                        </div>
                        {/* Similarity score row */}
                        {result.stages?.similarity && (() => {
                            const score = result.stages.similarity.similarityScore || 0
                            const scoreColor = score >= 0.5 ? '#10b981' : score >= 0.25 ? '#f59e0b' : '#94a3b8'
                            return (
                                <div className="flex items-center gap-3 mb-2">
                                    <span className="text-xs font-semibold" style={{ color: scoreColor }}>
                                        🔗 {(score * 100).toFixed(0)}% similarity match
                                    </span>
                                    {score >= 0.5 && (
                                        <span className="text-xs" style={{ color: '#10b981' }}>✅ Verified</span>
                                    )}
                                    {score > 0 && score < 0.5 && (
                                        <span className="text-xs" style={{ color: '#94a3b8' }}>❓ Unverified</span>
                                    )}
                                </div>
                            )
                        })()}
                        {result.summary.isFiltered && (
                            <p className="text-xs" style={{ color: '#ef4444' }}>
                                🚫 Filtered: {result.summary.filterReason}
                            </p>
                        )}
                    </div>

                    {/* Stage cards */}
                    <div className="grid grid-cols-1 gap-3">
                        <StageCard title="🤖 ML Classification" data={result.stages.mlClassification} />
                        <StageCard title="📍 Geolocation" data={result.stages.geolocation} />
                        <StageCard title="🔞 Nude Content Filter" data={result.stages.nudeContentFilter} />
                        <StageCard title="🛡️ Content Filter" data={result.stages.contentFilter} />
                        <StageCard title="🔍 Similarity Check" data={result.stages.similarity} />
                    </div>
                </div>
            )}
        </div>
    )
}

function StageCard({ title, data }) {
    return (
        <div
            className="p-3 rounded-xl"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)' }}
        >
            <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>
                {title}
            </p>
            {data?.error ? (
                <p className="text-xs" style={{ color: '#ef4444' }}>Error: {data.error}</p>
            ) : (
                <pre
                    className="text-xs overflow-auto"
                    style={{ color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                >
                    {JSON.stringify(data, null, 2)}
                </pre>
            )}
        </div>
    )
}
