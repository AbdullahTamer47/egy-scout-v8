import { pgTable, uuid, varchar, integer, text, boolean, timestamp, jsonb, real } from 'drizzle-orm/pg-core';
import { positionGroupEnum, preferredFootEnum, budgetBandEnum, pipelineStatusEnum } from './enums';
import { users } from './users';
import { players } from './players';
import { relations } from 'drizzle-orm';

export const shortlists = pgTable('shortlists', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: varchar('title', { length: 255 }).notNull(),
  titleAr: varchar('title_ar', { length: 255 }),
  positionGroup: positionGroupEnum('position_group'),
  ageMin: integer('age_min'),
  ageMax: integer('age_max'),
  preferredFoot: preferredFootEnum('preferred_foot'),
  tierMin: integer('tier_min'),
  tierMax: integer('tier_max'),
  budgetBand: budgetBandEnum('budget_band'),
  requiredAttributes: jsonb('required_attributes'),
  notes: text('notes'),
  isActive: boolean('is_active').default(true),
  createdById: uuid('created_by_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const shortlistCandidates = pgTable('shortlist_candidates', {
  id: uuid('id').primaryKey().defaultRandom(),
  shortlistId: uuid('shortlist_id').references(() => shortlists.id).notNull(),
  playerId: uuid('player_id').references(() => players.id).notNull(),
  pipelineStatus: pipelineStatusEnum('pipeline_status').default('spotted'),
  fitScore: real('fit_score'),
  fitReason: text('fit_reason'),
  notes: text('notes'),
  addedById: uuid('added_by_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow(),
});

export const shortlistsRelations = relations(shortlists, ({ one, many }) => ({
  createdBy: one(users, {
    fields: [shortlists.createdById],
    references: [users.id],
  }),
  candidates: many(shortlistCandidates),
}));

export const shortlistCandidatesRelations = relations(shortlistCandidates, ({ one }) => ({
  shortlist: one(shortlists, {
    fields: [shortlistCandidates.shortlistId],
    references: [shortlists.id],
  }),
  player: one(players, {
    fields: [shortlistCandidates.playerId],
    references: [players.id],
  }),
  addedBy: one(users, {
    fields: [shortlistCandidates.addedById],
    references: [users.id],
  }),
}));
