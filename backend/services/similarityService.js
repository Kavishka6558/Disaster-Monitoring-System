/**
 * Similarity Service
 * Detects duplicate/similar disaster reports using TF-IDF cosine similarity.
 * If multiple accounts report the same disaster, flags it as 'Verified'.
 */

const natural = require("natural");
const Tweet = require("../models/Tweet");

const TfIdf = natural.TfIdf;
const SIMILARITY_THRESHOLD = 0.65; // 65% similarity = same disaster event
const LOOKBACK_HOURS = 24; // Only compare with tweets from last 24 hours

/**
 * Compute cosine similarity between two TF-IDF vectors.
 */
function cosineSimilarity(vec1, vec2) {
    const keys = new Set([...Object.keys(vec1), ...Object.keys(vec2)]);
    let dotProduct = 0;
    let mag1 = 0;
    let mag2 = 0;

    for (const key of keys) {
        const a = vec1[key] || 0;
        const b = vec2[key] || 0;
        dotProduct += a * b;
        mag1 += a * a;
        mag2 += b * b;
    }

    if (mag1 === 0 || mag2 === 0) return 0;
    return dotProduct / (Math.sqrt(mag1) * Math.sqrt(mag2));
}

/**
 * Build a TF-IDF term vector for a document.
 */
function buildTermVector(tfidf, docIndex) {
    const vector = {};
    tfidf.listTerms(docIndex).forEach(({ term, tfidf: score }) => {
        vector[term] = score;
    });
    return vector;
}

/**
 * Check if a new tweet is similar to existing tweets.
 * If similar tweets found → mark as verified (multiple reports = real event).
 *
 * @param {string} text - New tweet text
 * @param {string} tweetId - New tweet ID
 * @returns {{ isVerified: boolean, similarTweetIds: string[] }}
 */
async function checkSimilarity(text, tweetId) {
    try {
        // Fetch recent tweets from DB for comparison
        const cutoff = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000);
        const recentTweets = await Tweet.find(
            {
                createdAt: { $gte: cutoff },
                tweetId: { $ne: tweetId },
                isFiltered: false,
            },
            { tweetId: 1, text: 1 }
        ).limit(200);

        if (recentTweets.length === 0) {
            return { isVerified: false, similarTweetIds: [] };
        }

        // Build TF-IDF corpus
        const tfidf = new TfIdf();
        tfidf.addDocument(text); // Index 0 = new tweet

        for (const tweet of recentTweets) {
            tfidf.addDocument(tweet.text);
        }

        const newTweetVector = buildTermVector(tfidf, 0);
        const similarTweetIds = [];
        let maxScore = 0; // highest cosine similarity found across all comparisons

        for (let i = 0; i < recentTweets.length; i++) {
            const existingVector = buildTermVector(tfidf, i + 1);
            const similarity = cosineSimilarity(newTweetVector, existingVector);

            if (similarity > maxScore) maxScore = similarity;

            if (similarity >= SIMILARITY_THRESHOLD) {
                similarTweetIds.push(recentTweets[i].tweetId);

                // Also update the existing tweet to mark it as verified
                await Tweet.updateOne(
                    { tweetId: recentTweets[i].tweetId },
                    {
                        $set: { isVerified: true, similarityScore: Math.max(similarity, 0) },
                        $addToSet: { similarTweetIds: tweetId },
                    }
                );
            }
        }

        // isVerified = at least one match >= threshold (65%)
        // similarityScore = best raw score found (0-1), shown in UI
        const similarityScore = Math.round(maxScore * 100) / 100;
        const isVerified = similarityScore >= 0.50; // 50% threshold for "verified"
        return { isVerified, similarTweetIds, similarityScore };
    } catch (err) {
        console.error(`❌ Similarity check error: ${err.message}`);
        return { isVerified: false, similarTweetIds: [], similarityScore: 0 };
    }
}

module.exports = { checkSimilarity };
