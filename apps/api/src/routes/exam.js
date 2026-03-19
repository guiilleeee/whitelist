import express from "express";
import { query } from "../db.js";
import { sendWebhook } from "../discord.js";
import {
  botEnabled,
  createTicketChannel,
  postToChannel,
  channelJumpLink,
  addMemberRole,
  removeMemberRole,
  editMessage
} from "../discord_channels.js";

const router = express.Router();

const EXAM_MULTIPLE_COUNT = 5;
const EXAM_OPEN_COUNT = 10;
const EXAM_TOTAL_COUNT = EXAM_MULTIPLE_COUNT + EXAM_OPEN_COUNT;

function requireUser(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "unauthorized" });
  if (!req.session.user.eligible) return res.status(403).json({ error: "discord_too_new" });
  next();
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function reasonLabel(value) {
  switch (value) {
    case "primera_vez":
      return "Primera vez en Genesis";
    case "segundo_slot":
      return "Segundo slot de PJ";
    case "wipe":
      return "WIPE";
    case "ck":
      return "CK";
    default:
      return "N/A";
  }
}

function clamp(str, max) {
  const s = String(str || "");
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 3))}...`;
}

function chunkAnswerBlocks(text, maxLen) {
  const blocks = String(text || "")
    .split(/\n\n+/)
    .map((b) => b.trim())
    .filter(Boolean);

  const chunks = [];
  let buf = "";
  for (const b of blocks) {
    const next = buf ? `${buf}\n\n${b}` : b;
    if (next.length > maxLen) {
      if (buf) chunks.push(buf);
      buf = b;
    } else {
      buf = next;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

async function checkSteamVac(steamLink) {
  if (!steamLink) return { status: "unknown", reason: "no_steam_link" };

  try {
    const res = await fetch(steamLink, {
      headers: {
        "User-Agent": "Mozilla/5.0 (WhitelistBot/1.0)"
      }
    });
    if (!res.ok) return { status: "unknown", reason: `http_${res.status}` };

    const html = await res.text();
    const text = html.replace(/\s+/g, " ");

    // Common Steam texts (EN/ES)
    const vacOk = /no\s+vac\s+bans/i.test(text);
    const gameBanOk = /no\s+game\s+bans/i.test(text);
    const redBanBlock = /profile_ban_status/i.test(text);

    // "Last ban X days ago" / "Last ban: X days"
    let days = null;
    const m1 = text.match(/last\s+ban[^0-9]{0,20}(\d+)\s+day/i);
    if (m1) days = Number(m1[1]);

    // "in the last X days"
    if (days === null) {
      const m2 = text.match(/last\s+(\d+)\s+days/i);
      if (m2) days = Number(m2[1]);
    }

    // Spanish-ish "ultima sancion hace X dias"
    if (days === null) {
      const m3 = text.match(/ultima\s+sanci[oó]n[^0-9]{0,20}(\d+)\s+d[ií]a/i);
      if (m3) days = Number(m3[1]);
    }

    const vacMention = /vac\s+ban/i.test(text) || /baneo\s+vac/i.test(text) || /sancion\s+vac/i.test(text);

    if (days !== null) {
      return { status: "ok", days, flagged: days < 180, vacMention: true };
    }

    if (vacMention && !(vacOk && gameBanOk)) {
      // If Steam shows a VAC/Game ban but no days, treat as flagged.
      return { status: "ok", days: null, flagged: true, vacMention: true };
    }

    if (redBanBlock && !vacOk) {
      // Red ban block visible and not explicitly "no bans" -> treat as flagged.
      return { status: "ok", days: null, flagged: true, vacMention: true };
    }

    if (vacOk && gameBanOk) {
      return { status: "ok", days: null, flagged: false, vacMention: false };
    }

    return { status: "unknown", reason: "no_signal" };
  } catch (e) {
    return { status: "unknown", reason: "fetch_error" };
  }
}

async function applyAutoDecision({ examId, statusValue, note, userId, mainChannelId, staffChannelId, staffMessageId, reasonCode }) {
  const resultText = statusValue === "approved" ? "ACEPTADA" : statusValue === "rejected" ? "RECHAZADA" : "PENDIENTE DE CAMBIOS";
  const color = statusValue === "approved" ? 0x2ecc71 : statusValue === "rejected" ? 0xe74c3c : 0xf1c40f;

  await query(`UPDATE exams SET status = $2, reviewed_at = NOW() WHERE id = $1`, [examId, statusValue]);

  // Disable staff buttons on final decisions
  if (staffChannelId && staffMessageId && (statusValue === "approved" || statusValue === "rejected")) {
    try {
      await editMessage(staffChannelId, staffMessageId, {
        components: [
          {
            type: 1,
            components: [
              { type: 2, style: 3, custom_id: "wl_disabled", label: "Aceptada", disabled: true },
              { type: 2, style: 4, custom_id: "wl_disabled2", label: "Rechazada", disabled: true },
              { type: 2, style: 2, custom_id: "wl_disabled3", label: "Pendiente de cambios", disabled: true }
            ]
          }
        ]
      });
    } catch {}
  }

  if (mainChannelId) {
    await postToChannel(mainChannelId, {
      content: `<@${userId}>`,
      embeds: [
        {
          title: `Whitelist ${resultText}`,
          color,
          description:
            statusValue === "changes_requested"
              ? "El staff te ha pedido cambios. Responde en este ticket."
              : "Revision finalizada.",
          fields: note ? [{ name: "Motivo / nota", value: String(note).slice(0, 1024), inline: false }] : []
        }
      ]
    });
  }

  if (staffChannelId) {
    await postToChannel(staffChannelId, {
      embeds: [
        {
          title: `Auto-decision: ${resultText}`,
          color,
          description: `Examen #${examId}${note ? `\n\n**Motivo:**\n${String(note).slice(0, 1800)}` : ""}`
        }
      ]
    });
  }

  const mainGuildId = process.env.DISCORD_MAIN_GUILD_ID || process.env.DISCORD_GUILD_ID || null;
  const roleApproved = process.env.DISCORD_MAIN_ROLE_APPROVED_ID || null;
  const roleRejected = process.env.DISCORD_MAIN_ROLE_REJECTED_ID || null;
  const roleMinor = process.env.DISCORD_MAIN_ROLE_MINOR_ID || null;
  const roleVac = process.env.DISCORD_MAIN_ROLE_VAC_ID || null;

  if (mainGuildId && userId) {
    try {
      for (const roleId of [roleApproved, roleRejected, roleMinor, roleVac].filter(Boolean)) {
        await removeMemberRole({ guildId: mainGuildId, userId, roleId });
      }

      if (statusValue === "approved" && roleApproved) {
        await addMemberRole({ guildId: mainGuildId, userId, roleId: roleApproved });
      }
      if (statusValue === "rejected" && roleRejected) {
        await addMemberRole({ guildId: mainGuildId, userId, roleId: roleRejected });
      }
      if (reasonCode === "menor" && roleMinor) {
        await addMemberRole({ guildId: mainGuildId, userId, roleId: roleMinor });
      }
      if (reasonCode === "vac" && roleVac) {
        await addMemberRole({ guildId: mainGuildId, userId, roleId: roleVac });
      }
    } catch {}
  }
}

