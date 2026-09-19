"use server";

import { db } from "@cap/database";
import { getCurrentUser } from "@cap/database/auth/session";
import { nanoId } from "@cap/database/helpers";
import { comments, videos } from "@cap/database/schema";
import { serverEnv } from "@cap/env";
import type { ImageUpload } from "@cap/web-domain";
import { Comment, type Video } from "@cap/web-domain";
import { and, count, eq, gt, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
	GUEST_COMMENT_MAX_LENGTH,
	GUEST_COMMENT_RATE_LIMIT,
	GUEST_COMMENT_RATE_WINDOW_MS,
	GUEST_NAME_MAX_LENGTH,
	guestCommentsEnabled,
	sanitizeGuestText,
} from "@/lib/guest-comments";
import { createNotification } from "@/lib/Notification";

export async function newComment(data: {
	content: string;
	videoId: Video.VideoId;
	type: "text" | "emoji";
	authorImage: ImageUpload.ImageUrl | null;
	parentCommentId: Comment.CommentId;
	timestamp: number | null;
	guestName?: string | null;
}) {
	const user = await getCurrentUser();

	const content = data.content;
	const videoId = data.videoId;
	const type = data.type;
	const parentCommentId = data.parentCommentId;
	const timestamp = data.timestamp;
	const conditionalType = parentCommentId
		? "reply"
		: type === "emoji"
			? "reaction"
			: "comment";

	if (!content || !videoId) {
		throw new Error("Content and videoId are required");
	}

	let guestName: string | null = null;

	if (!user) {
		if (!guestCommentsEnabled(serverEnv().CAP_ALLOW_GUEST_COMMENTS)) {
			throw new Error("User not authenticated");
		}

		guestName = sanitizeGuestText(data.guestName, GUEST_NAME_MAX_LENGTH);
		if (!guestName) throw new Error("A display name is required");

		const [video] = await db()
			.select({ settings: videos.settings })
			.from(videos)
			.where(eq(videos.id, videoId))
			.limit(1);

		if (!video) throw new Error("Video not found");
		if (type === "text" && video.settings?.disableComments)
			throw new Error("Comments are disabled for this video");
		if (type === "emoji" && video.settings?.disableReactions)
			throw new Error("Reactions are disabled for this video");

		const [recent] = await db()
			.select({ value: count() })
			.from(comments)
			.where(
				and(
					eq(comments.videoId, videoId),
					isNull(comments.authorId),
					gt(
						comments.createdAt,
						new Date(Date.now() - GUEST_COMMENT_RATE_WINDOW_MS),
					),
				),
			);

		if ((recent?.value ?? 0) >= GUEST_COMMENT_RATE_LIMIT)
			throw new Error("Too many comments, please try again later");
	}

	const sanitizedContent = user
		? content
		: sanitizeGuestText(content, GUEST_COMMENT_MAX_LENGTH);

	if (!sanitizedContent) throw new Error("Content is required");

	const id = Comment.CommentId.make(nanoId());

	const newComment = {
		id: id,
		authorId: user?.id ?? null,
		guestName,
		type: type,
		content: sanitizedContent,
		videoId: videoId,
		timestamp: timestamp ?? null,
		parentCommentId: parentCommentId,
		createdAt: new Date(),
		updatedAt: new Date(),
	};

	await db().insert(comments).values(newComment);

	// createNotification resolves the author against the users table, so there is
	// nothing it can record for a signed-out guest.
	if (user) {
		try {
			await createNotification({
				type: conditionalType,
				videoId,
				authorId: user.id,
				comment: { id, content: sanitizedContent },
				parentCommentId,
			});
		} catch (error) {
			console.error("Failed to create notification:", error);
		}
	}

	const commentWithAuthor = {
		...newComment,
		authorName: user?.name ?? guestName,
		authorImage: data.authorImage,
		sending: false,
	};

	revalidatePath(`/s/${videoId}`);

	return commentWithAuthor;
}
