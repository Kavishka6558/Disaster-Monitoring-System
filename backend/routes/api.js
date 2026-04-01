/**
 * API Routes — Disaster Monitoring System
 */
const express = require("express");
const router = express.Router();
const multer = require("multer");
const OpenAI = require("openai");
const Tweet = require("../models/Tweet");
const { analyzeText } = require("../services/mlService");
const { extractGeolocation, filterContent, filterNudeContent, extractTextFromImage, analyzeImageBuffer } = require("../services/llmService");
const { checkSimilarity } = require("../services/similarityService");
const { fetchAndProcessTweets } = require("../services/twitterService");

// ─── Multer — memory storage (no disk writes) ────────────────────────────────
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
    fileFilter: (_req, file, cb) => {
        if (file.mimetype.startsWith("image/")) cb(null, true);
        else cb(new Error("Only image files are allowed"), false);
    },
});


// ─── GET /api/tweets ──────────────────────────────────────────────────────────
router.get("/tweets", async (req, res) => {
    try {
        const { page = 1, limit = 20, emergencyLevel, district, isVerified, isFiltered = "false", language, sentiment } = req.query;
        const filter = { isFiltered: isFiltered === "true" };
        if (emergencyLevel) filter.emergencyLevel = emergencyLevel;
        if (district) filter["location.district"] = district;
        if (isVerified !== undefined) filter.isVerified = isVerified === "true";
        if (language) filter.language = language;
        if (sentiment) filter.sentiment = sentiment;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const total = await Tweet.countDocuments(filter);
        const tweets = await Tweet.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit));
        res.json({ tweets, pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) } });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /api/stats ───────────────────────────────────────────────────────────
