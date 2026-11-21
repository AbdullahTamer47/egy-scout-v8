import { db } from './index';
import { users, leagues, teams, seasons, players, matches, evaluations } from './schema';
import * as schema from './schema';
import bcrypt from 'bcryptjs';
import { sql } from 'drizzle-orm';

const FIRST_NAMES = ['Ahmed', 'Mohamed', 'Mahmoud', 'Mostafa', 'Omar', 'Karim', 'Hassan', 'Hussein', 'Ibrahim', 'Ali', 'Khaled', 'Tarek', 'Amr', 'Youssef', 'Ziad'];
const LAST_NAMES = ['Hassan', 'Ibrahim', 'Gomaa', 'El-Shenawy', 'Said', 'Tawfik', 'Fathi', 'Ashour', 'Zakaria', 'Sobhi', 'Hegazy', 'El-Nenny', 'Salah', 'Trezeguet', 'Marmoush'];
const FIRST_NAMES_AR = ['أحمد', 'محمد', 'محمود', 'مصطفى', 'عمر', 'كريم', 'حسن', 'حسين', 'إبراهيم', 'علي', 'خالد', 'طارق', 'عمرو', 'يوسف', 'زياد'];
const LAST_NAMES_AR = ['حسن', 'إبراهيم', 'جمعة', 'الشناوي', 'سعيد', 'توفيق', 'فتحي', 'عاشور', 'زكريا', 'صبحي', 'حجازي', 'النني', 'صلاح', 'تريزيجيه', 'مرموش'];

const GOVERNORATES = ['Cairo', 'Giza', 'Alexandria', 'Dakahlia', 'Red Sea', 'Beheira', 'Fayoum', 'Gharbia', 'Ismailia', 'Menofia', 'Minya', 'Qalyubia', 'New Valley', 'Suez', 'Aswan', 'Assiut', 'Beni Suef', 'Port Said', 'Damietta', 'Sharkia', 'South Sinai', 'Kafr El Sheikh', 'Matrouh', 'Luxor', 'Qena', 'North Sinai', 'Sohag'];

function getRandomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getRandomDate(start: Date, end: Date) {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime())).toISOString().split('T')[0];
}

