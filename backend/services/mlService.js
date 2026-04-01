/**
 * ML Service Client
 * Calls the local FastAPI ML microservice for:
 *  - Emergency level classification (/predict)
 *  - Sentiment analysis (/sentiment)
 *  - Combined analysis (/analyze)
 */

const axios = require("axios");

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:8001";

/**
 * Classify a single text string for emergency level.
 * @param {string} text
 * @returns {{ label: string, label_id: number, confidence: number, probabilities: object }}
 */
async function classifyText(text) {
    const response = await axios.post(
        `${ML_SERVICE_URL}/predict`,
        { text },
        { timeout: 30000 }
    );
    return response.data;
}

/**
 * Analyze sentiment of a text string.
 * @param {string} text
 * @returns {{ sentiment: string, sentiment_score: number, positive_signals: number, negative_signals: number }}
 */
async function analyzeSentiment(text) {
    const response = await axios.post(
        `${ML_SERVICE_URL}/sentiment`,
        { text },
        { timeout: 10000 }
    );
    return response.data;
}

/**
 * Combined: emergency classification + sentiment in one call.
 * @param {string} text
 * @returns {{ label, label_id, confidence, probabilities, sentiment, sentiment_score }}
 */
async function analyzeText(text) {
    const response = await axios.post(
        `${ML_SERVICE_URL}/analyze`,
        { text },
        { timeout: 30000 }
    );
    return response.data;
}

/**
 * Classify multiple texts in a single batch request.
 * @param {string[]} texts
 * @returns {Array}
 */
async function classifyBatch(texts) {
    const response = await axios.post(
        `${ML_SERVICE_URL}/predict/batch`,
        texts,
        { timeout: 60000 }
    );
    return response.data;
}

/**
 * Check if the ML service is healthy.
 * @returns {boolean}
 */
async function checkMLHealth() {
    try {
        const response = await axios.get(`${ML_SERVICE_URL}/health`, { timeout: 5000 });
        return response.data?.model_loaded === true;
    } catch {
        return false;
    }
}

module.exports = { classifyText, analyzeSentiment, analyzeText, classifyBatch, checkMLHealth };
