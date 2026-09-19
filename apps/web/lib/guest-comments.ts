export const GUEST_NAME_MAX_LENGTH = 40;
export const GUEST_COMMENT_MAX_LENGTH = 1000;
export const GUEST_COMMENT_RATE_LIMIT = 10;
export const GUEST_COMMENT_RATE_WINDOW_MS = 10 * 60 * 1000;

export const GUEST_NAME_STORAGE_KEY = "cap_guest_comment_name";

export const guestCommentsEnabled = (value?: string | null) =>
	value?.trim().toLowerCase() === "true";

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export const sanitizeGuestText = (
	value: string | null | undefined,
	maxLength: number,
) => {
	if (typeof value !== "string") return null;
	const cleaned = value.replace(CONTROL_CHARACTERS, "").trim();
	if (!cleaned) return null;
	return cleaned.slice(0, maxLength);
};
