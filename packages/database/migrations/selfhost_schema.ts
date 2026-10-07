import { db } from "@cap/database";
import { sql } from "drizzle-orm";

// Self-host fork schema (analytics_events + guest comments), applied outside the
// drizzle journal so the fork never has to renumber around upstream migrations.
//
// History: the 2026-09-19 fork build shipped these objects as journal entry
// `0038_soft_miek` (when = 1789779637776). Drizzle's mysql migrator only applies
// journal entries newer than the newest `created_at` in __drizzle_migrations, so
// that row hides every upstream migration dated before 2026-09-19 (0038-0045).
// removeStaleForkMigrationRow() deletes exactly that row before migrating;
// ensureSelfhostSchema() then creates whatever is missing, so existing data is
// kept and fresh installs get the same schema.

const STALE_FORK_MIGRATION = {
	hash: "57ef8b41673eee30779faa0136824983e2bae7fd20eb9ecff1267664de88a7bb",
	createdAt: 1789779637776,
};

type Row = Record<string, unknown>;

async function rows(query: ReturnType<typeof sql>): Promise<Row[]> {
	const result = (await db().execute(query)) as unknown as [Row[], unknown];
	return result[0];
}

export async function removeStaleForkMigrationRow() {
	await db().execute(sql`
		create table if not exists __drizzle_migrations (
			id serial primary key,
			hash text not null,
			created_at bigint
		)
	`);
	const stale = await rows(sql`
		select id from __drizzle_migrations
		where hash = ${STALE_FORK_MIGRATION.hash}
			and created_at = ${STALE_FORK_MIGRATION.createdAt}
	`);
	if (stale.length === 0) return;
	await db().execute(sql`
		delete from __drizzle_migrations
		where hash = ${STALE_FORK_MIGRATION.hash}
			and created_at = ${STALE_FORK_MIGRATION.createdAt}
	`);
	console.log(
		"[selfhost] removed stale fork migration row 0038_soft_miek so upstream migrations apply",
	);
}

async function tableExists(table: string) {
	const found = await rows(sql`
		select 1 from information_schema.tables
		where table_schema = database() and table_name = ${table}
	`);
	return found.length > 0;
}

async function column(table: string, name: string) {
	const found = await rows(sql`
		select is_nullable as isNullable from information_schema.columns
		where table_schema = database() and table_name = ${table}
			and column_name = ${name}
	`);
	return found[0] as { isNullable: string } | undefined;
}

async function indexExists(table: string, name: string) {
	const found = await rows(sql`
		select 1 from information_schema.statistics
		where table_schema = database() and table_name = ${table}
			and index_name = ${name}
	`);
	return found.length > 0;
}

export async function ensureSelfhostSchema() {
	if (!(await tableExists("analytics_events"))) {
		await db().execute(sql`
			CREATE TABLE \`analytics_events\` (
				\`id\` varchar(15) NOT NULL,
				\`timestamp\` timestamp NOT NULL DEFAULT (now()),
				\`sessionId\` varchar(128),
				\`userId\` varchar(15),
				\`tenantId\` varchar(255),
				\`action\` varchar(64) NOT NULL,
				\`pathname\` varchar(512),
				\`videoId\` varchar(15),
				\`country\` varchar(64),
				\`region\` varchar(64),
				\`city\` varchar(128),
				\`browser\` varchar(64),
				\`device\` varchar(64),
				\`os\` varchar(64),
				CONSTRAINT \`analytics_events_id\` PRIMARY KEY(\`id\`)
			)
		`);
		console.log("[selfhost] created analytics_events");
	}
	for (const [name, columns] of [
		["analytics_events_video_timestamp_idx", "`videoId`,`timestamp`"],
		["analytics_events_tenant_timestamp_idx", "`tenantId`,`timestamp`"],
	] as const) {
		if (!(await indexExists("analytics_events", name))) {
			await db().execute(
				sql.raw(`CREATE INDEX \`${name}\` ON \`analytics_events\` (${columns})`),
			);
			console.log(`[selfhost] created index ${name}`);
		}
	}

	const authorId = await column("comments", "authorId");
	if (!authorId) throw new Error("[selfhost] comments.authorId is missing");
	if (authorId.isNullable !== "YES") {
		await db().execute(
			sql`ALTER TABLE \`comments\` MODIFY COLUMN \`authorId\` varchar(15)`,
		);
		console.log("[selfhost] made comments.authorId nullable for guest comments");
	}
	if (!(await column("comments", "guestName"))) {
		await db().execute(
			sql`ALTER TABLE \`comments\` ADD \`guestName\` varchar(40)`,
		);
		console.log("[selfhost] added comments.guestName");
	}
}
