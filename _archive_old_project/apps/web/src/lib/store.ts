/**
 * ScoutZero In-Memory & Local Database Store
 * 
 * High-performance repository containing Egyptian football data, 320+ players,
 * realistic salaries (EGP), jersey numbers, youth academies, U15 Ashbal category,
 * detailed performance metrics, and playable video highlight moments.
 */

import { calculateMui, MuiResult } from './moneyball';
import { matchPlayerToArchetypes, ArchetypeMatchResult } from './dna-matcher';

export interface Team {
  id: string;
  name: string;
  nameAr: string;
  leagueId: string;
  tier: number;
  governorate: string;
  cityDistrict?: string;
  isOurClub?: boolean;
}

export interface League {
  id: string;
  name: string;
  nameAr: string;
  tier: number;
  group?: string;
  isYouth: boolean;
  youthCategory?: 'U15' | 'U17' | 'U19' | 'U21' | 'Senior';
}

export interface PlayerVideoClip {
  id: string;
  title: string;
  type: string;
  typeAr: string;
  videoUrl: string; // Direct MP4 or embeddable URL
  thumbnailUrl?: string;
  minute: string;
  durationSeconds: number;
  description: string;
  hasSpotlight: boolean;
  spotlightCoords: { x: number; y: number };
}

export interface Player {
  id: string;
  nameEn: string;
  nameAr: string;
  jerseyNumber: number;
  dateOfBirth: string; // YYYY-MM-DD
  age: number;
  ageCategory: 'أشبال (U15)' | 'ناشئين (U17)' | 'شباب (U19)' | 'أولمبي (U21)' | 'فريق أول';
  positionPrimary: string;
  positions: string[];
  preferredFoot: 'left' | 'right' | 'both';
  height: number;
  weight: number;
  governorate: string;
  cityDistrict: string;
  academyOrigin: string; // النادي أو مركز الشباب الذي بدأ فيه
  currentTeamId: string;
  teamNameEn: string;
  teamNameAr: string;
  leagueTier: number;
  contractStatus: 'active' | 'expiring' | 'expired' | 'free_agent' | 'amateur';
  contractEndDate?: string;
  monthlySalaryEgp: number; // الراتب الشهري بالجنيه المصري (منطقي وواقعي)
  contractClauseEgp: number; // قيمة الانتقال أو الشرط الجزائي المنطقي
  valueSource: string;
  guardianName?: string;
  guardianPhone?: string;
  agentName?: string;
  agentPhone?: string;
  photoUrl?: string;
  pipelineStatus: 'spotted' | 'monitoring' | 'contacted' | 'trial' | 'negotiating' | 'signed' | 'rejected';
  tags: string[];
  ratingsOverall: number;
  detailedStats: {
    goals: number;
    assists: number;
    yellowCards: number;
    progressivePassesPer90: number;
    tacklesPer90: number;
    dribbleSuccessPct: number;
    aerialDuelsWonPct: number;
  };
  clips: PlayerVideoClip[];
  mui: MuiResult;
  topArchetype: ArchetypeMatchResult;
  minutesPlayed: number;
  isSynthetic: boolean;
  dataSource: 'manual' | 'imported' | 'auto' | 'external' | 'synthetic';
}

export interface Evaluation {
  id: string;
  playerId: string;
  scoutId: string;
  scoutName: string;
  evaluationDate: string;
  positionGroup: 'GK' | 'CB' | 'FB' | 'DM_CM' | 'AM_W' | 'ST';
  ratings: Record<string, number>;
  ratingsOverall: number;
  potential: number;
  currentAbility: number;
  readiness: 'ready_now' | 'one_year' | 'two_plus_years';
  recommendation: 'sign' | 'monitor' | 'pass';
  strengths: string;
  weaknesses: string;
  personalityNotes: string;
  report: string;
  isSynthetic: boolean;
}

export interface MatchVideo {
  id: string;
  homeTeamName: string;
  homeTeamNameAr: string;
  awayTeamName: string;
  awayTeamNameAr: string;
  leagueName: string;
  date: string;
  homeScore: number;
  awayScore: number;
  videoUrl: string;
  durationSeconds: number;
  ingestStatus: 'done' | 'processing' | 'pending';
  cameraType: 'broadcast' | 'single_wide';
  clipsCount: number;
}

export interface LiveMatchEvent {
  id: string;
  minute: number;
  type: 'goal' | 'yellow_card' | 'red_card' | 'sub' | 'var';
  team: 'home' | 'away';
  playerAr: string;
  detailAr?: string;
}

export interface LiveMatch {
  id: string;
  roundNumber: number;
  leagueId: string;
  leagueNameAr: string;
  homeTeamNameAr: string;
  awayTeamNameAr: string;
  homeScore: number;
  awayScore: number;
  status: 'live' | 'finished' | 'upcoming';
  minute: number;
  stadiumAr: string;
  liveStats: {
    possessionHome: number;
    possessionAway: number;
    shotsHome: number;
    shotsAway: number;
    shotsOnTargetHome: number;
    shotsOnTargetAway: number;
    cornersHome: number;
    cornersAway: number;
    yellowCardsHome: number;
    yellowCardsAway: number;
    foulsHome: number;
    foulsAway: number;
  };
  events: LiveMatchEvent[];
  matchDate: string;
  hasVideoFeed?: boolean;
  videoUrl?: string;
}

export interface LeagueStanding {
  rank: number;
  teamNameAr: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  form: Array<'W' | 'D' | 'L'>;
}

export interface TaggedEvent {
  id: string;
  matchId: string;
  playerId?: string;
  playerName?: string;
  type: string;
  typeAr: string;
  startTime: number; // seconds
  endTime: number;
  pitchX?: number;
  pitchY?: number;
  source: 'manual' | 'auto' | 'import';
  confidence: number;
  status: 'suggested' | 'confirmed' | 'rejected';
  detectorType?: 'MOCK' | 'YOLO_BYTETRACK' | 'MANUAL';
  hasTelestration?: boolean;
}

export interface RecruitmentNeed {
  id: string;
  title: string;
  titleAr: string;
  positionGroup: string;
  targetFoot: 'left' | 'right' | 'both';
  maxAge: number;
  minTier: number;
  maxTier: number;
  maxMonthlySalaryEgp: number;
  maxTransferFeeEgp: number;
  candidates: Array<{
    playerId: string;
    stage: 'spotted' | 'monitoring' | 'contacted' | 'trial' | 'negotiating' | 'signed' | 'rejected';
    fitScore: number;
    fitReason: string;
    addedAt: string;
  }>;
}

// 1. Egyptian Leagues Reference including Youth & Ashbal U15
export const LEAGUES: League[] = [
  { id: 'l1', name: 'Egyptian Premier League', nameAr: 'الدوري المصري الممتاز (دوري نايل)', tier: 1, isYouth: false, youthCategory: 'Senior' },
  { id: 'l2', name: 'Egyptian Second Division A (Professionals)', nameAr: 'دوري المحترفين (دوري القسم الثاني أ)', tier: 2, group: 'A', isYouth: false, youthCategory: 'Senior' },
  { id: 'l3', name: 'Egyptian Second Division B (Delta & Canal)', nameAr: 'دوري القسم الثاني (ب) بحري والقناة', tier: 3, group: 'B', isYouth: false, youthCategory: 'Senior' },
  { id: 'l4', name: 'Egyptian Second Division B (Upper Egypt)', nameAr: 'دوري القسم الثاني (ب) الصعيد', tier: 3, group: 'C', isYouth: false, youthCategory: 'Senior' },
  { id: 'l5', name: 'Egyptian Third Division (Regional & Youth Centers)', nameAr: 'دوري القسم الثالث (مراكز الشباب والأندية الإقليمية)', tier: 4, isYouth: false, youthCategory: 'Senior' },
  { id: 'l6', name: 'Egyptian U19 Republic League', nameAr: 'دوري الجمهورية للشباب (مواليد 2006 - تحت 19 سنة)', tier: 1, isYouth: true, youthCategory: 'U19' },
  { id: 'l7', name: 'Egyptian U17 Republic League', nameAr: 'دوري الجمهورية للناشئين (مواليد 2008 - تحت 17 سنة)', tier: 1, isYouth: true, youthCategory: 'U17' },
  { id: 'l8', name: 'Egyptian U15 Republic League (Ashbal)', nameAr: 'دوري الجمهورية للأشبال (مواليد 2010 - تحت 15 سنة)', tier: 1, isYouth: true, youthCategory: 'U15' },
];

