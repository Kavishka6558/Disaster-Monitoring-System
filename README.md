# 🌊 Natural Disasters and Accidents Monitoring System — Sri Lanka

A full-stack, AI-powered disaster monitoring system that processes trilingual (Sinhala, Tamil, English) social media data in real-time using a **12-stage AI pipeline**.

> **Label Mapping:** `Label 0 = Neutral/Medium` | `Label 1 = High` (confirmed from model config)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Frontend (React + Tailwind CSS)          :5173                 │
│  ├── Interactive Sri Lanka Map (Leaflet.js + 2dsphere queries)  │
│  ├── Live Tweet Feed (Socket.io) — images, videos, GIFs         │
│  ├── Statistics Dashboard (sentiment + emergency breakdown)     │
│  └── Manual AI Pipeline Test Tool (all 12 stages)              │
├─────────────────────────────────────────────────────────────────┤
│  Backend API (Node.js + Express)          :5000                 │
│  ├── REST API + Socket.io real-time broadcast                   │
│  ├── Twitter/RapidAPI fetching (cron every 5 min)              │
│  ├── ML Service client → :8001                                  │
│  ├── LLM (GPT-4o-mini): geolocation + nude filter + content    │
│  ├── TF-IDF similarity — multi-source disaster verification     │
│  └── MongoDB (disaster_db) with 2dsphere geospatial index      │
├─────────────────────────────────────────────────────────────────┤
│  ML Microservice (FastAPI + PyTorch)      :8001                 │
│  ├── XLM-RoBERTa (local model) — Sinhala / Tamil / English     │
│  ├── /predict  — Emergency level (High / Neutral/Medium)        │
│  ├── /sentiment — Sentiment (Positive / Negative / Neutral)     │
│  └── /analyze  — Combined classification + sentiment            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Prerequisites

- Python 3.10+
- Node.js 18+
- MongoDB (local or Atlas)
- API Keys (see `.env` files below)

---

## 🚀 Quick Start

### Step 1 — ML Microservice (FastAPI)

```bash
cd backend/ml_service
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8001
```

**Test endpoints:**
```bash
# Health check
curl http://localhost:8001/health

# Emergency level classification (English)
curl -X POST http://localhost:8001/predict \
  -H "Content-Type: application/json" \
  -d '{"text": "Major flood in Colombo, people need urgent help"}'

# Sentiment analysis
curl -X POST http://localhost:8001/sentiment \
  -H "Content-Type: application/json" \
  -d '{"text": "Rescue teams saved 200 families, all are safe"}'

# Combined (classification + sentiment in one call)
curl -X POST http://localhost:8001/analyze \
  -H "Content-Type: application/json" \
  -d '{"text": "කොළඹ ගංවතුර - ජනතාවට ආධාර අවශ්‍යයි"}'
```

---

### Step 2 — Backend API (Node.js)

1. Fill in your API keys in `backend/.env`:

```env
MONGODB_URI=mongodb://localhost:27017/disaster_db
RAPIDAPI_KEY=your_rapidapi_key_here
OPENAI_API_KEY=your_openai_api_key_here
ML_SERVICE_URL=http://localhost:8001
PORT=5000
FRONTEND_URL=http://localhost:5173
FETCH_INTERVAL_MINUTES=5
```

2. Start the server:

```bash
cd backend
npm install
npm start
# or for development:
npm run dev
```

---

### Step 3 — Frontend (React + Tailwind)

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173** in your browser.

---

## 📁 Project Structure

