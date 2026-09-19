CREATE TABLE `analytics_events` (
	`id` varchar(15) NOT NULL,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	`sessionId` varchar(128),
	`userId` varchar(15),
	`tenantId` varchar(255),
	`action` varchar(64) NOT NULL,
	`pathname` varchar(512),
	`videoId` varchar(15),
	`country` varchar(64),
	`region` varchar(64),
	`city` varchar(128),
	`browser` varchar(64),
	`device` varchar(64),
	`os` varchar(64),
	CONSTRAINT `analytics_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `comments` MODIFY COLUMN `authorId` varchar(15);--> statement-breakpoint
ALTER TABLE `comments` ADD `guestName` varchar(40);--> statement-breakpoint
CREATE INDEX `analytics_events_video_timestamp_idx` ON `analytics_events` (`videoId`,`timestamp`);--> statement-breakpoint
CREATE INDEX `analytics_events_tenant_timestamp_idx` ON `analytics_events` (`tenantId`,`timestamp`);