// 2. Egyptian Teams Reference covering all 4 tiers of Egyptian football
export const TEAMS: Team[] = [
  // 1. الدوري المصري الممتاز (Tier 1)
  { id: 't1', name: 'Al Ahly SC', nameAr: 'النادي الأهلي', leagueId: 'l1', tier: 1, governorate: 'القاهرة', cityDistrict: 'الجزيرة / مدينة نصر', isOurClub: true },
  { id: 't2', name: 'Zamalek SC', nameAr: 'نادي الزمالك', leagueId: 'l1', tier: 1, governorate: 'الجيزة', cityDistrict: 'ميت عقبة' },
  { id: 't3', name: 'Pyramids FC', nameAr: 'بيراميدز إف سي', leagueId: 'l1', tier: 1, governorate: 'القاهرة', cityDistrict: 'التجمع الخامس' },
  { id: 't4', name: 'Al Masry SC', nameAr: 'المصري البورسعيدي', leagueId: 'l1', tier: 1, governorate: 'بورسعيد', cityDistrict: 'حي المناخ' },
  { id: 't5', name: 'Ismaily SC', nameAr: 'الإسماعيلي', leagueId: 'l1', tier: 1, governorate: 'الإسماعيلية', cityDistrict: 'الشيخ زايد' },
  { id: 't6', name: 'ENPPI Club', nameAr: 'إنبي', leagueId: 'l1', tier: 1, governorate: 'القاهرة', cityDistrict: 'مدينة نصر' },
  { id: 't7', name: 'Ceramica Cleopatra', nameAr: 'سيراميكا كليوباترا', leagueId: 'l1', tier: 1, governorate: 'الجيزة', cityDistrict: 'السادس من أكتوبر' },
  { id: 't8', name: 'ZED FC', nameAr: 'زد إف سي', leagueId: 'l1', tier: 1, governorate: 'الجيزة', cityDistrict: 'الشيخ زايد' },
  { id: 't9', name: 'Smouha SC', nameAr: 'سموحة', leagueId: 'l1', tier: 1, governorate: 'الإسكندرية', cityDistrict: 'سيدي جابر' },
  { id: 't10', name: 'National Bank', nameAr: 'البنك الأهلي', leagueId: 'l1', tier: 1, governorate: 'القاهرة', cityDistrict: 'المعادي' },
  { id: 't11', name: 'Al Ittihad Alexandria', nameAr: 'الاتحاد السكندري', leagueId: 'l1', tier: 1, governorate: 'الإسكندرية', cityDistrict: 'الشاطبي' },
  { id: 't12', name: 'Pharco FC', nameAr: 'فاركو', leagueId: 'l1', tier: 1, governorate: 'الإسكندرية', cityDistrict: 'برج العرب' },
  { id: 't13', name: 'El Gouna FC', nameAr: 'الجونة', leagueId: 'l1', tier: 1, governorate: 'البحر الأحمر', cityDistrict: 'الغردقة / الجونة' },
  { id: 't14', name: 'Baladeyet El Mahalla', nameAr: 'بلدية المحلة', leagueId: 'l1', tier: 1, governorate: 'الغربية', cityDistrict: 'المحلة الكبرى' },
  
  // 2. دوري المحترفين - القسم الثاني أ (Tier 2)
  { id: 't15', name: 'Ghazl El Mahalla', nameAr: 'غزل المحلة', leagueId: 'l2', tier: 2, governorate: 'الغربية', cityDistrict: 'المحلة الكبرى' },
  { id: 't16', name: 'Haras El Hodoud', nameAr: 'حرس الحدود', leagueId: 'l2', tier: 2, governorate: 'الإسكندرية', cityDistrict: 'المكس' },
  { id: 't17', name: 'Wadi Degla', nameAr: 'وادي دجلة', leagueId: 'l2', tier: 2, governorate: 'القاهرة', cityDistrict: 'زهراء المعادي' },
  { id: 't18', name: 'Tanta SC', nameAr: 'طنطا الرياضي', leagueId: 'l2', tier: 2, governorate: 'الغربية', cityDistrict: 'طنطا' },
  { id: 't19', name: 'El Mansoura SC', nameAr: 'المنصورة', leagueId: 'l2', tier: 2, governorate: 'الدقهلية', cityDistrict: 'المنصورة' },
  { id: 't20', name: 'Al Qanah FC', nameAr: 'القناة', leagueId: 'l2', tier: 2, governorate: 'الإسماعيلية', cityDistrict: 'القنطرة غرب' },
  { id: 't21', name: 'Suez SC', nameAr: 'منتخب السويس', leagueId: 'l2', tier: 2, governorate: 'السويس', cityDistrict: 'بورتوفيق' },
  { id: 't22', name: 'Aswan SC', nameAr: 'نادي أسوان', leagueId: 'l2', tier: 2, governorate: 'أسوان', cityDistrict: 'كورنيش النيل' },
  { id: 't23', name: 'Telecom Egypt (WE)', nameAr: 'المصرية للاتصالات', leagueId: 'l2', tier: 2, governorate: 'الجيزة', cityDistrict: 'القرية الذكية' },
  { id: 't24', name: 'La Viena FC', nameAr: 'لافيينا إف سي', leagueId: 'l2', tier: 2, governorate: 'بني سويف', cityDistrict: 'الواسطى' },
  
  // 3. دوري القسم الثاني ب - بحري والقناة والصعيد (Tier 3)
  { id: 't25', name: 'Kafr El Sheikh FC', nameAr: 'كفر الشيخ', leagueId: 'l3', tier: 3, governorate: 'كفر الشيخ', cityDistrict: 'سخا' },
  { id: 't26', name: 'Minya SC', nameAr: 'المنيا الرياضي', leagueId: 'l4', tier: 3, governorate: 'المنيا', cityDistrict: 'المنيا الجديدة' },
  { id: 't27', name: 'Fayoum FC', nameAr: 'نادي الفيوم', leagueId: 'l4', tier: 3, governorate: 'الفيوم', cityDistrict: 'إطسا' },
  { id: 't28', name: 'Sohag SC', nameAr: 'سوهاج الرياضي', leagueId: 'l4', tier: 3, governorate: 'سوهاج', cityDistrict: 'أخميم' },
  { id: 't29', name: 'Damanhour SC', nameAr: 'ألعاب دمنهور', leagueId: 'l3', tier: 3, governorate: 'البحيرة', cityDistrict: 'دمنهور' },
  { id: 't30', name: 'Dekernes SC', nameAr: 'نادي دكرنس', leagueId: 'l3', tier: 3, governorate: 'الدقهلية', cityDistrict: 'دكرنس' },
  { id: 't31', name: 'Belqas SC', nameAr: 'نادي بلقاس', leagueId: 'l3', tier: 3, governorate: 'الدقهلية', cityDistrict: 'بلقاس' },
  { id: 't32', name: 'Pioneers FC', nameAr: 'بايونيرز (نبروه)', leagueId: 'l3', tier: 3, governorate: 'الدقهلية', cityDistrict: 'نبروه' },
  
  // 4. دوري القسم الثالث - مراكز الشباب والأندية الإقليمية (Tier 4)
  { id: 't33', name: 'Desouk SC', nameAr: 'نادي دسوق', leagueId: 'l5', tier: 4, governorate: 'كفر الشيخ', cityDistrict: 'دسوق' },
  { id: 't34', name: 'Zefta SC', nameAr: 'نادي زفتى', leagueId: 'l5', tier: 4, governorate: 'الغربية', cityDistrict: 'زفتى' },
  { id: 't35', name: 'Biala YC', nameAr: 'مركز شباب بيلا', leagueId: 'l5', tier: 4, governorate: 'كفر الشيخ', cityDistrict: 'بيلا' },
  { id: 't36', name: 'Mit Ghamr SC', nameAr: 'نادي ميت غمر', leagueId: 'l5', tier: 4, governorate: 'الدقهلية', cityDistrict: 'ميت غمر' },
  { id: 't37', name: 'Kous SC', nameAr: 'نادي قوص', leagueId: 'l5', tier: 4, governorate: 'قنا', cityDistrict: 'قوص' },
  { id: 't38', name: 'Maghagha YC', nameAr: 'مركز شباب مغاغة', leagueId: 'l5', tier: 4, governorate: 'المنيا', cityDistrict: 'مغاغة' },
];

const POSITIONS = ['GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LW', 'RW', 'ST'];
const POSITION_GROUPS: Record<string, 'GK' | 'CB' | 'FB' | 'DM_CM' | 'AM_W' | 'ST'> = {
  GK: 'GK', CB: 'CB', LB: 'FB', RB: 'FB', LWB: 'FB', RWB: 'FB',
  CDM: 'DM_CM', CM: 'DM_CM', CAM: 'AM_W', LM: 'AM_W', RM: 'AM_W',
  LW: 'AM_W', RW: 'AM_W', CF: 'ST', ST: 'ST'
};

// High-definition, fully-functioning local football video assets served directly by the platform
const SAMPLE_FOOTBALL_VIDEO_URL = "/videos/match-broadcast.mp4"; // Real Broadcast Match (69s)
const SAMPLE_FOOTBALL_ACTION_URL = "/videos/match-action.mp4";   // Intensive Action & Tackle (25s)
const SAMPLE_FOOTBALL_DRIBBLE_URL = "/videos/match-dribble.mp4"; // Dribble & Box Entry (33s)
const SAMPLE_FOOTBALL_CLIP_URL = "/videos/clip-1.mp4";          // Tactical Snapshot Clip

// Sample standard video clips for top players with realistic timestamps and local video files
function createSampleClips(playerName: string): PlayerVideoClip[] {
  return [
    {
      id: `clip_1_${playerName}`,
      title: 'تمريرة تقدمية كاسرة لخطوط المنافس (Progressive Pass)',
      type: 'progressive_pass',
      typeAr: 'تمريرة تقدمية كاسرة للخطوط',
      videoUrl: SAMPLE_FOOTBALL_VIDEO_URL,
      minute: "24'",
      durationSeconds: 15,
      description: 'استلام متقن تحت ضغط وتمرير عمودي بين قلبي الدفاع وصناعة انفراد حقيقي.',
      hasSpotlight: true,
      spotlightCoords: { x: 52, y: 45 }
    },
    {
      id: `clip_2_${playerName}`,
      title: 'افتكاك دفاعي وضغط عكسي في الثلث الأوسط (High-Press Tackle)',
      type: 'tackle',
      typeAr: 'افتكاك وضغط عكسي',
      videoUrl: SAMPLE_FOOTBALL_ACTION_URL,
      minute: "58'",
      durationSeconds: 12,
      description: 'قطع ارتداد هجومي سريع واسترجاع الاستحواذ في نصف ملعب الخصم.',
      hasSpotlight: true,
      spotlightCoords: { x: 48, y: 56 }
    },
    {
      id: `clip_3_${playerName}`,
      title: 'مراوغة واختراق منطقة الجزاء (Box Penetration)',
      type: 'dribble',
      typeAr: 'مراوغة واختراق الصندوق',
      videoUrl: SAMPLE_FOOTBALL_DRIBBLE_URL,
      minute: "81'",
      durationSeconds: 14,
      description: 'تجاوز لاعبين على الخط وعرضية متقنة في نقطة الجزاء.',
      hasSpotlight: true,
      spotlightCoords: { x: 65, y: 38 }
    }
  ];
}

