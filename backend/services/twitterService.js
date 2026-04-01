/**
 * Twitter Service
 * Fetches disaster-related tweets via RapidAPI (twitter-v24)
 * and runs them through the exact 12-stage AI pipeline from the research report.
 *
 * ═══════════════════════════════════════════════════════════════
 *  12-STAGE PIPELINE (Research Report Aligned)
 * ═══════════════════════════════════════════════════════════════
 *  Stage  1: Data Aggregation      — Fetch from RapidAPI (twitter-v24)
 *  Stage  2: Data Collection       — Parse tweet fields, author, media
 *  Stage  3: Validation            — Check non-empty text, valid structure
 *  Stage  4: Deduplication         — Skip already-processed tweet IDs
 *  Stage  5: Detection/Classification — XLM-RoBERTa → High / Neutral/Medium
 *  Stage  6: Sentiment Analysis    — Positive / Negative / Neutral
 *  Stage  7: Geolocation Extraction — GPT-4o-mini → district, province, coords
 *  Stage  8: Nude Content Filtering — GPT-4o-mini explicit nude filter
 *  Stage  9: General Content Filter — GPT-4o-mini AI/spam/irrelevant filter
 *  Stage 10: Similarity Check      — TF-IDF cosine → misinformation/verified
 *  Stage 11: Storage               — Save to MongoDB (disaster_db)
 *  Stage 12: Post-Processing/Broadcast — Socket.io emit to all clients
 * ═══════════════════════════════════════════════════════════════
 */

const axios = require("axios");
const Tweet = require("../models/Tweet");
const { analyzeText } = require("./mlService");
const { extractGeolocation, filterContent, filterNudeContent } = require("./llmService");
const { checkSimilarity } = require("./similarityService");

// ─── Disaster Keywords (EN / SI / TA) ────────────────────────────────────────
const DISASTER_KEYWORDS = [
    // English
    "flood", "flooding", "landslide", "cyclone", "tsunami", "earthquake",
    "fire", "wildfire", "drought", "accident", "disaster", "emergency",
    "evacuation", "rescue", "collapse", "storm", "heavy rain", "mudslide",
    // Sinhala
    "ගංවතුර", "නාය යෑම", "සුළිසුළඟ", "භූකම්පා", "ගිනි",
    // Tamil
    "வெள்ளம்", "நிலச்சரிவு", "சூறாவளி", "நிலநடுக்கம்", "தீ", "அவசரநிலை",
];

// ─── Search Queries ───────────────────────────────────────────────────────────
// NOTE: Plain keyword queries are used for maximum RapidAPI plan compatibility.
// Advanced operators (OR, -is:retweet, lang:) are not supported on all tiers.
function buildSearchQueries() {
    return [
        // English — disaster events in Sri Lanka
        "flood Sri Lanka",
        "landslide Sri Lanka",
        "disaster emergency Sri Lanka",
        "cyclone storm Sri Lanka",
        // Sinhala — ගංවතුර (flood), නාය (landslide), භූකම්පා (earthquake)
        "ගංවතුර ශ්‍රී ලංකා",
        "නාය යෑම ශ්‍රී ලංකා",
        // Tamil — வெள்ளம் (flood), நிலச்சரிவு (landslide)
        "வெள்ளம் இலங்கை",
        "நிலச்சரிவு இலங்கை",
    ];
}

// ─── Stage 1: Data Aggregation — Fetch from RapidAPI ─────────────────────────
async function fetchTweetsFromAPI(query) {
    const options = {
        method: "GET",
        url: "https://twitter-v24.p.rapidapi.com/search/",
        params: { query, count: "20", type: "Latest" },
        headers: {
            "x-rapidapi-key": process.env.RAPIDAPI_KEY,
            "x-rapidapi-host": "twitter-v24.p.rapidapi.com",
        },
        timeout: 15000,
    };
    const response = await axios.request(options);

    // twitter-v24 actual response path:
    // data.search_by_raw_query.search_timeline.timeline.instructions[]
    const instructions =
        response.data?.search_by_raw_query?.search_timeline?.timeline?.instructions ||
        response.data?.timeline?.instructions || // legacy fallback
        [];

    // Find the TimelineAddEntries instruction (may not always be index 0)
    const addEntriesInstruction =
        instructions.find((i) => i.type === "TimelineAddEntries") ||
        instructions[0] ||
        {};

    const entries = addEntriesInstruction.entries || [];
    console.log(`   [Stage 1] API returned ${entries.length} entries for query`);
    return entries;
}

