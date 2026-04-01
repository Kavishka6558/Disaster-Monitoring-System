/**
 * ═══════════════════════════════════════════════════════════════
 *  VIVA LIVE SIMULATION SCRIPT — Disaster Monitoring System
 * ═══════════════════════════════════════════════════════════════
 *
 * Sends one realistic disaster tweet every 60 s to the local
 * backend's  POST /api/simulate  endpoint, which runs the full
 * 12-stage AI pipeline and broadcasts the result via Socket.io.
 *
 * Usage:
 *   node backend/simulateLive.js
 *   node backend/simulateLive.js --interval 30   (30-second gap)
 *   node backend/simulateLive.js --loop           (restart after last tweet)
 *
 * Make sure the main backend server (npm start) is already running.
 */

const axios = require("axios");

// ─── Config ───────────────────────────────────────────────────────────────────
const API_URL = process.env.API_URL || "http://localhost:5000";
const INTERVAL_MS = (() => {
    const idx = process.argv.indexOf("--interval");
    return idx !== -1 ? parseInt(process.argv[idx + 1]) * 1000 : 60_000;
})();
const LOOP = process.argv.includes("--loop");

// ─── Simulation data ──────────────────────────────────────────────────────────
// 15 realistic tweets: mix of English / Sinhala / Tamil,
// High Emergency and Neutral/Medium, across different Sri Lanka districts.
const SIMULATION_TWEETS = [
    // ── HIGH EMERGENCY ─────────────────────────────────────────────────────────
    {
        text: "URGENT: Massive landslide blocks the Colombo-Kandy highway near Kegalle. Multiple vehicles buried. Rescue teams needed immediately!",
        district: "Kegalle",
        lang: "en",
    },
    {
        text: "Flash flood in Ratnapura: 3 houses swept away, 12 people missing. Army and Police rescue teams have been deployed. Please evacuate low-lying areas now!",
        district: "Ratnapura",
        lang: "en",
    },
    {
        text: "ජාතික ගිනි අරිනා රෝහල ගෙවල් ගිලෙමින් ඇත! ගංවතුර හේතුවෙන් කොළඹ දිස්ත්‍රික්කයේ ජනතා 500 දෙනෙකු ගිලා. හදිසි ගිලීම් ක්‍රියාත්මකයි.",
        district: "Colombo",
        lang: "si",
    },
    {
        text: "மட்டக்களப்பு மாவட்டத்தில் கடுமையான வெள்ளம். 300 குடும்பங்கள் வீடுகளை விட்டு வெளியேறியுள்ளன. உயிரிழப்புகள் அறிவிக்கப்படவில்லை.",
        district: "Batticaloa",
        lang: "ta",
    },
    {
        text: "BREAKING: Cyclone warning upgraded to Level 3 for Hambantota and Matara districts. All residents within 5km of coast ordered to evacuate immediately.",
        district: "Hambantota",
        lang: "en",
    },
    {
        text: "Earthquake tremor magnitude 4.8 felt across Kandy, Matale and Nuwara Eliya. Several buildings cracked. People evacuating from old structures. No casualties yet.",
        district: "Kandy",
        lang: "en",
    },
    {
        text: "யாழ்ப்பாண மாவட்டத்தில் திடீர் வெள்ளம். தீவிர மழையால் 48 மணி நேரத்தில் நூற்றுக்கணக்கான குடும்பங்கள் பாதிக்கப்பட்டுள்ளன. அரசு நிவாரண நடவடிக்கை தொடங்கியுள்ளது.",
        district: "Jaffna",
        lang: "ta",
    },
    {
        text: "ALERT: River Kelani water level at Hanwella has exceeded 11 metres — highest in 5 years. All residents downstream in Gampaha and Colombo districts must evacuate!",
        district: "Gampaha",
        lang: "en",
    },
    // ── NEUTRAL / MEDIUM ───────────────────────────────────────────────────────
    {
        text: "Heavy rain expected in Trincomalee and Batticaloa over the next 12 hours. The Meteorology Department has issued a yellow alert. Residents are advised to stay vigilant.",
        district: "Trincomalee",
        lang: "en",
    },
    {
        text: "ගාල්ල දිස්ත්‍රික්කයේ සාමාන්‍ය ගස් කඩා වැටීම් රාශියක් වාර්තා. මාර්ග ප්‍රවාහනය කිරීම ප්‍රමාද වෙමින් ඇත. ජනතා ප්‍රවේශම් වෙන ලෙස ඉල්ලමු.",
        district: "Galle",
        lang: "si",
    },
    {
        text: "Anuradhapura reservoir water levels rising gradually. District irrigation authorities monitoring situation closely. No immediate flood risk at this stage.",
        district: "Anuradhapura",
        lang: "en",
    },
    {
        text: "அம்பாறையில் சாலைகளில் நீர் தேக்கம். சிறு வெள்ளம் ஏற்பட்டுள்ளது. மாவட்ட நிர்வாகம் நிலைமையை கண்காணிக்கிறது.",
        district: "Ampara",
        lang: "ta",
    },
    {
        text: "Moderate soil erosion reported on hillsides near Badulla town after 3 days of continuous rain. Authorities monitoring but no evacuation order issued yet.",
        district: "Badulla",
        lang: "en",
    },
    {
        text: "කුරුණෑගල දිස්ත්‍රික්කයේ ගංගා ජල මට්ටම ඉහළ යයි. ගොවිතැන් ජලයෙන් යටවී ඇත. ජලාශ ශ්‍රේෂ්ඨ ජලය ගලා.",
        district: "Kurunegala",
        lang: "si",
    },
    {
        text: "Puttalam lagoon water levels slightly elevated due to northeast winds. Fishing suspended for the day as a precaution. Expected to normalise by tomorrow.",
        district: "Puttalam",
        lang: "en",
    },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const COLORS = {
    reset: "\x1b[0m",
    cyan: "\x1b[36m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    yellow: "\x1b[33m",
    bold: "\x1b[1m",
    dim: "\x1b[2m",
};

function ts() {
    return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

function pad(str, len) {
    return str.substring(0, len).padEnd(len);
}

// ─── Main simulation loop ─────────────────────────────────────────────────────
let idx = 0;

async function sendNextTweet() {
    if (idx >= SIMULATION_TWEETS.length) {
        if (LOOP) {
            idx = 0;
            console.log(`\n${COLORS.dim}[${ts()}] 🔁 All tweets sent — restarting from the beginning (--loop)${COLORS.reset}\n`);
        } else {
            console.log(`\n${COLORS.bold}${COLORS.green}[${ts()}] ✅ All ${SIMULATION_TWEETS.length} tweets sent. Simulation complete.${COLORS.reset}`);
            process.exit(0);
        }
    }

    const tweet = SIMULATION_TWEETS[idx];
    const tweetNum = idx + 1;
    idx++;

    const snippet = tweet.text.substring(0, 72) + (tweet.text.length > 72 ? "…" : "");
    console.log(`\n${COLORS.bold}${COLORS.cyan}[${ts()}] ─── Tweet ${tweetNum}/${SIMULATION_TWEETS.length} ──────────────────────────────${COLORS.reset}`);
    console.log(`${COLORS.dim}  District: ${pad(tweet.district, 14)} Lang: ${tweet.lang.toUpperCase()}${COLORS.reset}`);
    console.log(`  "${snippet}"`);
    console.log(`${COLORS.dim}  ↳ Sending to ${API_URL}/api/simulate …${COLORS.reset}`);

    const t0 = Date.now();
    try {
        const res = await axios.post(
            `${API_URL}/api/simulate`,
            { text: tweet.text, district: tweet.district, language: tweet.lang },
            { timeout: 45_000 }
        );

        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        const { emergencyLevel, confidence, sentiment, saved } = res.data;
        const lvlColor = emergencyLevel === "High" ? COLORS.red : COLORS.yellow;

        console.log(`${COLORS.green}  ✅ Success in ${elapsed}s${COLORS.reset}`);
        console.log(`     Level:      ${lvlColor}${COLORS.bold}${emergencyLevel}${COLORS.reset}  (${(confidence * 100).toFixed(1)}% confidence)`);
        console.log(`     Sentiment:  ${sentiment}`);
        console.log(`     Saved to DB: ${saved ? "✅ Yes" : "⚠️  Skipped (duplicate)"}`);
        console.log(`     📡 Socket.io broadcast emitted → Live Feed & Map updated`);
    } catch (err) {
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        const msg = err.response?.data?.error || err.message;
        console.log(`${COLORS.red}  ❌ Failed in ${elapsed}s: ${msg}${COLORS.reset}`);
    }

    console.log(`${COLORS.dim}  ⏱  Next tweet in ${INTERVAL_MS / 1000}s …${COLORS.reset}`);
}

// ─── Entry point ──────────────────────────────────────────────────────────────
console.log(`\n${COLORS.bold}╔════════════════════════════════════════════════════════════╗`);
console.log(`║     🌊  DISASTER MONITOR — LIVE VIVA SIMULATION            ║`);
console.log(`╚════════════════════════════════════════════════════════════╝${COLORS.reset}`);
console.log(`  Backend : ${API_URL}`);
console.log(`  Tweets  : ${SIMULATION_TWEETS.length}`);
console.log(`  Interval: ${INTERVAL_MS / 1000}s per tweet`);
console.log(`  Loop    : ${LOOP ? "Yes (--loop)" : "No"}`);
console.log(`\n  Press  Ctrl+C  to stop at any time.\n`);
console.log(`${COLORS.dim}  Waiting 3 s for backend to be ready …${COLORS.reset}\n`);

setTimeout(async () => {
    await sendNextTweet();
    setInterval(sendNextTweet, INTERVAL_MS);
}, 3000);
