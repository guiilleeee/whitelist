function slugifyChannelName(input) {
  const base = String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return base || "whitelist";
}

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function botEnabled() {
  return Boolean(process.env.DISCORD_BOT_TOKEN && (process.env.DISCORD_GUILD_ID || process.env.DISCORD_MAIN_GUILD_ID || process.env.DISCORD_STAFF_GUILD_ID));
}

export async function fetchGuildMember(discordUserId) {
  if (!botEnabled()) return null;
  const guildId = process.env.DISCORD_GUILD_ID || process.env.DISCORD_STAFF_GUILD_ID || process.env.DISCORD_MAIN_GUILD_ID;

  const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${discordUserId}`, {
    headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` }
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) return null;
  return json;
}

export async function isStaffMember(discordUserId) {
  if (!botEnabled()) return false;
  const staffRoleIds = parseCsv(process.env.DISCORD_STAFF_ROLE_IDS || process.env.DISCORD_STAFF_ROLE_IDS_STAFF);
  if (!staffRoleIds.length) return false;
  const member = await fetchGuildMember(discordUserId);
  const roles = Array.isArray(member?.roles) ? member.roles : [];
  return staffRoleIds.some((id) => roles.includes(id));
}

export function channelJumpLink({ guildId, channelId }) {
  if (!guildId || !channelId) return null;
  return `https://discord.com/channels/${guildId}/${channelId}`;
}

export async function addMemberRole({ guildId, userId, roleId }) {
  if (!botEnabled()) return false;
  if (!guildId || !userId || !roleId) return false;

  const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
    method: "PUT",
    headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` }
  });

  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(`discord_add_role_failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return true;
}

export async function removeMemberRole({ guildId, userId, roleId }) {
  if (!botEnabled()) return false;
  if (!guildId || !userId || !roleId) return false;

  const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
    method: "DELETE",
    headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` }
  });

  // 204 success; 404 if role wasn't present is also fine for our purposes.
  if (!res.ok && res.status !== 404) {
    const json = await res.json().catch(() => ({}));
    throw new Error(`discord_remove_role_failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return true;
}

export async function createTicketChannel({
  guildId,
  categoryId,
  staffRoleIds,
  applicantDiscordId,
  displayName,
  allowApplicant
}) {
  if (!botEnabled()) return null;

  const name = `wl-${slugifyChannelName(displayName || applicantDiscordId)}`.slice(0, 95);

  const permission_overwrites = [];

  // Deny @everyone view by default
  permission_overwrites.push({
    id: guildId,
    type: 0,
    deny: String(1n << 10n) // VIEW_CHANNEL
  });

  // Allow staff roles
  for (const roleId of staffRoleIds || []) {
    permission_overwrites.push({
      id: roleId,
      type: 0,
      allow: String((1n << 10n) | (1n << 11n) | (1n << 13n)) // VIEW_CHANNEL | SEND_MESSAGES | READ_MESSAGE_HISTORY
    });
  }

  if (allowApplicant && applicantDiscordId) {
    permission_overwrites.push({
      id: applicantDiscordId,
      type: 1,
      allow: String((1n << 10n) | (1n << 11n) | (1n << 13n))
    });
  }

  const payload = { name, type: 0, parent_id: categoryId || null, permission_overwrites };

  const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`discord_create_channel_failed: ${res.status} ${JSON.stringify(json)}`);
  }

  return json;
}

// Backwards compatible wrapper (single guild)
export async function createReviewChannel({ applicantDiscordId, displayName }) {
  const guildId = process.env.DISCORD_GUILD_ID || process.env.DISCORD_MAIN_GUILD_ID;
  const categoryId = process.env.DISCORD_CATEGORY_ID || process.env.DISCORD_MAIN_CATEGORY_ID || null;
  const staffRoleIds = parseCsv(process.env.DISCORD_STAFF_ROLE_IDS || process.env.DISCORD_MAIN_STAFF_ROLE_IDS);
  return createTicketChannel({
    guildId,
    categoryId,
    staffRoleIds,
    applicantDiscordId,
    displayName,
    allowApplicant: true
  });
}

export async function postToChannel(channelId, payload) {
  if (!botEnabled()) return;
  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`discord_post_message_failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return json;
}

export async function editMessage(channelId, messageId, payload) {
  if (!botEnabled()) return;
  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`discord_edit_message_failed: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

export async function deleteChannel(channelId) {
  if (!botEnabled()) return;
  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`
    }
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(`discord_delete_channel_failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return true;
}