// Generate realistic detailed players across Egypt
function generateInitialPlayers(): Player[] {
  const result: Player[] = [];

  // Top Verified Prospects (Starting from U15 Ashbal up to U21)
  const starGems = [
    {
      nameEn: 'Ibrahim Adel El-Sayed',
      nameAr: 'إبراهيم عادل السيد',
      jersey: 11,
      pos: 'LW',
      age: 19,
      category: 'شباب (U19)' as const,
      tier: 2,
      teamId: 't15',
      salary: 18000,
      clause: 650000,
      foot: 'left' as const,
      rating: 8.8,
      mins: 1250,
      gov: 'الغربية',
      district: 'المحلة الكبرى (حي أول)',
      origin: 'مركز شباب بيلا (كفر الشيخ)',
      goals: 9, assists: 6, yellowCards: 2,
      dribblePct: 84, aerialPct: 45, pPasses: 4.8, tackles: 1.8
    },
    {
      nameEn: 'Bilal Mazhar Abdelkader',
      nameAr: 'بلال مظهر عبد القادر',
      jersey: 9,
      pos: 'ST',
      age: 18,
      category: 'شباب (U19)' as const,
      tier: 2,
      teamId: 't19',
      salary: 14000,
      clause: 450000,
      foot: 'right' as const,
      rating: 8.6,
      mins: 980,
      gov: 'الدقهلية',
      district: 'المنصورة (حي الجامعة)',
      origin: 'نادي دكرنس الرياضي',
      goals: 12, assists: 2, yellowCards: 1,
      dribblePct: 62, aerialPct: 82, pPasses: 1.9, tackles: 0.8
    },
    {
      nameEn: 'Youssef Amr El-Daly',
      nameAr: 'يوسف عمرو الدالي (موهبة الأشبال)',
      jersey: 10,
      pos: 'CAM',
      age: 15, // أشبال U15!
      category: 'أشبال (U15)' as const,
      tier: 1,
      teamId: 't14',
      salary: 4000,
      clause: 150000,
      foot: 'left' as const,
      rating: 8.9,
      mins: 780,
      gov: 'الغربية',
      district: 'زفتى (سندسيس)',
      origin: 'أكاديمية براعم بلدية المحلة',
      goals: 14, assists: 11, yellowCards: 0,
      dribblePct: 91, aerialPct: 38, pPasses: 6.2, tackles: 1.4
    },
    {
      nameEn: 'Ziad Kamal Mansour',
      nameAr: 'زياد كمال منصور',
      jersey: 6,
      pos: 'CDM',
      age: 20,
      category: 'أولمبي (U21)' as const,
      tier: 2,
      teamId: 't24',
      salary: 22000,
      clause: 800000,
      foot: 'right' as const,
      rating: 8.4,
      mins: 1420,
      gov: 'بني سويف',
      district: 'الواسطى (أطواب)',
      origin: 'أكاديمية لافيينا الصعيد',
      goals: 2, assists: 5, yellowCards: 4,
      dribblePct: 76, aerialPct: 74, pPasses: 5.6, tackles: 4.2
    },
    {
      nameEn: 'Marwan Fayed Hegazy',
      nameAr: 'مروان فايد حجازي',
      jersey: 4,
      pos: 'CB',
      age: 20,
      category: 'أولمبي (U21)' as const,
      tier: 3,
      teamId: 't25',
      salary: 9500,
      clause: 250000,
      foot: 'left' as const,
      rating: 8.5,
      mins: 1100,
      gov: 'كفر الشيخ',
      district: 'دسوق (محلة دياي)',
      origin: 'نادي دسوق الرياضي',
      goals: 3, assists: 1, yellowCards: 3,
      dribblePct: 55, aerialPct: 88, pPasses: 4.1, tackles: 3.9
    },
    {
      nameEn: 'Karim Youssef El-Badry',
      nameAr: 'كريم يوسف البدري',
      jersey: 14,
      pos: 'CAM',
      age: 17,
      category: 'ناشئين (U17)' as const,
      tier: 3,
      teamId: 't27',
      salary: 7500,
      clause: 180000,
      foot: 'left' as const,
      rating: 8.7,
      mins: 720,
      gov: 'الفيوم',
      district: 'إطسا (دفنو)',
      origin: 'مركز شباب إطسا',
      goals: 7, assists: 8, yellowCards: 1,
      dribblePct: 88, aerialPct: 42, pPasses: 5.4, tackles: 1.2
    },
    {
      nameEn: 'Omar Tarek El-Khatib',
      nameAr: 'عمر طارق الخطيب',
      jersey: 2,
      pos: 'RB',
      age: 19,
      category: 'شباب (U19)' as const,
      tier: 2,
      teamId: 't21',
      salary: 13000,
      clause: 320000,
      foot: 'right' as const,
      rating: 8.1,
      mins: 890,
      gov: 'السويس',
      district: 'حي الجناين',
      origin: 'نادي منتخب السويس للناشئين',
      goals: 1, assists: 7, yellowCards: 2,
      dribblePct: 78, aerialPct: 65, pPasses: 4.9, tackles: 3.4
    },
    {
      nameEn: 'Seif Amr El-Ghandour',
      nameAr: 'سيف عمرو الغندور',
      jersey: 8,
      pos: 'CM',
      age: 20,
      category: 'أولمبي (U21)' as const,
      tier: 2,
      teamId: 't17',
      salary: 20000,
      clause: 750000,
      foot: 'both' as const,
      rating: 8.3,
      mins: 1350,
      gov: 'القاهرة',
      district: 'المعادي (طرة)',
      origin: 'أكاديمية وادي دجلة',
      goals: 4, assists: 6, yellowCards: 2,
      dribblePct: 80, aerialPct: 60, pPasses: 5.8, tackles: 2.9
    },
    {
      nameEn: 'Mostafa Sherif El-Wany',
      nameAr: 'مصطفى شريف الواني',
      jersey: 5,
      pos: 'CB',
      age: 22,
      category: 'فريق أول' as const,
      tier: 2,
      teamId: 't22',
      salary: 25000,
      clause: 500000,
      foot: 'right' as const,
      rating: 7.9,
      mins: 1800,
      gov: 'أسوان',
      district: 'كوم أمبو (دراو)',
      origin: 'مركز شباب دراو',
      goals: 2, assists: 0, yellowCards: 5,
      dribblePct: 48, aerialPct: 85, pPasses: 3.8, tackles: 4.1
    },
    {
      nameEn: 'Ahmed Nader El-Sayed',
      nameAr: 'أحمد نادر السيد',
      jersey: 1,
      pos: 'GK',
      age: 20,
      category: 'أولمبي (U21)' as const,
      tier: 2,
      teamId: 't16',
      salary: 17000,
      clause: 450000,
      foot: 'right' as const,
      rating: 8.2,
      mins: 1440,
      gov: 'الإسكندرية',
      district: 'العجمي',
      origin: 'قطاع حرس الحدود للشباب',
      goals: 0, assists: 0, yellowCards: 1,
      dribblePct: 30, aerialPct: 92, pPasses: 6.8, tackles: 0.5
    },
    // Tier 4 Talents (دوري القسم الثالث ومراكز الشباب)
    {
      nameEn: 'Hossam Ramadan Basha',
      nameAr: 'حسام رمضان باشا',
      jersey: 11,
      pos: 'LW',
      age: 19,
      category: 'شباب (U19)' as const,
      tier: 4,
      teamId: 't35',
      salary: 6500,
      clause: 150000,
      foot: 'left' as const,
      rating: 8.7,
      mins: 1050,
      gov: 'كفر الشيخ',
      district: 'بيلا (الكوم الطويل)',
      origin: 'مركز شباب بيلا',
      goals: 11, assists: 7, yellowCards: 1,
      dribblePct: 86, aerialPct: 40, pPasses: 5.1, tackles: 1.5
    },
    {
      nameEn: 'Ahmed El-Sawy Desouky',
      nameAr: 'أحمد الصاوي الدسوقي',
      jersey: 10,
      pos: 'CAM',
      age: 18,
      category: 'شباب (U19)' as const,
      tier: 4,
      teamId: 't33',
      salary: 5500,
      clause: 120000,
      foot: 'right' as const,
      rating: 8.6,
      mins: 920,
      gov: 'كفر الشيخ',
      district: 'دسوق (حي الشريف)',
      origin: 'قطاع ناشئي نادي دسوق',
      goals: 8, assists: 9, yellowCards: 2,
      dribblePct: 83, aerialPct: 35, pPasses: 5.7, tackles: 1.1
    },
    {
      nameEn: 'Mahmoud Abdelmonem Zefta',
      nameAr: 'محمود عبد المنعم زفتى',
      jersey: 9,
      pos: 'ST',
      age: 20,
      category: 'أولمبي (U21)' as const,
      tier: 4,
      teamId: 't34',
      salary: 6000,
      clause: 130000,
      foot: 'right' as const,
      rating: 8.5,
      mins: 1120,
      gov: 'الغربية',
      district: 'زفتى (كفر عنان)',
      origin: 'نادي زفتى الرياضي',
      goals: 13, assists: 3, yellowCards: 3,
      dribblePct: 68, aerialPct: 79, pPasses: 2.1, tackles: 0.9
    }
  ];

  starGems.forEach((gem, idx) => {
    const team = TEAMS.find(t => t.id === gem.teamId) || TEAMS[0];
    const posGroup = POSITION_GROUPS[gem.pos] || 'AM_W';

    const mui = calculateMui({
      minutes: gem.mins,
      tier: gem.tier,
      age: gem.age,
      positionGroup: posGroup,
      estimatedValue: gem.clause,
      ratingsOverall: gem.rating,
      actionsUnderPressureSuccessRate: 0.78,
    });

    const archetypes = matchPlayerToArchetypes({
      pace: gem.rating * 9.5,
      passing: gem.rating * 9.2,
      dribbling: gem.rating * 9.6,
      shooting: gem.rating * 9.0,
      tackling: gem.rating * 8.5,
      aerial_duels: gem.rating * 8.8,
      positioning: gem.rating * 9.0
    }, posGroup);

    result.push({
      id: `p_gem_${idx + 1}`,
      nameEn: gem.nameEn,
      nameAr: gem.nameAr,
      jerseyNumber: gem.jersey,
      dateOfBirth: `${2026 - gem.age}-04-15`,
      age: gem.age,
      ageCategory: gem.category,
      positionPrimary: gem.pos,
      positions: [gem.pos],
      preferredFoot: gem.foot,
      height: 174 + (idx % 14),
      weight: 66 + (idx % 15),
      governorate: gem.gov,
      cityDistrict: gem.district,
      academyOrigin: gem.origin,
      currentTeamId: team.id,
      teamNameEn: team.name,
      teamNameAr: team.nameAr,
      leagueTier: gem.tier,
      contractStatus: idx % 3 === 0 ? 'expiring' : 'active',
      contractEndDate: '2026-06-30',
      monthlySalaryEgp: gem.salary,
      contractClauseEgp: gem.clause,
      valueSource: 'عقد محلي موثق',
      guardianName: gem.age < 19 ? `الحاج / عادل السيد (والد اللاعب)` : undefined,
      guardianPhone: gem.age < 19 ? `+20 100 555 010${idx}` : undefined,
      agentName: 'كابتن نبيل أبوزيد (وكيل معتمد)',
      agentPhone: `+20 122 888 020${idx}`,
      pipelineStatus: idx < 3 ? 'monitoring' : idx < 6 ? 'spotted' : 'trial',
      tags: ['موهبة استثنائية', `راتب: ${gem.salary.toLocaleString('ar-EG')} ج.م`, gem.category],
      ratingsOverall: gem.rating,
      detailedStats: {
        goals: gem.goals,
        assists: gem.assists,
        yellowCards: gem.yellowCards,
        progressivePassesPer90: gem.pPasses,
        tacklesPer90: gem.tackles,
        dribbleSuccessPct: gem.dribblePct,
        aerialDuelsWonPct: gem.aerialPct
      },
      clips: createSampleClips(gem.nameAr),
      mui,
      topArchetype: archetypes[0],
      minutesPlayed: gem.mins,
      isSynthetic: true,
      dataSource: 'synthetic'
    });
  });

  // Towns & Villages in Egypt for realism
  const EGYPT_LOCALITIES = [
    { gov: 'الغربية', district: 'المحلة الكبرى (سمنود)', origin: 'مركز شباب سمنود' },
    { gov: 'الغربية', district: 'طنطا (سيجر)', origin: 'نادي طنطا للبراعم' },
    { gov: 'الغربية', district: 'كفر الزيات', origin: 'نادي مالية كفر الزيات' },
    { gov: 'الدقهلية', district: 'دكرنس (ميت فارس)', origin: 'نادي دكرنس الرياضي' },
    { gov: 'الدقهلية', district: 'بلقاس', origin: 'نادي بلقاس' },
    { gov: 'الدقهلية', district: 'شربين', origin: 'نادي شربين' },
    { gov: 'الدقهلية', district: 'منية النصر', origin: 'مركز شباب منية النصر' },
    { gov: 'كفر الشيخ', district: 'بيلا (الكوم الطويل)', origin: 'مركز شباب بيلا' },
    { gov: 'كفر الشيخ', district: 'دسوق (كفر مجر)', origin: 'نادي دسوق' },
    { gov: 'كفر الشيخ', district: 'سيدي سالم', origin: 'مركز شباب سيدي سالم' },
    { gov: 'البحيرة', district: 'دمنهور (شبرا)', origin: 'ألعاب دمنهور' },
    { gov: 'البحيرة', district: 'كفر الدوار', origin: 'نادي كفر الدوار' },
    { gov: 'بني سويف', district: 'الواسطى (ميدوم)', origin: 'مركز شباب الواسطى' },
    { gov: 'بني سويف', district: 'الفشن', origin: 'مركز شباب الفشن' },
    { gov: 'المنيا', district: 'ملوي (الروضة)', origin: 'نادي ناصر ملوي' },
    { gov: 'المنيا', district: 'مغاغة', origin: 'مركز شباب مغاغة' },
    { gov: 'أسيوط', district: 'ديروط (صنبو)', origin: 'نادي ديروط' },
    { gov: 'سوهاج', district: 'طهطا', origin: 'نادي طهطا الرياضي' },
    { gov: 'قنا', district: 'نجع حمادي (هو)', origin: 'نادي الألومنيوم' },
    { gov: 'قنا', district: 'قوص', origin: 'نادي قوص' },
    { gov: 'أسوان', district: 'كوم أمبو (سلوا)', origin: 'مركز شباب كوم أمبو' },
    { gov: 'السويس', district: 'حي الأربعين', origin: 'مركز شباب الأربعين' },
    { gov: 'الإسماعيلية', district: 'التل الكبير', origin: 'نادي التل الكبير' },
    { gov: 'بورسعيد', district: 'بورفؤاد', origin: 'نادي بورفؤاد' },
    { gov: 'القاهرة', district: 'حلوان (المعصرة)', origin: 'مركز شباب حلوان' },
    { gov: 'الجيزة', district: 'أوسيم (بشتيل)', origin: 'مركز شباب بشتيل' }
  ];

  const ARABIC_FIRST_NAMES = ['يوسف', 'زياد', 'عمر', 'كريم', 'إبراهيم', 'بلال', 'مروان', 'سيف', 'أحمد', 'محمد', 'محمود', 'مصطفى', 'طارق', 'حسن', 'خالد', 'عبد الرحمن', 'شريف', 'حازم', 'نادر', 'يحيى'];
  const ARABIC_LAST_NAMES = ['عادل', 'كمال', 'فتحي', 'عاشور', 'عطية', 'مظهر', 'إمام', 'زيزو', 'حجازي', 'الشناوي', 'هاني', 'كوكا', 'السيد', 'صبحي', 'توفيق', 'قفشة', 'جابر', 'الدالي', 'فايد', 'مرموش'];

  // Add 310 additional granular players starting from U15 (15 years old) to 25
  for (let i = 11; i <= 320; i++) {
    const fn = ARABIC_FIRST_NAMES[i % ARABIC_FIRST_NAMES.length];
    const ln = ARABIC_LAST_NAMES[(i * 3 + 1) % ARABIC_LAST_NAMES.length];
    const locality = EGYPT_LOCALITIES[i % EGYPT_LOCALITIES.length];
    const team = TEAMS[i % TEAMS.length];
    const pos = POSITIONS[i % POSITIONS.length];
    const posGroup = POSITION_GROUPS[pos] || 'AM_W';
    
    // Ages starting from 15 (Ashbal) up to 24
    const age = 15 + (i % 10);
    const category: Player['ageCategory'] = 
      age <= 15 ? 'أشبال (U15)' :
      age <= 17 ? 'ناشئين (U17)' :
      age <= 19 ? 'شباب (U19)' :
      age <= 21 ? 'أولمبي (U21)' : 'فريق أول';

    const foot: 'left' | 'right' | 'both' = (i % 5 === 0) ? 'left' : (i % 7 === 0) ? 'both' : 'right';
    const jersey = (i % 99) + 1;
    const rating = Number((5.8 + ((i % 38) / 10)).toFixed(1));
    const mins = 300 + (i * 14) % 1700;

    // Realistic monthly salary in EGP
    let monthlySalary = 4000;
    if (age <= 16) monthlySalary = 2500 + (i % 4) * 1000; // أشبال 2.5k - 6k
    else if (team.tier === 1) monthlySalary = 20000 + (i % 30) * 2000; // ممتاز 20k - 80k
    else if (team.tier === 2) monthlySalary = 9000 + (i % 20) * 1200; // محترفين 9k - 33k
    else if (team.tier === 3) monthlySalary = 6000 + (i % 15) * 800; // قسم ثاني ب 6k - 18k
    else monthlySalary = 3500 + (i % 10) * 500; // قسم ثالث ومراكز شباب 3.5k - 8.5k

    const clause = monthlySalary * 24; // تقديراً لشرط جزائي مدة سنتين

    const mui = calculateMui({
      minutes: mins,
      tier: team.tier,
      age,
      positionGroup: posGroup,
      estimatedValue: clause,
      ratingsOverall: rating,
      actionsUnderPressureSuccessRate: 0.65 + ((i % 28) / 100)
    });

    const archetypes = matchPlayerToArchetypes({
      pace: 55 + (i % 40),
      passing: 55 + ((i * 2) % 40),
      tackling: 50 + ((i * 3) % 40),
      dribbling: 55 + ((i * 4) % 40),
      positioning: 58 + ((i * 5) % 38),
      finishing: 50 + ((i * 6) % 45)
    }, posGroup);

    result.push({
      id: `p_${i}`,
      nameEn: `${fn} ${ln}`,
      nameAr: `${fn} ${ln}`,
      jerseyNumber: jersey,
      dateOfBirth: `${2026 - age}-0${(i % 9) + 1}-10`,
      age,
      ageCategory: category,
      positionPrimary: pos,
      positions: [pos],
      preferredFoot: foot,
      height: 168 + (i % 24),
      weight: 60 + (i % 25),
      governorate: locality.gov,
      cityDistrict: locality.district,
      academyOrigin: locality.origin,
      currentTeamId: team.id,
      teamNameEn: team.name,
      teamNameAr: team.nameAr,
      leagueTier: team.tier,
      contractStatus: age <= 16 ? 'amateur' : i % 4 === 0 ? 'expiring' : 'active',
      contractEndDate: '2026-06-30',
      monthlySalaryEgp: monthlySalary,
      contractClauseEgp: clause,
      valueSource: 'عقد رسمي موثق بالاتحاد',
      guardianName: age < 19 ? `ولي أمر اللاعب (${fn})` : undefined,
      guardianPhone: age < 19 ? `+20 100 222 33${i % 90}` : undefined,
      agentName: i % 3 === 0 ? `كابتن تامر النحاس` : undefined,
      agentPhone: i % 3 === 0 ? `+20 122 444 55${i % 90}` : undefined,
      pipelineStatus: i % 15 === 0 ? 'negotiating' : i % 8 === 0 ? 'contacted' : i % 5 === 0 ? 'monitoring' : 'spotted',
      tags: [category, locality.gov, `راتب: ${monthlySalary.toLocaleString('ar-EG')} ج.م`],
      ratingsOverall: rating,
      detailedStats: {
        goals: (i * 3) % 11,
        assists: (i * 2) % 9,
        yellowCards: i % 4,
        progressivePassesPer90: Number((2.5 + (i % 35) / 10).toFixed(1)),
        tacklesPer90: Number((1.5 + (i % 25) / 10).toFixed(1)),
        dribbleSuccessPct: 55 + (i % 35),
        aerialDuelsWonPct: 50 + ((i * 2) % 40)
      },
      clips: createSampleClips(`${fn} ${ln}`),
      mui,
      topArchetype: archetypes[0],
      minutesPlayed: mins,
      isSynthetic: true,
      dataSource: 'synthetic'
    });
  }

  return result;
}

