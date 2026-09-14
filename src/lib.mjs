export const SATS_PER_BTC = 100_000_000n;
export const MAX_SUPPLY_SATS = 21_000_000n * SATS_PER_BTC;

export function btcLiteralToSats(value) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,8})?$/.test(value)) {
    throw new Error(`Invalid BTC amount: ${value}`);
  }

  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * SATS_PER_BTC + BigInt(fraction.padEnd(8, '0'));
}

export function satsToBtc(sats) {
  const negative = sats < 0n;
  const absolute = negative ? -sats : sats;
  const whole = absolute / SATS_PER_BTC;
  const fraction = (absolute % SATS_PER_BTC).toString().padStart(8, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

export function formatPercent(numerator, denominator, decimals = 9) {
  if (denominator <= 0n) {
    return 'n/a';
  }

  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const scale = 10n ** BigInt(decimals);
  const scaled = (absolute * 100n * scale + denominator / 2n) / denominator;
  const whole = scaled / scale;
  const fraction = (scaled % scale).toString().padStart(decimals, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

export function extractNumberLiteral(json, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = json.match(new RegExp(`"${escapedKey}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`));
  if (!match) {
    throw new Error(`Missing numeric field: ${key}`);
  }
  return match[1];
}

export function parseSourcePayload(raw) {
  try {
    return { payload: JSON.parse(raw), jsonText: raw };
  } catch {
    const match = raw.match(/<pre[^>]*>\s*([\s\S]*?)\s*<\/pre>/i);
    if (!match) {
      throw new Error('Source did not return JSON or an HTML <pre> JSON payload');
    }
    try {
      return { payload: JSON.parse(match[1]), jsonText: match[1] };
    } catch {
      throw new Error('Source did not return valid JSON');
    }
  }
}

function utcDate(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid UTC timestamp: ${timestamp}`);
  }
  return date.toISOString().slice(0, 10);
}

export function isSnapshotPublishedForUtcDay(snapshot, timestamp) {
  return snapshot != null && utcDate(snapshot.cutoff_utc) === utcDate(timestamp);
}

function formatSnapshotTime(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid snapshot timestamp: ${timestamp}`);
  }
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  const minute = String(date.getUTCMinutes()).padStart(2, '0');
  return `${day} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}, ${hour}:${minute} UTC`;
}

function formatSignedChange(sats) {
  const absolute = sats < 0n ? -sats : sats;
  const sign = sats > 0n ? '+' : sats < 0n ? '-' : '';
  const wholeBtc = absolute / SATS_PER_BTC;
  const remainingSats = absolute % SATS_PER_BTC;

  if (wholeBtc === 0n) {
    const amount = absolute.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const unit = absolute === 1n ? 'sat' : 'sats';
    return `${sign}${amount} ${unit}`;
  }

  const btcAmount = `${sign}${wholeBtc} BTC`;
  if (remainingSats === 0n) {
    return btcAmount;
  }

  const satsAmount = remainingSats.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const satsUnit = remainingSats === 1n ? 'sat' : 'sats';
  return `${btcAmount} and ${satsAmount} ${satsUnit}`;
}

export function buildPost({ snapshot, previousSnapshot }) {
  const total = BigInt(snapshot.total_unspendable_sats);
  const totalBtc = satsToBtc(total);
  const shareOfMax = formatPercent(total, MAX_SUPPLY_SATS);
  const shortHash = `${snapshot.block_hash.slice(0, 10)}…${snapshot.block_hash.slice(-8)}`;

  const lines = [
    'Provably unspendable $BTC · Bitcoin Core',
    '',
    `Total: ${totalBtc} BTC`,
    `Share of 21M BTC: ${shareOfMax}%`
  ];

  if (previousSnapshot) {
    const previous = BigInt(previousSnapshot.total_unspendable_sats);
    const delta = total - previous;
    const percent = formatPercent(delta, previous);
    const signedPercent = `${delta > 0n ? '+' : ''}${percent}`;
    lines.push('', 'Δ since previous snapshot:', `${formatSignedChange(delta)} (${signedPercent}%)`);
  } else {
    lines.push('', 'First snapshot — changes begin tomorrow.');
  }

  lines.push('', `Snapshot: ${formatSnapshotTime(snapshot.cutoff_utc)}`, `Block #${snapshot.height} · ${shortHash}`);
  const post = lines.join('\n');
  if (post.length > 280) {
    throw new Error(`Post too long: ${post.length} characters`);
  }
  return post;
}
