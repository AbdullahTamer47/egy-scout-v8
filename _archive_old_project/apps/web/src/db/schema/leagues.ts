import { pgTable, uuid, varchar, boolean, timestamp, integer, date } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const leagues = pgTable('leagues', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  nameAr: varchar('name_ar', { length: 255 }),
  country: varchar('country', { length: 100 }).default('Egypt'),
  tier: integer('tier').notNull(),
  group: varchar('group', { length: 100 }),
  isYouth: boolean('is_youth').default(false),
  youthCategory: varchar('youth_category', { length: 10 }),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
});

export const seasons = pgTable('seasons', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 50 }).notNull(),
  startDate: date('start_date'),
  endDate: date('end_date'),
  isCurrent: boolean('is_current').default(false),
});

export const teams = pgTable('teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  nameAr: varchar('name_ar', { length: 255 }),
  leagueId: uuid('league_id').references(() => leagues.id),
  city: varchar('city', { length: 255 }),
  governorate: varchar('governorate', { length: 255 }),
  logoUrl: text('logo_url'),
  isOurClub: boolean('is_our_club').default(false),
  createdAt: timestamp('created_at').defaultNow(),
});
// Need to import text from pg-core for teams.logoUrl
// Let's re-define teams with text import
import { text } from 'drizzle-orm/pg-core';

export const leaguesRelations = relations(leagues, ({ many }) => ({
  teams: many(teams),
}));

export const teamsRelations = relations(teams, ({ one }) => ({
  league: one(leagues, {
    fields: [teams.leagueId],
    references: [leagues.id],
  }),
}));
