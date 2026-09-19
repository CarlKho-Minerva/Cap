import * as Db from "@cap/database/schema";
import { nanoId } from "@cap/database/helpers";
import * as Dz from "drizzle-orm";
import { Effect } from "effect";

import { Database } from "../Database.ts";
import { Tinybird, type TinybirdEventRow } from "../Tinybird/index.ts";

export type AnalyticsBucket = "hour" | "day";

export type AnalyticsBreakdownField =
	| "country"
	| "city"
	| "browser"
	| "device"
	| "os";

export interface AnalyticsRangeQuery {
	tenantId: string;
	from: Date;
	to: Date;
	pathnames?: ReadonlyArray<string>;
}

const PAGE_HIT = "page_hit";

const bucketExpr = (bucket: AnalyticsBucket) =>
	bucket === "hour"
		? Dz.sql<string>`DATE_FORMAT(${Db.analyticsEvents.timestamp}, '%Y-%m-%dT%H:00:00Z')`
		: Dz.sql<string>`DATE_FORMAT(${Db.analyticsEvents.timestamp}, '%Y-%m-%dT00:00:00Z')`;

const uniqueSessions = Dz.sql<number>`COUNT(DISTINCT COALESCE(${Db.analyticsEvents.sessionId}, ''))`;

const breakdownColumn = (field: AnalyticsBreakdownField) => {
	switch (field) {
		case "country":
			return Db.analyticsEvents.country;
		case "city":
			return Db.analyticsEvents.city;
		case "browser":
			return Db.analyticsEvents.browser;
		case "device":
			return Db.analyticsEvents.device;
		case "os":
			return Db.analyticsEvents.os;
	}
};

const emptyToNull = (value?: string | null) => {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
};

export class Analytics extends Effect.Service<Analytics>()("Analytics", {
	effect: Effect.gen(function* () {
		const db = yield* Database;
		const tinybird = yield* Tinybird;

		// When Tinybird is configured it stays the single source of truth; the
		// MySQL table only exists so self-hosted instances get view counts at all.
		const usesDatabase = !tinybird.enabled;

		const rangeConditions = (query: AnalyticsRangeQuery) => {
			const conditions = [
				Dz.eq(Db.analyticsEvents.action, PAGE_HIT),
				Dz.eq(Db.analyticsEvents.tenantId, query.tenantId),
				Dz.between(Db.analyticsEvents.timestamp, query.from, query.to),
			];
			if (query.pathnames && query.pathnames.length > 0)
				conditions.push(
					Dz.inArray(Db.analyticsEvents.pathname, [...query.pathnames]),
				);
			return Dz.and(...conditions);
		};

		const appendEvents = (rows: ReadonlyArray<TinybirdEventRow>) => {
			if (rows.length === 0) return Effect.void;
			if (tinybird.enabled) return tinybird.appendEvents([...rows]);

			const values = rows.map((row) => ({
				id: nanoId(),
				timestamp: row.timestamp ? new Date(row.timestamp) : new Date(),
				sessionId: emptyToNull(row.session_id),
				userId: (emptyToNull(row.user_id) ??
					null) as (typeof Db.analyticsEvents.$inferInsert)["userId"],
				tenantId: emptyToNull(row.tenant_id),
				action: row.action,
				pathname: emptyToNull(row.pathname),
				videoId: (emptyToNull(row.video_id) ??
					null) as (typeof Db.analyticsEvents.$inferInsert)["videoId"],
				country: emptyToNull(row.country),
				region: emptyToNull(row.region),
				city: emptyToNull(row.city),
				browser: emptyToNull(row.browser),
				device: emptyToNull(row.device),
				os: emptyToNull(row.os),
			}));

			return db
				.use((database) => database.insert(Db.analyticsEvents).values(values))
				.pipe(Effect.asVoid);
		};

		const viewCountsByPathname = Effect.fn("Analytics.viewCountsByPathname")(
			function* (query: AnalyticsRangeQuery) {
				const rows = yield* db.use((database) =>
					database
						.select({
							pathname: Db.analyticsEvents.pathname,
							views: uniqueSessions,
						})
						.from(Db.analyticsEvents)
						.where(rangeConditions(query))
						.groupBy(Db.analyticsEvents.pathname),
				);

				const counts = new Map<string, number>();
				for (const row of rows) {
					if (!row.pathname) continue;
					counts.set(row.pathname, Number(row.views) || 0);
				}
				return counts;
			},
		);

		const viewSeries = Effect.fn("Analytics.viewSeries")(function* (
			query: AnalyticsRangeQuery & { bucket: AnalyticsBucket },
		) {
			const expr = bucketExpr(query.bucket);
			const rows = yield* db.use((database) =>
				database
					.select({ bucket: expr, views: uniqueSessions })
					.from(Db.analyticsEvents)
					.where(rangeConditions(query))
					.groupBy(expr)
					.orderBy(expr),
			);

			return rows
				.filter((row): row is { bucket: string; views: number } =>
					Boolean(row.bucket),
				)
				.map((row) => ({ bucket: row.bucket, views: Number(row.views) || 0 }));
		});

		const breakdown = Effect.fn("Analytics.breakdown")(function* (
			query: AnalyticsRangeQuery & { field: AnalyticsBreakdownField },
		) {
			const column = breakdownColumn(query.field);
			// Cities are only meaningful alongside their country, everything else
			// would be split into duplicate rows by grouping on it.
			const groupBy =
				query.field === "city"
					? [column, Db.analyticsEvents.country]
					: [column];

			const rows = yield* db.use((database) =>
				database
					.select({
						name: column,
						country: Dz.sql<
							string | null
						>`MIN(${Db.analyticsEvents.country})`,
						views: uniqueSessions,
					})
					.from(Db.analyticsEvents)
					.where(Dz.and(rangeConditions(query), Dz.isNotNull(column)))
					.groupBy(...groupBy)
					.orderBy(Dz.desc(uniqueSessions))
					.limit(10),
			);

			return rows
				.filter((row) => Boolean(row.name))
				.map((row) => ({
					name: row.name as string,
					subtitle: row.country ?? undefined,
					views: Number(row.views) || 0,
				}));
		});

		const topCaps = Effect.fn("Analytics.topCaps")(function* (
			query: AnalyticsRangeQuery,
		) {
			const rows = yield* db.use((database) =>
				database
					.select({
						pathname: Db.analyticsEvents.pathname,
						views: uniqueSessions,
					})
					.from(Db.analyticsEvents)
					.where(
						Dz.and(
							rangeConditions(query),
							Dz.like(Db.analyticsEvents.pathname, "/s/%"),
						),
					)
					.groupBy(Db.analyticsEvents.pathname)
					.orderBy(Dz.desc(uniqueSessions))
					.limit(10),
			);

			return rows
				.map((row) => ({
					videoId: row.pathname?.slice("/s/".length) ?? "",
					views: Number(row.views) || 0,
				}))
				.filter((row) => Boolean(row.videoId));
		});

		const deleteForTenants = (tenantIds: ReadonlyArray<string>) => {
			const unique = [...new Set(tenantIds.filter(Boolean))];
			if (!usesDatabase || unique.length === 0) return Effect.void;
			return db
				.use((database) =>
					database
						.delete(Db.analyticsEvents)
						.where(Dz.inArray(Db.analyticsEvents.tenantId, unique)),
				)
				.pipe(Effect.asVoid);
		};

		return {
			usesDatabase,
			appendEvents,
			viewCountsByPathname,
			viewSeries,
			breakdown,
			topCaps,
			deleteForTenants,
		} as const;
	}),
	dependencies: [Tinybird.Default, Database.Default],
}) {}