async function ensureExamQuestionsTable() {
  await query(
    `CREATE TABLE IF NOT EXISTS exam_questions (
       exam_id INT REFERENCES exams(id) ON DELETE CASCADE,
       question_id INT REFERENCES questions(id),
       created_at TIMESTAMP DEFAULT NOW(),
       PRIMARY KEY (exam_id, question_id)
     )`
  );
  await query(`CREATE INDEX IF NOT EXISTS idx_exam_questions_exam ON exam_questions(exam_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_exam_questions_question ON exam_questions(question_id)`);
  // For older DBs
  await query(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS discord_channel_id TEXT`);
  await query(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS discord_channel_id_main TEXT`);
  await query(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS discord_channel_id_staff TEXT`);
  await query(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS discord_message_id_staff TEXT`);
}

async function pickQuestionsForUser({ userId }) {
  // We only treat questions as "seen" when the exam is submitted/reviewed.
  // This prevents exhausting the pool during anti-cheat resets.
  const seenStatuses = ["submitted", "approved", "rejected"];

  const seenRes = await query(
    `SELECT DISTINCT eq.question_id
     FROM exam_questions eq
     JOIN exams e ON e.id = eq.exam_id
     WHERE e.user_discord_id = $1
       AND e.status = ANY($2::text[])`,
    [userId, seenStatuses]
  );
  const seenIds = seenRes.rows.map((r) => r.question_id);

  async function pickByType(type, limit, excludeSeen) {
    if (excludeSeen && seenIds.length) {
      return query(
        `SELECT id, question, type, options
         FROM questions
         WHERE type = $1
           AND id <> ALL($2::int[])
         ORDER BY random()
         LIMIT $3`,
        [type, seenIds, limit]
      );
    }
    return query(
      `SELECT id, question, type, options
       FROM questions
       WHERE type = $1
       ORDER BY random()
       LIMIT $2`,
      [type, limit]
    );
  }

  // Prefer unseen questions for this user; if we can't fill the exam, fallback to allow repeats.
  let multiple = await pickByType("multiple", EXAM_MULTIPLE_COUNT, true);
  let open = await pickByType("open", EXAM_OPEN_COUNT, true);

  if (multiple.rows.length < EXAM_MULTIPLE_COUNT) {
    const missing = EXAM_MULTIPLE_COUNT - multiple.rows.length;
    const more = await pickByType("multiple", missing, false);
    multiple = { rows: [...multiple.rows, ...more.rows] };
  }
  if (open.rows.length < EXAM_OPEN_COUNT) {
    const missing = EXAM_OPEN_COUNT - open.rows.length;
    const more = await pickByType("open", missing, false);
    open = { rows: [...open.rows, ...more.rows] };
  }

  const rows = [...multiple.rows, ...open.rows];
  return rows;
}

