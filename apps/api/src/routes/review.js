import express from "express";
import { query } from "../db.js";
import { isStaffMember, postToChannel } from "../discord_channels.js";
import { sendWebhook } from "../discord.js";

const router = express.Router();

function requireUser(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "unauthorized" });
  next();
}

async function requireStaff(req, res, next) {
  try {
    const cached = req.session.user?.isStaff;
    const cachedAt = req.session.user?.isStaffCheckedAt;
    if (typeof cached === "boolean" && typeof cachedAt === "number" && Date.now() - cachedAt < 5 * 60 * 1000) {
      if (!cached) return res.status(403).json({ error: "forbidden" });
      return next();
    }

    const ok = await isStaffMember(req.session.user.discordId);
    req.session.user.isStaff = ok;
    req.session.user.isStaffCheckedAt = Date.now();
    if (!ok) return res.status(403).json({ error: "forbidden" });
    next();
  } catch (e) {
    console.error("requireStaff error:", e);
    res.status(500).json({ error: "staff_check_failed" });
  }
}

router.get("/review/:id", requireUser, requireStaff, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "invalid_id" });

  const examRes = await query(
    `SELECT e.id, e.status, e.discord_username, e.steam_link, e.discord_channel_id,
            e.created_at, e.submitted_at, e.reviewed_at, e.user_discord_id,
            u.discord_username AS oauth_discord_username
     FROM exams e
     LEFT JOIN users u ON u.discord_id = e.user_discord_id
     WHERE e.id = $1`,
    [id]
  );
  if (!examRes.rows.length) return res.status(404).json({ error: "exam_not_found" });

  const answersRes = await query(
    `SELECT a.question_id, a.answer_text, a.time_ms, a.is_suspicious, q.question, q.type
     FROM answers a
     JOIN questions q ON q.id = a.question_id
     WHERE a.exam_id = $1
     ORDER BY a.id ASC`,
    [id]
  );

  const logsRes = await query(
    `SELECT type, count, details
     FROM logs
     WHERE exam_id = $1
     ORDER BY id ASC`,
    [id]
  );

  res.json({
    exam: examRes.rows[0],
    answers: answersRes.rows,
    logs: logsRes.rows
  });
});

router.post("/review/:id/decision", requireUser, requireStaff, async (req, res) => {
  const id = Number(req.params.id);
  const status = String(req.body?.status || "");
  if (!Number.isInteger(id)) return res.status(400).json({ error: "invalid_id" });
  if (!["approved", "rejected"].includes(status)) return res.status(400).json({ error: "invalid_status" });

  const examRes = await query(
    `SELECT id, status, user_discord_id, discord_channel_id, discord_username
     FROM exams
     WHERE id = $1`,
    [id]
  );
  if (!examRes.rows.length) return res.status(404).json({ error: "exam_not_found" });

  await query(`UPDATE exams SET status = $2, reviewed_at = NOW() WHERE id = $1`, [id, status]);

  const exam = examRes.rows[0];
  const staffUser = req.session.user?.username || req.session.user?.discordId || "staff";
  const resultText = status === "approved" ? "ACEPTADA" : "RECHAZADA";

  const payload = {
    embeds: [
      {
        title: `Whitelist ${resultText}`,
        color: status === "approved" ? 0x2ecc71 : 0xe74c3c,
        description: `Examen #${id}\nDecidido por: ${staffUser}\nSolicitante: <@${exam.user_discord_id}>`
      }
    ]
  };

  try {
    if (exam.discord_channel_id) {
      await postToChannel(exam.discord_channel_id, {
        content: `<@${exam.user_discord_id}> Tu whitelist ha sido **${resultText}**.`,
        ...payload
      });
    }
  } catch (e) {
    console.error("post decision to channel error:", e);
  }

  try {
    await sendWebhook(payload);
  } catch (e) {
    console.error("sendWebhook decision error:", e);
  }

  res.json({ ok: true });
});

export default router;

