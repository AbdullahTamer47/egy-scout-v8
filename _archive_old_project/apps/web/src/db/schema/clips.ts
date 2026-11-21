import { pgTable, uuid, text, real, timestamp, jsonb, boolean, varchar } from 'drizzle-orm/pg-core';
import { events } from './events';
import { matches } from './matches';
import { players } from './players';
import { clipStatusEnum } from './enums';
import { relations } from 'drizzle-orm';

export const clips = pgTable('clips', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id').references(() => events.id),
  matchId: uuid('match_id').references(() => matches.id),
  playerId: uuid('player_id').references(() => players.id),
  filePath: text('file_path'),
  thumbnailPath: text('thumbnail_path'),
  duration: real('duration'),
  startTime: real('start_time'),
  endTime: real('end_time'),
  preRoll: real('pre_roll').default(3.0),
  postRoll: real('post_roll').default(3.0),
  status: clipStatusEnum('status').default('pending'),
  jobId: varchar('job_id', { length: 255 }),
  telestrationConfig: jsonb('telestration_config'),
  hasSpotlight: boolean('has_spotlight').default(false),
  hasPath: boolean('has_path').default(false),
  hasArrow: boolean('has_arrow').default(false),
  hasFreezeFrame: boolean('has_freeze_frame').default(false),
  hasSlowMotion: boolean('has_slow_motion').default(false),
  createdAt: timestamp('created_at').defaultNow(),
});

export const clipsRelations = relations(clips, ({ one }) => ({
  event: one(events, {
    fields: [clips.eventId],
    references: [events.id],
  }),
  match: one(matches, {
    fields: [clips.matchId],
    references: [matches.id],
  }),
  player: one(players, {
    fields: [clips.playerId],
    references: [players.id],
  }),
}));
