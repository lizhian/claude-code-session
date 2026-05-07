const DEFAULT_TRANSCRIPT_MESSAGE_LIMIT = 100;
const DEFAULT_TRANSCRIPT_HEAD_MESSAGE_COUNT = 20;

function normalizeTranscriptMessages(messages, options = {}) {
  const messageLimit = options.messageLimit || DEFAULT_TRANSCRIPT_MESSAGE_LIMIT;
  const headCount = options.headCount ?? DEFAULT_TRANSCRIPT_HEAD_MESSAGE_COUNT;
  const tailCount = options.tailCount ?? Math.max(0, messageLimit - headCount);
  const userMessages = [];

  for (const message of messages) {
    const role = String(message.role || "").toLowerCase();
    if (role !== "user") {
      continue;
    }
    const text = String(message.text || "").trim();
    if (!text) {
      continue;
    }

    userMessages.push({
      role: "user",
      timestamp: message.timestamp || "",
      text,
      ordinal: userMessages.length + 1,
    });
  }

  const leadingCount = Math.min(headCount, messageLimit);
  const trailingCount = Math.min(tailCount, Math.max(0, messageLimit - leadingCount));
  const selectedMessages =
    userMessages.length > messageLimit
      ? [
          ...userMessages.slice(0, leadingCount),
          ...(trailingCount > 0 ? userMessages.slice(-trailingCount) : []),
        ]
      : userMessages;
  const skippedCount = Math.max(0, userMessages.length - selectedMessages.length);

  return {
    messages: selectedMessages,
    totalMessages: userMessages.length,
    truncated: skippedCount > 0,
    skippedCount,
    messageLimit,
    headCount,
    tailCount,
  };
}

module.exports = {
  DEFAULT_TRANSCRIPT_HEAD_MESSAGE_COUNT,
  DEFAULT_TRANSCRIPT_MESSAGE_LIMIT,
  normalizeTranscriptMessages,
};