// 3. Evaluations Sample
function generateInitialEvaluations(players: Player[]): Evaluation[] {
  return players.slice(0, 50).map((p, idx) => ({
    id: `eval_${idx + 1}`,
    playerId: p.id,
    scoutId: 'scout_1',
    scoutName: 'ك. مصطفى الشامي (كشاف الدلتا وشمال مصر)',
    evaluationDate: '2026-10-02',
    positionGroup: POSITION_GROUPS[p.positionPrimary] || 'AM_W',
    ratings: {
      pace: Math.min(10, Math.round(p.ratingsOverall + 0.5)),
      passing: Math.min(10, Math.round(p.ratingsOverall)),
      tackling: Math.min(10, Math.round(p.ratingsOverall - 0.5)),
      positioning: Math.min(10, Math.round(p.ratingsOverall + 0.2)),
      decision_making: Math.min(10, Math.round(p.ratingsOverall)),
      composure: Math.min(10, Math.round(p.ratingsOverall - 0.2))
    },
    ratingsOverall: p.ratingsOverall,
    potential: Math.min(10, Math.round(p.ratingsOverall + 1.2)),
    currentAbility: Math.round(p.ratingsOverall),
    readiness: p.age <= 17 ? 'two_plus_years' : p.age <= 19 ? 'one_year' : 'ready_now',
    recommendation: p.ratingsOverall >= 8.0 ? 'sign' : p.ratingsOverall >= 7.0 ? 'monitor' : 'pass',
    strengths: 'شجاعة واضحة في المواجهات الفردية، سرعة التحول من الدفاع للهجوم، ورؤية غير تقليدية للتمرير في المساحات الضيقة.',
    weaknesses: 'يحتاج لعمل بدني إضافي في صالة الجيم لتحمل الاحتكاكات العنيفة في الدوري الممتاز.',
    personalityNotes: 'منضبط للغاية، يستمع لتعليمات المدرب، قائد بطبعه في فريقه المحلي.',
    report: `تقرير مفصل للاعب ${p.nameAr} (#${p.jerseyNumber}): تم متابعته ميدانياً في مباراتين متتاليتين مع ${p.teamNameAr}. أظهر نضجاً تكتيكياً يفوق سنه، وقدرة فائقة على كسر خطوط المنافس. راتبه الحالي (${p.monthlySalaryEgp.toLocaleString('ar-EG')} ج.م) في المتناول تماماً ويسمح بفرصة تعاقد ذهبية.`,
    isSynthetic: true
  }));
}

// 4. Sample Matches with working video sources (Egyptian Football Competitions)
export const MATCHES: MatchVideo[] = [
  {
    id: 'm1',
    homeTeamName: 'Baladeyet El Mahalla',
    homeTeamNameAr: 'بلدية المحلة',
    awayTeamName: 'Ghazl El Mahalla',
    awayTeamNameAr: 'غزل المحلة',
    leagueName: 'دوري المحترفين المصري (ديربي المحلة)',
    date: '2026-09-28',
    homeScore: 2,
    awayScore: 1,
    videoUrl: '/videos/match-broadcast.mp4',
    durationSeconds: 230,
    ingestStatus: 'done',
    cameraType: 'broadcast',
    clipsCount: 14
  },
  {
    id: 'm2',
    homeTeamName: 'Wadi Degla',
    homeTeamNameAr: 'وادي دجلة',
    awayTeamName: 'El Mansoura SC',
    awayTeamNameAr: 'المنصورة',
    leagueName: 'دوري المحترفين المصري',
    date: '2026-10-01',
    homeScore: 2,
    awayScore: 0,
    videoUrl: '/videos/match-action.mp4',
    durationSeconds: 228,
    ingestStatus: 'done',
    cameraType: 'broadcast',
    clipsCount: 11
  },
  {
    id: 'm3',
    homeTeamName: 'La Viena FC',
    homeTeamNameAr: 'لافيينا إف سي',
    awayTeamName: 'Petroleum Asyut',
    awayTeamNameAr: 'بترول أسيوط',
    leagueName: 'دوري المحترفين المصري',
    date: '2026-10-04',
    homeScore: 2,
    awayScore: 0,
    videoUrl: '/videos/match-dribble.mp4',
    durationSeconds: 140,
    ingestStatus: 'done',
    cameraType: 'broadcast',
    clipsCount: 8
  },
  {
    id: 'm4',
    homeTeamName: 'Al Ahly SC',
    homeTeamNameAr: 'الأهلي',
    awayTeamName: 'Pyramids FC',
    awayTeamNameAr: 'بيراميدز',
    leagueName: 'الدوري المصري الممتاز (دوري نايل)',
    date: '2026-10-06',
    homeScore: 2,
    awayScore: 1,
    videoUrl: '/videos/match-broadcast.mp4',
    durationSeconds: 230,
    ingestStatus: 'done',
    cameraType: 'broadcast',
    clipsCount: 16
  },
  {
    id: 'm5',
    homeTeamName: 'Zamalek SC',
    homeTeamNameAr: 'الزمالك',
    awayTeamName: 'Al Masry SC',
    awayTeamNameAr: 'المصري البورسعيدي',
    leagueName: 'الدوري المصري الممتاز (دوري نايل)',
    date: '2026-10-06',
    homeScore: 1,
    awayScore: 0,
    videoUrl: '/videos/match-action.mp4',
    durationSeconds: 228,
    ingestStatus: 'done',
    cameraType: 'broadcast',
    clipsCount: 12
  },
  {
    id: 'm6',
    homeTeamName: 'Ceramica Cleopatra',
    homeTeamNameAr: 'سيراميكا كليوباترا',
    awayTeamName: 'ZED FC',
    awayTeamNameAr: 'زد إف سي',
    leagueName: 'الدوري المصري الممتاز (دوري نايل)',
    date: '2026-10-06',
    homeScore: 1,
    awayScore: 1,
    videoUrl: '/videos/match-dribble.mp4',
    durationSeconds: 140,
    ingestStatus: 'done',
    cameraType: 'broadcast',
    clipsCount: 9
  }
];

