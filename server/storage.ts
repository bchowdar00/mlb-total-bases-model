import { db, sql } from "./db";
import { predictions, refreshLog, playerResults, seasonStats } from "@shared/schema";
import type {
  InsertPrediction, InsertRefreshLog,
  InsertPlayerResult, InsertSeasonStats,
  Prediction, RefreshLog, PlayerResult, SeasonStats
} from "@shared/schema";
import { eq, desc, and, sql as drizzleSql } from "drizzle-orm";

export interface IStorage {
  upsertPredictions(data: InsertPrediction[]): Promise<void>;
  getPredictions(gameDate: string): Promise<Prediction[]>;
  insertRefreshLog(data: InsertRefreshLog): Promise<RefreshLog>;
  getRefreshLogs(limit?: number): Promise<RefreshLog[]>;
  getLatestRefresh(): Promise<RefreshLog | undefined>;
  upsertPlayerResults(data: InsertPlayerResult[]): Promise<void>;
  getPlayerResults(gameDate?: string, limit?: number): Promise<PlayerResult[]>;
  getSeasonStats(season: number): Promise<SeasonStats | undefined>;
  upsertSeasonStats(data: InsertSeasonStats): Promise<void>;
  getDailyResultsSummary(limit?: number): Promise<any[]>;
}

export class Storage implements IStorage {
  async upsertPredictions(data: InsertPrediction[]): Promise<void> {
    if (!data.length) return;
    const date = data[0].gameDate;

    // Purge projections older than 2 days
    await sql`
      DELETE FROM predictions
      WHERE game_date < (CURRENT_DATE - INTERVAL '2 days')::text
    `;

    // Dedup incoming batch: keep highest-scoring per player
    const dedupMap = new Map<string, InsertPrediction>();
    for (const p of data) {
      const key = p.playerName.toLowerCase().trim();
      const existing = dedupMap.get(key);
      if (!existing || p.probUnder > existing.probUnder) dedupMap.set(key, p);
    }
    const deduped = Array.from(dedupMap.values());

    // Fetch existing players for this date
    const dbExisting = await db.select({ playerName: predictions.playerName })
      .from(predictions)
      .where(eq(predictions.gameDate, date));
    const existingNames = new Set(dbExisting.map((r) => r.playerName.toLowerCase().trim()));

    for (const p of deduped) {
      const key = p.playerName.toLowerCase().trim();
      if (existingNames.has(key)) {
        await db.update(predictions)
          .set({
            refreshedAt: p.refreshedAt,
            probUnder: p.probUnder,
            tier: p.tier,
            isDemo: p.isDemo ?? 0,  // a computed refresh clears the seed's demo flag
          })
          .where(
            and(
              eq(predictions.gameDate, date),
              drizzleSql`LOWER(${predictions.playerName}) = ${key}`
            )
          );
      } else {
        await db.insert(predictions).values(p);
      }
    }
  }

  async getPredictions(gameDate: string): Promise<Prediction[]> {
    return db.select().from(predictions)
      .where(eq(predictions.gameDate, gameDate))
      .orderBy(desc(predictions.probUnder));
  }

  async insertRefreshLog(data: InsertRefreshLog): Promise<RefreshLog> {
    const countResult = await sql`SELECT COUNT(*) as c FROM refresh_log`;
    const count = Number(countResult[0]?.c ?? 0);
    if (count > 30) {
      await sql`DELETE FROM refresh_log WHERE id = (SELECT MIN(id) FROM refresh_log)`;
    }
    const [row] = await db.insert(refreshLog).values(data).returning();
    return row;
  }

  async getRefreshLogs(limit = 20): Promise<RefreshLog[]> {
    return db.select().from(refreshLog).orderBy(desc(refreshLog.id)).limit(limit);
  }

  async getLatestRefresh(): Promise<RefreshLog | undefined> {
    const [row] = await db.select().from(refreshLog).orderBy(desc(refreshLog.id)).limit(1);
    return row;
  }

  async upsertPlayerResults(data: InsertPlayerResult[]): Promise<void> {
    if (!data.length) return;
    const date = data[0].gameDate;
    await sql`DELETE FROM player_results WHERE game_date = ${date}`;
    for (const r of data) {
      await db.insert(playerResults).values(r);
    }
  }

  async getPlayerResults(gameDate?: string, limit = 200): Promise<PlayerResult[]> {
    if (gameDate) {
      return db.select().from(playerResults)
        .where(eq(playerResults.gameDate, gameDate))
        .orderBy(desc(playerResults.probUnder));
    }
    return db.select().from(playerResults)
      .orderBy(desc(playerResults.gameDate), desc(playerResults.probUnder))
      .limit(limit);
  }

  async getSeasonStats(season: number): Promise<SeasonStats | undefined> {
    const [row] = await db.select().from(seasonStats).where(eq(seasonStats.season, season));
    return row;
  }

  async upsertSeasonStats(data: InsertSeasonStats): Promise<void> {
    await sql`DELETE FROM season_stats WHERE season = ${data.season}`;
    await db.insert(seasonStats).values(data);
  }

  async getDailyResultsSummary(limit = 30): Promise<any[]> {
    const rows = await sql`
      SELECT
        game_date,
        COUNT(*) AS total,
        SUM(CASE WHEN hit = 1 THEN 1 ELSE 0 END) AS hits,
        SUM(CASE WHEN hit = 0 THEN 1 ELSE 0 END) AS misses,
        AVG(CASE WHEN hit IS NOT NULL THEN hit::REAL END) AS hit_rate,
        SUM(CASE WHEN tier = 'Elite' THEN 1 ELSE 0 END) AS elite_total,
        SUM(CASE WHEN tier = 'Elite' AND hit = 1 THEN 1 ELSE 0 END) AS elite_hits
      FROM player_results
      WHERE hit IS NOT NULL AND COALESCE(is_demo, 0) = 0
      GROUP BY game_date
      ORDER BY game_date DESC
      LIMIT ${limit}
    `;
    return rows as any[];
  }
}

export const storage = new Storage();
