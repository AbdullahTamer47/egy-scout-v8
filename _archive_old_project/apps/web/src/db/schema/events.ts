import { pgTable, uuid, varchar, real, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { matches, videoAssets } from './matches';
import { players } from './players';
import { users } from './users';
import { eventTypeEnum, eventSourceEnum, eventStatusEnum } from './enums';
import { relations } from 'drizzle-orm';

export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  matchId: uuid('match_id').references(() => matches.id).notNull(),
  videoAssetId: uuid('video_asset_id').references(() => videoAssets.id),
  playerId: uuid('player_id').references(() => players.id),
  type: eventTypeEnum('type').notNull(),
  customType: varchar('custom_type', { length: 100 }),
  startTime: real('start_time').notNull(),
  endTime: real('end_time'),
  pitchX: real('pitch_x'),
  pitchY: real('pitch_y'),
  source: eventSourceEnum('source').default('manual'),
  confidence: real('confidence'),
  status: eventStatusEnum('status').default('confirmed'),
  detectorType: varchar('detector_type', { length: 50 }),
  metadata: jsonb('metadata'),
  createdById: uuid('created_by_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow(),
});

export const eventsRelations = relations(events, ({ one }) => ({
  match: one(matches, {
    fields: [events.matchId],
    references: [matches.id],
  }),
  videoAsset: one(videoAssets, {
    fields: [events.videoAssetId],
    references: [videoAssets.id],
  }),
  player: one(players, {
    fields: [events.playerId],
    references: [players.id],
  }),
  createdBy: one(users, {
    fields: [events.createdById],
    references: [users.id],
  }),
}));
