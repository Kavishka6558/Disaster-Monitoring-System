/**
 * LLM Service  –  Multi-provider cascade with automatic failover
 * ─────────────────────────────────────────────────────────────────────────
 * Model cascade (tried in order until one works):
 *   1. gemini-2.0-flash           – primary, free tier (1,500 req/day)
 *   2. gemini-2.0-flash-lite      – secondary, separate quota pool
 *   3. gemini-1.5-flash           – tertiary, separate quota pool
 *   4. Groq llama-3.3-70b         – free, 30 req/min, no hard daily cap
 *      Groq llama-3.2-11b-vision  – for image/vision calls on Groq
 *   5. OpenAI gpt-4o-mini         – final fallback (needs OPENAI_API_KEY)
 *
 * All functions fall back gracefully — API failure never crashes the pipeline.
 */

"use strict";

const { GoogleGenerativeAI } = require("@google/generative-ai");
const OpenAI = require("openai");
const Tesseract = require("tesseract.js");
const os   = require("os");
const path = require("path");
const fs   = require("fs");

// ─── Model cascade ────────────────────────────────────────────────────────────
const GEMINI_MODELS = [
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-1.5-flash",
];

// Track which Gemini model is currently working (-1 = all exhausted → use Groq/OpenAI)
let _activeModelIndex = 0;
let _genAI            = null;
let _groqClient       = null;
let _openaiClient     = null;

function getGeminiAI() {
    if (_genAI) return _genAI;
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey && apiKey.startsWith("AIza")) {
        _genAI = new GoogleGenerativeAI(apiKey);
    }
    return _genAI;
}

function getGroqClient() {
    if (_groqClient) return _groqClient;
    const key = process.env.GROQ_API_KEY;
    if (key && key.startsWith("gsk_")) {
        // Groq uses an OpenAI-compatible REST API — just a different baseURL + model names
        _groqClient = new OpenAI({ apiKey: key, baseURL: "https://api.groq.com/openai/v1" });
    }
    return _groqClient;
}

function getOpenAIFallback() {
    if (_openaiClient) return _openaiClient;
    const key = process.env.OPENAI_API_KEY;
    if (key && key.startsWith("sk-")) {
        _openaiClient = new OpenAI({ apiKey: key });
    }
    return _openaiClient;
}

/**
 * Returns the currently active Gemini GenerativeModel, or null if all
 * Gemini models are quota-exhausted.
 */
function getGeminiModel() {
    const ai = getGeminiAI();
    if (!ai || _activeModelIndex >= GEMINI_MODELS.length) return null;
    const name = GEMINI_MODELS[_activeModelIndex];
    return ai.getGenerativeModel({ model: name });
}

function currentModelName() {
    if (_activeModelIndex < GEMINI_MODELS.length) return GEMINI_MODELS[_activeModelIndex];
    if (process.env.GROQ_API_KEY?.startsWith("gsk_")) return "llama-3.3-70b-versatile (Groq)";
    return "gpt-4o-mini (OpenAI fallback)";
}

/**
 * Call Gemini with automatic model cascade on quota errors.
 * If all Gemini models are exhausted, falls back to OpenAI gpt-4o-mini.
 *
 * @param {string|Array} parts  - prompt string, or [textPart, imagePart] array
 * @param {string}       stage  - label for warning messages
 * @returns {{ text: string, usedOpenAI: boolean } | null}
 */
