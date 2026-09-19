import { describe, expect, it } from "vitest";

import {
	GUEST_COMMENT_MAX_LENGTH,
	GUEST_NAME_MAX_LENGTH,
	guestCommentsEnabled,
	sanitizeGuestText,
} from "@/lib/guest-comments";

describe("guestCommentsEnabled", () => {
	it("is only enabled for the literal string true", () => {
		expect(guestCommentsEnabled("true")).toBe(true);
		expect(guestCommentsEnabled(" TRUE ")).toBe(true);
		expect(guestCommentsEnabled("false")).toBe(false);
		expect(guestCommentsEnabled("1")).toBe(false);
		expect(guestCommentsEnabled("")).toBe(false);
		expect(guestCommentsEnabled(undefined)).toBe(false);
		expect(guestCommentsEnabled(null)).toBe(false);
	});
});

describe("sanitizeGuestText", () => {
	it("rejects empty and whitespace-only input", () => {
		expect(sanitizeGuestText("", GUEST_NAME_MAX_LENGTH)).toBeNull();
		expect(sanitizeGuestText("   ", GUEST_NAME_MAX_LENGTH)).toBeNull();
		expect(sanitizeGuestText(undefined, GUEST_NAME_MAX_LENGTH)).toBeNull();
		expect(sanitizeGuestText(null, GUEST_NAME_MAX_LENGTH)).toBeNull();
	});

	it("trims surrounding whitespace", () => {
		expect(sanitizeGuestText("  Carl  ", GUEST_NAME_MAX_LENGTH)).toBe("Carl");
	});

	it("strips control characters", () => {
		expect(sanitizeGuestText("a\u0000b\u001Fc\u007F", 40)).toBe("abc");
	});

	it("keeps newlines in comment bodies", () => {
		expect(sanitizeGuestText("one\ntwo", GUEST_COMMENT_MAX_LENGTH)).toBe(
			"one\ntwo",
		);
	});

	it("truncates to the given maximum", () => {
		expect(
			sanitizeGuestText("x".repeat(80), GUEST_NAME_MAX_LENGTH),
		).toHaveLength(GUEST_NAME_MAX_LENGTH);
		expect(
			sanitizeGuestText("y".repeat(2000), GUEST_COMMENT_MAX_LENGTH),
		).toHaveLength(GUEST_COMMENT_MAX_LENGTH);
	});

	it("rejects input that is only control characters", () => {
		expect(sanitizeGuestText("\u0000\u0001", GUEST_NAME_MAX_LENGTH)).toBeNull();
	});
});