async function setExamQuestions(examId, questions) {
  await query(`DELETE FROM exam_questions WHERE exam_id = $1`, [examId]);
  if (!questions.length) return;

  const values = [];
  const params = [examId];
  for (let i = 0; i < questions.length; i++) {
    params.push(questions[i].id);
    values.push(`($1, $${i + 2})`);
  }
  await query(`INSERT INTO exam_questions (exam_id, question_id) VALUES ${values.join(",")}`, params);
}

router.post("/exam/start", requireUser, async (req, res) => {
  try {
    const userId = req.session.user.discordId;

    await ensureExamQuestionsTable();

    const examRes = await query(
      `INSERT INTO exams (user_discord_id, status)
       VALUES ($1, 'in_progress') RETURNING id`,
      [userId]
    );

    const examId = examRes.rows[0].id;

    const picked = await pickQuestionsForUser({ userId });
    if (picked.length < EXAM_TOTAL_COUNT) {
      return res.status(400).json({ error: "not_enough_questions" });
    }

    await setExamQuestions(examId, picked);

    const questions = picked.map((q) => {
      if (q.type === "multiple" && Array.isArray(q.options)) {
        return { ...q, options: shuffle(q.options) };
      }
      return q;
    });

    res.json({ examId, questions: shuffle(questions) });
  } catch (err) {
    console.error("exam/start error:", err);
    res.status(500).json({ error: "db_error" });
  }
});

router.post("/exam/reset", requireUser, async (req, res) => {
  try {
    const userId = req.session.user.discordId;
    const { examId } = req.body || {};

    if (!examId) return res.status(400).json({ error: "invalid_payload" });

    await ensureExamQuestionsTable();

    const examCheck = await query(
      `SELECT id, status
       FROM exams
       WHERE id = $1 AND user_discord_id = $2`,
      [examId, userId]
    );
    if (!examCheck.rows.length) return res.status(404).json({ error: "exam_not_found" });
    if (examCheck.rows[0].status !== "in_progress") return res.status(400).json({ error: "exam_not_in_progress" });

    const picked = await pickQuestionsForUser({ userId });
    if (picked.length < EXAM_TOTAL_COUNT) {
      return res.status(400).json({ error: "not_enough_questions" });
    }

    await setExamQuestions(examId, picked);

    const questions = picked.map((q) => {
      if (q.type === "multiple" && Array.isArray(q.options)) {
        return { ...q, options: shuffle(q.options) };
      }
      return q;
    });

    res.json({ examId, questions: shuffle(questions) });
  } catch (err) {
    console.error("exam/reset error:", err);
    res.status(500).json({ error: "db_error" });
  }
});