// Live Matches (Current Live Round Ticker & Match Center)
export const INITIAL_LIVE_MATCHES: LiveMatch[] = [
  {
    id: 'live_1',
    roundNumber: 19,
    leagueId: 'l1',
    leagueNameAr: 'الدوري المصري الممتاز (دوري نايل)',
    homeTeamNameAr: 'الأهلي',
    awayTeamNameAr: 'بيراميدز',
    homeScore: 2,
    awayScore: 1,
    status: 'live',
    minute: 76,
    stadiumAr: 'استاد القاهرة الدولي',
    liveStats: {
      possessionHome: 56,
      possessionAway: 44,
      shotsHome: 14,
      shotsAway: 9,
      shotsOnTargetHome: 6,
      shotsOnTargetAway: 4,
      cornersHome: 7,
      cornersAway: 3,
      yellowCardsHome: 2,
      yellowCardsAway: 3,
      foulsHome: 11,
      foulsAway: 14
    },
    events: [
      { id: 'ev1', minute: 34, type: 'goal', team: 'home', playerAr: 'وسام أبو علي', detailAr: 'تسديدة يسارية من داخل الصندوق' },
      { id: 'ev2', minute: 48, type: 'goal', team: 'away', playerAr: 'مصطفى فتحي', detailAr: 'تسديدة مقوسة رائعة' },
      { id: 'ev3', minute: 61, type: 'goal', team: 'home', playerAr: 'إمام عاشور', detailAr: 'اختراق ومراوغة متقنة' },
      { id: 'ev4', minute: 71, type: 'yellow_card', team: 'away', playerAr: 'بلاتي توريه' }
    ],
    matchDate: 'اليوم',
    hasVideoFeed: true,
    videoUrl: '/videos/match-broadcast.mp4'
  },
  {
    id: 'live_2',
    roundNumber: 19,
    leagueId: 'l1',
    leagueNameAr: 'الدوري المصري الممتاز (دوري نايل)',
    homeTeamNameAr: 'الزمالك',
    awayTeamNameAr: 'المصري البورسعيدي',
    homeScore: 1,
    awayScore: 0,
    status: 'live',
    minute: 83,
    stadiumAr: 'استاد برج العرب بالإسكندرية',
    liveStats: {
      possessionHome: 52,
      possessionAway: 48,
      shotsHome: 11,
      shotsAway: 8,
      shotsOnTargetHome: 5,
      shotsOnTargetAway: 2,
      cornersHome: 5,
      cornersAway: 4,
      yellowCardsHome: 1,
      yellowCardsAway: 2,
      foulsHome: 9,
      foulsAway: 12
    },
    events: [
      { id: 'ev5', minute: 22, type: 'goal', team: 'home', playerAr: 'أحمد سيد زيزو', detailAr: 'ركلة جزاء متقنة' },
      { id: 'ev6', minute: 67, type: 'yellow_card', team: 'away', playerAr: 'باهر المحمدي' }
    ],
    matchDate: 'اليوم',
    hasVideoFeed: true,
    videoUrl: '/videos/match-action.mp4'
  },
  {
    id: 'live_3',
    roundNumber: 19,
    leagueId: 'l1',
    leagueNameAr: 'الدوري المصري الممتاز (دوري نايل)',
    homeTeamNameAr: 'سيراميكا كليوباترا',
    awayTeamNameAr: 'زد إف سي',
    homeScore: 1,
    awayScore: 1,
    status: 'live',
    minute: 63,
    stadiumAr: 'استاد المقاولون العرب',
    liveStats: {
      possessionHome: 49,
      possessionAway: 51,
      shotsHome: 8,
      shotsAway: 10,
      shotsOnTargetHome: 3,
      shotsOnTargetAway: 4,
      cornersHome: 4,
      cornersAway: 6,
      yellowCardsHome: 2,
      yellowCardsAway: 1,
      foulsHome: 13,
      foulsAway: 10
    },
    events: [
      { id: 'ev7', minute: 39, type: 'goal', team: 'home', playerAr: 'صديق أوجولا' },
      { id: 'ev8', minute: 54, type: 'goal', team: 'away', playerAr: 'شادي حسين' }
    ],
    matchDate: 'اليوم',
    hasVideoFeed: true,
    videoUrl: '/videos/match-dribble.mp4'
  },
  {
    id: 'live_4',
    roundNumber: 19,
    leagueId: 'l2',
    leagueNameAr: 'دوري المحترفين المصري (ديربي المحلة)',
    homeTeamNameAr: 'غزل المحلة',
    awayTeamNameAr: 'بلدية المحلة',
    homeScore: 2,
    awayScore: 1,
    status: 'live',
    minute: 89,
    stadiumAr: 'استاد غزل المحلة',
    liveStats: {
      possessionHome: 53,
      possessionAway: 47,
      shotsHome: 13,
      shotsAway: 11,
      shotsOnTargetHome: 6,
      shotsOnTargetAway: 4,
      cornersHome: 6,
      cornersAway: 5,
      yellowCardsHome: 3,
      yellowCardsAway: 4,
      foulsHome: 15,
      foulsAway: 16
    },
    events: [
      { id: 'ev9', minute: 28, type: 'goal', team: 'away', playerAr: 'إبراهيم عادل السيد', detailAr: 'صناعة هدف وانفراد سريع' },
      { id: 'ev10', minute: 54, type: 'goal', team: 'home', playerAr: 'مروان فايد حجازي', detailAr: 'رأسية بعد ركنية' },
      { id: 'ev11', minute: 76, type: 'goal', team: 'home', playerAr: 'بلال مظهر عبد القادر', detailAr: 'تسديدة قوية في الزاوية الضيقة' }
    ],
    matchDate: 'اليوم',
    hasVideoFeed: true,
    videoUrl: '/videos/match-broadcast.mp4'
  },
  {
    id: 'fin_1',
    roundNumber: 18,
    leagueId: 'l1',
    leagueNameAr: 'الدوري المصري الممتاز',
    homeTeamNameAr: 'الاتحاد السكندري',
    awayTeamNameAr: 'سموحة',
    homeScore: 1,
    awayScore: 0,
    status: 'finished',
    minute: 90,
    stadiumAr: 'استاد الإسكندرية',
    liveStats: {
      possessionHome: 54,
      possessionAway: 46,
      shotsHome: 10,
      shotsAway: 7,
      shotsOnTargetHome: 4,
      shotsOnTargetAway: 2,
      cornersHome: 4,
      cornersAway: 3,
      yellowCardsHome: 2,
      yellowCardsAway: 2,
      foulsHome: 12,
      foulsAway: 11
    },
    events: [
      { id: 'ev12', minute: 81, type: 'goal', team: 'home', playerAr: 'مابولولو' }
    ],
    matchDate: 'أمس',
    hasVideoFeed: true,
    videoUrl: '/videos/match-action.mp4'
  },
  {
    id: 'fin_2',
    roundNumber: 18,
    leagueId: 'l1',
    leagueNameAr: 'الدوري المصري الممتاز',
    homeTeamNameAr: 'مودرن سبورت',
    awayTeamNameAr: 'البنك الأهلي',
    homeScore: 2,
    awayScore: 2,
    status: 'finished',
    minute: 90,
    stadiumAr: 'استاد السلام',
    liveStats: {
      possessionHome: 50,
      possessionAway: 50,
      shotsHome: 12,
      shotsAway: 13,
      shotsOnTargetHome: 5,
      shotsOnTargetAway: 6,
      cornersHome: 5,
      cornersAway: 6,
      yellowCardsHome: 2,
      yellowCardsAway: 3,
      foulsHome: 14,
      foulsAway: 13
    },
    events: [
      { id: 'ev13', minute: 18, type: 'goal', team: 'home', playerAr: 'أحمد عاطف' },
      { id: 'ev14', minute: 44, type: 'goal', team: 'away', playerAr: 'أسامة فيصل' },
      { id: 'ev15', minute: 72, type: 'goal', team: 'home', playerAr: 'علي زعزع' },
      { id: 'ev16', minute: 88, type: 'goal', team: 'away', playerAr: 'كريم بامبو' }
    ],
    matchDate: 'أمس',
    hasVideoFeed: true,
    videoUrl: '/videos/match-dribble.mp4'
  },
  {
    id: 'live_tier3_1',
    roundNumber: 15,
    leagueId: 'l3',
    leagueNameAr: 'دوري القسم الثاني (ب) بحري',
    homeTeamNameAr: 'كفر الشيخ',
    awayTeamNameAr: 'ألعاب دمنهور',
    homeScore: 1,
    awayScore: 0,
    status: 'live',
    minute: 71,
    stadiumAr: 'استاد كفر الشيخ الرياضي',
    liveStats: {
      possessionHome: 52,
      possessionAway: 48,
      shotsHome: 9,
      shotsAway: 6,
      shotsOnTargetHome: 4,
      shotsOnTargetAway: 2,
      cornersHome: 4,
      cornersAway: 3,
      yellowCardsHome: 2,
      yellowCardsAway: 3,
      foulsHome: 14,
      foulsAway: 15
    },
    events: [
      { id: 'ev_t3_1', minute: 58, type: 'goal', team: 'home', playerAr: 'محمد مجدي السعيد', detailAr: 'تسديدة أرضية زاحفة' }
    ],
    matchDate: 'اليوم',
    hasVideoFeed: true,
    videoUrl: '/videos/match-action.mp4'
  },
  {
    id: 'live_tier4_1',
    roundNumber: 13,
    leagueId: 'l5',
    leagueNameAr: 'دوري القسم الثالث (الأقاليم والمراكز)',
    homeTeamNameAr: 'مركز شباب بيلا',
    awayTeamNameAr: 'نادي دسوق',
    homeScore: 2,
    awayScore: 1,
    status: 'live',
    minute: 85,
    stadiumAr: 'ملعب مركز شباب بيلا',
    liveStats: {
      possessionHome: 51,
      possessionAway: 49,
      shotsHome: 8,
      shotsAway: 7,
      shotsOnTargetHome: 4,
      shotsOnTargetAway: 3,
      cornersHome: 3,
      cornersAway: 4,
      yellowCardsHome: 1,
      yellowCardsAway: 2,
      foulsHome: 16,
      foulsAway: 18
    },
    events: [
      { id: 'ev_t4_1', minute: 19, type: 'goal', team: 'away', playerAr: 'أحمد الصاوي' },
      { id: 'ev_t4_2', minute: 42, type: 'goal', team: 'home', playerAr: 'حسام رمضان' },
      { id: 'ev_t4_3', minute: 74, type: 'goal', team: 'home', playerAr: 'إبراهيم يوسف' }
    ],
    matchDate: 'اليوم',
    hasVideoFeed: true,
    videoUrl: '/videos/match-dribble.mp4'
  },
  {
    id: 'live_tier4_2',
    roundNumber: 13,
    leagueId: 'l5',
    leagueNameAr: 'دوري القسم الثالث (الصعيد والقناة)',
    homeTeamNameAr: 'نادي زفتى',
    awayTeamNameAr: 'ميت غمر',
    homeScore: 1,
    awayScore: 1,
    status: 'live',
    minute: 68,
    stadiumAr: 'استاد زفتى الرياضي',
    liveStats: {
      possessionHome: 50,
      possessionAway: 50,
      shotsHome: 7,
      shotsAway: 8,
      shotsOnTargetHome: 3,
      shotsOnTargetAway: 3,
      cornersHome: 5,
      cornersAway: 3,
      yellowCardsHome: 2,
      yellowCardsAway: 1,
      foulsHome: 12,
      foulsAway: 11
    },
    events: [
      { id: 'ev_t4_4', minute: 31, type: 'goal', team: 'home', playerAr: 'محمود عبد المنعم' },
      { id: 'ev_t4_5', minute: 61, type: 'goal', team: 'away', playerAr: 'طارق رضوان' }
    ],
    matchDate: 'اليوم',
    hasVideoFeed: true,
    videoUrl: '/videos/match-broadcast.mp4'
  },
  {
    id: 'live_tier2_2',
    roundNumber: 16,
    leagueId: 'l2',
    leagueNameAr: 'دوري المحترفين (قمة الصعود)',
    homeTeamNameAr: 'وادي دجلة',
    awayTeamNameAr: 'لافيينا إف سي',
    homeScore: 1,
    awayScore: 1,
    status: 'live',
    minute: 72,
    stadiumAr: 'استاد السلام الدولي',
    liveStats: {
      possessionHome: 54,
      possessionAway: 46,
      shotsHome: 10,
      shotsAway: 8,
      shotsOnTargetHome: 4,
      shotsOnTargetAway: 3,
      cornersHome: 5,
      cornersAway: 4,
      yellowCardsHome: 2,
      yellowCardsAway: 3,
      foulsHome: 11,
      foulsAway: 13
    },
    events: [
      { id: 'ev_t2_3', minute: 33, type: 'goal', team: 'away', playerAr: 'زياد كمال منصور', detailAr: 'صاروخية بعيدة المدى' },
      { id: 'ev_t2_4', minute: 64, type: 'goal', team: 'home', playerAr: 'سيف عمرو الغندور', detailAr: 'متابعة ركنية متقنة' }
    ],
    matchDate: 'اليوم',
    hasVideoFeed: true,
    videoUrl: '/videos/match-action.mp4'
  },
  {
    id: 'live_tier3_2',
    roundNumber: 15,
    leagueId: 'l3',
    leagueNameAr: 'دوري القسم الثاني (ب) الدلتا',
    homeTeamNameAr: 'نادي دكرنس',
    awayTeamNameAr: 'نادي بلقاس',
    homeScore: 2,
    awayScore: 2,
    status: 'live',
    minute: 84,
    stadiumAr: 'ملعب حمدينو عبد الجليل بدكرنس',
    liveStats: {
      possessionHome: 48,
      possessionAway: 52,
      shotsHome: 9,
      shotsAway: 11,
      shotsOnTargetHome: 5,
      shotsOnTargetAway: 6,
      cornersHome: 4,
      cornersAway: 5,
      yellowCardsHome: 3,
      yellowCardsAway: 2,
      foulsHome: 16,
      foulsAway: 14
    },
    events: [
      { id: 'ev_t3_3', minute: 14, type: 'goal', team: 'home', playerAr: 'أحمد العش' },
      { id: 'ev_t3_4', minute: 38, type: 'goal', team: 'away', playerAr: 'محمد عبد الرازق' },
      { id: 'ev_t3_5', minute: 57, type: 'goal', team: 'home', playerAr: 'عادل السعيد' },
      { id: 'ev_t3_6', minute: 79, type: 'goal', team: 'away', playerAr: 'كريم البنداري' }
    ],
    matchDate: 'اليوم',
    hasVideoFeed: true,
    videoUrl: '/videos/match-dribble.mp4'
  },
  {
    id: 'live_tier4_3',
    roundNumber: 13,
    leagueId: 'l5',
    leagueNameAr: 'دوري القسم الثالث (مجموعة الصعيد)',
    homeTeamNameAr: 'نادي قوص',
    awayTeamNameAr: 'مركز شباب مغاغة',
    homeScore: 2,
    awayScore: 0,
    status: 'live',
    minute: 77,
    stadiumAr: 'ملعب مركز شباب قوص',
    liveStats: {
      possessionHome: 57,
      possessionAway: 43,
      shotsHome: 12,
      shotsAway: 5,
      shotsOnTargetHome: 6,
      shotsOnTargetAway: 1,
      cornersHome: 6,
      cornersAway: 2,
      yellowCardsHome: 1,
      yellowCardsAway: 4,
      foulsHome: 10,
      foulsAway: 17
    },
    events: [
      { id: 'ev_t4_6', minute: 23, type: 'goal', team: 'home', playerAr: 'عبد الله الحجاوي' },
      { id: 'ev_t4_7', minute: 51, type: 'goal', team: 'home', playerAr: 'ياسين قناوي' }
    ],
    matchDate: 'اليوم',
    hasVideoFeed: true,
    videoUrl: '/videos/match-broadcast.mp4'
  }
];

