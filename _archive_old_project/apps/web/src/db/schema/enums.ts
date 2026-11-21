import { pgEnum } from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', ['head_coach', 'scout', 'analyst', 'viewer']);
export const playerPositionEnum = pgEnum('player_position', ['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'CF', 'ST']);
export const preferredFootEnum = pgEnum('preferred_foot', ['left', 'right', 'both']);
export const pipelineStatusEnum = pgEnum('pipeline_status', ['spotted', 'monitoring', 'contacted', 'trial', 'negotiating', 'signed', 'rejected']);
export const eventTypeEnum = pgEnum('event_type', ['progressive_pass', 'key_pass', 'interception', 'tackle', 'dribble', 'box_entry', 'shot', 'goal', 'chance_created', 'duel_won', 'duel_lost', 'foul', 'custom']);
export const eventSourceEnum = pgEnum('event_source', ['manual', 'auto', 'import']);
export const eventStatusEnum = pgEnum('event_status', ['suggested', 'confirmed', 'rejected']);
export const dataSourceEnum = pgEnum('data_source', ['manual', 'imported', 'auto', 'external', 'synthetic']);
export const videoIngestStatusEnum = pgEnum('video_ingest_status', ['pending', 'queued', 'downloading', 'processing', 'done', 'failed']);
export const clipStatusEnum = pgEnum('clip_status', ['pending', 'processing', 'done', 'failed']);
export const readinessEnum = pgEnum('readiness', ['ready_now', 'one_year', 'two_plus_years']);
export const recommendationEnum = pgEnum('recommendation', ['sign', 'monitor', 'pass']);
export const positionGroupEnum = pgEnum('position_group', ['GK', 'CB', 'FB', 'DM_CM', 'AM_W', 'ST']);
export const budgetBandEnum = pgEnum('budget_band', ['free', 'very_low', 'low', 'medium', 'high']);
export const contractStatusEnum = pgEnum('contract_status', ['active', 'expiring', 'expired', 'free_agent', 'unknown']);
