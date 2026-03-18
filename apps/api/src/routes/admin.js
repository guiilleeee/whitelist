import express from "express";
import { query } from "../db.js";

const router = express.Router();

function requireAdmin(req, res, next) {
  const adminIds = (process.env.ADMIN_DISCORD_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (!req.session.user || !adminIds.includes(req.session.user.discordId)) {
    return res.status(403).json({ error: "forbidden" });
  }
  next();
}

router.get("/admin/exams", requireAdmin, async (req, res) => {
  const exams = await query(
    `SELECT e.id, e.status, e.discord_username, e.steam_link, e.created_at, e.submitted_at,
            u.discord_username AS discord_user
     FROM exams e
     LEFT JOIN users u ON u.discord_id = e.user_discord_id
     ORDER BY e.created_at DESC
     LIMIT 100`
  );

  const examIds = exams.rows.map((e) => e.id);
  if (!examIds.length) return res.json({ exams: [] });

  const answers = await query(
    `SELECT exam_id, question_id, answer_text, time_ms, is_suspicious
     FROM answers
     WHERE exam_id = ANY($1::int[])`,
    [examIds]
  );

  const logs = await query(
    `SELECT exam_id, type, count, details
     FROM logs
     WHERE exam_id = ANY($1::int[])`,
    [examIds]
  );

  const answerMap = answers.rows.reduce((acc, a) => {
    acc[a.exam_id] = acc[a.exam_id] || [];
    acc[a.exam_id].push(a);
    return acc;
  }, {});

  const logMap = logs.rows.reduce((acc, l) => {
    acc[l.exam_id] = acc[l.exam_id] || [];
    acc[l.exam_id].push(l);
    return acc;
  }, {});

  const enriched = exams.rows.map((e) => ({
    ...e,
    answers: answerMap[e.id] || [],
    logs: logMap[e.id] || []
  }));

  res.json({ exams: enriched });
});

router.patch("/admin/exams/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!["approved", "rejected"].includes(status)) {
    return res.status(400).json({ error: "invalid_status" });
  }

  await query(
    `UPDATE exams SET status = $2, reviewed_at = NOW() WHERE id = $1`,
    [id, status]
  );

  res.json({ ok: true });
});

export default router;