```
Natural-Disaster-management-system/
├── backend/
│   ├── ml_model/                  # Pre-trained XLM-RoBERTa model files
│   │   ├── config.json
│   │   ├── model.safetensors
│   │   ├── tokenizer.json
│   │   └── tokenizer_config.json
│   ├── ml_service/                # Phase 1: FastAPI ML Microservice (Python)
│   │   ├── main.py                # /predict, /sentiment, /analyze endpoints
│   │   ├── requirements.txt
│   │   └── .env
│   ├── models/
│   │   └── Tweet.js               # Mongoose schema (sentiment, geoPoint, 12-stage enum)
│   ├── routes/
│   │   └── api.js                 # REST API routes incl. /tweets/nearby (2dsphere)
│   ├── services/
│   │   ├── twitterService.js      # 12-stage pipeline orchestrator
│   │   ├── mlService.js           # ML microservice client (classify + sentiment)
│   │   ├── llmService.js          # GPT-4o-mini: geolocation, nude filter, content filter
│   │   └── similarityService.js   # TF-IDF multi-source verification
│   ├── server.js                  # Express + Socket.io main server
│   ├── package.json
│   └── .env
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── DisasterMap.jsx    # Leaflet.js Sri Lanka map (2dsphere-powered)
│   │   │   ├── LiveFeed.jsx       # Real-time feed: photos, videos, GIFs + sentiment badge
│   │   │   ├── StatsCards.jsx     # Dashboard: emergency + sentiment breakdown
│   │   │   └── TestTool.jsx       # Manual AI pipeline tester (all 12 stages)
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── index.css
│   ├── .env
│   ├── vite.config.js
│   └── package.json
└── README.md
```

---

## 🤖 AI Pipeline — 12 Stages

As defined in the research report (Chapter 4 & 5):

| Stage | Name | Service | Output |
|-------|------|---------|--------|
| **1** | **Data Aggregation** | RapidAPI (twitter-v24) | Raw tweet entries |
| **2** | **Data Collection** | `twitterService.js` | Parsed: text, author, media URLs |
| **3** | **Language Detection** | Twitter API `lang` field | `en` / `si` / `ta` / `unknown` |
| **4** | **Deduplication** | In-memory Set + MongoDB | Skip already-processed IDs |
| **5** | **Emergency Classification** | XLM-RoBERTa `/predict` | `High` (Label 1) or `Neutral/Medium` (Label 0) |
| **6** | **Sentiment Analysis** | `/sentiment` endpoint | `Positive` / `Negative` / `Neutral` + score (−1 to +1) |
| **7** | **Geolocation Extraction** | GPT-4o-mini LLM | District, Province, lat/lng coordinates |
| **8** | **Nude Content Filtering** | GPT-4o-mini LLM | `isNudeFiltered: true/false` — explicit nude/sexual content detection |
| **9** | **General Content Filter** | GPT-4o-mini LLM | `isFiltered: true/false` — AI-generated, spam, irrelevant |
| **10** | **Similarity & Verification** | TF-IDF cosine similarity | `isVerified: true` if multi-source confirmed |
| **11** | **Storage** | MongoDB `disaster_db` | Persisted with all pipeline results |
| **12** | **Post-Processing / Broadcast** | Socket.io | Real-time emit to all connected dashboards |

### Stage 6 — Sentiment Analysis (Detail)

Separate from Emergency Level classification. Uses a multilingual keyword lexicon (English, Sinhala, Tamil):

| Result | Meaning | Example |
|--------|---------|---------|
| `Positive` | Rescue successful, aid arrived | *"200 families evacuated safely"* |
| `Negative` | Deaths, trapped, urgent help needed | *"People trapped, casualties reported"* |
| `Neutral` | Factual reporting, no strong signal | *"Flood warning issued for Colombo"* |

### Stage 8 — Nude Content Filtering (Detail)

As required by Project details: *"Use the LLM API to filter nude content."*

A **dedicated, separate GPT-4o-mini call** (not merged with Stage 9) that explicitly checks for sexually explicit or nude content unrelated to disaster reporting. Stored as `isNudeFiltered` in MongoDB, shown separately from general content filtering in the dashboard.

### Stage 10 — Multi-Source Verification Logic (Detail)

As required by Project details: *"When a post is posted on several accounts, we can assume disaster is true."*