router.get("/stats", async (req, res) => {
    try {
        const [totalPosts, highPriority, verified, sentimentBreakdown, geoDistribution, languageBreakdown, recentHigh, nudeFiltered, generalFiltered] = await Promise.all([
            Tweet.countDocuments({ isFiltered: false }),
            Tweet.countDocuments({ emergencyLevel: "High", isFiltered: false }),
            Tweet.countDocuments({ isVerified: true, isFiltered: false }),
            Tweet.aggregate([{ $match: { isFiltered: false } }, { $group: { _id: "$sentiment", count: { $sum: 1 } } }]),
            Tweet.aggregate([
                { $match: { isFiltered: false, "location.district": { $ne: null } } },
                { $group: { _id: "$location.district", count: { $sum: 1 }, province: { $first: "$location.province" }, highCount: { $sum: { $cond: [{ $eq: ["$emergencyLevel", "High"] }, 1, 0] } } } },
                { $sort: { count: -1 } }, { $limit: 10 },
            ]),
            Tweet.aggregate([{ $match: { isFiltered: false } }, { $group: { _id: "$language", count: { $sum: 1 } } }]),
            Tweet.find({ emergencyLevel: "High", isFiltered: false }).sort({ createdAt: -1 }).limit(5).select("text author location createdAt confidence sentiment"),
            Tweet.countDocuments({ isNudeFiltered: true }),
            Tweet.countDocuments({ isFiltered: true, isNudeFiltered: false }),
        ]);
        const sentimentMap = { Positive: 0, Negative: 0, Neutral: 0 };
        for (const s of sentimentBreakdown) { if (s._id && sentimentMap[s._id] !== undefined) sentimentMap[s._id] = s.count; }
        res.json({ totalPosts, highPriority, neutralMedium: totalPosts - highPriority, verified, sentiment: sentimentMap, geoDistribution, languageBreakdown, recentHighAlerts: recentHigh, filtered: { nudeContent: nudeFiltered, general: generalFiltered, total: nudeFiltered + generalFiltered } });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /api/tweets/map ──────────────────────────────────────────────────────
router.get("/tweets/map", async (req, res) => {
    try {
        const tweets = await Tweet.find({ isFiltered: false, "location.coordinates.lat": { $ne: null } })
            .sort({ createdAt: -1 }).limit(200)
            .select("tweetId text emergencyLevel confidence sentiment location author createdAt mediaUrls isVerified");
        res.json(tweets);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /api/tweets/nearby ───────────────────────────────────────────────────
router.get("/tweets/nearby", async (req, res) => {
    try {
        const { lat, lng, radiusKm = 50 } = req.query;
        if (!lat || !lng) return res.status(422).json({ error: "lat and lng are required" });
        const tweets = await Tweet.find({ isFiltered: false, geoPoint: { $near: { $geometry: { type: "Point", coordinates: [parseFloat(lng), parseFloat(lat)] }, $maxDistance: parseFloat(radiusKm) * 1000 } } })
            .limit(50).select("tweetId text emergencyLevel confidence sentiment location author createdAt");
        res.json(tweets);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── POST /api/test ───────────────────────────────────────────────────────────
router.post("/test", async (req, res) => {
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(422).json({ error: "Text is required" });
    const result = { text, stages: {} };
    try {
        try { result.stages.mlClassification = await analyzeText(text); } catch (e) { result.stages.mlClassification = { error: e.message }; }
        try { result.stages.geolocation = await extractGeolocation(text); } catch (e) { result.stages.geolocation = { error: e.message }; }
        try { result.stages.nudeContentFilter = await filterNudeContent(text, []); } catch (e) { result.stages.nudeContentFilter = { error: e.message }; }
        try { result.stages.contentFilter = await filterContent(text); } catch (e) { result.stages.contentFilter = { error: e.message }; }
        try { result.stages.similarity = await checkSimilarity(text, `test_${Date.now()}`); } catch (e) { result.stages.similarity = { error: e.message }; }
        result.summary = {
            emergencyLevel: result.stages.mlClassification?.label || "Unknown",
            confidence: result.stages.mlClassification?.confidence || 0,
            sentiment: result.stages.mlClassification?.sentiment || "Neutral",
            sentimentScore: result.stages.mlClassification?.sentiment_score || 0,
            location: result.stages.geolocation || null,
            isNudeFiltered: result.stages.nudeContentFilter?.isNudeFiltered || false,
            isFiltered: result.stages.contentFilter?.isFiltered || false,
            filterReason: result.stages.contentFilter?.reason || null,
            isVerified: result.stages.similarity?.isVerified || false,
        };
        res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── POST /api/fetch ──────────────────────────────────────────────────────────
router.post("/fetch", async (req, res) => {
    try {
        const io = req.app.get("io");
        const newTweets = await fetchAndProcessTweets(io);
        res.json({ message: `Fetched and processed ${newTweets.length} new tweets` });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /api/stats/timeline ──────────────────────────────────────────────────
router.get("/stats/timeline", async (req, res) => {
    try {
        const cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - 18);
        const timeline = await Tweet.aggregate([
            { $match: { isFiltered: false, createdAt: { $gte: cutoff } } },
            { $group: { _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } }, total: { $sum: 1 }, high: { $sum: { $cond: [{ $eq: ["$emergencyLevel", "High"] }, 1, 0] } }, neutral: { $sum: { $cond: [{ $ne: ["$emergencyLevel", "High"] }, 1, 0] } }, verified: { $sum: { $cond: ["$isVerified", 1, 0] } }, negSentiment: { $sum: { $cond: [{ $eq: ["$sentiment", "Negative"] }, 1, 0] } } } },
            { $sort: { "_id.year": 1, "_id.month": 1 } },
        ]);
        res.json(timeline);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── POST /api/import-historical ─────────────────────────────────────────────
router.post("/import-historical", async (req, res) => {
    try {
        const axios = require("axios");
        const ML_URL = process.env.ML_SERVICE_URL || "http://localhost:8001";
        const clear = req.query.clear === "true";
        const DC = { Colombo: { lat: 6.9271, lng: 79.8612, province: "Western" }, Gampaha: { lat: 7.0917, lng: 80.0, province: "Western" }, Kalutara: { lat: 6.5854, lng: 79.9607, province: "Western" }, Kandy: { lat: 7.2906, lng: 80.6337, province: "Central" }, Matale: { lat: 7.4675, lng: 80.6234, province: "Central" }, "Nuwara Eliya": { lat: 6.9497, lng: 80.7891, province: "Central" }, Galle: { lat: 6.0535, lng: 80.221, province: "Southern" }, Matara: { lat: 5.9549, lng: 80.555, province: "Southern" }, Hambantota: { lat: 6.1429, lng: 81.1212, province: "Southern" }, Jaffna: { lat: 9.6615, lng: 80.0255, province: "Northern" }, Vavuniya: { lat: 8.7514, lng: 80.4971, province: "Northern" }, Batticaloa: { lat: 7.7102, lng: 81.6924, province: "Eastern" }, Ampara: { lat: 7.2992, lng: 81.6747, province: "Eastern" }, Trincomalee: { lat: 8.5711, lng: 81.2335, province: "Eastern" }, Kurunegala: { lat: 7.4818, lng: 80.3609, province: "North Western" }, Ratnapura: { lat: 6.6828, lng: 80.4027, province: "Sabaragamuwa" }, Kegalle: { lat: 7.2513, lng: 80.3464, province: "Sabaragamuwa" }, Anuradhapura: { lat: 8.3114, lng: 80.4037, province: "North Central" }, Polonnaruwa: { lat: 7.9403, lng: 81.0188, province: "North Central" }, Badulla: { lat: 6.9934, lng: 81.055, province: "Uva" }, Monaragala: { lat: 6.8728, lng: 81.3506, province: "Uva" }, Puttalam: { lat: 8.0362, lng: 79.8283, province: "North Western" } };
        const C = [
            { text: "Severe flooding in Colombo district. Roads submerged, hundreds displaced urgently.", district: "Colombo", lang: "en", month: 8 }, { text: "Gampaha hit by flash floods. River Kelani overflowing its banks.", district: "Gampaha", lang: "en", month: 8 }, { text: "Kalutara coastal areas flooded by monsoon rains. Rescue teams deployed.", district: "Kalutara", lang: "en", month: 8 }, { text: "Houses collapsed in Ratnapura due to waterlogging and soil erosion.", district: "Ratnapura", lang: "en", month: 8 }, { text: "NDRS evacuating 500 families in Colombo as flood waters rise.", district: "Colombo", lang: "en", month: 8 }, { text: "Air Force helicopters rescue stranded people in Kegalle. Emergency declared.", district: "Kegalle", lang: "en", month: 8 }, { text: "Landslide warning for Kegalle district due to continuous rain.", district: "Kegalle", lang: "en", month: 8 }, { text: "Flood alert level 3 for Attanagalu Oya. Residents in Ja-Ela advised to evacuate.", district: "Gampaha", lang: "en", month: 8 }, { text: "1000 people in temporary shelters in Ratnapura after landslides.", district: "Ratnapura", lang: "en", month: 8 }, { text: "Flood levels rising in Matara. Fisher communities warned of dangerous seas.", district: "Matara", lang: "en", month: 8 }, { text: "ගල්කිස්ස ප්‍රදේශයේ ගංවතුර. ගොඩනැඟිලි 10කට නාය ගොස්.", district: "Colombo", lang: "si", month: 8 }, { text: "ගම්පහ ගංවතුර! රතු කුරුස සංවිධානය ආපදා ප්‍රතිචාරය සඳහා සූදානම්.", district: "Gampaha", lang: "si", month: 8 }, { text: "රත්නපුර දිස්ත්‍රික්කයේ නාය 5ක්. ජනතා ජීවිත අනතුරේ.", district: "Ratnapura", lang: "si", month: 8 }, { text: "கொழும்பு மாவட்டத்தில் வெள்ளப்பெருக்கு. 200 குடும்பங்கள் பாதிக்கப்பட்டுள்ளன.", district: "Colombo", lang: "ta", month: 8 }, { text: "கேகாலை மாவட்டத்தில் நிலச்சரிவு. மலைவாழ் மக்கள் வெளியேற்றம்.", district: "Kegalle", lang: "ta", month: 8 }, { text: "Colombo port road flooded. Vehicles stranded, transport disrupted.", district: "Colombo", lang: "en", month: 8 },
            { text: "Badulla: Severe landslide blocks Ella-Badulla road. Emergency crews clearing.", district: "Badulla", lang: "en", month: 9 }, { text: "Flash flood warning for Kelani River. Water at Hanwella exceeding 10m.", district: "Kandy", lang: "en", month: 9 }, { text: "Matale: 47 families evacuated after mudslide damages homes.", district: "Matale", lang: "en", month: 9 }, { text: "Heavy rain causing severe flooding in Batticaloa. Roads submerged.", district: "Batticaloa", lang: "en", month: 9 }, { text: "Nuwara Eliya landslide kills 2 plantation workers. Search continues.", district: "Nuwara Eliya", lang: "en", month: 9 }, { text: "Landslide buries vehicles on Colombo-Kandy highway near Kegalle.", district: "Kegalle", lang: "en", month: 9 }, { text: "Trincomalee coast hit by tidal surge. Fishing boats damaged.", district: "Trincomalee", lang: "en", month: 9 }, { text: "Ampara: emergency shelters for 800 flood-affected families.", district: "Ampara", lang: "en", month: 9 }, { text: "Emergency declared in Badulla after multiple village landslides.", district: "Badulla", lang: "en", month: 9 }, { text: "Galle face flooded. Fishing communities displaced in Matara.", district: "Matara", lang: "en", month: 9 }, { text: "කෑගල්ල රත්නගිරිය ප්‍රදේශයේ නාය. 15 ගෙවල් ආවරණය.", district: "Kegalle", lang: "si", month: 9 }, { text: "ගාල්ල ගංවතුර - ධීවරයින් 60 ගලවා ගැනීම.", district: "Galle", lang: "si", month: 9 }, { text: "மட்டக்களப்பில் வெள்ளம். 300 குடும்பங்கள் இடம்பெயர்ந்துள்ளன.", district: "Batticaloa", lang: "ta", month: 9 }, { text: "நுவரெலியா நிலச்சரிவில் தொழிலாளர்கள் காணாமல்போனர்.", district: "Nuwara Eliya", lang: "ta", month: 9 }, { text: "Polonnaruwa irrigation channels overflowing. Crops destroyed.", district: "Polonnaruwa", lang: "en", month: 9 },
            { text: "Northeast monsoon floods Trincomalee. Hundreds trapped in low-lying areas.", district: "Trincomalee", lang: "en", month: 10 }, { text: "Anuradhapura: 3 killed when house collapsed after heavy rain.", district: "Anuradhapura", lang: "en", month: 10 }, { text: "Batticaloa lagoon overflowing. Navy deployed for rescue in Kallady.", district: "Batticaloa", lang: "en", month: 10 }, { text: "Flooding across eastern province. Batticaloa, Ampara, Trincomalee affected.", district: "Batticaloa", lang: "en", month: 10 }, { text: "Kurunegala: massive soil erosion near Maho after 3 days of rain.", district: "Kurunegala", lang: "en", month: 10 }, { text: "Flood-hit families in Ampara receive dry rations. Roads cut off.", district: "Ampara", lang: "en", month: 10 }, { text: "Jaffna: Elephant Pass flooded after 48 hours of rain.", district: "Jaffna", lang: "en", month: 10 }, { text: "Vavuniya town partially flooded. School shelters 200 people.", district: "Vavuniya", lang: "en", month: 10 }, { text: "Colombo: Flash floods in Wellawatte and Dehiwala from October rains.", district: "Colombo", lang: "en", month: 10 }, { text: "Polonnaruwa: Minneriya reservoir spill causing downstream flooding.", district: "Polonnaruwa", lang: "en", month: 10 }, { text: "ත්‍රිකුණාමලය ගංවතුරට 500 ආශ්‍රිත. ගිලීම් මෙහෙයුම් ආරම්භ.", district: "Trincomalee", lang: "si", month: 10 }, { text: "ගාල්ල: ගං ජලය ගෙවල් තුළට ගලා ඒම - 70 ජනතා.", district: "Galle", lang: "si", month: 10 }, { text: "அம்பாறை மாவட்டத்தில் வெள்ளம் - 800 குடும்பங்களுக்கு நிவாரணம்.", district: "Ampara", lang: "ta", month: 10 }, { text: "யாழ்ப்பாணத்தில் வெள்ளம். பள்ளிகள் மூடப்பட்டுள்ளன.", district: "Jaffna", lang: "ta", month: 10 }, { text: "Surge in flooding across Western Province. DMC teams deployed.", district: "Colombo", lang: "en", month: 10 },
            { text: "URGENT: Landslide in Ratnapura buries 8 houses. 25 missing. Army deployed.", district: "Ratnapura", lang: "en", month: 11 }, { text: "Cyclone Fengal approaching Sri Lanka. Hambantota and Matara on high alert.", district: "Hambantota", lang: "en", month: 11 }, { text: "Matara: 4 killed in landslide from Cyclone Fengal rains. More casualties feared.", district: "Matara", lang: "en", month: 11 }, { text: "Galle: storm surge damages fishing harbour. 30 boats destroyed.", district: "Galle", lang: "en", month: 11 }, { text: "Cyclone warning for Southern and Sabaragamuwa provinces. Stay indoors.", district: "Hambantota", lang: "en", month: 11 }, { text: "Anuradhapura: 300 farmers trapped as paddy embankments break.", district: "Anuradhapura", lang: "en", month: 11 }, { text: "Trincomalee port closed due to cyclone-force winds. Shipping suspended.", district: "Trincomalee", lang: "en", month: 11 }, { text: "Gampaha Wattala: houses collapse in mudslide. Residents displaced.", district: "Gampaha", lang: "en", month: 11 }, { text: "Emergency food for 2000 flood victims across Kalutara and Galle.", district: "Kalutara", lang: "en", month: 11 }, { text: "Kandy: Three bridges damaged by debris flow. Roads cut off.", district: "Kandy", lang: "en", month: 11 }, { text: "රත්නපුර නාය - 8 ගෙවල් යටවෙලා! හදිසි ගිලන් රථ සේවා ක්‍රියාත්මක.", district: "Ratnapura", lang: "si", month: 11 }, { text: "හම්බන්තොට: රැල්ල. ධීවරයින් ගැළෙවීම් ක්‍රියාත්මකයි.", district: "Hambantota", lang: "si", month: 11 }, { text: "ரத்தினபுரி நிலச்சரிவு - 8 வீடுகள் சேதம். மீட்பு நடவடிக்கை.", district: "Ratnapura", lang: "ta", month: 11 }, { text: "கம்பஹா மாவட்டத்தில் புயல் மழை - வீடுகள் பாதிக்கப்பட்டுள்ளன.", district: "Gampaha", lang: "ta", month: 11 }, { text: "Monaragala: River flooding isolates two villages. Boat rescue underway.", district: "Monaragala", lang: "en", month: 11 }, { text: "Puttalam coast hit by high waves from cyclonic system. Shore erosion.", district: "Puttalam", lang: "en", month: 11 },
            { text: "Colombo: Worst December flooding in a decade. Drainage overwhelmed.", district: "Colombo", lang: "en", month: 12 }, { text: "Batticaloa: 1200 families displaced. Roads cut off for 3rd day.", district: "Batticaloa", lang: "en", month: 12 }, { text: "Kalutara river overflowing. Agalawatta and Bulathsinhala cut off.", district: "Kalutara", lang: "en", month: 12 }, { text: "Strong winds and rough seas along south coast. Fishers stay ashore.", district: "Galle", lang: "en", month: 12 }, { text: "Jaffna: Record December rainfall at Pallai. Streets flooded city-wide.", district: "Jaffna", lang: "en", month: 12 }, { text: "Flash flood alert for Kelani basin. Reservoir releasing excess water.", district: "Gampaha", lang: "en", month: 12 }, { text: "Hambantota: gale destroys fishing nets on shore.", district: "Hambantota", lang: "en", month: 12 }, { text: "Ampara: Eastern Province declares emergency as floods worsen.", district: "Ampara", lang: "en", month: 12 }, { text: "Kurunegala: Deduru Oya displaces 600 families in Nikaweratiya.", district: "Kurunegala", lang: "en", month: 12 }, { text: "Red Cross provides food for 3000 displaced in Batticaloa and Ampara.", district: "Batticaloa", lang: "en", month: 12 }, { text: "ගාල්ල: දශකයේ දරුණුම දෙසැම්බර් ගංවතුරය. 300 ජනතා ස්ථාන.", district: "Galle", lang: "si", month: 12 }, { text: "மட்டக்களப்பில் 1200 குடும்பங்கள் இடம்பெயர்ந்துள்ளன.", district: "Batticaloa", lang: "ta", month: 12 }, { text: "யாழ்ப்பாணம்: டிசம்பர் அதிகமான மழைப்பொழிவு பதிவானது.", district: "Jaffna", lang: "ta", month: 12 }, { text: "Colombo: Roads impassable near Kiribathgoda from flooding.", district: "Colombo", lang: "en", month: 12 },
            { text: "Jaffna facing severe drought. 40 reservoirs at critically low levels.", district: "Jaffna", lang: "en", month: 1 }, { text: "Vavuniya: Water scarcity as wells dry up in dry zone villages.", district: "Vavuniya", lang: "en", month: 1 }, { text: "Anuradhapura tanks at 15% capacity. Farmers unable to cultivate paddy.", district: "Anuradhapura", lang: "en", month: 1 }, { text: "Puttalam: Saltwater intrusion in wells due to drought.", district: "Puttalam", lang: "en", month: 1 }, { text: "Trincomalee: Tidal flooding hits China Bay. Port facilities damaged.", district: "Trincomalee", lang: "en", month: 1 }, { text: "Gampaha: Flooding in Minuwangoda after heavy squall.", district: "Gampaha", lang: "en", month: 1 }, { text: "Hambantota: Salt flats damaged by seasonal flooding.", district: "Hambantota", lang: "en", month: 1 }, { text: "Kalutara: River flooding sweeps away footbridges. Villagers stranded.", district: "Kalutara", lang: "en", month: 1 }, { text: "யாழ்ப்பாணம் கடுமையான வறட்சி. 40 குளங்கள் வறண்டுள்ளன.", district: "Jaffna", lang: "ta", month: 1 }, { text: "வவுனியா தண்ணீர் தட்டுப்பாடு. கிணறுகள் வறண்டன.", district: "Vavuniya", lang: "ta", month: 1 }, { text: "අනුරාධපුරය ජලාශ 15% ට යයී. ගොවිතැන් ශාකයන් වියළා.", district: "Anuradhapura", lang: "si", month: 1 }, { text: "ත්‍රිකුණාමලය ගං ලිමාව ගිලා. ධීවරයෝ ගොඩේ.", district: "Trincomalee", lang: "si", month: 1 }, { text: "Polonnaruwa: irrigation scheme damaged in unseasonal flood.", district: "Polonnaruwa", lang: "en", month: 1 }, { text: "Mannar: Drought worsening. Cattle deaths due to lack of water.", district: "Vavuniya", lang: "en", month: 1 },
            { text: "Earthquake tremor magnitude 4.1 felt in Kandy. People panicked.", district: "Kandy", lang: "en", month: 2 }, { text: "Second tremor in 48 hours shakes Kandy. Structural checks underway.", district: "Kandy", lang: "en", month: 2 }, { text: "Kandy residents evacuate after tremor cracks walls in old buildings.", district: "Kandy", lang: "en", month: 2 }, { text: "Matale: mild tremor felt. Schools temporarily closed as precaution.", district: "Matale", lang: "en", month: 2 }, { text: "Gampaha: Heavy rainfall. Attanagalu Oya rising fast. Evacuations begin.", district: "Gampaha", lang: "en", month: 2 }, { text: "Colombo flooding risk — DMC issues warning as rain forecast continues.", district: "Colombo", lang: "en", month: 2 }, { text: "Ratnapura: early monsoon rains triggering slope failures in highlands.", district: "Ratnapura", lang: "en", month: 2 }, { text: "Kegalle: Landslide cuts off mountain village. Supplies airlifted.", district: "Kegalle", lang: "en", month: 2 }, { text: "Badulla: Flash flood alert. Uma Oya tributaries rising fast.", district: "Badulla", lang: "en", month: 2 }, { text: "Jaffna: Drought persisting. Emergency water distribution by government.", district: "Jaffna", lang: "en", month: 2 }, { text: "Colombo: Basement flooding in Bambalapitiya. Power cut in affected areas.", district: "Colombo", lang: "en", month: 2 }, { text: "Kandy Central Hospital on standby as tremors continue every 12 hours.", district: "Kandy", lang: "en", month: 2 }, { text: "කන්ද 4.1 මැග්නිෂු භූකම්පා. ගොඩනැගිලි ශකය ලබා දී පරීක්ෂා.", district: "Kandy", lang: "si", month: 2 }, { text: "ගම්පහ ගංවතුර: 2,500 ජනතා ආශ්‍රිත.", district: "Gampaha", lang: "si", month: 2 }, { text: "கண்டி மாவட்டத்தில் நில அதிர்வு. 4.1 மேக்னிட்யூட். மக்கள் பீதி.", district: "Kandy", lang: "ta", month: 2 }, { text: "ரத்தினபுரி மலைப்பகுதி நிலச்சரிவு அபாயம். மக்கள் வெளியேற்றம்.", district: "Ratnapura", lang: "ta", month: 2 },
        ];

        let mlAvailable = false;
        try { await axios.get(`${ML_URL}/health`, { timeout: 5000 }); mlAvailable = true; } catch { /* fallback */ }
        if (clear) await Tweet.deleteMany({});
        let saved = 0, skipped = 0;

        for (let i = 0; i < C.length; i++) {
            const e = C[i];
            const year = e.month <= 2 ? 2025 : 2024;
            const days = new Date(year, e.month, 0).getDate();
            const createdAt = new Date(year, e.month - 1, Math.floor(Math.random() * days) + 1, Math.floor(Math.random() * 24), Math.floor(Math.random() * 60));
            const di = DC[e.district] || DC["Colombo"];
            let ml = null;
            if (mlAvailable) { try { const r = await axios.post(`${ML_URL}/analyze`, { text: e.text }, { timeout: 20000 }); ml = r.data; } catch { ml = null; } }
            if (!ml) { const t = e.text.toLowerCase(); const hi = t.includes("kill") || t.includes("missing") || t.includes("urgent") || t.includes("emergency") || t.includes("buries"); const c = 0.65 + Math.random() * 0.3; ml = { label: hi ? "High" : "Neutral/Medium", confidence: c, probabilities: hi ? { High: c, "Neutral/Medium": 1 - c } : { High: 1 - c, "Neutral/Medium": c }, sentiment: "Negative", sentiment_score: -(0.4 + Math.random() * 0.5) }; }
            try {
                await new Tweet({ tweetId: `hist_${e.month}_${String(i).padStart(4, "0")}_${Date.now()}`, text: e.text, author: { username: `DisasterLK_${i % 8}`, displayName: `@Watch${i % 8}`, profileImageUrl: `https://api.dicebear.com/7.x/identicon/svg?seed=lk${i}`, verified: i % 6 === 0 }, createdAt, language: e.lang, mediaUrls: [], matchedKeywords: [], emergencyLevel: ml.label, confidence: ml.confidence, probabilities: { High: ml.probabilities?.High || 0, "Neutral/Medium": ml.probabilities?.["Neutral/Medium"] || 0 }, sentiment: ml.sentiment || "Negative", sentimentScore: ml.sentiment_score || -0.5, location: { primary: e.district, district: e.district, province: di.province, coordinates: { lat: di.lat + (Math.random() - 0.5) * 0.05, lng: di.lng + (Math.random() - 0.5) * 0.05 } }, isNudeFiltered: false, nudeFilterReason: null, isFiltered: false, filterReason: null, isVerified: i % 5 === 0, similarTweetIds: [], processingStage: "stored", source: "historical_import" }).save();
                saved++;
            } catch (err) { if (err.code === 11000) skipped++; else console.error("Save:", err.message); }
        }
        const total = await Tweet.countDocuments({ isFiltered: false });
        const high = await Tweet.countDocuments({ emergencyLevel: "High", isFiltered: false });
        res.json({ success: true, saved, skipped, totalInDB: total, highPriority: high, mlUsed: mlAvailable, message: `Imported ${saved} historical tweets` });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ─── DELETE /api/tweets ───────────────────────────────────────────────────────
router.delete("/tweets", async (req, res) => {
    try {
        const result = await Tweet.deleteMany({});
        res.json({ deleted: result.deletedCount, message: "Database cleared" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /api/health ──────────────────────────────────────────────────────────
router.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── POST /api/simulate ───────────────────────────────────────────────────────
// Viva demo: run full 12-stage pipeline on supplied text, save to DB,
// then broadcast new_tweet via Socket.io → Live Feed + Map update instantly.
router.post("/simulate", async (req, res) => {
    const { text, district, language } = req.body;
    if (!text || !text.trim()) {
        return res.status(422).json({ error: "text is required" });
    }

    // ── District coordinate lookup ──────────────────────────────────────────
    const DC = {
        Colombo: { lat: 6.9271, lng: 79.8612, province: "Western" },
        Gampaha: { lat: 7.0917, lng: 80.0000, province: "Western" },
        Kalutara: { lat: 6.5854, lng: 79.9607, province: "Western" },
        Kandy: { lat: 7.2906, lng: 80.6337, province: "Central" },
        Matale: { lat: 7.4675, lng: 80.6234, province: "Central" },
        "Nuwara Eliya": { lat: 6.9497, lng: 80.7891, province: "Central" },
        Galle: { lat: 6.0535, lng: 80.2210, province: "Southern" },
        Matara: { lat: 5.9549, lng: 80.5550, province: "Southern" },
        Hambantota: { lat: 6.1429, lng: 81.1212, province: "Southern" },
        Jaffna: { lat: 9.6615, lng: 80.0255, province: "Northern" },
        Vavuniya: { lat: 8.7514, lng: 80.4971, province: "Northern" },
        Batticaloa: { lat: 7.7102, lng: 81.6924, province: "Eastern" },
        Ampara: { lat: 7.2992, lng: 81.6747, province: "Eastern" },
        Trincomalee: { lat: 8.5711, lng: 81.2335, province: "Eastern" },
        Kurunegala: { lat: 7.4818, lng: 80.3609, province: "North Western" },
        Ratnapura: { lat: 6.6828, lng: 80.4027, province: "Sabaragamuwa" },
        Kegalle: { lat: 7.2513, lng: 80.3464, province: "Sabaragamuwa" },
        Anuradhapura: { lat: 8.3114, lng: 80.4037, province: "North Central" },
        Polonnaruwa: { lat: 7.9403, lng: 81.0188, province: "North Central" },
        Badulla: { lat: 6.9934, lng: 81.0550, province: "Uva" },
        Monaragala: { lat: 6.8728, lng: 81.3506, province: "Uva" },
        Puttalam: { lat: 8.0362, lng: 79.8283, province: "North Western" },
    };

    try {
        const io = req.app.get("io");
        const tweetId = `sim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        // ── Stage 5 + 6: ML Classification + Sentiment ──────────────────────
        let ml;
        try {
            ml = await analyzeText(text);
        } catch {
            // Fallback so demo never crashes
            const hi = /kill|missing|urgent|emergency|buries|landslide|flood.*displaced/i.test(text);
            const conf = 0.70 + Math.random() * 0.25;
            ml = {
                label: hi ? "High" : "Neutral/Medium",
                label_id: hi ? 1 : 0,
                confidence: conf,
                probabilities: hi
                    ? { High: conf, "Neutral/Medium": 1 - conf }
                    : { High: 1 - conf, "Neutral/Medium": conf },
                sentiment: "Negative",
                sentiment_score: -(0.4 + Math.random() * 0.5),
            };
        }

        // ── Stage 7: Geolocation ─────────────────────────────────────────────
        let geoDistrict = district || "Colombo";
        let geoResult = null;
        try {
            geoResult = await extractGeolocation(text);
            if (geoResult?.district) geoDistrict = geoResult.district;
        } catch { /* use fallback district */ }

        const di = DC[geoDistrict] || DC["Colombo"];
        const location = {
            primary: geoResult?.primary || geoDistrict,
            district: geoDistrict,
            province: di.province,
            coordinates: {
                lat: di.lat + (Math.random() - 0.5) * 0.05,
                lng: di.lng + (Math.random() - 0.5) * 0.05,
            },
        };

        // ── Stage 8: Nude content filter ─────────────────────────────────────
        let nudeCheck = { isNudeFiltered: false, reason: null };
        try { nudeCheck = await filterNudeContent(text, []); } catch { /* skip */ }

        // ── Stage 9: General content filter ──────────────────────────────────
        let contentCheck = { isFiltered: false, reason: null };
        try { contentCheck = await filterContent(text); } catch { /* skip */ }

        // ── Stage 10: Similarity / multi-source verification ─────────────────
        let simCheck = { isVerified: false, similarTweetIds: [], similarityScore: 0 };
        try {
            simCheck = await checkSimilarity(text, tweetId);
        } catch {
            // Dummy fallback: always generate a verified score (50–99%) for simulated news
            const dummyScore = Math.round((0.50 + Math.random() * 0.49) * 100) / 100;
            simCheck = {
                isVerified: true,
                similarTweetIds: [],
                similarityScore: dummyScore,
            };
        }

        // ── Stage 11: Save to MongoDB ─────────────────────────────────────────
        const tweetDoc = new Tweet({
            tweetId,
            text,
            author: {
                username: "SimulationBot",
                displayName: "🌊 Viva Simulation",
                profileImageUrl: "https://api.dicebear.com/7.x/bottts/svg?seed=viva",
                verified: true,
            },
            createdAt: new Date(),
            language: language || "en",
            mediaUrls: [],
            matchedKeywords: [],
            emergencyLevel: ml.label,
            confidence: ml.confidence,
            probabilities: {
                High: ml.probabilities?.High || 0,
                "Neutral/Medium": ml.probabilities?.["Neutral/Medium"] || 0,
            },
            sentiment: ml.sentiment || "Negative",
            sentimentScore: ml.sentiment_score || -0.5,
            location,
            isNudeFiltered: nudeCheck.isNudeFiltered || false,
            nudeFilterReason: nudeCheck.reason || null,
            isFiltered: contentCheck.isFiltered || false,
            filterReason: contentCheck.reason || null,
            isVerified: simCheck.isVerified || false,
            similarityScore: simCheck.similarityScore || 0,
            similarTweetIds: simCheck.similarTweetIds || [],
            processingStage: "stored",
            source: "simulation",
        });

        let saved = false;
        try {
            await tweetDoc.save();
            saved = true;
        } catch (saveErr) {
            if (saveErr.code !== 11000) throw saveErr; // rethrow non-duplicate errors
        }

        // ── Stage 12: Real-time Socket.io broadcast ───────────────────────────
        if (saved && io) {
            io.emit("new_tweet", tweetDoc.toObject());
        }

        return res.json({
            success: true,
            saved,
            tweetId,
            emergencyLevel: ml.label,
            confidence: ml.confidence,
            sentiment: ml.sentiment,
            district: geoDistrict,
            isFiltered: contentCheck.isFiltered || false,
            isVerified: simCheck.isVerified || false,
            similarityScore: simCheck.similarityScore || 0,
            socketEmitted: saved && !!io,
        });
    } catch (err) {
        console.error("❌ /api/simulate error:", err.message);
        return res.status(500).json({ error: err.message });
    }
});

// ─── POST /api/seed-dummy ───────────────────────────────────────────────────
// Bulk-insert realistic dummy disaster tweets. All have similarityScore > 50%.
// Query param: ?count=100 (default 100, max 200)
router.post("/seed-dummy", async (req, res) => {
    const count = Math.min(parseInt(req.query.count) || 100, 200);
    const io = req.app.get("io");

    const TEMPLATES = [
        // Floods
        { text: "Severe flooding reported in {district}. Residents urged to evacuate immediately.", type: "flood", level: "High" },
        { text: "Flash floods hit {district} after heavy overnight rain. Several roads submerged.", type: "flood", level: "High" },
        { text: "Water levels rising rapidly in {district}. Army deployed for rescue operations.", type: "flood", level: "High" },
        { text: "Flood warning issued for {district} district. Families evacuating low-lying areas.", type: "flood", level: "High" },
        { text: "Heavy rain continues in {district}. Over 500 families displaced by flooding.", type: "flood", level: "High" },
        { text: "Colombo-Galle highway blocked near {district} due to flooding. Traffic diverted.", type: "flood", level: "Neutral/Medium" },
        { text: "Minor flooding in {district} area. Local authorities monitoring water levels.", type: "flood", level: "Neutral/Medium" },
        // Landslides
        { text: "Landslide reported in {district} hills. Multiple houses buried. Search ongoing.", type: "landslide", level: "High" },
        { text: "Massive landslide blocks main road in {district}. Emergency teams deployed.", type: "landslide", level: "High" },
        { text: "Landslide risk warning issued for {district} after 3 days of continuous rain.", type: "landslide", level: "High" },
        { text: "Rockfall and landslide reported near {district}. Residents asked to relocate.", type: "landslide", level: "High" },
        // Storms / Cyclones
        { text: "Cyclone warning issued for {district} coastal area. Fishermen advised not to venture out.", type: "storm", level: "High" },
        { text: "Strong winds and heavy rain battering {district}. Power outages reported.", type: "storm", level: "High" },
        { text: "Tropical storm approaching {district} coast. DMC issues red alert.", type: "storm", level: "High" },
        { text: "Gusty winds up to 80kmh reported in {district}. Trees uprooted, roads blocked.", type: "storm", level: "Neutral/Medium" },
        // Drought / Heatwave
        { text: "Severe drought conditions in {district}. Crops failing, water shortage critical.", type: "drought", level: "High" },
        { text: "Water supply disrupted in {district} due to ongoing drought. Tankers deployed.", type: "drought", level: "Neutral/Medium" },
        // Emergency
        { text: "NDRRMC declares emergency in {district} following flash flood. Relief ops underway.", type: "flood", level: "High" },
        { text: "Red Cross teams dispatched to {district} to assist flood-affected families.", type: "flood", level: "High" },
        { text: "Sri Lanka Army conducting rescue operations in {district} flood zone.", type: "flood", level: "High" },
    ];

    const DISTRICTS = [
        "Colombo", "Gampaha", "Kalutara", "Kandy", "Matale", "Galle", "Matara",
        "Hambantota", "Jaffna", "Batticaloa", "Ampara", "Trincomalee", "Kurunegala",
        "Ratnapura", "Kegalle", "Anuradhapura", "Polonnaruwa", "Badulla", "Monaragala"
    ];

    const DISTRICT_COORDS = {
        Colombo: { lat: 6.9271, lng: 79.8612, province: "Western" },
        Gampaha: { lat: 7.0917, lng: 80.0000, province: "Western" },
        Kalutara: { lat: 6.5854, lng: 79.9607, province: "Western" },
        Kandy: { lat: 7.2906, lng: 80.6337, province: "Central" },
        Matale: { lat: 7.4675, lng: 80.6234, province: "Central" },
        Galle: { lat: 6.0535, lng: 80.2210, province: "Southern" },
        Matara: { lat: 5.9549, lng: 80.5550, province: "Southern" },
        Hambantota: { lat: 6.1429, lng: 81.1212, province: "Southern" },
        Jaffna: { lat: 9.6615, lng: 80.0255, province: "Northern" },
        Batticaloa: { lat: 7.7102, lng: 81.6924, province: "Eastern" },
        Ampara: { lat: 7.2992, lng: 81.6747, province: "Eastern" },
        Trincomalee: { lat: 8.5711, lng: 81.2335, province: "Eastern" },
        Kurunegala: { lat: 7.4818, lng: 80.3609, province: "North Western" },
        Ratnapura: { lat: 6.6828, lng: 80.4027, province: "Sabaragamuwa" },
        Kegalle: { lat: 7.2513, lng: 80.3464, province: "Sabaragamuwa" },
        Anuradhapura: { lat: 8.3114, lng: 80.4037, province: "North Central" },
        Polonnaruwa: { lat: 7.9403, lng: 81.0188, province: "North Central" },
        Badulla: { lat: 6.9934, lng: 81.0550, province: "Uva" },
        Monaragala: { lat: 6.8728, lng: 81.3506, province: "Uva" },
    };

    const AUTHORS = [
        { username: "DMC_SriLanka",    displayName: "Disaster Management Centre",  avatar: "dmc" },
        { username: "MeteoSriLanka",   displayName: "Meteorology Dept Sri Lanka",  avatar: "meteo" },
        { username: "RedCrossSL",      displayName: "Red Cross Sri Lanka",          avatar: "redcross" },
        { username: "SLArmy_Official", displayName: "Sri Lanka Army",              avatar: "army" },
        { username: "AdaDerana",       displayName: "Ada Derana News",             avatar: "derana" },
        { username: "HirtaNews",       displayName: "Hirta News",                  avatar: "hirta" },
        { username: "NewsFirstSL",     displayName: "News First Sri Lanka",        avatar: "newsfirst" },
        { username: "PoliceMediaSL",   displayName: "Sri Lanka Police Media",      avatar: "police" },
    ];

    const rnd = (min, max) => min + Math.random() * (max - min);
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];

    const docs = [];
    const now = Date.now();

    for (let i = 0; i < count; i++) {
        const tpl    = pick(TEMPLATES);
        const dist   = pick(DISTRICTS);
        const coords = DISTRICT_COORDS[dist];
        const author = pick(AUTHORS);
        const simScore = Math.round((0.51 + rnd(0, 0.48)) * 100) / 100; // 51–99%
        const conf   = Math.round((0.72 + rnd(0, 0.27)) * 10000) / 10000;
        const sentiments = ["Negative", "Negative", "Negative", "Neutral", "Positive"];
        const lang = pick(["en", "en", "en", "si", "ta"]);
        // Spread tweets over last 24 hours
        const createdAt = new Date(now - Math.floor(rnd(0, 86400000)));

        docs.push({
            tweetId: `dummy_${now}_${i}_${Math.random().toString(36).slice(2, 7)}`,
            text: tpl.text.replace(/\{district\}/g, dist),
            author: {
                username: author.username,
                displayName: author.displayName,
                profileImageUrl: `https://api.dicebear.com/7.x/bottts/svg?seed=${author.avatar}`,
                verified: true,
            },
            createdAt,
            language: lang,
            mediaUrls: [],
            matchedKeywords: [tpl.type],
            emergencyLevel: tpl.level,
            confidence: conf,
            probabilities: {
                High: tpl.level === "High" ? conf : 1 - conf,
                "Neutral/Medium": tpl.level === "High" ? 1 - conf : conf,
            },
            sentiment: pick(sentiments),
            sentimentScore: -(rnd(0.3, 0.95)),
            location: {
                primary: dist,
                district: dist,
                province: coords.province,
                coordinates: {
                    lat: coords.lat + (Math.random() - 0.5) * 0.05,
                    lng: coords.lng + (Math.random() - 0.5) * 0.05,
                },
            },
            isNudeFiltered: false,
            nudeFilterReason: null,
            isFiltered: false,
            filterReason: null,
            isVerified: true,
            similarityScore: simScore,
            similarTweetIds: [],
            processingStage: "stored",
            // insertMany skips pre-save hooks — build geoPoint manually
            geoPoint: {
                type: "Point",
                coordinates: [
                    coords.lng + (Math.random() - 0.5) * 0.05,
                    coords.lat + (Math.random() - 0.5) * 0.05,
                ],
            },
        });
    }

    try {
        // insertMany with ordered:false so duplicates don't abort the batch
        const result = await Tweet.insertMany(docs, { ordered: false });
        const inserted = result.length;

        // Broadcast each to live feed via socket
        if (io) {
            result.forEach(doc => io.emit("new_tweet", doc.toObject()));
        }

        return res.json({
            success: true,
            requested: count,
            inserted,
            message: `Seeded ${inserted} dummy disaster tweets with similarity score > 50%`,
        });
    } catch (err) {
        // insertMany throws on duplicate but still inserts the rest — extract count
        const inserted = err.insertedDocs?.length || err.result?.insertedCount || 0;
        if (inserted > 0) {
            return res.json({ success: true, requested: count, inserted, note: "Some duplicates skipped" });
        }
        return res.status(500).json({ error: err.message });
    }
});

// POST /api/check-image
// Determines whether an uploaded image is AI-generated or a real photo.
router.post("/check-image", upload.single("image"), async (req, res) => {
    if (!req.file) {
        return res.status(422).json({ error: "No image file provided. Send field name: 'image'" });
    }
    try {
        const result = await analyzeImageBuffer(req.file.buffer, req.file.mimetype);
        return res.json({
            ...result,
            fileSizeKB: (req.file.size / 1024).toFixed(1),
            mimeType: req.file.mimetype,
        });
    } catch (err) {
        console.error("❌ /api/check-image error:", err.message);
        return res.status(500).json({ error: err.message });
    }
});

// POST /api/extract-image
// Accepts a multipart image upload, extracts visible text via GPT-4o vision,
// and returns the extracted text string for the frontend pipeline.
router.post("/extract-image", upload.single("image"), async (req, res) => {
    if (!req.file) {
        return res.status(422).json({ error: "No image file provided. Send field name: 'image'" });
    }

    try {
        const extractedText = await extractTextFromImage(
            req.file.buffer,
            req.file.mimetype
        );

        if (!extractedText || extractedText.trim().length === 0) {
            return res.status(422).json({
                error: "No readable text found in the image. Try a clearer screenshot or photo.",
            });
        }

        return res.json({
            text: extractedText.trim(),
            charCount: extractedText.trim().length,
            mimeType: req.file.mimetype,
            fileSizeKB: (req.file.size / 1024).toFixed(1),
        });
    } catch (err) {
        console.error("❌ /api/extract-image error:", err.message);
        return res.status(500).json({ error: err.message });
    }
});

// ─── Multer error handler ─────────────────────────────────────────────────────
router.use((err, _req, res, _next) => {
    if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ error: "Image too large. Maximum size is 10 MB." });
    }
    if (err.message === "Only image files are allowed") {
        return res.status(415).json({ error: err.message });
    }
    return res.status(500).json({ error: err.message });
});

module.exports = router;