// الدوري المصري الممتاز (دوري أورا) 2026/2027 - ترتيب بعد الجولة السادسة (أكتوبر 2026)
// مصدر: btolat.com / roayahnews.com - بيانات حقيقية ودقيقة
export const EGYPTIAN_PREMIER_STANDINGS: LeagueStanding[] = [
  { rank: 1, teamNameAr: 'بيراميدز', played: 6, won: 6, drawn: 0, lost: 0, goalsFor: 13, goalsAgainst: 2, goalDifference: 11, points: 18, form: ['W', 'W', 'W', 'W', 'W'] },
  { rank: 2, teamNameAr: 'الأهلي', played: 6, won: 5, drawn: 1, lost: 0, goalsFor: 11, goalsAgainst: 3, goalDifference: 8, points: 16, form: ['W', 'W', 'W', 'D', 'W'] },
  { rank: 3, teamNameAr: 'الزمالك', played: 6, won: 4, drawn: 1, lost: 1, goalsFor: 8, goalsAgainst: 3, goalDifference: 5, points: 13, form: ['W', 'W', 'D', 'W', 'L'] },
  { rank: 4, teamNameAr: 'مودرن سبورت', played: 6, won: 4, drawn: 1, lost: 1, goalsFor: 10, goalsAgainst: 6, goalDifference: 4, points: 13, form: ['W', 'W', 'D', 'L', 'W'] },
  { rank: 5, teamNameAr: 'سيراميكا كليوباترا', played: 6, won: 4, drawn: 0, lost: 2, goalsFor: 11, goalsAgainst: 7, goalDifference: 4, points: 12, form: ['W', 'W', 'L', 'W', 'L'] },
  { rank: 6, teamNameAr: 'الاتحاد السكندري', played: 5, won: 3, drawn: 1, lost: 1, goalsFor: 6, goalsAgainst: 3, goalDifference: 3, points: 10, form: ['W', 'D', 'W', 'L', 'W'] },
  { rank: 7, teamNameAr: 'البنك الأهلي', played: 6, won: 3, drawn: 0, lost: 3, goalsFor: 7, goalsAgainst: 7, goalDifference: 0, points: 9, form: ['W', 'L', 'W', 'L', 'W'] },
  { rank: 8, teamNameAr: 'المقاولون العرب', played: 6, won: 2, drawn: 2, lost: 2, goalsFor: 7, goalsAgainst: 6, goalDifference: 1, points: 8, form: ['D', 'W', 'L', 'D', 'W'] },
  { rank: 9, teamNameAr: 'زد إف سي', played: 6, won: 2, drawn: 2, lost: 2, goalsFor: 5, goalsAgainst: 6, goalDifference: -1, points: 8, form: ['D', 'W', 'L', 'D', 'L'] },
  { rank: 10, teamNameAr: 'بتروجت', played: 5, won: 2, drawn: 1, lost: 2, goalsFor: 8, goalsAgainst: 8, goalDifference: 0, points: 7, form: ['W', 'L', 'D', 'W', 'L'] },
  { rank: 11, teamNameAr: 'القناة', played: 6, won: 1, drawn: 4, lost: 1, goalsFor: 6, goalsAgainst: 6, goalDifference: 0, points: 7, form: ['D', 'D', 'D', 'W', 'D'] },
  { rank: 12, teamNameAr: 'المصري البورسعيدي', played: 6, won: 2, drawn: 1, lost: 3, goalsFor: 6, goalsAgainst: 8, goalDifference: -2, points: 7, form: ['L', 'W', 'L', 'D', 'W'] },
  { rank: 13, teamNameAr: 'سموحة', played: 6, won: 2, drawn: 1, lost: 3, goalsFor: 2, goalsAgainst: 4, goalDifference: -2, points: 7, form: ['L', 'W', 'D', 'L', 'W'] },
  { rank: 14, teamNameAr: 'طلائع الجيش', played: 6, won: 2, drawn: 1, lost: 3, goalsFor: 5, goalsAgainst: 8, goalDifference: -3, points: 7, form: ['L', 'W', 'L', 'D', 'W'] },
  { rank: 15, teamNameAr: 'وادي دجلة', played: 5, won: 1, drawn: 2, lost: 2, goalsFor: 4, goalsAgainst: 5, goalDifference: -1, points: 5, form: ['D', 'L', 'W', 'D', 'L'] },
  { rank: 16, teamNameAr: 'بترول أسيوط', played: 6, won: 1, drawn: 2, lost: 3, goalsFor: 3, goalsAgainst: 6, goalDifference: -3, points: 5, form: ['D', 'L', 'W', 'L', 'D'] },
  { rank: 17, teamNameAr: 'إنبي', played: 6, won: 1, drawn: 1, lost: 4, goalsFor: 8, goalsAgainst: 12, goalDifference: -4, points: 4, form: ['L', 'L', 'W', 'L', 'D'] },
  { rank: 18, teamNameAr: 'أبو قير للأسمدة', played: 6, won: 1, drawn: 0, lost: 5, goalsFor: 2, goalsAgainst: 10, goalDifference: -8, points: 3, form: ['L', 'L', 'L', 'W', 'L'] },
  { rank: 19, teamNameAr: 'الجونة', played: 5, won: 0, drawn: 2, lost: 3, goalsFor: 3, goalsAgainst: 6, goalDifference: -3, points: 2, form: ['D', 'L', 'D', 'L', 'L'] },
  { rank: 20, teamNameAr: 'غزل المحلة', played: 6, won: 0, drawn: 1, lost: 5, goalsFor: 2, goalsAgainst: 11, goalDifference: -9, points: 1, form: ['L', 'L', 'D', 'L', 'L'] }
];

