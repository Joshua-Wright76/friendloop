const REPLY_LOCAL_PART = "loop";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function normalizeEmailAddress(value: string): string {
  const trimmed = value.trim();
  const address = trimmed.match(/<([^>]+)>/)?.[1] ?? trimmed;
  return address.trim().toLowerCase();
}

export function normalizeReplyDomain(value: string | null | undefined): string | null {
  const domain = value?.trim().toLowerCase().replace(/\.$/, "") ?? "";
  if (
    domain.length > 253 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(domain)
  ) {
    return null;
  }
  return domain;
}

export function configuredReplyDomain(): string | null {
  return normalizeReplyDomain(process.env.EMAIL_REPLY_DOMAIN);
}

export function replyAddress(token: string, domain = configuredReplyDomain()): string | null {
  const normalized = normalizeReplyDomain(domain);
  if (!normalized || !TOKEN_PATTERN.test(token)) return null;
  return `${REPLY_LOCAL_PART}+${token}@${normalized}`;
}

export function replyTokenFromRecipients(
  recipients: string[],
  domain = configuredReplyDomain(),
): string | null {
  const normalized = normalizeReplyDomain(domain);
  if (!normalized) return null;

  const prefix = `${REPLY_LOCAL_PART}+`;
  const tokens = new Set<string>();

  for (const recipient of recipients) {
    const trimmed = recipient.trim();
    const address = (trimmed.match(/<([^>]+)>/)?.[1] ?? trimmed).trim();
    const at = address.lastIndexOf("@");
    if (at < 0 || address.slice(at + 1).toLowerCase() !== normalized) continue;

    const local = address.slice(0, at);
    if (local.slice(0, prefix.length).toLowerCase() !== prefix) continue;
    const token = local.slice(prefix.length);
    if (TOKEN_PATTERN.test(token)) tokens.add(token);
  }

  return tokens.size === 1 ? [...tokens][0] : null;
}
