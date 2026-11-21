import { pgTable, uuid, integer, real, varchar, boolean, timestamp, jsonb, text } from 'drizzle-orm/pg-core';
import { players } from './players';
import { seasons, leagues } from './leagues';
import { dataSourceEnum, positionGroupEnum } from './enums';
import { users } from './users';
import { relations } from 'drizzle-orm';

export const metricSnapshots = pgTable('metric_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  playerId: uuid('player_id').references(() => players.id).notNull(),
  seasonId: uuid('season_id').references(() => seasons.id),
  leagueId: uuid('league_id').references(() => leagues.id),
  minutes: integer('minutes').notNull(),
  appearances: integer('appearances'),
  metricsP90: jsonb('metrics_p90').notNull(),
  rawMetrics: jsonb('raw_metrics'),
  source: dataSourceEnum('source').notNull(),
  sourceDetail: varchar('source_detail', { length: 255 }),
  confidence: real('confidence').default(1.0),
  isSynthetic: boolean('is_synthetic').default(false),
  createdAt: timestamp('created_at').defaultNow(),
});

export const archetypes = pgTable('archetypes', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  nameAr: varchar('name_ar', { length: 255 }),
  positionGroup: positionGroupEnum('position_group').notNull(),
  description: text('description'),
  featureSpace: varchar('feature_space', { length: 50 }).notNull(),
  vector: jsonb('vector').notNull(),
  benchmarkPlayerName: varchar('benchmark_player_name', { length: 255 }),
  provenance: dataSourceEnum('provenance').notNull(),
  isTemplate: boolean('is_template').default(true),
  createdById: uuid('created_by_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow(),
});

export const metricSnapshotsRelations = relations(metricSnapshots, ({ one }) => ({
  player: one(players, {
    fields: [metricSnapshots.playerId],
    references: [players.id],
  }),
  season: one(seasons, {
    fields: [metricSnapshots.seasonId],
    references: [seasons.id],
  }),
  league: one(leagues, {
    fields: [metricSnapshots.leagueId],
    references: [leagues.id],
  }),
}));

export const archetypesRelations = relations(archetypes, ({ one }) => ({
  createdBy: one(users, {
    fields: [archetypes.createdById],
    references: [users.id],
  }),
}));