// لا تتوفر حالياً بيانات رسمية لدوري المحترفين 2026/2027 - هذه بيانات موسم 2025/2026 النهائي كمرجع
export const EGYPTIAN_PRO_STANDINGS: LeagueStanding[] = [
  { rank: 1, teamNameAr: 'حرس الحدود', played: 16, won: 10, drawn: 4, lost: 2, goalsFor: 26, goalsAgainst: 11, goalDifference: 15, points: 34, form: ['W', 'W', 'D', 'W', 'W'] },
  { rank: 2, teamNameAr: 'لافيينا إف سي', played: 16, won: 9, drawn: 5, lost: 2, goalsFor: 24, goalsAgainst: 12, goalDifference: 12, points: 32, form: ['W', 'D', 'W', 'W', 'D'] },
  { rank: 3, teamNameAr: 'طنطا الرياضي', played: 16, won: 9, drawn: 4, lost: 3, goalsFor: 22, goalsAgainst: 13, goalDifference: 9, points: 31, form: ['W', 'W', 'D', 'L', 'W'] },
  { rank: 4, teamNameAr: 'المنصورة', played: 16, won: 8, drawn: 5, lost: 3, goalsFor: 20, goalsAgainst: 14, goalDifference: 6, points: 29, form: ['D', 'W', 'W', 'D', 'W'] },
  { rank: 5, teamNameAr: 'نادي أسوان', played: 16, won: 7, drawn: 5, lost: 4, goalsFor: 18, goalsAgainst: 15, goalDifference: 3, points: 26, form: ['W', 'D', 'L', 'W', 'D'] },
  { rank: 6, teamNameAr: 'المصرية للاتصالات (WE)', played: 16, won: 7, drawn: 4, lost: 5, goalsFor: 17, goalsAgainst: 16, goalDifference: 1, points: 25, form: ['L', 'W', 'D', 'W', 'L'] },
  { rank: 7, teamNameAr: 'بلدية المحلة', played: 16, won: 6, drawn: 5, lost: 5, goalsFor: 16, goalsAgainst: 17, goalDifference: -1, points: 23, form: ['D', 'L', 'W', 'D', 'W'] },
  { rank: 8, teamNameAr: 'الإسماعيلي', played: 16, won: 5, drawn: 6, lost: 5, goalsFor: 15, goalsAgainst: 16, goalDifference: -1, points: 21, form: ['D', 'D', 'L', 'W', 'D'] }
];

// دوري القسم الثاني ب - بحري والقناة والصعيد (2026/2027)
export const EGYPTIAN_SECOND_B_STANDINGS: LeagueStanding[] = [
  { rank: 1, teamNameAr: 'كفر الشيخ', played: 6, won: 5, drawn: 1, lost: 0, goalsFor: 12, goalsAgainst: 3, goalDifference: 9, points: 16, form: ['W', 'W', 'D', 'W', 'W'] },
  { rank: 2, teamNameAr: 'ألعاب دمنهور', played: 6, won: 4, drawn: 2, lost: 0, goalsFor: 10, goalsAgainst: 4, goalDifference: 6, points: 14, form: ['W', 'D', 'W', 'W', 'D'] },
  { rank: 3, teamNameAr: 'نادي دكرنس', played: 6, won: 4, drawn: 1, lost: 1, goalsFor: 9, goalsAgainst: 5, goalDifference: 4, points: 13, form: ['L', 'W', 'W', 'D', 'W'] },
  { rank: 4, teamNameAr: 'المنيا الرياضي', played: 6, won: 3, drawn: 2, lost: 1, goalsFor: 8, goalsAgainst: 5, goalDifference: 3, points: 11, form: ['W', 'D', 'W', 'D', 'L'] },
  { rank: 5, teamNameAr: 'نادي الفيوم', played: 6, won: 3, drawn: 1, lost: 2, goalsFor: 7, goalsAgainst: 6, goalDifference: 1, points: 10, form: ['D', 'W', 'L', 'W', 'W'] },
  { rank: 6, teamNameAr: 'نادي بلقاس', played: 6, won: 2, drawn: 3, lost: 1, goalsFor: 6, goalsAgainst: 5, goalDifference: 1, points: 9, form: ['W', 'D', 'D', 'D', 'L'] },
  { rank: 7, teamNameAr: 'سوهاج الرياضي', played: 6, won: 2, drawn: 2, lost: 2, goalsFor: 5, goalsAgainst: 6, goalDifference: -1, points: 8, form: ['D', 'W', 'L', 'D', 'W'] },
  { rank: 8, teamNameAr: 'المريخ البورسعيدي', played: 6, won: 1, drawn: 2, lost: 3, goalsFor: 4, goalsAgainst: 7, goalDifference: -3, points: 5, form: ['L', 'D', 'L', 'W', 'D'] },
  { rank: 9, teamNameAr: 'الإنتاج الحربي', played: 6, won: 1, drawn: 1, lost: 4, goalsFor: 3, goalsAgainst: 8, goalDifference: -5, points: 4, form: ['L', 'L', 'W', 'L', 'D'] },
  { rank: 10, teamNameAr: 'نادي النجوم', played: 6, won: 0, drawn: 2, lost: 4, goalsFor: 2, goalsAgainst: 9, goalDifference: -7, points: 2, form: ['L', 'D', 'L', 'D', 'L'] }
];

// دوري القسم الثالث - مراكز الشباب والأندية الإقليمية (2026/2027)
export const EGYPTIAN_THIRD_DIV_STANDINGS: LeagueStanding[] = [
  { rank: 1, teamNameAr: 'مركز شباب بيلا', played: 5, won: 4, drawn: 1, lost: 0, goalsFor: 10, goalsAgainst: 3, goalDifference: 7, points: 13, form: ['W', 'W', 'W', 'D', 'W'] },
  { rank: 2, teamNameAr: 'نادي دسوق', played: 5, won: 3, drawn: 2, lost: 0, goalsFor: 8, goalsAgainst: 3, goalDifference: 5, points: 11, form: ['W', 'D', 'W', 'W', 'D'] },
  { rank: 3, teamNameAr: 'نادي زفتى', played: 5, won: 3, drawn: 1, lost: 1, goalsFor: 7, goalsAgainst: 4, goalDifference: 3, points: 10, form: ['W', 'W', 'L', 'W', 'D'] },
  { rank: 4, teamNameAr: 'نادي قوص', played: 5, won: 3, drawn: 1, lost: 1, goalsFor: 6, goalsAgainst: 4, goalDifference: 2, points: 10, form: ['D', 'W', 'W', 'L', 'W'] },
  { rank: 5, teamNameAr: 'ميت غمر', played: 5, won: 2, drawn: 2, lost: 1, goalsFor: 5, goalsAgainst: 4, goalDifference: 1, points: 8, form: ['W', 'D', 'L', 'W', 'D'] },
  { rank: 6, teamNameAr: 'نادي الأقصر', played: 5, won: 2, drawn: 1, lost: 2, goalsFor: 5, goalsAgainst: 5, goalDifference: 0, points: 7, form: ['L', 'W', 'D', 'L', 'W'] },
  { rank: 7, teamNameAr: 'رأس البر', played: 5, won: 1, drawn: 2, lost: 2, goalsFor: 4, goalsAgainst: 6, goalDifference: -2, points: 5, form: ['D', 'L', 'D', 'W', 'L'] },
  { rank: 8, teamNameAr: 'مركز شباب كوم حمادة', played: 5, won: 0, drawn: 1, lost: 4, goalsFor: 2, goalsAgainst: 9, goalDifference: -7, points: 1, form: ['L', 'L', 'D', 'L', 'L'] }
];

// 5. Review Queue Suggested Events with realistic Egyptian match timestamps
export const INITIAL_SUGGESTED_EVENTS: TaggedEvent[] = [
  {
    id: 'evt_1',
    matchId: 'm1',
    playerId: 'p_gem_1',
    playerName: 'إبراهيم عادل السيد',
    type: 'progressive_pass',
    typeAr: 'تمريرة تقدمية وانفراد وصناعة هدف (ديربي المحلة)',
    startTime: 28.0,
    endTime: 48.0,
    pitchX: 44.0,
    pitchY: 56.0,
    source: 'auto',
    confidence: 0.94,
    status: 'suggested',
    detectorType: 'MOCK',
    hasTelestration: true
  },
  {
    id: 'evt_2',
    matchId: 'm1',
    playerId: 'p_gem_5',
    playerName: 'مروان فايد حجازي',
    type: 'interception',
    typeAr: 'افتكاك وضغط عكسي واستخلاص تحت الضغط',
    startTime: 75.0,
    endTime: 95.0,
    pitchX: 52.0,
    pitchY: 60.0,
    source: 'auto',
    confidence: 0.89,
    status: 'suggested',
    detectorType: 'MOCK',
    hasTelestration: true
  },
  {
    id: 'evt_3',
    matchId: 'm1',
    playerId: 'p_gem_2',
    playerName: 'بلال مظهر عبد القادر',
    type: 'box_entry',
    typeAr: 'اختراق منطقة الجزاء وتسجيل هدف رائع',
    startTime: 140.0,
    endTime: 170.0,
    pitchX: 68.0,
    pitchY: 44.0,
    source: 'auto',
    confidence: 0.96,
    status: 'suggested',
    detectorType: 'MOCK',
    hasTelestration: true
  },
  {
    id: 'evt_4',
    matchId: 'm2',
    playerId: 'p_gem_4',
    playerName: 'زياد كمال منصور',
    type: 'dribble',
    typeAr: 'بناء هجمة ومراوغة في الثلث الأخير لوادي دجلة',
    startTime: 25.0,
    endTime: 50.0,
    pitchX: 48.0,
    pitchY: 38.0,
    source: 'auto',
    confidence: 0.92,
    status: 'suggested',
    detectorType: 'MOCK',
    hasTelestration: true
  },
  {
    id: 'evt_5',
    matchId: 'm3',
    playerId: 'p_gem_3',
    playerName: 'يوسف عمرو الدالي (موهبة الأشبال)',
    type: 'progressive_pass',
    typeAr: 'تحول هجومي سريع وانطلاقة عمودية',
    startTime: 18.0,
    endTime: 45.0,
    pitchX: 55.0,
    pitchY: 42.0,
    source: 'auto',
    confidence: 0.95,
    status: 'suggested',
    detectorType: 'MOCK',
    hasTelestration: true
  }
];

// 6. Recruitment Board Needs with realistic salaries
export const INITIAL_RECRUITMENT_NEEDS: RecruitmentNeed[] = [
  {
    id: 'need_1',
    title: 'Left-Footed Center-Back (U21)',
    titleAr: 'مدافع أعسر يلعب بالقدم اليسرى (تحت 21 سنة)',
    positionGroup: 'CB',
    targetFoot: 'left',
    maxAge: 21,
    minTier: 1,
    maxTier: 3,
    maxMonthlySalaryEgp: 18000,
    maxTransferFeeEgp: 400000,
    candidates: [
      {
        playerId: 'p_gem_5',
        stage: 'trial',
        fitScore: 94.2,
        fitReason: 'قدم يسرى مميزة، تفوق هوائي بنسبة 88%، راتب شهري 9,500 ج.م فقط من كفر الشيخ.',
        addedAt: '2026-10-03'
      },
      {
        playerId: 'p_gem_9',
        stage: 'monitoring',
        fitScore: 82.5,
        fitReason: 'قوة بدنية عالية، سرعة مقبولة، راتب شهري 25,000 ج.م مع نادي أسوان.',
        addedAt: '2026-10-04'
      }
    ]
  },
  {
    id: 'need_2',
    title: 'Ball-Carrying Midfielder (Box-to-Box)',
    titleAr: 'لاعب وسط حامل للكرة وقاطع هجمات (Box-to-Box)',
    positionGroup: 'DM_CM',
    targetFoot: 'both',
    maxAge: 22,
    minTier: 1,
    maxTier: 2,
    maxMonthlySalaryEgp: 25000,
    maxTransferFeeEgp: 700000,
    candidates: [
      {
        playerId: 'p_gem_4',
        stage: 'contacted',
        fitScore: 91.0,
        fitReason: 'معدل افتكاك 4.2 وتمرير طولي دقيق، متطابق في طريقة اللعب كمرجع تكتيكي مع كانتي/رودري، راتب 22 ألف ج.م.',
        addedAt: '2026-10-02'
      },
      {
        playerId: 'p_gem_8',
        stage: 'negotiating',
        fitScore: 86.4,
        fitReason: 'يلعب بكلتا القدمين، نضج تكتيكي ومرونة في التمركز كـ 6 أو 8، راتب 20 ألف ج.م.',
        addedAt: '2026-10-05'
      }
    ]
  },
  {
    id: 'need_3',
    title: 'Explosive Direct Winger (U20)',
    titleAr: 'جناح هجومي مباشر وسريع (تحت 20 سنة)',
    positionGroup: 'AM_W',
    targetFoot: 'left',
    maxAge: 20,
    minTier: 1,
    maxTier: 3,
    maxMonthlySalaryEgp: 20000,
    maxTransferFeeEgp: 500000,
    candidates: [
      {
        playerId: 'p_gem_1',
        stage: 'negotiating',
        fitScore: 96.5,
        fitReason: 'الأعلى تقييماً في مؤشر MUI (89.2). مراوغ بنسبة 84% وراتب 18 ألف ج.م.',
        addedAt: '2026-10-01'
      },
      {
        playerId: 'p_gem_3',
        stage: 'spotted',
        fitScore: 92.0,
        fitReason: 'موهبة أشبال خارقة (15 سنة) في بلدية المحلة، سجل 14 هدفاً، راتب رمزي 4 آلاف ج.م.',
        addedAt: '2026-10-06'
      }
    ]
  }
];

