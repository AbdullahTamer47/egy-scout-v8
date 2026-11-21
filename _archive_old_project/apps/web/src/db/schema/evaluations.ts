import { pgTable, uuid, date, real, integer, text, boolean, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { players } from './players';
import { users } from './users';
import { matches } from './matches';
import { positionGroupEnum, readinessEnum, recommendationEnum, dataSourceEnum } from './enums';
import { relations } from 'drizzle-orm';

export const POSITION_RATING_TEMPLATES = {
  GK: ['shot_stopping', 'aerial_ability', 'distribution', 'positioning', 'reflexes', 'command_of_area', 'one_on_one', 'communication'],
  CB: ['aerial_duels', 'tackling', 'positioning', 'passing', 'pace', 'strength', 'reading_game', 'composure'],
  FB: ['crossing', 'tackling', 'pace', 'stamina', 'dribbling', 'positioning', 'overlapping_runs', 'defensive_awareness'],
  DM_CM: ['passing', 'tackling', 'positioning', 'vision', 'stamina', 'ball_retention', 'pressing', 'long_range_passing'],
  AM_W: ['dribbling', 'creativity', 'pace', 'shooting', 'crossing', 'vision', 'key_passes', 'movement'],
  ST: ['finishing', 'positioning', 'aerial_ability', 'link_up_play', 'pace', 'strength', 'movement', 'composure']
} as const;

export const evaluations = pgTable('evaluations', {
  id: uuid('id').primaryKey().defaultRandom(),
  playerId: uuid('player_id').references(() => players.id).notNull(),
  scoutId: uuid('scout_id').references(() => users.id).notNull(),
  matchId: uuid('match_id').references(() => matches.id),
  evaluationDate: date('evaluation_date').notNull().defaultNow(),
  positionGroup: positionGroupEnum('position_group').notNull(),
  ratings: jsonb('ratings').notNull(),
  ratingsOverall: real('ratings_overall'),
  potential: integer('potential'),
  currentAbility: integer('current_ability'),
  readiness: readinessEnum('readiness'),
  recommendation: recommendationEnum('recommendation'),
  strengths: text('strengths'),
  weaknesses: text('weaknesses'),
  personalityNotes: text('personality_notes'),
  report: text('report'),
  dataSource: dataSourceEnum('data_source').default('manual'),
  isSynthetic: boolean('is_synthetic').default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const evaluationsRelations = relations(evaluations, ({ one }) => ({
  player: one(players, {
    fields: [evaluations.playerId],
    references: [players.id],
  }),
  scout: one(users, {
    fields: [evaluations.scoutId],
    references: [users.id],
  }),
  match: one(matches, {
    fields: [evaluations.matchId],
    references: [matches.id],
  }),
}));
