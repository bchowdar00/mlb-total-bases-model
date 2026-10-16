import { pgTable, text, integer, real, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Cached projections from the scorer (recomputed on demand / on a schedule)
export const predictions = pgTable("predictions", {
  id: serial("id").primaryKey(),
  refreshedAt: text("refreshed_at").notNull(),
  gameDate: text("game_date").notNull(),
  playerName: text("player_name").notNull(),
  team: text("team").notNull(),
  opponent: text("opponent").notNull(),
  homeTeam: text("home_team").notNull(),
  game: text("game").notNull(),
  gameTime: text("game_time"),
  lineupPos: integer("lineup_pos"),
  tbLine: real("tb_line").notNull(),
  probUnder: real("prob_under").notNull(),
  tier: text("tier").notNull(),
  slg2025: real("slg_2025"),
  iso2025: real("iso_2025"),
  kPct: real("k_pct"),
  bbPct: real("bb_pct"),
  parkFactor: real("park_factor"),
  oppSpName: text("opp_sp_name"),
  keySignals: text("key_signals"),  // JSON array
  isDemo: integer("is_demo").default(0),  // 1 = sample data inserted via /api/seed
});

// Daily refresh log
export const refreshLog = pgTable("refresh_log", {
  id: serial("id").primaryKey(),
  refreshedAt: text("refreshed_at").notNull(),
  gameDate: text("game_date").notNull(),
  totalProjected: integer("total_projected"),
  totalPredictions: integer("total_predictions"),
  source: text("source").default("auto"),
  durationMs: integer("duration_ms"),
});

// Per-player graded results (populated after games finish, from MLB box scores)
export const playerResults = pgTable("player_results", {
  id: serial("id").primaryKey(),
  gameDate: text("game_date").notNull(),
  playerName: text("player_name").notNull(),
  team: text("team").notNull(),
  game: text("game").notNull(),
  tbLine: real("tb_line").notNull(),
  probUnder: real("prob_under").notNull(),
  tier: text("tier").notNull(),
  actualTb: integer("actual_tb"),
  hit: integer("hit"),
  gradedAt: text("graded_at"),
  isDemo: integer("is_demo").default(0),  // 1 = sample data inserted via /api/seed
});

// Running season-level tracking (one row per season, updated after grading)
export const seasonStats = pgTable("season_stats", {
  id: serial("id").primaryKey(),
  season: integer("season").notNull(),
  totalPredictions: integer("total_predictions").notNull().default(0),
  totalGraded: integer("total_graded").notNull().default(0),
  totalHits: integer("total_hits").notNull().default(0),
  elitePredictions: integer("elite_predictions").notNull().default(0),
  eliteHits: integer("elite_hits").notNull().default(0),
  veryHighPredictions: integer("very_high_predictions").notNull().default(0),
  veryHighHits: integer("very_high_hits").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
});

export const insertPredictionSchema = createInsertSchema(predictions).omit({ id: true });
export const insertRefreshLogSchema = createInsertSchema(refreshLog).omit({ id: true });
export const insertPlayerResultSchema = createInsertSchema(playerResults).omit({ id: true });
export const insertSeasonStatsSchema = createInsertSchema(seasonStats).omit({ id: true });

export type Prediction = typeof predictions.$inferSelect;
export type RefreshLog = typeof refreshLog.$inferSelect;
export type PlayerResult = typeof playerResults.$inferSelect;
export type SeasonStats = typeof seasonStats.$inferSelect;
export type InsertPrediction = z.infer<typeof insertPredictionSchema>;
export type InsertRefreshLog = z.infer<typeof insertRefreshLogSchema>;
export type InsertPlayerResult = z.infer<typeof insertPlayerResultSchema>;
export type InsertSeasonStats = z.infer<typeof insertSeasonStatsSchema>;
