import { Button } from "@cap/ui";
import { Comment } from "@cap/web-domain";
import { AnimatePresence, motion } from "motion/react";
import { startTransition, useEffect, useState } from "react";
import { newComment } from "@/actions/videos/new-comment";
import { useCurrentUser } from "@/app/Layout/AuthContext";
import {
	GUEST_NAME_MAX_LENGTH,
	GUEST_NAME_STORAGE_KEY,
	sanitizeGuestText,
} from "@/lib/guest-comments";
import type { CommentType } from "../Share";
import type { VideoData } from "../types";
import { AuthOverlay } from "./AuthOverlay";

const MotionButton = motion.create(Button);

// million-ignore
interface ToolbarProps {
	data: VideoData;
	onOptimisticComment?: (comment: CommentType) => void;
	onCommentSuccess?: (comment: CommentType) => void;
	disableComments?: boolean;
	disableReactions?: boolean;
	allowGuestComments?: boolean;
}

type PendingGuestAction =
	| { kind: "emoji"; emoji: string }
	| { kind: "comment" };

interface EmojiButtonProps {
	label: string;
	emoji: string;
	onClick: () => void;
}

const EmojiButton = ({ label, emoji, onClick }: EmojiButtonProps) => (
	<motion.div layout className="relative size-10">
		<motion.button
			layout
			className="inline-flex relative justify-center items-center p-1 text-xl leading-6 align-middle bg-transparent rounded-full transition-colors ease-in-out size-full font-emoji sm:text-2xl duration-600 hover:bg-gray-200 active:bg-blue-500 active:duration-0"
			role="img"
			aria-label={label ? label : ""}
			aria-hidden={label ? "false" : "true"}
			onClick={onClick}
		>
			{emoji}
		</motion.button>
	</motion.div>
);

