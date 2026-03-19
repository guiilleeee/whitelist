import {
  Client,
  GatewayIntentBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder
} from "discord.js";
import { query } from "./db.js";
import { editMessage, postToChannel, botEnabled, addMemberRole, removeMemberRole, deleteChannel } from "./discord_channels.js";

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function staffConfig() {
  // New (preferred)
  const guildId = process.env.DISCORD_STAFF_GUILD_ID || process.env.DISCORD_GUILD_ID || process.env.DISCORD_MAIN_GUILD_ID;
  const staffRoleIds = parseCsv(process.env.DISCORD_STAFF_ROLE_IDS_STAFF || process.env.DISCORD_STAFF_ROLE_IDS);
  return { guildId, staffRoleIds };
}

function mainGuildId() {
  return process.env.DISCORD_MAIN_GUILD_ID || process.env.DISCORD_GUILD_ID || null;
}

function decisionButtonsDisabled() {
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 3, custom_id: "wl_disabled", label: "Aceptada", disabled: true },
        { type: 2, style: 4, custom_id: "wl_disabled2", label: "Rechazada", disabled: true },
        { type: 2, style: 2, custom_id: "wl_disabled3", label: "Pendiente de cambios", disabled: true }
      ]
    }
  ];
}

function appealButtonsDisabled() {
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 1, custom_id: "wl_appeal_disabled", label: "Apelacion", disabled: true },
        { type: 2, style: 4, custom_id: "wl_close_disabled", label: "Cerrar ticket", disabled: true }
      ]
    }
  ];
}

function blacklistButtonsDisabled() {
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 3, custom_id: "bl_disabled", label: "Ya sali", disabled: true },
        { type: 2, style: 4, custom_id: "bl_disabled2", label: "No quiero salir", disabled: true },
        { type: 2, style: 2, custom_id: "bl_disabled3", label: "NP / Excepcion", disabled: true }
      ]
    }
  ];
}

function decisionButtonsDisabledFull() {
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 3, custom_id: "wl_disabled", label: "Aceptada", disabled: true },
        { type: 2, style: 4, custom_id: "wl_disabled2", label: "Rechazada", disabled: true },
        { type: 2, style: 2, custom_id: "wl_disabled3", label: "Pendiente de cambios", disabled: true },
        { type: 2, style: 1, custom_id: "wl_disabled4", label: "Cerrar ticket", disabled: true }
      ]
    }
  ];
}

function rejectionReasonLabel(value) {
  switch (value) {
    case "no_apto":
      return "No apto / no cumple requisitos";
    case "wl_mal":
      return "No ha corregido bien la whitelist";
    case "cheats":
      return "Relacion con chetos / blacklist";
    case "vac":
      return "VAC reciente / baneos";
    case "menor":
      return "Menor de edad";
    case "incoherente":
      return "Incoherencias graves";
    case "toxico":
      return "Toxicidad / faltas de respeto";
    default:
      return "Motivo no especificado";
  }
}

function hasStaffRole(interaction, staffRoleIds) {
  try {
    const roles = interaction?.member?.roles;
    if (!roles) return false;
    // discord.js: roles is a GuildMemberRoleManager (roles.cache is a Collection)
    const roleList = Array.isArray(roles)
      ? roles
      : roles?.cache
        ? Array.from(roles.cache.keys())
        : [];
    return staffRoleIds.some((id) => roleList.includes(id));
  } catch {
    return false;
  }
}

function resultMeta(statusValue) {
  if (statusValue === "approved") return { label: "ACEPTADA", color: 0x2ecc71 };
  if (statusValue === "rejected") return { label: "RECHAZADA", color: 0xe74c3c };
  return { label: "PENDIENTE DE CAMBIOS", color: 0xf1c40f };
}

async function applyRoles({ statusValue, userId }) {
  const mainGuildId = process.env.DISCORD_MAIN_GUILD_ID || process.env.DISCORD_GUILD_ID || null;
  if (!mainGuildId) return;

  const roleApproved = process.env.DISCORD_MAIN_ROLE_APPROVED_ID || null;
  const roleRejected = process.env.DISCORD_MAIN_ROLE_REJECTED_ID || null;
  const roleVac = process.env.DISCORD_MAIN_ROLE_VAC_ID || null;

  try {
    if (statusValue === "approved" && roleApproved) {
      await addMemberRole({ guildId: mainGuildId, userId, roleId: roleApproved });
      if (roleRejected) await removeMemberRole({ guildId: mainGuildId, userId, roleId: roleRejected });
    }
    if (statusValue === "rejected" && roleRejected) {
      await addMemberRole({ guildId: mainGuildId, userId, roleId: roleRejected });
      if (roleApproved) await removeMemberRole({ guildId: mainGuildId, userId, roleId: roleApproved });
    }
    if (statusValue === "rejected" && roleVac) {
      // only if caller decides, see handleDecision
    }
  } catch (e) {
    console.error("role assignment error:", e);
  }
}

