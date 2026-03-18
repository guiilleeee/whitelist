import "dotenv/config";
import express from "express";
import cors from "cors";
import session from "express-session";
import pg from "pg";
import connectPgSimple from "connect-pg-simple";
import authRoutes from "./auth.js";
import examRoutes from "./routes/exam.js";
import adminRoutes from "./routes/admin.js";
import reviewRoutes from "./routes/review.js";
import { startDiscordBot } from "./bot.js";

const { Pool } = pg;
const PgSession = connectPgSimple(session);

const app = express();
const isProd = process.env.NODE_ENV === "production";

app.set("trust proxy", 1);

app.use(cors({
  origin: process.env.WEB_URL,
  credentials: true
}));

app.use(express.json({ limit: "2mb" }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.on("error", (err) => {
  console.error("Postgres pool error:", err);
});

app.use(session({
  store: new PgSession({ pool }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: isProd ? "none" : "lax",
    secure: isProd
  }
}));

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, db: true });
  } catch (err) {
    console.error("health db error:", err);
    res.status(500).json({ ok: false, db: false });
  }
});

app.use(authRoutes);
app.use(examRoutes);
app.use(adminRoutes);
app.use(reviewRoutes);

// Buttons (Accept/Reject) inside Discord require the gateway bot to be running.
startDiscordBot();

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "server_error" });
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`API listening on ${port}`);
});