router.post("/exam/submit", requireUser, async (req, res) => {
  try {
    const { examId, profile, answers, antiCheat } = req.body;

    if (!examId || !Array.isArray(answers)) {
      return res.status(400).json({ error: "invalid_payload" });
    }

    // Prevent double submits (double click / retry).
    const examRow = await query(
      `SELECT id, status FROM exams WHERE id = $1 AND user_discord_id = $2`,
      [examId, req.session.user.discordId]
    );
    if (!examRow.rows.length) return res.status(404).json({ error: "exam_not_found" });
    if (examRow.rows[0].status !== "in_progress") return res.status(409).json({ error: "already_submitted" });

    // Lock the exam so only one request can proceed creating tickets, answers, etc.
    const lock = await query(
      `UPDATE exams
       SET status = 'submitting', discord_username = $2, steam_link = $3
       WHERE id = $1 AND user_discord_id = $4 AND status = 'in_progress'
       RETURNING id`,
      [examId, profile?.discordName || null, profile?.steamLink || null, req.session.user.discordId]
    );
    if (!lock.rows.length) return res.status(409).json({ error: "already_submitted" });

    for (const ans of answers) {
      const isSuspicious = Number(ans.timeMs || 0) < 10000;
      await query(
        `INSERT INTO answers (exam_id, question_id, answer_text, time_ms, is_suspicious)
         VALUES ($1, $2, $3, $4, $5)`,
        [examId, ans.questionId, ans.answer, ans.timeMs || null, isSuspicious]
      );
    }

    if (antiCheat) {
      await query(
        `INSERT INTO logs (exam_id, type, count, details)
         VALUES ($1, 'tab_switch', $2, $3)`,
        [examId, antiCheat.tabSwitches || 0, antiCheat.tabSwitchDetails || {}]
      );

      await query(
        `INSERT INTO logs (exam_id, type, count, details)
         VALUES ($1, 'fast_answer', $2, $3)`,
        [examId, (antiCheat.fastAnswers || []).length, { questions: antiCheat.fastAnswers || [] }]
      );

      await query(
        `INSERT INTO logs (exam_id, type, count, details)
         VALUES ($1, 'copy_paste', $2, $3)`,
        [examId, antiCheat.copyPasteBlocks || 0, antiCheat.copyPasteDetails || {}]
      );

      await query(
        `INSERT INTO logs (exam_id, type, count, details)
         VALUES ($1, 'right_click', $2, $3)`,
        [examId, antiCheat.rightClickBlocks || 0, antiCheat.rightClickDetails || {}]
      );
    }

    if (profile) {
      await query(
        `INSERT INTO logs (exam_id, type, count, details)
         VALUES ($1, 'profile', 1, $2)`,
        [examId, profile]
      );
    }

    const durationMs = antiCheat?.startedAt && antiCheat?.finishedAt
      ? Math.max(0, antiCheat.finishedAt - antiCheat.startedAt)
      : null;

    const createdAt = req.session.user?.createdAt ? new Date(req.session.user.createdAt) : null;
    const now = new Date();
    const months = createdAt
      ? Math.max(0, (now.getFullYear() - createdAt.getFullYear()) * 12 + (now.getMonth() - createdAt.getMonth()))
      : null;

    const questionIds = answers.map((a) => a.questionId).filter((id) => Number.isInteger(id));
    const qRes = questionIds.length
      ? await query(`SELECT id, question FROM questions WHERE id = ANY($1::int[])`, [questionIds])
      : { rows: [] };

    const qMap = qRes.rows.reduce((acc, q) => {
      acc[q.id] = q.question;
      return acc;
    }, {});

    const qaText = answers
      .map((a, i) => {
        const q = qMap[a.questionId] || `Pregunta ${a.questionId}`;
        return `**${i + 1}. ${q}**\n${a.answer || "(sin respuesta)"}`;
      })
      .join("\n\n")
      .slice(0, 3900);

    let mainChannel = null;
    let staffChannel = null;
    let mainLink = null;
    let staffLink = null;
    let staffRoleIds = [];
    let mainGuildId = null;
    let staffGuildId = null;

    let staffMessageId = null;
    let autoDecision = null;

    // Auto checks (minor / VAC)
    if (profile?.isAdult === false) {
      autoDecision = {
        statusValue: "rejected",
        note: "Solicitud rechazada automaticamente: menor de edad.",
        reasonCode: "menor"
      };
    }

    let vacCheck = null;
    if (profile?.steamLink) {
      vacCheck = await checkSteamVac(profile.steamLink);
      await query(
        `INSERT INTO logs (exam_id, type, count, details)
         VALUES ($1, 'steam_vac', 1, $2)`,
        [examId, vacCheck]
      );
      if (vacCheck?.flagged) {
        autoDecision = {
          statusValue: "rejected",
          note: "Solicitud rechazada automaticamente: VAC inferior a 6 meses.",
          reasonCode: "vac"
        };
      }
    }

    try {
      if (botEnabled()) {
        const displayName = profile?.discordName || req.session.user.username || req.session.user.discordId;

        mainGuildId = process.env.DISCORD_MAIN_GUILD_ID || process.env.DISCORD_GUILD_ID || null;
        const mainCategoryId = process.env.DISCORD_MAIN_CATEGORY_ID || process.env.DISCORD_CATEGORY_ID || null;
        const mainStaffRoleIds = String(process.env.DISCORD_MAIN_STAFF_ROLE_IDS || process.env.DISCORD_STAFF_ROLE_IDS || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

        staffGuildId = process.env.DISCORD_STAFF_GUILD_ID || process.env.DISCORD_GUILD_ID || mainGuildId;
        const staffCategoryId = process.env.DISCORD_STAFF_CATEGORY_ID || process.env.DISCORD_CATEGORY_ID || null;
        staffRoleIds = String(process.env.DISCORD_STAFF_ROLE_IDS_STAFF || process.env.DISCORD_STAFF_ROLE_IDS || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

        if (mainGuildId) {
          mainChannel = await createTicketChannel({
            guildId: mainGuildId,
            categoryId: mainCategoryId,
            staffRoleIds: mainStaffRoleIds,
            applicantDiscordId: req.session.user.discordId,
            displayName,
            allowApplicant: true
          });
        }

        if (staffGuildId) {
          staffChannel = await createTicketChannel({
            guildId: staffGuildId,
            categoryId: staffCategoryId,
            staffRoleIds,
            applicantDiscordId: req.session.user.discordId,
            displayName,
            allowApplicant: false
          });
        }

        await query(
          `UPDATE exams
           SET discord_channel_id = COALESCE($2, discord_channel_id),
               discord_channel_id_main = $3,
               discord_channel_id_staff = $4
           WHERE id = $1`,
          [examId, mainChannel?.id || staffChannel?.id || null, mainChannel?.id || null, staffChannel?.id || null]
        );

        mainLink = mainChannel?.id ? channelJumpLink({ guildId: mainGuildId, channelId: mainChannel.id }) : null;
        staffLink = staffChannel?.id ? channelJumpLink({ guildId: staffGuildId, channelId: staffChannel.id }) : null;

        if (mainChannel?.id) {
          await postToChannel(mainChannel.id, {
            content: `<@${req.session.user.discordId}>`,
            embeds: [
              {
                title: "Genesis Community | Whitelist",
                color: 0xff4d8d,
                description: "Hemos recibido tu solicitud. El staff la revisara y te respondera por aqui.",
                fields: [
                  { name: "Estado", value: "En revision", inline: true },
                  { name: "Ticket staff", value: staffLink || "N/A", inline: true },
                  { name: "Steam", value: clamp(profile?.steamLink || "N/A", 200), inline: false }
                ]
              }
            ],
            components: [
              {
                type: 1,
                components: [
                  { type: 2, style: 2, custom_id: `wl_close_main:${examId}`, label: "Cerrar ticket" },
                  { type: 2, style: 4, custom_id: `wl_delete_main:${examId}`, label: "Eliminar ticket (staff)" }
                ]
              }
            ]
          });
        }

        // Auto-role: if the applicant self-declares as minor, assign the minor role in the MAIN guild.
        try {
          const minorRoleId = process.env.DISCORD_MAIN_ROLE_MINOR_ID || null;
          if (mainGuildId && minorRoleId && profile?.isAdult === false) {
            await addMemberRole({ guildId: mainGuildId, userId: req.session.user.discordId, roleId: minorRoleId });
          }
          const vacRoleId = process.env.DISCORD_MAIN_ROLE_VAC_ID || null;
          if (mainGuildId && vacRoleId && vacCheck?.flagged) {
            await addMemberRole({ guildId: mainGuildId, userId: req.session.user.discordId, roleId: vacRoleId });
          }
        } catch (e) {
          console.error("auto minor role error:", e);
        }
      }
    } catch (err) {
      console.error("discord channel create error:", err);
    }

    const applicant = {
      discordManual: profile?.discordName || req.session.user.username || "N/A",
      discordMention: `<@${req.session.user.discordId}>`,
      steam: profile?.steamLink || "N/A",
      reason: reasonLabel(profile?.applicationReason),
      months
    };

    const anti = {
      tab: Number(antiCheat?.tabSwitches || 0),
      fast: Number((antiCheat?.fastAnswers || []).length),
      copy: Number(antiCheat?.copyPasteBlocks || 0),
      right: Number(antiCheat?.rightClickBlocks || 0),
      duration: durationMs ? `${Math.round(durationMs / 60000)} min` : "N/A"
    };

    const webhookEmbeds = [
      {
        title: "Genesis Community | Whitelist",
        color: 0xff4d8d,
        description: `Solicitud recibida (Examen #${examId}).`,
        fields: [
          { name: "Solicitante", value: `${applicant.discordMention}\n${clamp(applicant.discordManual, 120)}`, inline: true },
          { name: "Steam", value: clamp(applicant.steam, 200), inline: true },
          { name: "Antiguedad", value: applicant.months === null ? "N/A" : `${applicant.months} meses`, inline: true },
          { name: "Motivo", value: applicant.reason, inline: true },
          { name: "Mayor de edad", value: profile?.isAdult === true ? "Si" : profile?.isAdult === false ? "No" : "N/A", inline: true },
          { name: "Faccion", value: profile?.faction || "N/A", inline: true },
          { name: "Anti-cheat", value: `Pestanas: ${anti.tab}\n<10s: ${anti.fast}\nCopiar/Pegar: ${anti.copy}\nClick der.: ${anti.right}`, inline: true },
          { name: "Duracion", value: anti.duration, inline: true }
        ]
      }
    ];

    const webhookPayload = { embeds: webhookEmbeds };

    try {
      if (staffChannel?.id) {
        const staffRoleId = staffRoleIds[0] || null;
        const staffMention = staffRoleId ? `<@&${staffRoleId}>` : "@staff";
        const story = clamp(profile?.characterStory || "(vacio)", 3800);
        const goal = clamp(profile?.characterGoal || "(vacio)", 3800);

        const answerChunks = chunkAnswerBlocks(qaText, 3800);
        const answerEmbeds = answerChunks.map((c, idx) => ({
          title: `Respuestas del examen${answerChunks.length > 1 ? ` (${idx + 1}/${answerChunks.length})` : ""}`,
          color: 0x1f2a44,
          description: c
        }));

        const staffPayload = {
          content: `${staffMention} **Nueva whitelist** · Ticket principal: ${mainLink || "N/A"}`,
          embeds: [
            {
              title: "Registro (resumen)",
              color: 0xff4d8d,
              fields: [
                { name: "Solicitante", value: `${applicant.discordMention}\n${clamp(applicant.discordManual, 120)}`, inline: true },
                { name: "Antiguedad", value: applicant.months === null ? "N/A" : `${applicant.months} meses`, inline: true },
                { name: "Motivo", value: applicant.reason, inline: true },
                { name: "Steam", value: clamp(applicant.steam, 200), inline: false },
                { name: "Mayor de edad", value: profile?.isAdult === true ? "Si" : profile?.isAdult === false ? "No" : "N/A", inline: true },
                { name: "Experiencia", value: clamp(profile?.discordExperience || "N/A", 900), inline: false }
              ]
            },
            {
              title: "Personaje",
              color: 0xff4d8d,
              fields: [
                { name: "Nombre PJ", value: clamp(profile?.characterName || "N/A", 120), inline: true },
                { name: "Nacimiento", value: clamp(profile?.birthYear || "N/A", 40), inline: true },
                { name: "Faccion", value: clamp(profile?.faction || "N/A", 40), inline: true },
                { name: "Clase social", value: clamp(profile?.socialClass || "N/A", 40), inline: true }
              ]
            },
            {
              title: "Historia",
              color: 0x1f2a44,
              description: story
            },
            {
              title: "Objetivo",
              color: 0x1f2a44,
              description: goal
            },
            {
              title: "Anti-cheat",
              color: 0x1f2a44,
              fields: [
                { name: "Cambios de pestana", value: String(anti.tab), inline: true },
                { name: "Respuestas < 10s", value: String(anti.fast), inline: true },
                { name: "Copiar/Pegar", value: String(anti.copy), inline: true },
                { name: "Click derecho", value: String(anti.right), inline: true },
                { name: "Duracion", value: anti.duration, inline: true }
              ]
            },
            ...answerEmbeds
          ].slice(0, 10), // Discord hard limit safety
          components: [
                {
                  type: 1,
                  components: [
                    { type: 2, style: 3, custom_id: `wl_decide:${examId}:approved`, label: "Aceptada" },
                    { type: 2, style: 4, custom_id: `wl_reject:${examId}`, label: "Rechazada" },
                    { type: 2, style: 2, custom_id: `wl_changes:${examId}`, label: "Pendiente de cambios" },
                    { type: 2, style: 1, custom_id: `wl_close_ticket:${examId}`, label: "Cerrar ticket" },
                    { type: 2, style: 4, custom_id: `wl_delete_ticket:${examId}`, label: "Eliminar ticket" }
                  ]
                }
              ]
            };

        const msg = await postToChannel(staffChannel.id, staffPayload);
        if (msg?.id) {
          staffMessageId = msg.id;
          await query(`UPDATE exams SET discord_message_id_staff = $2 WHERE id = $1`, [examId, msg.id]);
        }
      }
    } catch (err) {
      console.error("discord channel post error:", err);
    }

    await sendWebhook(webhookPayload);

    if (autoDecision) {
      await applyAutoDecision({
        examId,
        statusValue: autoDecision.statusValue,
        note: autoDecision.note,
        reasonCode: autoDecision.reasonCode,
        userId: req.session.user.discordId,
        mainChannelId: mainChannel?.id || null,
        staffChannelId: staffChannel?.id || null,
        staffMessageId
      });
    } else {
      await query(
        `UPDATE exams SET status = 'submitted', submitted_at = NOW() WHERE id = $1 AND status = 'submitting'`,
        [examId]
      );
    }

    const ticketLink = mainLink || staffLink || null;
    res.json({ ok: true, ticketLink });
  } catch (err) {
    console.error("exam/submit error:", err);
    try {
      // Best-effort unlock in case anything failed mid-submit.
      if (req?.body?.examId && req.session?.user?.discordId) {
        await query(
          `UPDATE exams SET status = 'in_progress' WHERE id = $1 AND user_discord_id = $2 AND status = 'submitting'`,
          [req.body.examId, req.session.user.discordId]
        );
      }
    } catch {}
    res.status(500).json({ error: "db_error" });
  }
});

export default router;
