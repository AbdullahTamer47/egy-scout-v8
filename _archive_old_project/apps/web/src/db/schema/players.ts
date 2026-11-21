import { pgTable, uuid, varchar, text, boolean, timestamp, integer, date, decimal, index } from 'drizzle-orm/pg-core';
import { playerPositionEnum, preferredFootEnum, contractStatusEnum, dataSourceEnum, pipelineStatusEnum } from './enums';
import { teams } from './leagues';
import { users } from './users';
import { relations } from 'drizzle-orm';

export const players = pgTable('players', {
  id: uuid('id').primaryKey().defaultRandom(),
  nameEn: varchar('name_en', { length: 255 }).notNull(),
  nameAr: varchar('name_ar', { length: 255 }),
  dateOfBirth: date('date_of_birth'),
  positions: text('positions').array(),
  positionPrimary: playerPositionEnum('position_primary'),
  preferredFoot: preferredFootEnum('preferred_foot'),
  height: integer('height'),
  weight: integer('weight'),
  governorate: varchar('governorate', { length: 255 }),
  city: varchar('city', { length: 255 }),
  currentTeamId: uuid('current_team_id').references(() => teams.id),
  contractStatus: contractStatusEnum('contract_status').default('unknown'),
  contractEndDate: date('contract_end_date'),
  estimatedValue: decimal('estimated_value', { precision: 12, scale: 2 }),
  valueSource: dataSourceEnum('value_source'),
  valueCurrency: varchar('value_currency', { length: 10 }).default('EGP'),
  guardianName: varchar('guardian_name', { length: 255 }),
  guardianPhone: varchar('guardian_phone', { length: 50 }),
  agentName: varchar('agent_name', { length: 255 }),
  agentPhone: varchar('agent_phone', { length: 50 }),
  photoUrl: text('photo_url'),
  pipelineStatus: pipelineStatusEnum('pipeline_status').default('spotted'),
  tags: text('tags').array(),
  notes: text('notes'),
  dataSource: dataSourceEnum('data_source').default('manual'),
  isSynthetic: boolean('is_synthetic').default(false),
  createdById: uuid('created_by_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  nameEnIdx: index('idx_players_name_en').on(table.nameEn),
  nameArIdx: index('idx_players_name_ar').on(table.nameAr),
  currentTeamIdIdx: index('idx_players_current_team_id').on(table.currentTeamId),
  dateOfBirthIdx: index('idx_players_dob').on(table.dateOfBirth),
  pipelineStatusIdx: index('idx_players_pipeline_status').on(table.pipelineStatus),
  governorateIdx: index('idx_players_governorate').on(table.governorate),
}));

export const playersRelations = relations(players, ({ one }) => ({
  team: one(teams, {
    fields: [players.currentTeamId],
    references: [teams.id],
  }),
  createdBy: one(users, {
    fields: [players.createdById],
    references: [users.id],
  }),
}));