async function handleDecision({ examId, statusValue, note, interaction, reasonCode }) {
  const allowed = ["approved", "rejected", "changes_requested"];
  if (!allowed.includes(statusValue)) return { ok: false, error: "invalid_status" };

  const examRes = await query(
    `SELECT id, status, user_discord_id, discord_channel_id_main, discord_channel_id_staff, discord_message_id_staff
     FROM exams WHERE id = $1`,
    [examId]
  );
  if (!examRes.rows.length) return { ok: false, error: "exam_not_found" };
  const exam = examRes.rows[0];

  if (!["submitted", "submitting", "approved", "rejected", "changes_requested"].includes(exam.status)) {
    return { ok: false, error: "exam_not_submitted" };
  }

  if (exam.status === statusValue) {
    return { ok: true, already: true };
  }

  await query(`UPDATE exams SET status = $2, reviewed_at = NOW() WHERE id = $1`, [examId, statusValue]);

  const { label: resultText, color } = resultMeta(statusValue);
  const staffUser = interaction?.user?.tag || interaction?.user?.username || "staff";

  // Update staff message: disable only on final decisions.
  try {
    if (exam.discord_channel_id_staff && exam.discord_message_id_staff && (statusValue === "approved" || statusValue === "rejected")) {
      await editMessage(exam.discord_channel_id_staff, exam.discord_message_id_staff, { components: decisionButtonsDisabled() });
    }
    if (exam.discord_channel_id_staff) {
      await postToChannel(exam.discord_channel_id_staff, {
        embeds: [
          {
            title: `Revision: ${resultText}`,
            color,
            description: `Examen #${examId}\nPor: ${staffUser}${note ? `\n\n**Nota:**\n${String(note).slice(0, 1800)}` : ""}`
          }
        ]
      });
    }
  } catch (e) {
    console.error("staff message update error:", e);
  }

  // Notify main ticket channel
  try {
    if (exam.discord_channel_id_main) {
      await postToChannel(exam.discord_channel_id_main, {
        content: `<@${exam.user_discord_id}>`,
        embeds: [
          {
            title: `Whitelist ${resultText}`,
            color,
            description:
              statusValue === "changes_requested"
                ? "El staff te ha pedido cambios. Responde en este ticket y sigue las indicaciones."
                : "El staff ha finalizado la revision de tu whitelist.",
            fields: note ? [{ name: "Motivo / nota", value: String(note).slice(0, 1024), inline: false }] : []
          }
        ]
      });
    }
  } catch (e) {
    console.error("main channel notify error:", e);
  }

  // Assign roles in main guild (approved/rejected)
  await applyRoles({ statusValue, userId: exam.user_discord_id });

  // Optional VAC role if rejection reason indicates VAC.
  if (statusValue === "rejected" && reasonCode === "vac") {
    const mainGuildId = process.env.DISCORD_MAIN_GUILD_ID || process.env.DISCORD_GUILD_ID || null;
    const roleVac = process.env.DISCORD_MAIN_ROLE_VAC_ID || null;
    if (mainGuildId && roleVac) {
      try {
        await addMemberRole({ guildId: mainGuildId, userId: exam.user_discord_id, roleId: roleVac });
      } catch {}
    }
  }

  return { ok: true };
}

