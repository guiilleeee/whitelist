const DISCORD_EPOCH = 1420070400000n;

export function snowflakeToDate(snowflake) {
  try {
    const id = BigInt(snowflake);
    const timestamp = Number((id >> 22n) + DISCORD_EPOCH);
    return new Date(timestamp);
  } catch {
    return null;
  }
}

export function isOlderThanMonths(date, months) {
  if (!date) return false;
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - months);
  return date <= cutoff;
}

export async function sendWebhook(payload) {
  if (!process.env.DISCORD_WEBHOOK_URL) return;
  await fetch(process.env.DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}