async function callLLM(parts, stage) {
    // ── Try Gemini models in cascade order ────────────────────────────────
    while (_activeModelIndex < GEMINI_MODELS.length) {
        const model = getGeminiModel();
        try {
            const result = await model.generateContent(parts);
            const text   = result.response.text().trim();
            // Log when cascade advances so it's visible in the console
            if (_activeModelIndex > 0) {
                console.log(`ℹ️  [LLM] Using fallback model: ${GEMINI_MODELS[_activeModelIndex]}`);
            }
            return { text, usedOpenAI: false };
        } catch (err) {
            const isSkip =
                err?.message?.includes("429") ||
                err?.message?.toLowerCase().includes("quota") ||
                err?.message?.includes("404") ||
                err?.message?.toLowerCase().includes("not found") ||
                err?.message?.toLowerCase().includes("not supported");

            if (isSkip) {
                console.warn(
                    `⚠️  [${stage}] ${GEMINI_MODELS[_activeModelIndex]} unavailable (${err.message.slice(0, 60)}) — trying next`
                );
                _activeModelIndex++;
                // Re-initialise model instance for next model in cascade
                continue;
            }
            // Non-quota error — re-throw so callers handle it
            throw err;
        }
    }

    // ── Shared helper: build OpenAI-format messages from parts ───────────
    // Used by both the Groq and OpenAI fallback blocks below.
    function buildMessages() {
        if (!Array.isArray(parts)) {
            return [{ role: "user", content: parts }];
        }
        // Vision call: [textString, { inlineData: { mimeType, data } }]
        const textPart  = parts.find(p => typeof p === "string");
        const imagePart = parts.find(p => p?.inlineData);
        const content   = [];
        if (textPart)  content.push({ type: "text", text: textPart });
        if (imagePart) content.push({
            type: "image_url",
            image_url: {
                url: `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`,
                detail: "high",
            },
        });
        return [{ role: "user", content }];
    }

    const isVisionCall = Array.isArray(parts) && parts.some(p => p?.inlineData);

    // ── All Gemini models exhausted → try Groq (free, 30 req/min) ────────
    // Text model: llama-3.3-70b-versatile  |  Vision: meta-llama/llama-4-scout-17b-16e-instruct
    const groq = getGroqClient();
    if (groq) {
        const groqModel = isVisionCall ? "meta-llama/llama-4-scout-17b-16e-instruct" : "llama-3.3-70b-versatile";
        try {
            const response = await groq.chat.completions.create({
                model: groqModel,
                messages: buildMessages(),
                temperature: 0,
                max_tokens: isVisionCall ? 1000 : 400,
            });
            const text = response.choices[0]?.message?.content?.trim() || "";
            console.log(`ℹ️  [${stage}] Using Groq ${groqModel} (all Gemini quotas exhausted)`);
            return { text, usedOpenAI: false };
        } catch (err) {
            const isRateLimit =
                err?.message?.includes("429") ||
                err?.message?.toLowerCase().includes("rate limit") ||
                err?.message?.toLowerCase().includes("quota");
            if (isRateLimit) {
                console.warn(`⚠️  [${stage}] Groq rate-limited — trying OpenAI`);
            } else {
                console.warn(`⚠️  [${stage}] Groq failed: ${err.message} — trying OpenAI`);
            }
        }
    }

    // ── All Groq quota used → try OpenAI (final fallback) ────────────────
    const openai = getOpenAIFallback();
    if (!openai) return null;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: buildMessages(),
            temperature: 0,
            // Use more tokens for vision/OCR calls (images can contain long text)
            max_tokens: isVisionCall ? 1000 : 300,
        });
        const text = response.choices[0]?.message?.content?.trim() || "";
        console.log(`ℹ️  [${stage}] Using OpenAI gpt-4o-mini (all Gemini + Groq quotas exhausted)`);
        return { text, usedOpenAI: true };
    } catch (err) {
        console.warn(`⚠️  [${stage}] OpenAI fallback also failed: ${err.message}`);
        return null;
    }
}

// ─── Utility: strip ```json … ``` fences ─────────────────────────────────────
function cleanJSON(raw = "") {
    return raw
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();
}

// ─── Nominatim geocoding (OpenStreetMap, free, no API key) ───────────────────
/**
 * Resolve any place name to coordinates using the Nominatim API.
 * Restricted to Sri Lanka (countrycodes=lk).
 * Returns { lat, lng, district, province } or null on failure.
 */