async function postApprovalLog({ examId }) {
  const logChannelId = process.env.DISCORD_STAFF_LOG_CHANNEL_ID || null;
  if (!logChannelId) return;

  const examRes = await query(
    `SELECT e.id, e.user_discord_id, e.discord_username, e.steam_link
     FROM exams e WHERE e.id = $1`,
    [examId]
  );
  if (!examRes.rows.length) return;
  const exam = examRes.rows[0];

  const profileLog = await query(
    `SELECT details FROM logs WHERE exam_id = $1 AND type = 'profile' ORDER BY id DESC LIMIT 1`,
    [examId]
  );
  const profile = profileLog.rows[0]?.details || {};

  const history = String(profile?.characterStory || "(sin historia)").slice(0, 1800);
  const comment = "Aprobado";

  await postToChannel(logChannelId, {
    embeds: [
      {
        title: "Whitelist aprobada",
        color: 0x2ecc71,
        fields: [
          { name: "Discord", value: `<@${exam.user_discord_id}>`, inline: true },
          { name: "Discord ID", value: String(exam.user_discord_id || "N/A"), inline: true },
          { name: "Steam", value: String(exam.steam_link || "N/A").slice(0, 200), inline: false },
          { name: "Comentario", value: comment, inline: false }
        ],
        description: `**Historia:**\n${history}`
      }
    ]
  });
}

async function postTranscriptToLog({ examId }) {
  const logChannelId = process.env.DISCORD_STAFF_LOG_CHANNEL_ID || null;
  if (!logChannelId) return;

  const examRes = await query(
    `SELECT e.id, e.user_discord_id, e.discord_username, e.steam_link
     FROM exams e WHERE e.id = $1`,
    [examId]
  );
  if (!examRes.rows.length) return;
  const exam = examRes.rows[0];

  const profileLog = await query(
    `SELECT details FROM logs WHERE exam_id = $1 AND type = 'profile' ORDER BY id DESC LIMIT 1`,
    [examId]
  );
  const profile = profileLog.rows[0]?.details || {};

  const history = String(profile?.characterStory || "(sin historia)").slice(0, 1800);
  const comment = "Transcript generado por cierre manual";

  await postToChannel(logChannelId, {
    embeds: [
      {
        title: "Whitelist - Transcript",
        color: 0x95a5a6,
        fields: [
          { name: "Discord", value: `<@${exam.user_discord_id}>`, inline: true },
          { name: "Discord ID", value: String(exam.user_discord_id || "N/A"), inline: true },
          { name: "Steam", value: String(exam.steam_link || "N/A").slice(0, 200), inline: false },
          { name: "Comentario", value: comment, inline: false }
        ],
        description: `**Historia:**\n${history}`
      }
    ]
  });
}