async function runSeed() {
  const isClear = process.argv.includes('--clear');

  if (isClear) {
    console.log('Clearing synthetic data...');
    await db.delete(evaluations).where(sql`is_synthetic = true`);
    await db.delete(matches).where(sql`id IN (SELECT match_id FROM ${matches} m JOIN ${teams} t ON m.home_team_id = t.id WHERE t.is_our_club = false)`); // simplification
    await db.delete(players).where(sql`is_synthetic = true`);
    await db.delete(teams).where(sql`name LIKE 'Synthetic%' OR is_our_club = false`); // Just clear all seeded teams for now
    await db.delete(seasons);
    await db.delete(leagues);
    await db.delete(users).where(sql`email LIKE '%@scoutzero.local'`);
    console.log('Cleared.');
    return;
  }

  console.log('Seeding...');

  // 1. Users
  const adminHash = await bcrypt.hash('admin123', 10);
  const [admin] = await db.insert(users).values({
    email: 'admin@scoutzero.local',
    name: 'Admin User',
    passwordHash: adminHash,
    role: 'head_coach'
  }).returning();
  
  const [scout] = await db.insert(users).values({
    email: 'scout1@scoutzero.local',
    name: 'Scout User',
    passwordHash: adminHash,
    role: 'scout'
  }).returning();

  const [analyst] = await db.insert(users).values({
    email: 'analyst1@scoutzero.local',
    name: 'Analyst User',
    passwordHash: adminHash,
    role: 'analyst'
  }).returning();

  // 2. Leagues
  const leaguesData = [
    { name: 'Egyptian Premier League', tier: 1, isYouth: false },
    { name: 'Egyptian Second Division Group A', tier: 2, group: 'A', isYouth: false },
    { name: 'Egyptian Second Division Group B', tier: 2, group: 'B', isYouth: false },
    { name: 'Egyptian Second Division Group C', tier: 2, group: 'C', isYouth: false },
    { name: 'Egyptian Second Division Group D', tier: 2, group: 'D', isYouth: false },
    { name: 'Egyptian Third Division', tier: 3, isYouth: false },
    { name: 'U19 Premier League', tier: 1, isYouth: true, youthCategory: 'U19' },
    { name: 'U17 Premier League', tier: 1, isYouth: true, youthCategory: 'U17' },
  ];
  
  const insertedLeagues = await db.insert(leagues).values(leaguesData).returning();
  const plLeague = insertedLeagues[0];

  // 3. Teams
  const teamsData = [
    { name: 'Al Ahly', nameAr: 'الأهلي', tier: 1 },
    { name: 'Zamalek', nameAr: 'الزمالك', tier: 1 },
    { name: 'Pyramids FC', nameAr: 'بيراميدز', tier: 1 },
    { name: 'Al Masry', nameAr: 'المصري', tier: 1 },
    { name: 'Ismaily', nameAr: 'الإسماعيلي', tier: 1 },
    { name: 'ENPPI', nameAr: 'إنبي', tier: 1 },
    { name: 'Ceramica Cleopatra', nameAr: 'سيراميكا كليوباترا', tier: 1 },
    { name: 'El Gouna', nameAr: 'الجونة', tier: 1 },
    { name: 'Pharco', nameAr: 'فاركو', tier: 1 },
    { name: 'Future FC', nameAr: 'فيوتشر', tier: 1 },
    { name: 'Al Mokawloon', nameAr: 'المقاولون العرب', tier: 1 },
    { name: 'National Bank', nameAr: 'البنك الأهلي', tier: 1 },
    { name: 'Smouha', nameAr: 'سموحة', tier: 1 },
    { name: 'Baladeyet El Mahalla', nameAr: 'بلدية المحلة', tier: 1 },
    { name: 'Ittihad El Shorta', nameAr: 'اتحاد الشرطة', tier: 1 },
    { name: 'ZED FC', nameAr: 'زد', tier: 1 },
    { name: 'Eastern Company', nameAr: 'الشرقية للدخان', tier: 1 },
    { name: 'El Daklyeh', nameAr: 'الداخلية', tier: 1 },
    // Tier 2
    { name: 'Tala\'ea El Gaish', nameAr: 'طلائع الجيش', tier: 2 },
    { name: 'Haras El Hodoud', nameAr: 'حرس الحدود', tier: 2 },
    { name: 'Ghazl El Mahalla', nameAr: 'غزل المحلة', tier: 2 },
    { name: 'Wadi Degla', nameAr: 'وادي دجلة', tier: 2 },
    { name: 'Suez', nameAr: 'السويس', tier: 2 },
    { name: 'Aswan', nameAr: 'أسوان', tier: 2 },
    { name: 'Tanta', nameAr: 'طنطا', tier: 2 },
    { name: 'El Mansoura', nameAr: 'المنصورة', tier: 2 },
    // Tier 3
    { name: 'Kafr El Sheikh FC', nameAr: 'كفر الشيخ', tier: 3 },
    { name: 'Beni Suef FC', nameAr: 'بني سويف', tier: 3 },
    { name: 'Minya SC', nameAr: 'المنيا', tier: 3 },
    { name: 'Fayoum FC', nameAr: 'الفيوم', tier: 3 },
    { name: 'Sohag FC', nameAr: 'سوهاج', tier: 3 },
    { name: 'Qena SC', nameAr: 'قنا', tier: 3 },
  ];

  const dbTeamsToInsert = teamsData.map(t => {
    let lId = plLeague.id;
    if (t.tier === 2) lId = insertedLeagues[1].id;
    else if (t.tier === 3) lId = insertedLeagues[5].id;
    return {
      name: t.name,
      nameAr: t.nameAr,
      leagueId: lId,
      governorate: getRandomElement(GOVERNORATES)
    };
  });

  const insertedTeams = await db.insert(teams).values(dbTeamsToInsert).returning();

  // 4. Seasons
  const [season] = await db.insert(seasons).values({
    name: '2025-2026',
    startDate: '2025-08-01',
    endDate: '2026-05-31',
    isCurrent: true
  }).returning();

  // 5. Players
  const positions: Array<'GK' | 'CB' | 'LB' | 'RB' | 'CDM' | 'CM' | 'CAM' | 'LW' | 'RW' | 'ST'> = ['GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LW', 'RW', 'ST'];
  const playersToInsert = [];
  for (let i = 0; i < 300; i++) {
    const fIdx = Math.floor(Math.random() * FIRST_NAMES.length);
    const lIdx = Math.floor(Math.random() * LAST_NAMES.length);
    const p = {
      nameEn: `${FIRST_NAMES[fIdx]} ${LAST_NAMES[lIdx]}`,
      nameAr: `${FIRST_NAMES_AR[fIdx]} ${LAST_NAMES_AR[lIdx]}`,
      dateOfBirth: getRandomDate(new Date(1998, 0, 1), new Date(2007, 11, 31)),
      positionPrimary: getRandomElement(positions),
      positions: [getRandomElement(positions)],
      preferredFoot: getRandomElement(['left', 'right', 'both']) as 'left'|'right'|'both',
      currentTeamId: getRandomElement(insertedTeams).id,
      governorate: getRandomElement(GOVERNORATES),
      pipelineStatus: getRandomElement(['spotted', 'monitoring', 'contacted', 'trial', 'negotiating', 'signed', 'rejected']) as any,
      estimatedValue: (Math.random() * 5000000).toFixed(2),
      contractStatus: getRandomElement(['active', 'expiring', 'expired', 'free_agent', 'unknown']) as any,
      isSynthetic: true,
      dataSource: 'synthetic' as const,
      createdById: admin.id
    };
    playersToInsert.push(p);
  }

  const insertedPlayers = [];
  for (let i = 0; i < playersToInsert.length; i += 50) {
    const chunk = playersToInsert.slice(i, i + 50);
    const res = await db.insert(players).values(chunk).returning();
    insertedPlayers.push(...res);
  }

  // 6. Matches
  const matchesToInsert = [];
  for (let i = 0; i < 10; i++) {
    matchesToInsert.push({
      homeTeamId: getRandomElement(insertedTeams).id,
      awayTeamId: getRandomElement(insertedTeams).id,
      leagueId: plLeague.id,
      seasonId: season.id,
      matchDate: new Date()
    });
  }
  const insertedMatches = await db.insert(matches).values(matchesToInsert).returning();

  // 7. Evaluations
  const evaluationsToInsert = [];
  for (let i = 0; i < 100; i++) {
    const p = getRandomElement(insertedPlayers);
    const posGroup = (['GK', 'CB', 'FB', 'DM_CM', 'AM_W', 'ST'] as const)[Math.floor(Math.random() * 6)];
    evaluationsToInsert.push({
      playerId: p.id,
      scoutId: scout.id,
      matchId: getRandomElement(insertedMatches).id,
      positionGroup: posGroup,
      ratings: {
        pace: Math.floor(Math.random() * 10) + 1,
        passing: Math.floor(Math.random() * 10) + 1
      },
      ratingsOverall: Math.random() * 10,
      potential: Math.floor(Math.random() * 10) + 1,
      currentAbility: Math.floor(Math.random() * 10) + 1,
      readiness: 'ready_now' as const,
      recommendation: 'monitor' as const,
      isSynthetic: true,
      dataSource: 'synthetic' as const
    });
  }

  for (let i = 0; i < evaluationsToInsert.length; i += 50) {
    const chunk = evaluationsToInsert.slice(i, i + 50);
    await db.insert(evaluations).values(chunk);
  }

  console.log('Done seeding!');
}

runSeed().catch(console.error).finally(() => process.exit(0));
