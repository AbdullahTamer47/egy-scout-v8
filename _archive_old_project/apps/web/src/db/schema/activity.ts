import { pgTable, uuid, text, varchar, date, boolean, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { players } from './players';
import { matches } from './matches';
import { users } from './users';
import { relations } from 'drizzle-orm';

export const notes = pgTable('notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  playerId: uuid('player_id').references(() => players.id),
  matchId: uuid('match_id').references(() => matches.id),
  content: text('content').notNull(),
  createdById: uuid('created_by_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow(),
});

export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  assignedToId: uuid('assigned_to_id').references(() => users.id),
  playerId: uuid('player_id').references(() => players.id),
  matchId: uuid('match_id').references(() => matches.id),
  dueDate: date('due_date'),
  isCompleted: boolean('is_completed').default(false),
  createdById: uuid('created_by_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow(),
});

export const activityLog = pgTable('activity_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id),
  action: varchar('action', { length: 100 }).notNull(),
  entityType: varchar('entity_type', { length: 50 }).notNull(),
  entityId: uuid('entity_id'),
  details: jsonb('details'),
  ipAddress: varchar('ip_address', { length: 45 }),
  createdAt: timestamp('created_at').defaultNow(),
});

export const notesRelations = relations(notes, ({ one }) => ({
  player: one(players, {
    fields: [notes.playerId],
    references: [players.id],
  }),
  match: one(matches, {
    fields: [notes.matchId],
    references: [matches.id],
  }),
  createdBy: one(users, {
    fields: [notes.createdById],
    references: [users.id],
  }),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  assignedTo: one(users, {
    fields: [tasks.assignedToId],
    references: [users.id],
  }),
  player: one(players, {
    fields: [tasks.playerId],
    references: [players.id],
  }),
  match: one(matches, {
    fields: [tasks.matchId],
    references: [matches.id],
  }),
  createdBy: one(users, {
    fields: [tasks.createdById],
    references: [users.id],
  }),
}));

export const activityLogRelations = relations(activityLog, ({ one }) => ({
  user: one(users, {
    fields: [activityLog.userId],
    references: [users.id],
  }),
}));