export function startDiscordBot() {
  if (!botEnabled()) return null;
  if (!process.env.DISCORD_BOT_TOKEN) return null;

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once("ready", () => {
    console.log(`Discord bot ready as ${client.user?.tag || client.user?.id}`);
  });

  client.on("interactionCreate", async (interaction) => {
    try {
      const { guildId: staffGuildId, staffRoleIds } = staffConfig();
      const mainGuild = mainGuildId();

      if (interaction.isButton()) {
        const id = interaction.customId || "";

        if (id.startsWith("wl_decide:")) {
          if (!staffGuildId || interaction.guildId !== staffGuildId) return;
          if (!hasStaffRole(interaction, staffRoleIds)) {
            await interaction.reply({ content: "No tienes permisos para revisar whitelists.", ephemeral: true });
            return;
          }
          const parts = id.split(":");
          const examId = Number(parts[1]);
          const status = parts[2];
          if (!Number.isInteger(examId) || status !== "approved") return;

          await interaction.deferReply({ ephemeral: true });
          const result = await handleDecision({ examId, statusValue: "approved", note: null, interaction });
          if (!result.ok) return interaction.editReply({ content: `No se pudo aplicar: ${result.error}` });
          await postApprovalLog({ examId });
          return interaction.editReply({ content: "Decision aplicada." });
        }

        if (id.startsWith("wl_reject:")) {
          if (!staffGuildId || interaction.guildId !== staffGuildId) return;
          if (!hasStaffRole(interaction, staffRoleIds)) {
            await interaction.reply({ content: "No tienes permisos para revisar whitelists.", ephemeral: true });
            return;
          }
          const examId = Number(id.split(":")[1]);
          if (!Number.isInteger(examId)) return;

          return interaction.reply({
            ephemeral: true,
            content: "Selecciona el motivo de rechazo:",
            components: [
              {
                type: 1,
                components: [
                  {
                    type: 3,
                    custom_id: `wl_reject_reason:${examId}`,
                    placeholder: "Selecciona un motivo",
                    options: [
                      { label: "No apto / no cumple requisitos", value: "no_apto" },
                      { label: "No ha corregido bien la whitelist", value: "wl_mal" },
                      { label: "Relacion con chetos / blacklist", value: "cheats" },
                      { label: "VAC reciente / baneos", value: "vac" },
                      { label: "Menor de edad", value: "menor" },
                      { label: "Incoherencias graves", value: "incoherente" },
                      { label: "Toxicidad / faltas de respeto", value: "toxico" }
                    ]
                  }
                ]
              }
            ]
          });
        }

        if (id.startsWith("wl_changes:")) {
          if (!staffGuildId || interaction.guildId !== staffGuildId) return;
          if (!hasStaffRole(interaction, staffRoleIds)) {
            await interaction.reply({ content: "No tienes permisos para revisar whitelists.", ephemeral: true });
            return;
          }
          const examId = Number(id.split(":")[1]);
          if (!Number.isInteger(examId)) return;

          const modal = new ModalBuilder().setCustomId(`wl_changes_modal:${examId}`).setTitle("Pendiente de cambios");
          const input = new TextInputBuilder()
            .setCustomId("note")
            .setLabel("Mensaje para el usuario (que debe corregir)")
            .setStyle(TextInputStyle.Paragraph)
            .setMinLength(10)
            .setMaxLength(900)
            .setRequired(true);

          modal.addComponents(new ActionRowBuilder().addComponents(input));
          return interaction.showModal(modal);
        }

        if (id.startsWith("wl_appeal:")) {
          if (mainGuild && interaction.guildId !== mainGuild) return;
          const discordId = id.split(":")[1];
          if (!discordId) return;

          // Only the same user or staff can appeal.
          if (interaction.user.id !== discordId && !hasStaffRole(interaction, staffRoleIds)) {
            await interaction.reply({ content: "No puedes enviar una apelacion para otro usuario.", ephemeral: true });
            return;
          }

          const modal = new ModalBuilder().setCustomId(`wl_appeal_modal:${discordId}`).setTitle("Apelacion");
          const input = new TextInputBuilder()
            .setCustomId("proof")
            .setLabel("Pruebas del robo de cuenta (links o texto)")
            .setStyle(TextInputStyle.Paragraph)
            .setMinLength(10)
            .setMaxLength(900)
            .setRequired(true);

          modal.addComponents(new ActionRowBuilder().addComponents(input));
          return interaction.showModal(modal);
        }

        if (id.startsWith("wl_close:")) {
          if (mainGuild && interaction.guildId !== mainGuild) return;
          const discordId = id.split(":")[1];
          if (!discordId) return;

          // Only the same user or staff can close.
          if (interaction.user.id !== discordId && !hasStaffRole(interaction, staffRoleIds)) {
            await interaction.reply({ content: "No puedes cerrar este ticket.", ephemeral: true });
            return;
          }

          await interaction.deferReply({ ephemeral: true });
          // Find appeal ticket by discord_id + channel
          const appealRes = await query(
            `SELECT id, main_channel_id, main_message_id
             FROM appeals
             WHERE discord_id = $1 AND main_channel_id = $2
             ORDER BY created_at DESC
             LIMIT 1`,
            [discordId, interaction.channelId]
          );

          if (appealRes.rows.length) {
            const appeal = appealRes.rows[0];
            try {
              if (appeal.main_channel_id && appeal.main_message_id) {
                await editMessage(appeal.main_channel_id, appeal.main_message_id, { components: appealButtonsDisabled() });
              }
            } catch {}
            await query(`UPDATE appeals SET status = 'closed', updated_at = NOW() WHERE id = $1`, [appeal.id]);
          }

          await postToChannel(interaction.channelId, {
            content: "Ticket cerrado por el usuario."
          });
          return interaction.editReply({ content: "Ticket cerrado." });
        }

        if (id.startsWith("wl_close_ticket:")) {
          if (!staffGuildId || interaction.guildId !== staffGuildId) return;
          if (!hasStaffRole(interaction, staffRoleIds)) {
            await interaction.reply({ content: "No tienes permisos para cerrar tickets.", ephemeral: true });
            return;
          }
          const examId = Number(id.split(":")[1]);
          if (!Number.isInteger(examId)) return;

          await interaction.deferReply({ ephemeral: true });
          const examRes = await query(
            `SELECT discord_channel_id_staff, discord_message_id_staff FROM exams WHERE id = $1`,
            [examId]
          );
          const exam = examRes.rows[0];
          if (exam?.discord_channel_id_staff && exam?.discord_message_id_staff) {
            try {
              await editMessage(exam.discord_channel_id_staff, exam.discord_message_id_staff, {
                components: decisionButtonsDisabledFull()
              });
            } catch {}
          }
          await postToChannel(interaction.channelId, { content: "Ticket cerrado por staff." });
          return interaction.editReply({ content: "Ticket cerrado." });
        }

        if (id.startsWith("bl_left:") || id.startsWith("bl_refuse:") || id.startsWith("bl_exception:")) {
          const discordId = id.split(":")[1];
          if (!discordId) return;
          if (mainGuild && interaction.guildId !== mainGuild) return;

          const isOwner = interaction.user.id === discordId;
          const isStaff = hasStaffRole(interaction, staffRoleIds);
          if (!isOwner && !isStaff) {
            await interaction.reply({ content: "No puedes responder por este usuario.", ephemeral: true });
            return;
          }

          await interaction.deferReply({ ephemeral: true });

          const ticketRes = await query(
            `SELECT id, main_channel_id, staff_channel_id, main_message_id
             FROM blacklist_tickets
             WHERE discord_id = $1
             ORDER BY created_at DESC
             LIMIT 1`,
            [discordId]
          );
          const ticket = ticketRes.rows[0];

          const staffMessage =
            id.startsWith("bl_left:")
              ? "El usuario indica que **ya se ha salido** de los servidores prohibidos."
              : id.startsWith("bl_refuse:")
                ? "El usuario **no quiere salir** de los servidores prohibidos."
                : "Excepcion solicitada (NP).";

          if (ticket?.staff_channel_id) {
            const staffRoleId = staffRoleIds[0] || null;
            const staffMention = staffRoleId ? `<@&${staffRoleId}>` : "@staff";
            await postToChannel(ticket.staff_channel_id, {
              content: `${staffMention}`,
              embeds: [
                {
                  title: "Blacklist - respuesta del usuario",
                  color: id.startsWith("bl_left:") ? 0x2ecc71 : id.startsWith("bl_refuse:") ? 0xe74c3c : 0xf1c40f,
                  description: staffMessage,
                  fields: [
                    { name: "Usuario", value: `<@${discordId}>`, inline: true },
                    { name: "Discord ID", value: String(discordId), inline: true }
                  ]
                }
              ]
            });
          }

          if (ticket?.main_channel_id && ticket?.main_message_id) {
            try {
              await editMessage(ticket.main_channel_id, ticket.main_message_id, { components: blacklistButtonsDisabled() });
            } catch {}
          }

          if (ticket?.id) {
            await query(`UPDATE blacklist_tickets SET status = $2, updated_at = NOW() WHERE id = $1`, [
              ticket.id,
              id.startsWith("bl_left:") ? "left" : id.startsWith("bl_refuse:") ? "refuse" : "exception"
            ]);
          }

          return interaction.editReply({ content: "Respuesta enviada al staff." });
        }

        if (id.startsWith("wl_close_main:")) {
          const examId = Number(id.split(":")[1]);
          if (!Number.isInteger(examId)) return;
          if (mainGuild && interaction.guildId !== mainGuild) return;

          const examRes = await query(
            `SELECT user_discord_id FROM exams WHERE id = $1`,
            [examId]
          );
          const exam = examRes.rows[0];
          if (!exam) return;

          const isOwner = interaction.user.id === exam.user_discord_id;
          const isStaff = hasStaffRole(interaction, staffRoleIds);
          if (!isOwner && !isStaff) {
            await interaction.reply({ content: "No tienes permisos para cerrar este ticket.", ephemeral: true });
            return;
          }

          await interaction.reply({
            content: "Se ha generado el transcript. Quieres cerrar definitivamente el ticket?",
            ephemeral: true,
            components: [
              {
                type: 1,
                components: [
                  { type: 2, style: 3, custom_id: `wl_close_confirm:${examId}`, label: "Si, cerrar" },
                  { type: 2, style: 2, custom_id: `wl_close_cancel:${examId}`, label: "No, mantener" }
                ]
              }
            ]
          });
          return;
        }
        if (id.startsWith("wl_close_confirm:")) {
          const examId = Number(id.split(":")[1]);
          if (!Number.isInteger(examId)) return;
          if (mainGuild && interaction.guildId !== mainGuild) return;

          await interaction.deferReply({ ephemeral: true });
          await postTranscriptToLog({ examId });
          try {
            await deleteChannel(interaction.channelId);
          } catch {}
          return interaction.editReply({ content: "Ticket cerrado definitivamente." });
        }
        if (id.startsWith("wl_close_cancel:")) {
          if (mainGuild && interaction.guildId !== mainGuild) return;
          await interaction.reply({ content: "Ticket se mantiene abierto.", ephemeral: true });
          return;
        }

        return;
      }

      if (interaction.isModalSubmit()) {
        const id = interaction.customId || "";

        if (id.startsWith("wl_changes_modal:")) {
          if (!staffGuildId || interaction.guildId !== staffGuildId) return;
          if (!hasStaffRole(interaction, staffRoleIds)) {
            await interaction.reply({ content: "No tienes permisos para revisar whitelists.", ephemeral: true });
            return;
          }
          const examId = Number(id.split(":")[1]);
          const note = interaction.fields.getTextInputValue("note");
          await interaction.deferReply({ ephemeral: true });
          const result = await handleDecision({ examId, statusValue: "changes_requested", note, interaction });
          if (!result.ok) return interaction.editReply({ content: `No se pudo aplicar: ${result.error}` });
          return interaction.editReply({ content: "Mensaje de cambios enviado al usuario." });
        }
        if (id.startsWith("wl_appeal_modal:")) {
          if (mainGuild && interaction.guildId !== mainGuild) return;
          const discordId = id.split(":")[1];
          const proof = interaction.fields.getTextInputValue("proof");
          await interaction.deferReply({ ephemeral: true });

          const appealRes = await query(
            `SELECT id, main_channel_id, staff_channel_id, main_message_id
             FROM appeals
             WHERE discord_id = $1
             ORDER BY created_at DESC
             LIMIT 1`,
            [discordId]
          );
          if (!appealRes.rows.length) {
            return interaction.editReply({ content: "No se encontro un ticket de apelacion." });
          }

          const appeal = appealRes.rows[0];
          await query(`UPDATE appeals SET status = 'appeal_submitted', updated_at = NOW() WHERE id = $1`, [appeal.id]);

          if (appeal.main_channel_id && appeal.main_message_id) {
            try {
              await editMessage(appeal.main_channel_id, appeal.main_message_id, { components: appealButtonsDisabled() });
            } catch {}
          }

          if (appeal.staff_channel_id) {
            await postToChannel(appeal.staff_channel_id, {
              embeds: [
                {
                  title: "Apelacion recibida",
                  color: 0xf1c40f,
                  description: `Usuario: <@${discordId}>\n\n**Pruebas:**\n${String(proof).slice(0, 1800)}`
                }
              ]
            });
          }

          if (appeal.main_channel_id) {
            await postToChannel(appeal.main_channel_id, {
              content: "<@"+discordId+"> Apelacion enviada. El staff revisara tus pruebas."
            });
          }

          return interaction.editReply({ content: "Apelacion enviada al staff." });
        }
      }

      if (interaction.isStringSelectMenu()) {
        const id = interaction.customId || "";
        if (id.startsWith("wl_reject_reason:")) {
          if (!staffGuildId || interaction.guildId !== staffGuildId) return;
          if (!hasStaffRole(interaction, staffRoleIds)) {
            await interaction.reply({ content: "No tienes permisos para revisar whitelists.", ephemeral: true });
            return;
          }
          const examId = Number(id.split(":")[1]);
          const reasonCode = interaction.values?.[0];
          if (!Number.isInteger(examId) || !reasonCode) return;

          const note = rejectionReasonLabel(reasonCode);
          await interaction.deferReply({ ephemeral: true });
          const result = await handleDecision({ examId, statusValue: "rejected", note, interaction, reasonCode });
          if (!result.ok) return interaction.editReply({ content: `No se pudo aplicar: ${result.error}` });
          return interaction.editReply({ content: `Rechazo enviado: ${note}` });
        }
      }

    } catch (e) {
      console.error("interaction handler error:", e);
      try {
        if (interaction.deferred) {
          await interaction.editReply({ content: "Error interno al procesar la decision." });
        } else {
          await interaction.reply({ content: "Error interno al procesar la decision.", ephemeral: true });
        }
      } catch {}
    }
  });

  client.login(process.env.DISCORD_BOT_TOKEN).catch((e) => {
    console.error("Discord bot login error:", e);
  });

  return client;
}

