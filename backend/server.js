/**
 * Disaster Monitoring System - Main Server
 * Express + Socket.io + MongoDB + Cron job for tweet fetching
 */

require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const cors = require("cors");
const cron = require("node-cron");

const apiRoutes = require("./routes/api");
const { fetchAndProcessTweets } = require("./services/twitterService");

const app = express();
const server = http.createServer(app);

// ─── Socket.io ────────────────────────────────────────────────────────────────
const io = new Server(server, {
    cors: {
        origin: process.env.FRONTEND_URL || "http://localhost:5173",
        methods: ["GET", "POST"],
    },
});

// Make io accessible to routes
app.set("io", io);

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.FRONTEND_URL || "http://localhost:5173" }));
app.use(express.json());

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use("/api", apiRoutes);

app.get("/", (req, res) => {
    res.json({
        service: "Disaster Monitoring Backend",
        version: "1.0.0",
        status: "running",
    });
});

// ─── MongoDB Connection ───────────────────────────────────────────────────────
mongoose
    .connect(process.env.MONGODB_URI || "mongodb://localhost:27017/disaster_db")
    .then(() => {
        console.log("✅ Connected to MongoDB (disaster_db)");
    })
    .catch((err) => {
        console.error("❌ MongoDB connection error:", err.message);
    });

// ─── Socket.io Events ─────────────────────────────────────────────────────────
io.on("connection", (socket) => {
    console.log(`🔌 Client connected: ${socket.id}`);
    socket.on("disconnect", () => {
        console.log(`🔌 Client disconnected: ${socket.id}`);
    });
});

// ─── Cron Job: Fetch tweets periodically ─────────────────────────────────────
const FETCH_INTERVAL = process.env.FETCH_INTERVAL_MINUTES || 5;
const cronExpression = `*/${FETCH_INTERVAL} * * * *`;

console.log(`⏰ Tweet fetch scheduled every ${FETCH_INTERVAL} minute(s)`);

cron.schedule(cronExpression, async () => {
    console.log("🔄 Cron: Fetching new tweets...");
    try {
        const newTweets = await fetchAndProcessTweets(io);
        console.log(`✅ Cron: Processed ${newTweets.length} new tweets`);
    } catch (err) {
        console.error("❌ Cron fetch error:", err.message);
    }
});

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`🚀 Backend server running on http://localhost:${PORT}`);
    console.log(`📡 Socket.io ready`);

    // Initial fetch on startup
    setTimeout(async () => {
        console.log("🔄 Initial tweet fetch on startup...");
        try {
            const newTweets = await fetchAndProcessTweets(io);
            console.log(`✅ Initial fetch: Processed ${newTweets.length} tweets`);
        } catch (err) {
            console.error("❌ Initial fetch error:", err.message);
        }
    }, 3000);
});