// ─── Stage 2: Data Collection — Parse tweet entry ─────────────────────────────
function parseTweetEntry(entry) {
    try {
        const result = entry?.content?.itemContent?.tweet_results?.result;
        if (!result) return null;

        const legacy = result.legacy;
        const user = result.core?.user_results?.result?.legacy;
        if (!legacy || !user) return null;

        // Extract media (photos, videos, GIFs)
        const mediaUrls = [];
        const mediaEntities = legacy.extended_entities?.media || legacy.entities?.media || [];
        for (const media of mediaEntities) {
            // For videos, get the highest-quality variant
            let url = media.media_url_https;
            if (media.type === "video" && media.video_info?.variants) {
                const mp4Variants = media.video_info.variants
                    .filter((v) => v.content_type === "video/mp4")
                    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
                if (mp4Variants.length > 0) url = mp4Variants[0].url;
            }
            mediaUrls.push({
                type: media.type,
                url,
                thumbnailUrl: media.media_url_https,
            });
        }

        // Detect language
        let language = "unknown";
        const langCode = legacy.lang;
        if (langCode === "en") language = "en";
        else if (langCode === "si") language = "si";
        else if (langCode === "ta") language = "ta";

        // Match keywords
        const text = (legacy.full_text || legacy.text || "").toLowerCase();
        const matchedKeywords = DISASTER_KEYWORDS.filter((kw) => text.includes(kw.toLowerCase()));

        return {
            tweetId: legacy.id_str || result.rest_id,
            text: legacy.full_text || legacy.text,
            author: {
                username: user.screen_name,
                displayName: user.name,
                profileImageUrl: user.profile_image_url_https,
                verified: user.verified || false,
            },
            createdAt: new Date(legacy.created_at),
            language,
            mediaUrls,
            matchedKeywords,
        };
    } catch {
        return null;
    }
}

