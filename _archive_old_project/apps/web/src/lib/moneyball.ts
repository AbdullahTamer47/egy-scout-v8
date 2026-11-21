/**
 * ScoutZero Moneyball Undervalued Index (MUI) Engine
 * 
 * Proprietary algorithmic rating for discovering undervalued talent in Egyptian leagues.
 * Implements:
 * - Bayesian shrinkage for small sample sizes
 * - League tier adjustment
 * - Configurable youth age curve
 * - Cost normalization (no explosive division by zero)
 * - Provenance tracking & confidence scoring
 */

export interface PlayerMetricInput {
  minutes: number;
  tier: number; // 1, 2, 3
  age: number;
  positionGroup: 'GK' | 'CB' | 'FB' | 'DM_CM' | 'AM_W' | 'ST';
  estimatedValue?: number | null; // in EGP
  ratingsOverall?: number; // 1-10 scouting rating
  actionsUnderPressureSuccessRate?: number; // 0-1
  duelSuccessRate?: number; // 0-1
  per90Metrics?: Record<string, number>;
}

export interface MuiResult {
  score: number; // 0 - 100 rescaled
  rawMui: number;
  confidence: 'HIGH' | 'MODERATE' | 'PRELIMINARY';
  confidenceReason: string;
  sampleMinutes: number;
  components: {
    performanceScore: number; // 0 - 100
    ageFactor: number; // e.g. 1.0 - 1.45
    pressureFactor: number; // 0.8 - 1.2
    costBand: number; // 1 - 5
    costDivider: number;
    tierMultiplier: number;
  };
  provenance: {
    source: 'computed_stats' | 'scouting_ratings' | 'hybrid';
    timestamp: string;
  };
}

// Position-specific weights for ratings
const POSITION_PERFORMANCE_WEIGHTS: Record<string, Record<string, number>> = {
  GK: { shot_stopping: 0.3, positioning: 0.25, reflexes: 0.2, distribution: 0.15, aerial_ability: 0.1 },
  CB: { tackling: 0.25, aerial_duels: 0.25, positioning: 0.2, reading_game: 0.15, passing: 0.15 },
  FB: { pace: 0.25, crossing: 0.2, tackling: 0.2, stamina: 0.2, positioning: 0.15 },
  DM_CM: { passing: 0.25, tackling: 0.2, ball_retention: 0.2, positioning: 0.2, vision: 0.15 },
  AM_W: { dribbling: 0.25, creativity: 0.25, pace: 0.2, vision: 0.15, shooting: 0.15 },
  ST: { finishing: 0.35, movement: 0.2, positioning: 0.2, composure: 0.15, aerial_ability: 0.1 },
};

/**
 * Calculates youth age factor:
 * Rewards younger players with higher multipliers.
 * Age 17: ~1.45, Age 20: ~1.18, Age 23: 1.00, Age 27: 0.76
 */
export function calculateAgeFactor(age: number): number {
  if (age <= 16) return 1.50;
  if (age === 17) return 1.45;
  if (age === 18) return 1.35;
  if (age === 19) return 1.25;
  if (age === 20) return 1.18;
  if (age === 21) return 1.12;
  if (age === 22) return 1.06;
  if (age === 23) return 1.00;
  // Above 23, decay smoothly
  return Math.max(0.65, Number((1.0 / (1.0 + 0.07 * (age - 23))).toFixed(3)));
}

/**
 * Tier quality adjustment factor:
 * Tier 1 (Premier League) = 1.0
 * Tier 2 (Second Division) = 0.88
 * Tier 3 (Third Division) = 0.76
 */
export function getTierAdjustment(tier: number): number {
  switch (tier) {
    case 1: return 1.0;
    case 2: return 0.88;
    case 3: return 0.76;
    default: return 0.80;
  }
}

/**
 * Bayesian shrinkage towards group mean for small sample sizes.
 * If minutes < threshold (e.g. 450 minutes / 5 full matches), shrink toward 50.0.
 */
