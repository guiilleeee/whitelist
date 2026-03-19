import express from "express";
import { query } from "./db.js";
import { snowflakeToDate, isOlderThanMonths } from "./discord.js";
import { botEnabled, createTicketChannel, postToChannel, channelJumpLink } from "./discord_channels.js";

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function ensureAppealsTable() {
  await query(
    `CREATE TABLE IF NOT EXISTS appeals (
       id SERIAL PRIMARY KEY,
       discord_id TEXT NOT NULL,
       main_channel_id TEXT,
       staff_channel_id TEXT,
       main_message_id TEXT,
       status TEXT DEFAULT 'open',
       created_at TIMESTAMP DEFAULT NOW(),
       updated_at TIMESTAMP DEFAULT NOW()
     )`
  );
  await query(`CREATE INDEX IF NOT EXISTS idx_appeals_discord ON appeals(discord_id)`);
}

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
      // Auto-create appeal ticket if bot is enabled (Discord account too new).
      try {
        if (botEnabled()) {
          await ensureAppealsTable();

          const existing = await query(
            `SELECT id FROM appeals WHERE discord_id = $1 AND status IN ('open','appeal_submitted') LIMIT 1`,
            [user.id]
          );
          if (existing.rows.length) {
            return res.redirect(`${process.env.WEB_URL}/status?error=discord_too_new`);
          }

          const mainGuildId = process.env.DISCORD_MAIN_GUILD_ID || process.env.DISCORD_GUILD_ID || null;
          const mainCategoryId = process.env.DISCORD_MAIN_CATEGORY_ID || process.env.DISCORD_CATEGORY_ID || null;
          const mainStaffRoleIds = parseCsv(process.env.DISCORD_MAIN_STAFF_ROLE_IDS || process.env.DISCORD_STAFF_ROLE_IDS);

          const staffGuildId = process.env.DISCORD_STAFF_GUILD_ID || process.env.DISCORD_GUILD_ID || mainGuildId;
          const staffCategoryId = process.env.DISCORD_STAFF_CATEGORY_ID || process.env.DISCORD_CATEGORY_ID || null;
          const staffRoleIds = parseCsv(process.env.DISCORD_STAFF_ROLE_IDS_STAFF || process.env.DISCORD_STAFF_ROLE_IDS);

          let mainChannel = null;
          let staffChannel = null;
          let mainLink = null;
          let staffLink = null;

          if (mainGuildId) {
            mainChannel = await createTicketChannel({
              guildId: mainGuildId,
              categoryId: mainCategoryId,
              staffRoleIds: mainStaffRoleIds,
              applicantDiscordId: user.id,
              displayName: user.username,
              allowApplicant: true
            });
          }

          if (staffGuildId) {
            staffChannel = await createTicketChannel({
              guildId: staffGuildId,
              categoryId: staffCategoryId,
              staffRoleIds,
              applicantDiscordId: user.id,
              displayName: user.username,
              allowApplicant: false
            });
          }

          mainLink = mainChannel?.id ? channelJumpLink({ guildId: mainGuildId, channelId: mainChannel.id }) : null;
          staffLink = staffChannel?.id ? channelJumpLink({ guildId: staffGuildId, channelId: staffChannel.id }) : null;

          if (mainChannel?.id) {
            const msg = await postToChannel(mainChannel.id, {
              content: `<@${user.id}>`,
              embeds: [
                {
                  title: "Cuenta de Discord demasiado nueva",
                  color: 0xe74c3c,
                  description:
                    "Por seguridad, exigimos un minimo de 6 meses de antiguedad en Discord para acceder al servidor.",
                  fields: [
                    { name: "Estado", value: "Suspendido por antiguedad", inline: true },
                    { name: "Ticket staff", value: staffLink || "N/A", inline: true },
                    {
                      name: "Si te han robado la cuenta",
                      value: "Pulsa **Apelacion** y envia pruebas (capturas, tickets, etc).",
                      inline: false
                    }
                  ]
                }
              ],
              components: [
                {
                  type: 1,
                  components: [
                    { type: 2, style: 1, custom_id: `wl_appeal:${user.id}`, label: "Apelacion" },
                    { type: 2, style: 4, custom_id: `wl_close:${user.id}`, label: "Cerrar ticket" }
                  ]
                }
              ]
            });

            await query(
              `INSERT INTO appeals (discord_id, main_channel_id, staff_channel_id, main_message_id)
               VALUES ($1, $2, $3, $4)`,
              [user.id, mainChannel?.id || null, staffChannel?.id || null, msg?.id || null]
            );
          }

          if (staffChannel?.id) {
            const staffRoleId = staffRoleIds[0] || null;
            const staffMention = staffRoleId ? `<@&${staffRoleId}>` : "@staff";
            await postToChannel(staffChannel.id, {
              content: `${staffMention} Cuenta con antiguedad insuficiente (<6 meses). Ticket principal: ${mainLink || "N/A"}`,
              embeds: [
                {
                  title: "Revision por antiguedad",
                  color: 0xe74c3c,
                  fields: [
                    { name: "Discord", value: `${user.username}#${user.discriminator ?? ""}`.replace(/#0$/, ""), inline: true },
                    { name: "Discord ID", value: user.id, inline: true },
                    { name: "Creada", value: createdAt.toISOString(), inline: true }
                  ]
                }
              ]
            });
          }
        }
      } catch (e) {
        console.error("appeal ticket error:", e);
      }

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
