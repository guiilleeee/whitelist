import express from "express";
import { query } from "./db.js";
import { snowflakeToDate, isOlderThanMonths } from "./discord.js";

const router = express.Router();

const DISCORD_API = "https://discord.com/api";

router.get("/auth/discord", (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: process.env.DISCORD_REDIRECT_URI,
    response_type: "code",
    scope: "identify"
  });
  res.redirect(`${DISCORD_API}/oauth2/authorize?${params.toString()}`);
});

router.get("/auth/discord/callback", async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.redirect(`${process.env.WEB_URL}/status?error=missing_code`);

    const body = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.DISCORD_REDIRECT_URI
    });

    const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });

    const token = await tokenRes.json();
    if (!token.access_token) {
      return res.redirect(`${process.env.WEB_URL}/status?error=oauth_failed`);
    }

    const userRes = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${token.access_token}` }
    });
    const user = await userRes.json();

    const createdAt = snowflakeToDate(user.id);
    const eligible = isOlderThanMonths(createdAt, 6);

    await query(
      `INSERT INTO users (discord_id, discord_username, avatar, created_at, is_eligible)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (discord_id)
       DO UPDATE SET discord_username = EXCLUDED.discord_username,
                     avatar = EXCLUDED.avatar,
                     created_at = EXCLUDED.created_at,
                     is_eligible = EXCLUDED.is_eligible`,
      [user.id, `${user.username}#${user.discriminator ?? ""}`.replace(/#0$/, ""), user.avatar, createdAt, eligible]
    );

    req.session.user = {
      discordId: user.id,
      username: `${user.username}#${user.discriminator ?? ""}`.replace(/#0$/, ""),
      createdAt,
      eligible
    };

    if (!eligible) {
      return res.redirect(`${process.env.WEB_URL}/status?error=discord_too_new`);
    }

    res.redirect(`${process.env.WEB_URL}/exam`);
  } catch (err) {
    console.error("auth callback error:", err);
    res.redirect(`${process.env.WEB_URL}/status?error=server_error`);
  }
});

router.get("/me", (req, res) => {
  res.json({ user: req.session.user || null });
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

export default router;