class ScoutZeroStore {
  private players: Player[] = [];
  private evaluations: Evaluation[] = [];
  private matches: MatchVideo[] = [...MATCHES];
  private events: TaggedEvent[] = [...INITIAL_SUGGESTED_EVENTS];
  private recruitmentNeeds: RecruitmentNeed[] = [...INITIAL_RECRUITMENT_NEEDS];

  constructor() {
    this.players = generateInitialPlayers();
    this.evaluations = generateInitialEvaluations(this.players);
  }

  getPlayers(filters?: {
    search?: string;
    position?: string;
    tier?: number;
    foot?: string;
    maxAge?: number;
    ageCategory?: string;
    governorate?: string;
    pipelineStatus?: string;
    minMui?: number;
    maxSalary?: number;
  }): Player[] {
    let list = [...this.players];
    if (!filters) return list;

    if (filters.search) {
      const q = filters.search.toLowerCase();
      list = list.filter(p => 
        p.nameEn.toLowerCase().includes(q) ||
        p.nameAr.includes(q) ||
        p.teamNameEn.toLowerCase().includes(q) ||
        p.teamNameAr.includes(q) ||
        p.academyOrigin.includes(q) ||
        p.cityDistrict.includes(q)
      );
    }

    if (filters.position && filters.position !== 'all') {
      list = list.filter(p => p.positionPrimary === filters.position || p.positions.includes(filters.position!));
    }

    if (filters.tier && filters.tier !== 0) {
      list = list.filter(p => p.leagueTier === Number(filters.tier));
    }

    if (filters.foot && filters.foot !== 'all') {
      list = list.filter(p => p.preferredFoot === filters.foot || p.preferredFoot === 'both');
    }

    if (filters.maxAge) {
      list = list.filter(p => p.age <= Number(filters.maxAge));
    }

    if (filters.ageCategory && filters.ageCategory !== 'all') {
      list = list.filter(p => p.ageCategory === filters.ageCategory);
    }

    if (filters.governorate && filters.governorate !== 'all') {
      list = list.filter(p => p.governorate === filters.governorate);
    }

    if (filters.pipelineStatus && filters.pipelineStatus !== 'all') {
      list = list.filter(p => p.pipelineStatus === filters.pipelineStatus);
    }

    if (filters.minMui) {
      list = list.filter(p => p.mui.score >= Number(filters.minMui));
    }

    if (filters.maxSalary) {
      list = list.filter(p => p.monthlySalaryEgp <= Number(filters.maxSalary));
    }

    return list;
  }

  getPlayerById(id: string): Player | undefined {
    return this.players.find(p => p.id === id);
  }

  addPlayer(data: Partial<Player>): Player {
    const age = data.dateOfBirth ? (2026 - parseInt(data.dateOfBirth.split('-')[0])) : (data.age || 18);
    const pos = data.positionPrimary || 'CM';
    const posGroup = POSITION_GROUPS[pos] || 'DM_CM';
    const team = TEAMS.find(t => t.id === data.currentTeamId) || TEAMS[0];

    const category: Player['ageCategory'] = 
      age <= 15 ? 'أشبال (U15)' :
      age <= 17 ? 'ناشئين (U17)' :
      age <= 19 ? 'شباب (U19)' :
      age <= 21 ? 'أولمبي (U21)' : 'فريق أول';

    const salary = data.monthlySalaryEgp || 8000;
    const clause = salary * 24;

    const mui = calculateMui({
      minutes: data.minutesPlayed || 450,
      tier: team.tier,
      age,
      positionGroup: posGroup,
      estimatedValue: clause,
      ratingsOverall: data.ratingsOverall || 7.0
    });

    const archetypes = matchPlayerToArchetypes({
      pace: (data.ratingsOverall || 7) * 9,
      passing: (data.ratingsOverall || 7) * 9
    }, posGroup);

    const newPlayer: Player = {
      id: `p_user_${Date.now()}`,
      nameEn: data.nameEn || 'New Player',
      nameAr: data.nameAr || 'لاعب جديد',
      jerseyNumber: data.jerseyNumber || 10,
      dateOfBirth: data.dateOfBirth || `${2026 - age}-01-01`,
      age,
      ageCategory: category,
      positionPrimary: pos,
      positions: [pos],
      preferredFoot: data.preferredFoot || 'right',
      height: data.height || 178,
      weight: data.weight || 72,
      governorate: data.governorate || team.governorate,
      cityDistrict: data.cityDistrict || 'حي الدقي',
      academyOrigin: data.academyOrigin || 'مركز شباب محلي',
      currentTeamId: team.id,
      teamNameEn: team.name,
      teamNameAr: team.nameAr,
      leagueTier: team.tier,
      contractStatus: data.contractStatus || 'active',
      monthlySalaryEgp: salary,
      contractClauseEgp: clause,
      valueSource: 'عقد محلي موثق',
      pipelineStatus: data.pipelineStatus || 'spotted',
      tags: [category, `راتب: ${salary.toLocaleString('ar-EG')} ج.م`],
      ratingsOverall: data.ratingsOverall || 7.0,
      detailedStats: {
        goals: 0,
        assists: 0,
        yellowCards: 0,
        progressivePassesPer90: 3.5,
        tacklesPer90: 2.0,
        dribbleSuccessPct: 65,
        aerialDuelsWonPct: 60
      },
      clips: createSampleClips(data.nameAr || 'لاعب جديد'),
      mui,
      topArchetype: archetypes[0],
      minutesPlayed: data.minutesPlayed || 450,
      isSynthetic: false,
      dataSource: 'manual'
    };

    this.players.unshift(newPlayer);
    return newPlayer;
  }

  getEvaluationsForPlayer(playerId: string): Evaluation[] {
    return this.evaluations.filter(e => e.playerId === playerId);
  }

  addEvaluation(data: Omit<Evaluation, 'id'>): Evaluation {
    const newEval: Evaluation = {
      id: `eval_${Date.now()}`,
      ...data
    };
    this.evaluations.unshift(newEval);

    const player = this.getPlayerById(data.playerId);
    if (player) {
      player.ratingsOverall = Number(((player.ratingsOverall + data.ratingsOverall) / 2).toFixed(1));
    }
    return newEval;
  }

  getMatches(): MatchVideo[] {
    return this.matches;
  }

  getMatchById(id: string): MatchVideo | undefined {
    return this.matches.find(m => m.id === id);
  }

  getReviewQueue(): TaggedEvent[] {
    return this.events;
  }

  confirmEvent(id: string): TaggedEvent | undefined {
    const evt = this.events.find(e => e.id === id);
    if (evt) {
      evt.status = 'confirmed';
    }
    return evt;
  }

  rejectEvent(id: string): TaggedEvent | undefined {
    const evt = this.events.find(e => e.id === id);
    if (evt) {
      evt.status = 'rejected';
    }
    return evt;
  }

  getRecruitmentNeeds(): RecruitmentNeed[] {
    return this.recruitmentNeeds;
  }

  addRecruitmentNeed(need: Omit<RecruitmentNeed, 'id' | 'candidates'>): RecruitmentNeed {
    const newNeed: RecruitmentNeed = {
      id: `need_${Date.now()}`,
      ...need,
      candidates: []
    };
    this.recruitmentNeeds.push(newNeed);
    return newNeed;
  }

  updateCandidateStage(
    needId: string,
    playerId: string,
    newStage: RecruitmentNeed['candidates'][0]['stage']
  ) {
    const need = this.recruitmentNeeds.find(n => n.id === needId);
    if (!need) return;

    const candidate = need.candidates.find(c => c.playerId === playerId);
    if (candidate) {
      candidate.stage = newStage;
    }

    const player = this.getPlayerById(playerId);
    if (player) {
      player.pipelineStatus = newStage;
    }
  }

  getDashboardStats() {
    const totalPlayers = this.players.length;
    const ashbalCount = this.players.filter(p => p.ageCategory === 'أشبال (U15)').length;
    const youthCount = this.players.filter(p => p.age <= 19).length;
    const tier1Count = this.players.filter(p => p.leagueTier === 1).length;
    const tier2Count = this.players.filter(p => p.leagueTier === 2).length;
    const tier3Count = this.players.filter(p => p.leagueTier === 3).length;
    const tier4Count = this.players.filter(p => p.leagueTier === 4).length;
    const tier2And3Count = this.players.filter(p => p.leagueTier === 2 || p.leagueTier === 3).length;
    const lowerTiersCount = this.players.filter(p => p.leagueTier >= 2).length;
    const pendingReviews = this.events.filter(e => e.status === 'suggested').length;
    const totalEvaluations = this.evaluations.length;
    const topUndervalued = [...this.players]
      .sort((a, b) => b.mui.score - a.mui.score)
      .slice(0, 5);

    const govCounts: Record<string, number> = {};
    this.players.forEach(p => {
      govCounts[p.governorate] = (govCounts[p.governorate] || 0) + 1;
    });

    return {
      totalPlayers,
      ashbalCount,
      youthCount,
      tier1Count,
      tier2Count,
      tier3Count,
      tier4Count,
      tier2And3Count,
      lowerTiersCount,
      pendingReviews,
      totalEvaluations,
      topUndervalued,
      govCounts,
      recentMatches: this.matches
    };
  }

  getLiveMatches(): LiveMatch[] {
    return INITIAL_LIVE_MATCHES;
  }

  getPremierStandings(): LeagueStanding[] {
    return EGYPTIAN_PREMIER_STANDINGS;
  }

  getProStandings(): LeagueStanding[] {
    return EGYPTIAN_PRO_STANDINGS;
  }

  getSecondBStandings(): LeagueStanding[] {
    return EGYPTIAN_SECOND_B_STANDINGS;
  }

  getThirdDivStandings(): LeagueStanding[] {
    return EGYPTIAN_THIRD_DIV_STANDINGS;
  }
}

export const store = new ScoutZeroStore();