// ─── Main Pipeline ────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchAndProcessTweets(io) {
    if (!process.env.RAPIDAPI_KEY || process.env.RAPIDAPI_KEY === "your_rapidapi_key_here") {
        console.warn("⚠️  RAPIDAPI_KEY not set. Skipping tweet fetch.");
        return [];
    }

    const queries = buildSearchQueries();
    const processedTweets = [];
    const seenIds = new Set();

    for (const query of queries) {
        try {
            console.log(`🔍 [Stage 1] Aggregating: "${query.substring(0, 60)}..."`);


            // ── Stage 1: Data Aggregation ──────────────────────────────────────
            const entries = await fetchTweetsFromAPI(query);

            for (const entry of entries) {

                // ── Stage 2: Data Collection (Parse) ──────────────────────────
                const raw = parseTweetEntry(entry);

                // ── Stage 3: Validation ────────────────────────────────────────
                if (!raw || !raw.tweetId || !raw.text || raw.text.trim().length < 5) {
                    continue;
                }

                // ── Stage 4: Deduplication ─────────────────────────────────────
                if (seenIds.has(raw.tweetId)) continue;
                seenIds.add(raw.tweetId);

                const exists = await Tweet.findOne({ tweetId: raw.tweetId });
                if (exists) continue;

                // ── Stage 5: Detection / ML Classification ─────────────────────
                let mlResult = {
                    label: "Neutral/Medium",
                    label_id: 0,
                    confidence: 0.5,
                    probabilities: { High: 0.5, "Neutral/Medium": 0.5 },
                    sentiment: "Neutral",
                    sentiment_score: 0,
                };
                try {
                    // Use /analyze endpoint: classification + sentiment in one call
                    mlResult = await analyzeText(raw.text);
                    console.log(`   [Stage 5] ${raw.tweetId}: ${mlResult.label} (${(mlResult.confidence * 100).toFixed(1)}%)`);
                } catch (e) {
                    console.warn(`⚠️  [Stage 5] ML failed for ${raw.tweetId}: ${e.message}`);
                }

                // ── Stage 6: Sentiment Analysis ────────────────────────────────
                // Already included in mlResult from /analyze endpoint above.
                // Logged separately for pipeline clarity:
                console.log(`   [Stage 6] Sentiment: ${mlResult.sentiment} (score: ${mlResult.sentiment_score})`);

                // ── Stage 7: Geolocation Extraction ───────────────────────────
                let location = {
                    primary: null,
                    district: null,
                    province: null,
                    coordinates: { lat: null, lng: null },
                };
                try {
                    location = await extractGeolocation(raw.text);
                    if (location.district) {
                        console.log(`   [Stage 7] Location: ${location.district}, ${location.province}`);
                    }
                } catch (e) {
                    console.warn(`⚠️  [Stage 7] Geolocation failed for ${raw.tweetId}: ${e.message}`);
                }

                // ── Stage 8: Nude Content Filtering ───────────────────────────
                let nudeResult = { isNudeFiltered: false, nudeFilterReason: null };
                try {
                    const mediaUrlStrings = raw.mediaUrls.map((m) => m.url);
                    nudeResult = await filterNudeContent(raw.text, mediaUrlStrings);
                    if (nudeResult.isNudeFiltered) {
                        console.log(`   [Stage 8] 🚫 Nude content filtered: ${nudeResult.nudeFilterReason}`);
                    }
                } catch (e) {
                    console.warn(`⚠️  [Stage 8] Nude filter failed for ${raw.tweetId}: ${e.message}`);
                }

                // ── Stage 9: General Content Filtering ────────────────────────
                let filterResult = { isFiltered: false, reason: null };
                // Skip general filter if already nude-filtered
                if (!nudeResult.isNudeFiltered) {
                    try {
                        filterResult = await filterContent(raw.text);
                        if (filterResult.isFiltered) {
                            console.log(`   [Stage 9] 🚫 Content filtered: ${filterResult.reason}`);
                        }
                    } catch (e) {
                        console.warn(`⚠️  [Stage 9] Content filter failed for ${raw.tweetId}: ${e.message}`);
                    }
                }

                // ── Stage 10: Similarity / Misinformation Check ────────────────
                let similarityResult = { isVerified: false, similarTweetIds: [] };
                try {
                    similarityResult = await checkSimilarity(raw.text, raw.tweetId);
                    if (similarityResult.isVerified) {
                        console.log(`   [Stage 10] ✅ Verified (${similarityResult.similarTweetIds.length} similar reports)`);
                    }
                } catch (e) {
                    console.warn(`⚠️  [Stage 10] Similarity failed for ${raw.tweetId}: ${e.message}`);
                }

                // ── Stage 11: Storage ──────────────────────────────────────────
                const tweet = new Tweet({
                    ...raw,
                    // Stage 5 results
                    emergencyLevel: mlResult.label,
                    confidence: mlResult.confidence,
                    probabilities: {
                        High: mlResult.probabilities?.High || 0,
                        "Neutral/Medium": mlResult.probabilities?.["Neutral/Medium"] || 0,
                    },
                    // Stage 6 results
                    sentiment: mlResult.sentiment || "Neutral",
                    sentimentScore: mlResult.sentiment_score || 0,
                    // Stage 7 results
                    location,
                    // Stage 8 results
                    isNudeFiltered: nudeResult.isNudeFiltered,
                    nudeFilterReason: nudeResult.nudeFilterReason,
                    // Stage 9 results
                    isFiltered: filterResult.isFiltered || nudeResult.isNudeFiltered,
                    filterReason: filterResult.reason || nudeResult.nudeFilterReason,
                    // Stage 10 results
                    isVerified: similarityResult.isVerified,
                    similarityScore: similarityResult.similarityScore || 0,
                    similarTweetIds: similarityResult.similarTweetIds,
                    processingStage: "stored",
                });

                await tweet.save();
                processedTweets.push(tweet);
                console.log(`   [Stage 11] 💾 Stored: ${raw.tweetId}`);

                // ── Stage 12: Post-Processing / Broadcast ──────────────────────
                if (io) {
                    const tweetObj = tweet.toObject();
                    io.emit("new_tweet", tweetObj);

                    if (tweet.emergencyLevel === "High") {
                        io.emit("high_alert", tweetObj);
                    }

                    // Emit sentiment-specific events for dashboard widgets
                    io.emit("sentiment_update", {
                        tweetId: tweet.tweetId,
                        sentiment: tweet.sentiment,
                        emergencyLevel: tweet.emergencyLevel,
                    });
                }
                console.log(`   [Stage 12] 📡 Broadcast complete\n`);
            }
        } catch (err) {
            console.error(`❌ Pipeline error for query "${query.substring(0, 40)}...": ${err.message}`);
        }

        // Throttle: wait 1.5s between queries to avoid per-second rate limits
        await sleep(1500);
    }

    return processedTweets;
}

module.exports = { fetchAndProcessTweets, DISASTER_KEYWORDS };
