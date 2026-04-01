const mongoose = require("mongoose");

const tweetSchema = new mongoose.Schema(
    {
        tweetId: {
            type: String,
            unique: true,
            required: true,
            index: true,
        },
        text: {
            type: String,
            required: true,
        },
        author: {
            username: String,
            displayName: String,
            profileImageUrl: String,
            verified: { type: Boolean, default: false },
        },
        createdAt: {
            type: Date,
            default: Date.now,
        },
        language: {
            type: String,
            enum: ["en", "si", "ta", "unknown"],
            default: "unknown",
        },

        // ── Stage 5: ML Emergency Classification ──────────────────────────────
        emergencyLevel: {
            type: String,
            enum: ["High", "Neutral/Medium"],
            default: "Neutral/Medium",
        },
        confidence: {
            type: Number,
            min: 0,
            max: 1,
            default: 0,
        },
        probabilities: {
            High: { type: Number, default: 0 },
            "Neutral/Medium": { type: Number, default: 0 },
        },

        // ── Stage 6: Sentiment Analysis ────────────────────────────────────────
        sentiment: {
            type: String,
            enum: ["Positive", "Negative", "Neutral"],
            default: "Neutral",
        },
        sentimentScore: {
            type: Number,
            min: -1,
            max: 1,
            default: 0,
        },

        // ── Stage 7: Geolocation (LLM extracted) ──────────────────────────────
        location: {
            primary: { type: String, default: null },
            district: { type: String, default: null },
            province: { type: String, default: null },
            coordinates: {
                lat: { type: Number, default: null },
                lng: { type: Number, default: null },
            },
        },

        // ── Geospatial index field (GeoJSON Point for 2dsphere) ────────────────
        // Stored as GeoJSON so MongoDB can run $near / $geoWithin queries
        geoPoint: {
            type: {
                type: String,
                enum: ["Point"],
                default: "Point",
            },
            coordinates: {
                type: [Number], // [longitude, latitude]  ← GeoJSON order
                default: undefined,
            },
        },

        // ── Media ──────────────────────────────────────────────────────────────
        mediaUrls: [
            {
                type: { type: String, enum: ["photo", "video", "gif"] },
                url: String,
                thumbnailUrl: String,
            },
        ],

        // ── Stage 8: Nude Content Filter (explicit, dedicated stage) ──────────
        isNudeFiltered: {
            type: Boolean,
            default: false,
        },
        nudeFilterReason: {
            type: String,
            default: null,
        },

        // ── Stage 9: General Content Filter ───────────────────────────────────
        isFiltered: {
            type: Boolean,
            default: false,
        },
        filterReason: {
            type: String,
            default: null,
        },

        // ── Stage 10: Similarity / Misinformation / Verification ───────────────
        isVerified: {
            type: Boolean,
            default: false,
        },
        similarityScore: {
            type: Number,
            min: 0,
            max: 1,
            default: 0,
        },
        similarTweetIds: [String],

        // ── Keywords matched ───────────────────────────────────────────────────
        matchedKeywords: [String],

        // ── Processing stage tracker (12-stage pipeline) ───────────────────────
        processingStage: {
            type: String,
            enum: [
                "fetched",           // Stage 1
                "aggregated",        // Stage 2
                "validated",         // Stage 3
                "deduplicated",      // Stage 4
                "ml_classified",     // Stage 5
                "sentiment_analyzed",// Stage 6
                "geo_extracted",     // Stage 7
                "nude_filtered",     // Stage 8
                "content_filtered",  // Stage 9
                "similarity_checked",// Stage 10
                "stored",            // Stage 11
                "broadcast",         // Stage 12
            ],
            default: "fetched",
        },
    },
    {
        timestamps: true,
    }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
tweetSchema.index({ emergencyLevel: 1, createdAt: -1 });
tweetSchema.index({ "location.district": 1 });
tweetSchema.index({ isFiltered: 1 });
tweetSchema.index({ isNudeFiltered: 1 });
tweetSchema.index({ isVerified: 1 });
tweetSchema.index({ sentiment: 1 });
tweetSchema.index({ language: 1 });

// 2dsphere index for geospatial queries ($near, $geoWithin, etc.)
tweetSchema.index({ geoPoint: "2dsphere" });

// ─── Pre-save hook: populate geoPoint from location.coordinates ───────────────
tweetSchema.pre("save", function (next) {
    const lat = this.location?.coordinates?.lat;
    const lng = this.location?.coordinates?.lng;

    if (lat != null && lng != null) {
        // GeoJSON uses [longitude, latitude] order
        this.geoPoint = {
            type: "Point",
            coordinates: [lng, lat],
        };
    } else {
        this.geoPoint = undefined;
    }
    next();
});

module.exports = mongoose.model("Tweet", tweetSchema);
