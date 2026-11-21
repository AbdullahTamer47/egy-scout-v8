import { pgTable, uuid, varchar, text, integer, timestamp, real, jsonb, boolean } from 'drizzle-orm/pg-core';
import { teams, leagues, seasons } from './leagues';
import { videoIngestStatusEnum } from './enums';
import { relations } from 'drizzle-orm';

export const matches = pgTable('matches', {
  id: uuid('id').primaryKey().defaultRandom(),
  homeTeamId: uuid('home_team_id').references(() => teams.id).notNull(),
  awayTeamId: uuid('away_team_id').references(() => teams.id).notNull(),
  leagueId: uuid('league_id').references(() => leagues.id),
  seasonId: uuid('season_id').references(() => seasons.id),
  matchDate: timestamp('match_date'),
  homeScore: integer('home_score'),
  awayScore: integer('away_score'),
  venue: varchar('venue', { length: 255 }),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const videoAssets = pgTable('video_assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  matchId: uuid('match_id').references(() => matches.id),
  sourceUrl: text('source_url'),
  filePath: text('file_path'),
  fileName: varchar('file_name', { length: 255 }),
  duration: integer('duration'),
  width: integer('width'),
  height: integer('height'),
  fps: real('fps'),
  thumbnailPath: text('thumbnail_path'),
  ingestStatus: videoIngestStatusEnum('ingest_status').default('pending'),
  ingestJobId: varchar('ingest_job_id', { length: 255 }),
  ingestProgress: integer('ingest_progress').default(0),
  ingestError: text('ingest_error'),
  metadata: jsonb('metadata'),
  isUpload: boolean('is_upload').default(false),
  cameraType: varchar('camera_type', { length: 50 }).default('broadcast'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const matchesRelations = relations(matches, ({ one, many }) => ({
  homeTeam: one(teams, {
    fields: [matches.homeTeamId],
    references: [teams.id],
    relationName: 'homeTeam',
  }),
  awayTeam: one(teams, {
    fields: [matches.awayTeamId],
    references: [teams.id],
    relationName: 'awayTeam',
  }),
  league: one(leagues, {
    fields: [matches.leagueId],
    references: [leagues.id],
  }),
  season: one(seasons, {
    fields: [matches.seasonId],
    references: [seasons.id],
  }),
  videoAssets: many(videoAssets),
}));

export const videoAssetsRelations = relations(videoAssets, ({ one }) => ({
  match: one(matches, {
    fields: [videoAssets.matchId],
    references: [matches.id],
  }),
}));