export function applyBayesianShrinkage(
  observedScore: number,
  minutes: number,
  thresholdMinutes: number = 450,
  priorMean: number = 50.0
): { adjustedScore: number; confidence: 'HIGH' | 'MODERATE' | 'PRELIMINARY' } {
  if (minutes >= 700) {
    return { adjustedScore: observedScore, confidence: 'HIGH' };
  }
  
  // Weight parameter K = 300 minutes
  const K = 300;
  const weight = minutes / (minutes + K);
  const adjustedScore = (weight * observedScore) + ((1 - weight) * priorMean);
  
  const confidence = minutes >= thresholdMinutes ? 'MODERATE' : 'PRELIMINARY';
  return { adjustedScore: Number(adjustedScore.toFixed(2)), confidence };
}

/**
 * Calculates Cost Divider:
 * Safeguards against 0 or undefined values blowing up the score.
 */
export function calculateCostDivider(estimatedValueEgp?: number | null): { divider: number; costBand: number } {
  const floorValue = 100000; // 100k EGP floor
  const val = estimatedValueEgp && estimatedValueEgp > 0 ? estimatedValueEgp : floorValue;
  
  // Price bands:
  // 1: < 500k EGP (Free / Youth / Low)
  // 2: 500k - 1.5M EGP
  // 3: 1.5M - 4M EGP
  // 4: 4M - 10M EGP
  // 5: > 10M EGP
  let costBand = 1;
  if (val >= 10000000) costBand = 5;
  else if (val >= 4000000) costBand = 4;
  else if (val >= 1500000) costBand = 3;
  else if (val >= 500000) costBand = 2;

  // Logarithmic damping: log(1 + val / 150,000)
  const divider = Math.max(1.0, Math.log1p(val / 150000));
  return { divider: Number(divider.toFixed(3)), costBand };
}

/**
 * Calculate Moneyball Undervalued Index (MUI)
 */
export function calculateMui(input: PlayerMetricInput): MuiResult {
  const { minutes, tier, age, estimatedValue, ratingsOverall = 6.5 } = input;
  
  // 1. Performance base
  // Scale ratings (1-10) to 0-100 base
  let rawPerformance = Math.min(100, Math.max(10, ratingsOverall * 10));
  
  // Apply tier multiplier
  const tierMultiplier = getTierAdjustment(tier);
  rawPerformance = rawPerformance * tierMultiplier;
  
  // Apply Bayesian shrinkage
  const { adjustedScore: performanceScore, confidence } = applyBayesianShrinkage(rawPerformance, minutes);
  
  // 2. Age Factor
  const ageFactor = calculateAgeFactor(age);
  
  // 3. Pressure Factor
  let pressureFactor = 1.0;
  if (input.actionsUnderPressureSuccessRate !== undefined) {
    // Normal rate is ~0.65. Range from 0.85 to 1.15
    pressureFactor = 0.85 + (input.actionsUnderPressureSuccessRate * 0.3);
  } else {
    // Heuristic fallback using rating
    pressureFactor = 0.95 + ((ratingsOverall / 10) * 0.1);
  }
  pressureFactor = Number(pressureFactor.toFixed(3));
  
  // 4. Cost Divider
  const { divider: costDivider, costBand } = calculateCostDivider(estimatedValue);
  
  // 5. Raw MUI formula
  // Raw = (Performance * AgeFactor * PressureFactor) / CostDivider
  const rawMui = (performanceScore * ageFactor * pressureFactor) / costDivider;
  
  // Rescale Raw MUI (typically 20 - 150) to 0 - 100 benchmarked
  const rescaledScore = Math.min(99.4, Math.max(15.0, Number(((rawMui / 95) * 100).toFixed(1))));
  
  return {
    score: rescaledScore,
    rawMui: Number(rawMui.toFixed(2)),
    confidence,
    confidenceReason: confidence === 'PRELIMINARY' 
      ? `عينة دقائق منخفضة (${minutes} دقيقة) - تم تطبيق انكماش بايزي نحو المتوسط` 
      : `عينة مقبولة (${minutes} دقيقة)`,
    sampleMinutes: minutes,
    components: {
      performanceScore: Number(performanceScore.toFixed(1)),
      ageFactor,
      pressureFactor,
      costBand,
      costDivider,
      tierMultiplier
    },
    provenance: {
      source: input.per90Metrics ? 'computed_stats' : 'scouting_ratings',
      timestamp: new Date().toISOString()
    }
  };
}