- Uses **TF-IDF cosine similarity** to compare new tweets against the last 24 hours of stored tweets
- **Threshold:** cosine similarity ≥ 0.6 across **3 or more distinct accounts** → `isVerified: true`
- Verified tweets are highlighted in the dashboard with a ✅ badge

---

## 🗄️ Database — MongoDB Setup

### Collection: `tweets` (in `disaster_db`)

Key schema fields:

| Field | Type | Stage | Description |
|-------|------|-------|-------------|
| `emergencyLevel` | `String` enum | Stage 5 | `"High"` or `"Neutral/Medium"` |
| `confidence` | `Number` | Stage 5 | Model confidence 0–1 |
| `sentiment` | `String` enum | Stage 6 | `"Positive"`, `"Negative"`, `"Neutral"` |
| `sentimentScore` | `Number` | Stage 6 | −1.0 (most negative) to +1.0 (most positive) |
| `location.coordinates` | `{lat, lng}` | Stage 7 | Extracted district coordinates |
| `geoPoint` | GeoJSON Point | Stage 7 | `{type:"Point", coordinates:[lng,lat]}` |
| `isNudeFiltered` | `Boolean` | Stage 8 | Nude content detected by LLM |
| `isFiltered` | `Boolean` | Stage 9 | General content filtered |
| `isVerified` | `Boolean` | Stage 10 | Multi-source verified |
| `processingStage` | `String` enum | All | Tracks current pipeline stage |

### Indexes

```js
// Standard indexes
tweetSchema.index({ emergencyLevel: 1, createdAt: -1 });
tweetSchema.index({ "location.district": 1 });
tweetSchema.index({ sentiment: 1 });
tweetSchema.index({ isVerified: 1 });

// 2dsphere index for geospatial queries (fast map rendering)
tweetSchema.index({ geoPoint: "2dsphere" });
```

The `2dsphere` index enables MongoDB `$near` and `$geoWithin` queries for radius-based map searches, as specified in the research report for optimized geospatial rendering.

---

## 🌐 API Endpoints

### Backend (Node.js — :5000)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/tweets` | Paginated tweets (filter: level, district, language, **sentiment**) |
| GET | `/api/tweets/map` | Tweets with coordinates for map |
| GET | `/api/tweets/nearby` | **Geospatial:** tweets within radius (`?lat=&lng=&radiusKm=`) |
| GET | `/api/stats` | Dashboard stats: emergency + **sentiment breakdown** + filtered counts |
| POST | `/api/test` | Manual pipeline test (all 12 stages) |
| POST | `/api/fetch` | Trigger manual tweet fetch |
| GET | `/api/health` | Backend health check |

### ML Microservice (FastAPI — :8001)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Model status (loaded, device, version) |
| GET | `/docs` | Swagger UI |
| POST | `/predict` | Emergency classification → `High` / `Neutral/Medium` |
| POST | `/sentiment` | **Sentiment analysis** → `Positive` / `Negative` / `Neutral` |
| POST | `/analyze` | **Combined:** classification + sentiment in one call |
| POST | `/predict/batch` | Batch classification (max 50 texts) |

---

## 🔑 API Keys

| Key | Source | Required for |
|-----|--------|-------------|
| `RAPIDAPI_KEY` | [rapidapi.com](https://rapidapi.com/) → "twitter-v24" | Tweet fetching |
| `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com/api-keys) | Geolocation, Nude Filter, Content Filter |
| `MONGODB_URI` | Local: `mongodb://localhost:27017/disaster_db` or [Atlas](https://www.mongodb.com/atlas) | Database |

> **Note:** The system works without `RAPIDAPI_KEY` and `OPENAI_API_KEY`. ML classification and sentiment analysis work fully offline. Geolocation falls back to keyword matching. Nude/content filtering is skipped (defaults to `false`).

---

## Label Mapping

| Label ID | Label | Meaning |
|----------|-------|---------|
| 0 | `Neutral/Medium` | General or low-priority disaster mention |
| 1 | `High` | Urgent disaster requiring immediate response |