export const Toolbar = ({
	data,
	onOptimisticComment,
	onCommentSuccess,
	disableComments,
	disableReactions,
	allowGuestComments = false,
}: ToolbarProps) => {
	const user = useCurrentUser();
	const [commentBoxOpen, setCommentBoxOpen] = useState(false);
	const [comment, setComment] = useState("");
	const [showAuthOverlay, setShowAuthOverlay] = useState(false);
	const [guestName, setGuestName] = useState<string | null>(null);
	const [guestNameDraft, setGuestNameDraft] = useState("");
	const [pendingGuestAction, setPendingGuestAction] =
		useState<PendingGuestAction | null>(null);
	const canComment = !disableComments;
	const canReact = !disableReactions;
	const isGuest = !user && allowGuestComments;

	useEffect(() => {
		if (user) return;
		const stored = sanitizeGuestText(
			window.localStorage.getItem(GUEST_NAME_STORAGE_KEY),
			GUEST_NAME_MAX_LENGTH,
		);
		if (stored) setGuestName(stored);
	}, [user]);

	const identity = user
		? {
				authorId: user.id,
				authorName: user.name,
				authorImage: user.imageUrl,
				guestName: null,
			}
		: {
				authorId: null,
				authorName: guestName,
				authorImage: null,
				guestName,
			};

	const requireIdentity = (action: PendingGuestAction) => {
		if (user) return true;
		if (!isGuest) {
			setShowAuthOverlay(true);
			return false;
		}
		if (guestName) return true;
		setPendingGuestAction(action);
		return false;
	};

	const saveGuestName = () => {
		const name = sanitizeGuestText(guestNameDraft, GUEST_NAME_MAX_LENGTH);
		if (!name) return;
		window.localStorage.setItem(GUEST_NAME_STORAGE_KEY, name);
		setGuestName(name);
		setGuestNameDraft("");
		const pending = pendingGuestAction;
		setPendingGuestAction(null);
		if (pending?.kind === "emoji") void submitEmoji(pending.emoji, name);
		else if (pending?.kind === "comment") setCommentBoxOpen(true);
	};

	const submitEmoji = async (emoji: string, guestNameOverride?: string) => {
		const name = user ? user.name : (guestNameOverride ?? guestName);
		const videoElement = document.querySelector("video") as HTMLVideoElement;
		const currentTime = data.isScreenshot
			? null
			: videoElement?.currentTime || 0;
		const optimisticComment: CommentType = {
			id: Comment.CommentId.make(`temp-${Date.now()}`),
			authorId: identity.authorId,
			guestName: user ? null : (guestNameOverride ?? guestName),
			authorName: name,
			authorImage: identity.authorImage,
			content: emoji,
			createdAt: new Date(),
			videoId: data.id,
			parentCommentId: Comment.CommentId.make(""),
			type: "emoji",
			timestamp: currentTime,
			updatedAt: new Date(),
			sending: true,
		};

		onOptimisticComment?.(optimisticComment);

		try {
			const newCommentData = await newComment({
				content: emoji,
				videoId: data.id,
				authorImage: identity.authorImage,
				parentCommentId: Comment.CommentId.make(""),
				type: "emoji",
				timestamp: currentTime,
				guestName: user ? null : (guestNameOverride ?? guestName),
			});
			startTransition(() => {
				onCommentSuccess?.(newCommentData);
			});
		} catch (error) {
			console.error("Error posting comment:", error);
		} finally {
			setCommentBoxOpen(false);
			setComment("");
		}
	};

	const handleEmojiClick = async (emoji: string) => {
		if (!canReact) return;
		if (!requireIdentity({ kind: "emoji", emoji })) return;
		await submitEmoji(emoji);
	};

	const handleCommentSubmit = async () => {
		if (!canComment || comment.length === 0) return;
		if (!user && !(isGuest && guestName)) return;
		const videoElement = document.querySelector("video") as HTMLVideoElement;
		const currentTime = data.isScreenshot
			? null
			: videoElement?.currentTime || 0;
		const optimisticComment: CommentType = {
			id: Comment.CommentId.make(`temp-${Date.now()}`),
			authorId: identity.authorId,
			guestName: identity.guestName,
			authorName: identity.authorName,
			authorImage: identity.authorImage,
			content: comment,
			createdAt: new Date(),
			videoId: data.id,
			parentCommentId: Comment.CommentId.make(""),
			type: "text",
			timestamp: currentTime,
			updatedAt: new Date(),
			sending: true,
		};

		onOptimisticComment?.(optimisticComment);

		try {
			const newCommentData = await newComment({
				content: comment,
				videoId: data.id,
				authorImage: identity.authorImage,
				parentCommentId: Comment.CommentId.make(""),
				type: "text",
				timestamp: currentTime,
				guestName: identity.guestName,
			});
			startTransition(() => {
				onCommentSuccess?.(newCommentData);
			});
		} catch (error) {
			console.error("Error posting comment:", error);
		} finally {
			setCommentBoxOpen(false);
			setComment("");
		}
	};

	useEffect(() => {
		if (!canComment) return;

		const handleKeyPress = (e: KeyboardEvent) => {
			if (
				e.key.toLowerCase() === "c" &&
				!commentBoxOpen &&
				!e.metaKey &&
				!e.ctrlKey &&
				!e.altKey &&
				!e.shiftKey &&
				!(
					e.target instanceof HTMLInputElement ||
					e.target instanceof HTMLTextAreaElement
				)
			) {
				e.preventDefault();
				if (!user) {
					if (!isGuest) {
						setShowAuthOverlay(true);
						return;
					}
					if (!guestName) {
						setPendingGuestAction({ kind: "comment" });
						return;
					}
				}
				const videoElement = document.querySelector(
					"video",
				) as HTMLVideoElement;
				if (videoElement) {
					videoElement.pause();
				}
				setCommentBoxOpen(true);
			}
		};

		window.addEventListener("keydown", handleKeyPress);
		return () => {
			window.removeEventListener("keydown", handleKeyPress);
		};
	}, [canComment, commentBoxOpen, user, isGuest, guestName]);

	const handleCommentClick = () => {
		if (!canComment) return;
		if (!requireIdentity({ kind: "comment" })) return;
		const videoElement = document.querySelector("video") as HTMLVideoElement;
		if (videoElement) {
			videoElement.pause();
		}
		setCommentBoxOpen(true);
	};

	if (!canComment && !canReact) {
		return null;
	}

	return (
		<>
			<motion.div
				layout
				className="flex overflow-hidden p-2 mx-auto max-w-full bg-white rounded-full border border-gray-5 md:max-w-fit"
			>
				<AnimatePresence initial={false} mode="popLayout">
					{pendingGuestAction ? (
						<motion.div
							layout
							key="guest-name-box"
							initial={{ scale: 0.9 }}
							animate={{ scale: 1 }}
							className="flex justify-between items-center w-full"
						>
							<motion.input
								layout
								autoFocus
								type="text"
								value={guestNameDraft}
								onChange={(e) => setGuestNameDraft(e.target.value)}
								placeholder="Your name"
								className="flex-grow px-3 h-full outline-none"
								maxLength={GUEST_NAME_MAX_LENGTH}
								onKeyDown={(e) => {
									if (e.key === "Enter") {
										e.preventDefault();
										saveGuestName();
									}
									if (e.key === "Escape") {
										setPendingGuestAction(null);
										setGuestNameDraft("");
									}
								}}
							/>
							<motion.div
								layout="position"
								className="flex items-center space-x-2"
							>
								<MotionButton
									disabled={guestNameDraft.trim().length === 0}
									variant="primary"
									size="sm"
									layout="position"
									onClick={saveGuestName}
								>
									Continue
								</MotionButton>
								<MotionButton
									variant="gray"
									size="sm"
									layout="position"
									onClick={() => {
										setPendingGuestAction(null);
										setGuestNameDraft("");
									}}
								>
									Cancel
								</MotionButton>
							</motion.div>
						</motion.div>
					) : commentBoxOpen && canComment ? (
						<motion.div
							layout
							key="comment-box"
							initial={{ scale: 0.9 }}
							animate={{ scale: 1 }}
							className="flex justify-between items-center w-full"
						>
							<motion.input
								layout
								autoFocus
								type="text"
								value={comment}
								onChange={(e) => setComment(e.target.value)}
								placeholder="Add a comment"
								className="flex-grow px-3 h-full outline-none"
								maxLength={255}
								onKeyDown={(e) => {
									if (e.key === "Enter") {
										e.preventDefault();
										handleCommentSubmit();
									}
									if (e.key === "Escape") {
										setCommentBoxOpen(false);
										setComment("");
									}
								}}
							/>
							<motion.div
								layout="position"
								className="flex items-center space-x-2"
							>
								<MotionButton
									disabled={comment.length === 0}
									variant="primary"
									size="sm"
									layout="position"
									onClick={() => {
										handleCommentSubmit();
									}}
								>
									Comment
								</MotionButton>
								<MotionButton
									variant="gray"
									size="sm"
									layout="position"
									onClick={() => {
										setCommentBoxOpen(false);
										setComment("");
									}}
								>
									Cancel
								</MotionButton>
							</motion.div>
						</motion.div>
					) : (
						<motion.div
							layout
							key="toolbar"
							initial={{ scale: 0.9 }}
							animate={{ scale: 1 }}
							exit={{ scale: 0.9 }}
							transition={{ duration: 0.2, ease: "easeInOut" }}
							className="flex flex-col gap-2 items-center mx-auto w-full md:justify-center sm:grid sm:grid-flow-col md:w-fit min-h-[28px]"
						>
							{canReact && (
								<div className="flex gap-2 justify-evenly items-center w-full md:w-fit md:justify-center">
									{REACTIONS.map((reaction) => (
										<EmojiButton
											key={reaction.emoji}
											emoji={reaction.emoji}
											label={reaction.label}
											onClick={() => handleEmojiClick(reaction.emoji)}
										/>
									))}
								</div>
							)}

							{canReact && canComment && (
								<motion.div className="hidden sm:block w-px bg-gray-5 h-[16px] mx-4" />
							)}

							{canComment && (
								<div
									className={
										canReact ? "ml-auto w-full sm:w-auto" : "w-full sm:w-auto"
									}
								>
									<MotionButton
										onClick={handleCommentClick}
										variant="dark"
										layout="position"
										kbd="c"
										size="sm"
										className="mx-auto w-fit"
									>
										Comment
									</MotionButton>
								</div>
							)}
						</motion.div>
					)}
				</AnimatePresence>
			</motion.div>

			<AuthOverlay
				isOpen={showAuthOverlay}
				onClose={() => setShowAuthOverlay(false)}
			/>
		</>
	);
};

const REACTIONS = [
	{
		emoji: "😂",
		label: "joy",
	},
	{
		emoji: "😍",
		label: "love",
	},
	{
		emoji: "😮",
		label: "wow",
	},
	{
		emoji: "🙌",
		label: "yay",
	},
	{
		emoji: "👍",
		label: "up",
	},
	{
		emoji: "👎",
		label: "down",
	},
];