async function geocodeWithNominatim(placeName) {
    if (!placeName) return null;
    try {
        const q   = encodeURIComponent(`${placeName}, Sri Lanka`);
        const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&countrycodes=lk&addressdetails=1`;
        const res = await fetch(url, {
            headers: { "User-Agent": "SriLankaDisasterMonitor/1.0 (open-source)" },
            signal:  AbortSignal.timeout(6000),
        });
        if (!res.ok) return null;
        const data = await res.json();
        if (!data?.length) return null;

        const item = data[0];
        const addr = item.address || {};

        // county = "Galle District"  →  "Galle"
        const rawDistrict = addr.county || addr.state_district || null;
        const district    = rawDistrict
            ? rawDistrict.replace(/\s*district\s*/i, "").trim()
            : null;

        // state = "Southern Province"  →  "Southern"
        const rawProvince = addr.state || null;
        const province    = rawProvince
            ? rawProvince.replace(/\s*province\s*/i, "").trim()
            : null;

        return {
            lat: parseFloat(item.lat),
            lng: parseFloat(item.lon),
            district,
            province,
        };
    } catch (err) {
        console.warn(`⚠️  Nominatim failed for "${placeName}": ${err.message}`);
        return null;
    }
}

// Sri Lanka district → province + coordinate lookup
const DISTRICT_COORDINATES = {
    Colombo: { lat: 6.9271, lng: 79.8612, province: "Western" },
    Gampaha: { lat: 7.0917, lng: 80.0, province: "Western" },
    Kalutara: { lat: 6.5854, lng: 79.9607, province: "Western" },
    Kandy: { lat: 7.2906, lng: 80.6337, province: "Central" },
    Matale: { lat: 7.4675, lng: 80.6234, province: "Central" },
    "Nuwara Eliya": { lat: 6.9497, lng: 80.7891, province: "Central" },
    Galle: { lat: 6.0535, lng: 80.2210, province: "Southern" },
    Matara: { lat: 5.9549, lng: 80.5550, province: "Southern" },
    Hambantota: { lat: 6.1429, lng: 81.1212, province: "Southern" },
    Jaffna: { lat: 9.6615, lng: 80.0255, province: "Northern" },
    Kilinochchi: { lat: 9.3803, lng: 80.3770, province: "Northern" },
    Mannar: { lat: 8.9810, lng: 79.9044, province: "Northern" },
    Vavuniya: { lat: 8.7514, lng: 80.4971, province: "Northern" },
    Mullaitivu: { lat: 9.2671, lng: 80.8128, province: "Northern" },
    Batticaloa: { lat: 7.7170, lng: 81.7000, province: "Eastern" },
    Ampara: { lat: 7.2992, lng: 81.6747, province: "Eastern" },
    Trincomalee: { lat: 8.5874, lng: 81.2152, province: "Eastern" },
    Kurunegala: { lat: 7.4863, lng: 80.3647, province: "North Western" },
    Puttalam: { lat: 8.0362, lng: 79.8283, province: "North Western" },
    Anuradhapura: { lat: 8.3114, lng: 80.4037, province: "North Central" },
    Polonnaruwa: { lat: 7.9403, lng: 81.0188, province: "North Central" },
    Badulla: { lat: 6.9934, lng: 81.0550, province: "Uva" },
    Monaragala: { lat: 6.8728, lng: 81.3507, province: "Uva" },
    Ratnapura: { lat: 6.6828, lng: 80.3992, province: "Sabaragamuwa" },
    Kegalle: { lat: 7.2513, lng: 80.3464, province: "Sabaragamuwa" },
};

// Sinhala district name → English district name
const SINHALA_DISTRICT_MAP = {
    "කොළඹ":          "Colombo",
    "ගම්පහ":         "Gampaha",
    "කළුතර":         "Kalutara",
    "මහනුවර":        "Kandy",
    "කන්දය":         "Kandy",
    "නුවර":          "Nuwara Eliya",
    "නුවරඑළිය":      "Nuwara Eliya",
    "ගාල්ල":         "Galle",
    "මාතර":          "Matara",
    "හම්බන්තොට":     "Hambantota",
    "යාපනය":         "Jaffna",
    "කිලිනොච්චිය":   "Kilinochchi",
    "මන්නාරම":       "Mannar",
    "වවුනියාව":      "Vavuniya",
    "මුලතිව්":       "Mullaitivu",
    "මඩකලපුව":       "Batticaloa",
    "අම්පාර":        "Ampara",
    "ත්‍රිකෝණමාලය": "Trincomalee",
    "කුරුණෑගල":      "Kurunegala",
    "පුත්තලම":       "Puttalam",
    "අනුරාධපුර":     "Anuradhapura",
    "පොළොන්නරුව":    "Polonnaruwa",
    "බදුල්ල":        "Badulla",
    "මොනරාගල":       "Monaragala",
    "රත්නපුර":       "Ratnapura",
    "කෑගල්ල":        "Kegalle",
    "මාතලේ":         "Matale",
};

// Tamil district name → English district name
const TAMIL_DISTRICT_MAP = {
    "கொழும்பு":       "Colombo",
    "கம்பஹா":         "Gampaha",
    "களுத்துறை":      "Kalutara",
    "கண்டி":          "Kandy",
    "மாத்தளை":        "Matale",
    "நுவரெலியா":      "Nuwara Eliya",
    "காலி":           "Galle",
    "மாத்தறை":        "Matara",
    "அம்பாந்தோட்டை":  "Hambantota",
    "யாழ்ப்பாணம்":    "Jaffna",
    "கிளிநொச்சி":     "Kilinochchi",
    "மன்னார்":        "Mannar",
    "வவுனியா":        "Vavuniya",
    "முல்லைத்தீவு":   "Mullaitivu",
    "மட்டக்களப்பு":   "Batticaloa",
    "அம்பாறை":        "Ampara",
    "திருகோணமலை":     "Trincomalee",
    "குருநாகல்":      "Kurunegala",
    "புத்தளம்":       "Puttalam",
    "அனுராதபுரம்":    "Anuradhapura",
    "பொலன்னறுவை":     "Polonnaruwa",
    "பதுளை":          "Badulla",
    "மொனராகலை":       "Monaragala",
    "இரத்தினபுரி":    "Ratnapura",
    "கேகாலை":         "Kegalle",
};

// ─── Keyword fallback (no LLM needed) ────────────────────────────────────────
/**
 * 1. English/Sinhala/Tamil district keyword match  → Nominatim for exact coords
 * 2. Capitalized word scan (English)               → Nominatim
 * 3. Hardcoded district coords                     → last resort when offline
 */
async function extractLocationByKeyword(text) {
    const upperText = text.toUpperCase();

    // Helper: geocode a matched district name, fall back to hardcoded coords
    async function resolveDistrict(district, info) {
        const geo = await geocodeWithNominatim(district);
        return {
            primary:    district,
            district,
            province:   geo?.province  || info?.province || null,
            coordinates: { lat: geo?.lat ?? info?.lat ?? null, lng: geo?.lng ?? info?.lng ?? null },
        };
    }

    // 1. English district names
    for (const [district, info] of Object.entries(DISTRICT_COORDINATES)) {
        if (upperText.includes(district.toUpperCase())) {
            return resolveDistrict(district, info);
        }
    }
    // 2. Sinhala district names
    for (const [siName, district] of Object.entries(SINHALA_DISTRICT_MAP)) {
        if (text.includes(siName)) {
            return resolveDistrict(district, DISTRICT_COORDINATES[district]);
        }
    }
    // 3. Tamil district names
    for (const [taName, district] of Object.entries(TAMIL_DISTRICT_MAP)) {
        if (text.includes(taName)) {
            return resolveDistrict(district, DISTRICT_COORDINATES[district]);
        }
    }

    // 4. Scan capitalised English words — try each as a potential Sri Lanka place
    const SKIP = /^(The|And|For|With|Need|Help|People|Army|Major|Heavy|Flash|Urgent|Please|Alert|Warning|Update|News|Report|Area|Zone|Road|Street|High|Low)$/i;
    const candidates = text.match(/\b[A-Z][a-z]{2,}(?:\s[A-Z][a-z]{2,})?\b/g) || [];
    for (const word of candidates) {
        if (SKIP.test(word)) continue;
        const geo = await geocodeWithNominatim(word);
        if (geo?.lat) {
            return {
                primary:    word,
                district:   geo.district || null,
                province:   geo.province || null,
                coordinates: { lat: geo.lat, lng: geo.lng },
            };
        }
    }

    // 5. Country-level fallback
    if (upperText.includes("SRI LANKA") || text.includes("ශ්‍රී ලංකා") || text.includes("இலங்கை")) {
        return { primary: "Sri Lanka", district: null, province: null,
            coordinates: { lat: 7.8731, lng: 80.7718 } };
    }
    return { primary: null, district: null, province: null,
        coordinates: { lat: null, lng: null } };
}

// ─── Stage 7 : Geolocation Extraction ────────────────────────────────────────
/**
 * Two-step pipeline:
 *  Step 1 — LLM extracts the primary place name + district from free text
 *  Step 2 — Nominatim geocodes that name to exact lat/lng + district/province
 * Falls back to keyword scan + Nominatim when LLM is unavailable.
 *
 * @param   {string} text  – Tweet/post text (SI / TA / EN)
 * @returns {{ primary, district, province, coordinates: { lat, lng } }}
 */
async function extractGeolocation(text) {
    // ── Step 1: extract the place name ──────────────────────────────────────
    let primaryName  = null;
    let llmDistrict  = null;
    let llmProvince  = null;

    const prompt = `You are a geolocation assistant for Sri Lanka disaster monitoring.

Read this social media post (may be Sinhala, Tamil, or English) and extract the most specific location mentioned.

Post: "${text}"

Respond with ONLY a valid JSON object — no markdown:
{
  "primary": "most specific location name (town, city, or area) or null",
  "district": "Sri Lanka district name or null",
  "province": "Sri Lanka province or null"
}

Sri Lanka districts: Colombo, Gampaha, Kalutara, Kandy, Matale, Nuwara Eliya, Galle, Matara, Hambantota, Jaffna, Kilinochchi, Mannar, Vavuniya, Mullaitivu, Batticaloa, Ampara, Trincomalee, Kurunegala, Puttalam, Anuradhapura, Polonnaruwa, Badulla, Monaragala, Ratnapura, Kegalle.
If no Sri Lanka location is mentioned, return null for all fields.`;

    try {
        const res = await callLLM(prompt, "Stage 7");
        if (res) {
            const parsed = JSON.parse(cleanJSON(res.text));
            primaryName = parsed.primary  || null;
            llmDistrict = parsed.district || null;
            llmProvince = parsed.province || null;
        }
    } catch (_) { /* fall through to keyword scan */ }

    // ── Step 2: geocode with Nominatim ───────────────────────────────────────
    // Try most-specific name first, fall back to district name
    const nameToGeocode = primaryName || llmDistrict;
    if (nameToGeocode) {
        const geo = await geocodeWithNominatim(nameToGeocode);
        if (geo?.lat) {
            return {
                primary:    primaryName  || llmDistrict,
                district:   geo.district  || llmDistrict  || null,
                province:   geo.province  || llmProvince  || null,
                coordinates: { lat: geo.lat, lng: geo.lng },
            };
        }
        // Nominatim found nothing for town — retry with district name
        if (primaryName && llmDistrict && primaryName !== llmDistrict) {
            const geo2 = await geocodeWithNominatim(llmDistrict);
            if (geo2?.lat) {
                return {
                    primary:    primaryName,
                    district:   llmDistrict,
                    province:   geo2.province || llmProvince || null,
                    coordinates: { lat: geo2.lat, lng: geo2.lng },
                };
            }
        }
        // Last resort: hardcoded district table
        const lookup = llmDistrict ? DISTRICT_COORDINATES[llmDistrict] : null;
        if (lookup) {
            return {
                primary:    primaryName || llmDistrict,
                district:   llmDistrict,
                province:   llmProvince || lookup.province,
                coordinates: { lat: lookup.lat, lng: lookup.lng },
            };
        }
    }

    // ── No LLM result — keyword scan + Nominatim ─────────────────────────────
    return extractLocationByKeyword(text);
}

// ─── Stage 8 : Nude-Content Filter ───────────────────────────────────────────
// Explicit-language keyword list used as fast pre-LLM check and LLM fallback
const EXPLICIT_KEYWORDS = [
    "sex", "sexy", "nude", "naked", "porn", "pornography", "xxx", "nsfw",
    "fucking", "fucked", "fuck", "fucker", "fucks",
    "shit", "bullshit", "cunt", "dick", "cock", "pussy", "boob", "boobs",
    "tits", "ass", "arse", "bitch", "whore", "slut", "horny", "erotic",
    // Sinhala transliterations (romanised)
    "kella", "hukana", "hukanawa",
];

/**
 * Detects sexually explicit language in tweet text (text-level only).
 *
 * @param   {string}   text       – Tweet text
 * @param   {string[]} mediaUrls  – Attached media URLs (for context only)
 * @returns {{ isNudeFiltered: boolean, nudeFilterReason: string|null }}
 */
async function filterNudeContent(text, mediaUrls = []) {
    // ── Keyword pre-check (works even when LLM quota is exhausted) ───────────
    const lowerText = text.toLowerCase();
    const hitWord   = EXPLICIT_KEYWORDS.find(w =>
        new RegExp(`(?<![a-z])${w}(?![a-z])`, "i").test(lowerText)
    );
    if (hitWord) {
        console.log(`🔞 [Stage 8] Explicit keyword "${hitWord}" detected — filtered without LLM`);
        return { isNudeFiltered: true, nudeFilterReason: `Explicit language detected: "${hitWord}"` };
    }

    const prompt = `You are a content safety classifier for a disaster monitoring system.

Analyze this social media post text for sexually explicit or nude content UNRELATED to disaster reporting.

Post: "${text}"
Has media attached: ${mediaUrls.length > 0}

Respond with ONLY a valid JSON object:
{
  "isNudeContent": true or false,
  "reason": "short reason if flagged, or null"
}

IMPORTANT: Do NOT flag disaster content (injured bodies, flood victims) as nude. Only flag explicit sexual language.`;

    try {
        const res = await callLLM(prompt, "Stage 8");
        if (!res) return { isNudeFiltered: false, nudeFilterReason: null };
        const parsed = JSON.parse(cleanJSON(res.text));
        return {
            isNudeFiltered:   parsed.isNudeContent === true,
            nudeFilterReason: parsed.reason || null,
        };
    } catch (err) {
        const safetyBlocked =
            err?.message?.toLowerCase().includes("safety") ||
            err?.message?.toLowerCase().includes("blocked") ||
            err?.message?.toLowerCase().includes("harm");

        if (safetyBlocked) {
            console.warn("⚠️  [Stage 8] Safety block on nude-check — flagging as unsafe");
            return { isNudeFiltered: true, nudeFilterReason: "Safety block" };
        }
        console.warn(`⚠️  [Stage 8] Nude filter error: ${err.message}`);
        return { isNudeFiltered: false, nudeFilterReason: null };
    }
}

// ─── Stage 9 : General Content Filter ────────────────────────────────────────
// Spam / hate / off-topic indicators (keyword fallback for when LLM is unavailable)
const SPAM_KEYWORDS = [
    // Purchase / advertisement
    "buy now", "buy it now", "shop now", "order now", "click here", "click to buy",
    "limited offer", "limited time", "exclusive deal", "special offer", "best price",
    "discount", "promo code", "coupon", "sale now", "free shipping",
    // Self-promotion / social spam
    "subscribe", "follow me", "follow us", "dm me", "link in bio", "check my profile",
    "onlyfans", "only fans", "giveaway", "win a prize", "retweet to win",
    // Financial spam
    "make money", "earn cash", "earn money", "work from home", "passive income",
    "investment opportunity", "get rich", "financial freedom",
    "casino", "betting", "sports bet", "online gambling",
    "crypto", "bitcoin", "ethereum", "nft", "token sale", "forex", "trading signals",
];

/**
 * Filters spam, AI-generated text, and completely off-topic posts.
 * Runs keyword pre-check before LLM so it works without quota.
 *
 * @param   {string} text
 * @returns {{ isFiltered: boolean, reason: string|null }}
 */
async function filterContent(text) {
    // ── Keyword pre-check ────────────────────────────────────────────────────
    const lowerText = text.toLowerCase();
    const spamHit   = SPAM_KEYWORDS.find(w => lowerText.includes(w));
    if (spamHit) {
        console.log(`🚫 [Stage 9] Spam keyword "${spamHit}" detected — filtered without LLM`);
        return { isFiltered: true, reason: `Spam/off-topic content: "${spamHit}"` };
    }

    const prompt = `You are a content moderation assistant for a Sri Lanka disaster monitoring dashboard.

Decide if this social media post should be FILTERED OUT (excluded from the dashboard).

Post: "${text}"

Filter ONLY if the post is:
1. Clearly AI-generated filler or automated bot content
2. Spam / advertising / promotion with no disaster relevance
3. Completely unrelated to disasters, emergencies, accidents, or public safety
4. Hate speech unrelated to any disaster event

Do NOT filter: genuine disaster reports, help requests, rescue updates, news reports.

Respond with ONLY a valid JSON object:
{
  "isFiltered": true or false,
  "reason": "brief reason if filtered, or null"
}`;

    try {
        const res = await callLLM(prompt, "Stage 9");
        if (!res) return { isFiltered: false, reason: null };
        return JSON.parse(cleanJSON(res.text));
    } catch (err) {
        console.warn(`⚠️  [Stage 9] Content filter error: ${err.message}`);
        return { isFiltered: false, reason: null };
    }
}

// ─── Image text extraction (uploaded Buffer → OCR) ────────────────────────────
/**
 * Extract readable text from an uploaded image.
 * Pipeline:
 *   1. Try Gemini vision (cascade) / OpenAI vision — best quality
 *   2. Fall back to Tesseract.js local OCR — works with zero API quota
 *
 * @param   {Buffer} imageBuffer  – Raw image bytes from multer memory storage
 * @param   {string} mimeType     – e.g. "image/jpeg", "image/png", "image/webp"
 * @returns {string}              – Extracted text, or "" if nothing found
 */
async function extractTextFromImage(imageBuffer, mimeType = "image/jpeg") {
    const imagePart = {
        inlineData: { data: imageBuffer.toString("base64"), mimeType },
    };

    const textPart = `Extract ALL readable text from this image exactly as written.
Include text in any language (Sinhala, Tamil, English, etc.).
If this is a screenshot of a tweet or social media post, extract the full post text.
If this is a news article, notice board, or sign, extract the main body text.
Return ONLY the raw extracted text — no explanations, no markdown, no JSON.
If no text is visible, return the exact string: NO_TEXT_FOUND`;

    // ── Step 1: try LLM vision (Gemini cascade / OpenAI) ──────────────────
    try {
        const res = await callLLM([textPart, imagePart], "ImageOCR");
        if (res) {
            const extracted = res.text.trim();
            if (extracted && extracted !== "NO_TEXT_FOUND" && extracted.length > 2) {
                console.log(`✅ [ImageOCR] LLM extracted ${extracted.length} chars`);
                return extracted;
            }
        }
    } catch (err) {
        const safetyBlocked =
            err?.message?.toLowerCase().includes("safety") ||
            err?.message?.toLowerCase().includes("blocked");
        if (safetyBlocked) {
            throw new Error("Image blocked by safety filters — may contain unsafe content.");
        }
        console.warn(`⚠️  [ImageOCR] LLM failed: ${err.message} — trying Tesseract`);
    }

    // ── Step 2: Tesseract.js local OCR fallback ────────────────────────────
    console.log("📷 [ImageOCR] Falling back to Tesseract.js local OCR...");

    // Tesseract.js v7 workers have issues with raw Buffers — write to a
    // temp file and pass the path instead (reliable across all v7 builds).
    const ext     = mimeType.includes("png") ? ".png" : mimeType.includes("webp") ? ".webp" : ".jpg";
    const tmpPath = path.join(os.tmpdir(), `ocr_${Date.now()}${ext}`);

    try {
        fs.writeFileSync(tmpPath, imageBuffer);

        // Run English OCR first (fast + no extra language download needed)
        const { data: { text: engText } } = await Tesseract.recognize(
            tmpPath,
            "eng",
            { logger: () => {} }   // suppress verbose progress logs
        );
        const cleaned = engText.replace(/\s+/g, " ").trim();
        if (cleaned.length > 5) {
            console.log(`✅ [ImageOCR] Tesseract extracted ${cleaned.length} chars (eng)`);
            return cleaned;
        }

        // Very short output — try multilingual (handles SI/TA scripts)
        const { data: { text: multiText } } = await Tesseract.recognize(
            tmpPath,
            "eng+sin+tam",
            { logger: () => {} }
        );
        const multiCleaned = multiText.replace(/\s+/g, " ").trim();
        console.log(`✅ [ImageOCR] Tesseract multilingual extracted ${multiCleaned.length} chars`);
        return multiCleaned;
    } catch (tessErr) {
        console.warn(`⚠️  [ImageOCR] Tesseract also failed: ${tessErr.message}`);
        return "";
    } finally {
        // Always clean up the temp file
        try { fs.unlinkSync(tmpPath); } catch (_) {}
    }
}

// ─── Image analysis (URL → { isNude, isAIGenerated }) ────────────────────────
const IMAGE_ANALYSIS_PROMPT = `You are an image authenticity and safety classifier.

Analyze this image and answer:
1. Does it contain nudity or sexually explicit (NSFW) content?
2. Is it AI-generated / synthetic (e.g. Stable Diffusion, Midjourney, DALL-E, CGI)?
   Signs of AI: perfectly smooth skin, surreal lighting, warped text, extra fingers, “dreamlike” quality, unnatural textures, or no visible compression artifacts.
   Signs of a REAL photo: grain/noise, natural blur, authentic shadows, credible metadata context.

Respond with ONLY a valid JSON object — no markdown, no explanation:
{
  "isNude": true or false,
  "isAIGenerated": true or false,
  "aiConfidence": "low" | "medium" | "high",
  "reason": "one short sentence explaining the AI/real decision"
}`;

/**
 * Analyse an image supplied as a raw Buffer (multipart upload).
 * Returns { isNude, isAIGenerated, aiConfidence, reason }.
 */
async function analyzeImageBuffer(imageBuffer, mimeType = "image/jpeg") {
    const imagePart = { inlineData: { data: imageBuffer.toString("base64"), mimeType } };
    try {
        const res = await callLLM([IMAGE_ANALYSIS_PROMPT, imagePart], "ImageCheck");
        if (!res) return { isNude: false, isAIGenerated: null, aiConfidence: null, reason: "LLM unavailable" };
        const parsed = JSON.parse(cleanJSON(res.text));
        return {
            isNude:        parsed.isNude        === true,
            isAIGenerated: parsed.isAIGenerated === true,
            aiConfidence:  parsed.aiConfidence  || null,
            reason:        parsed.reason        || null,
        };
    } catch (err) {
        const safetyBlocked =
            err?.message?.toLowerCase().includes("safety") ||
            err?.message?.toLowerCase().includes("blocked") ||
            err?.message?.toLowerCase().includes("harm");
        if (safetyBlocked) return { isNude: true, isAIGenerated: false, aiConfidence: "high", reason: "Safety block" };
        console.warn(`⚠️  [analyzeImageBuffer] ${err.message}`);
        return { isNude: false, isAIGenerated: null, aiConfidence: null, reason: "Analysis error" };
    }
}

/**
 * Fetch an image from a public URL and analyse it with Gemini vision.
 * Detects nude/NSFW content and AI-generated imagery.
 *
 * Graceful safety handling:
 *  • If Gemini throws a safety-block the image IS the problem —
 *    returns { isNude: true, isAIGenerated: false } so the pipeline
 *    filters it without crashing.
 *
 * @param   {string} imageUrl  – Publicly accessible image URL
 * @returns {{ isNude: boolean, isAIGenerated: boolean }}
 */
async function analyzeImage(imageUrl) {
    try {
        const response = await fetch(imageUrl, {
            headers: { "User-Agent": "DisasterMonitorBot/1.0" },
            signal:  AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status} fetching image`);

        const arrayBuffer = await response.arrayBuffer();
        const base64Data  = Buffer.from(arrayBuffer).toString("base64");
        const mimeType    = response.headers.get("content-type") || "image/jpeg";

        const imagePart = { inlineData: { data: base64Data, mimeType } };
        const textPart  = `Analyze this image and answer two questions:

1. Does this image contain nudity or sexually explicit (NSFW) content?
2. Does this image appear to be AI-generated (synthetic, digital art, unrealistic textures)?

Respond with ONLY a valid JSON object — no markdown, no explanation:
{
  "isNude": true or false,
  "isAIGenerated": true or false
}`;

        const res    = await callLLM([textPart, imagePart], "ImageAnalysis");
        if (!res) return { isNude: false, isAIGenerated: false };
        const parsed = JSON.parse(cleanJSON(res.text));
        return {
            isNude:        parsed.isNude        === true,
            isAIGenerated: parsed.isAIGenerated === true,
        };
    } catch (err) {
        const safetyBlocked =
            err?.message?.toLowerCase().includes("safety") ||
            err?.message?.toLowerCase().includes("blocked") ||
            err?.message?.toLowerCase().includes("harm");
        if (safetyBlocked) {
            console.warn(`⚠️  [analyzeImage] Safety block for ${imageUrl} — marking as unsafe`);
            return { isNude: true, isAIGenerated: false };
        }
        console.warn(`⚠️  [analyzeImage] Error: ${err.message}`);
        return { isNude: false, isAIGenerated: false };
    }
}

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
    extractGeolocation,     // Stage 7  — text → location
    filterNudeContent,      // Stage 8  — text nudity check
    filterContent,          // Stage 9  — spam / AI / off-topic
    extractTextFromImage,   // Image upload OCR (Buffer)
    analyzeImage,           // Image safety + AI-gen check (public URL)
    analyzeImageBuffer,     // Image safety + AI-gen check (Buffer upload)
    DISTRICT_COORDINATES,   // Exported for other services
};
