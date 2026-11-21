/**
 * ScoutZero Scoring & Analytics Engine Unit Tests
 * 
 * Verifies:
 * - Bayesian shrinkage for small minutes samples
 * - Age factor youth rewards curve
 * - Cost divisor stability (no division by zero)
 * - Moneyball Undervalued Index (MUI) bounds
 * - Tactical DNA Cosine Similarity & Archetype Matching
 * - Manual event tagging to clip generation flow
 */

import { 
  calculateAgeFactor, 
  getTierAdjustment, 
  applyBayesianShrinkage, 
  calculateCostDivider, 
  calculateMui 
} from '../lib/moneyball';

import { 
  calculateCosineSimilarity, 
  matchPlayerToArchetypes, 
  BENCHMARK_ARCHETYPES 
} from '../lib/dna-matcher';

import { store } from '../lib/store';

function runTests() {
  console.log('==============================================');
  console.log('⚽ Running ScoutZero Scoring Engine Unit Tests');
  console.log('==============================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, details?: string) {
    if (condition) {
      console.log(`✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${testName}${details ? ` -> ${details}` : ''}`);
      failed++;
    }
  }

  // --- 1. Age Factor Curve Tests ---
  console.log('--- 1. Testing Age Factor Youth Curve ---');
  assert(calculateAgeFactor(16) === 1.50, 'Age 16 receives 1.50 multiplier');
  assert(calculateAgeFactor(17) === 1.45, 'Age 17 receives 1.45 multiplier');
  assert(calculateAgeFactor(19) === 1.25, 'Age 19 receives 1.25 multiplier');
  assert(calculateAgeFactor(23) === 1.00, 'Age 23 receives 1.00 baseline multiplier');
  assert(calculateAgeFactor(28) < 1.00, 'Age 28 decays below 1.00 multiplier');
  assert(calculateAgeFactor(32) >= 0.65, 'Older age does not collapse below 0.65 floor');

  // --- 2. Tier Adjustment Tests ---
  console.log('\n--- 2. Testing League Tier Adjustment ---');
  assert(getTierAdjustment(1) === 1.0, 'Tier 1 Premier League has 1.0 multiplier');
  assert(getTierAdjustment(2) === 0.88, 'Tier 2 Second Division has 0.88 multiplier');
  assert(getTierAdjustment(3) === 0.76, 'Tier 3 has 0.76 multiplier');

  // --- 3. Bayesian Shrinkage Tests ---
  console.log('\n--- 3. Testing Bayesian Shrinkage for Small Samples ---');
  const smallSample = applyBayesianShrinkage(90, 100, 450, 50.0);
  assert(smallSample.confidence === 'PRELIMINARY', 'Small sample flagged as PRELIMINARY');
  assert(smallSample.adjustedScore < 90 && smallSample.adjustedScore > 50, 'Small sample (100 mins) shrunk significantly towards 50.0');

  const largeSample = applyBayesianShrinkage(85, 1200, 450, 50.0);
  assert(largeSample.confidence === 'HIGH', '1200 mins flagged as HIGH confidence');
  assert(largeSample.adjustedScore === 85, 'Sample > 900 mins does not suffer shrinkage');

  // --- 4. Cost Divider & Safety Tests ---
  console.log('\n--- 4. Testing Cost Divider Safety (No Div/0) ---');
  const zeroVal = calculateCostDivider(0);
  assert(zeroVal.divider >= 1.0, 'Zero valuation has safe floor divider >= 1.0');
  assert(zeroVal.costBand === 1, 'Zero/unknown valuation defaults to Price Band 1');

  const nullVal = calculateCostDivider(null);
  assert(nullVal.divider >= 1.0, 'Null valuation has safe floor divider >= 1.0');

  const highVal = calculateCostDivider(15000000);
  assert(highVal.costBand === 5, '15M EGP is correctly assigned to Price Band 5');
  assert(highVal.divider > zeroVal.divider, 'Higher valuation creates higher divider');

  // --- 5. Moneyball Undervalued Index (MUI) Bounds ---
  console.log('\n--- 5. Testing MUI Comprehensive Formula ---');
  const youngTalentMui = calculateMui({
    minutes: 850,
    tier: 2,
    age: 18,
    positionGroup: 'AM_W',
    estimatedValue: 400000,
    ratingsOverall: 8.5,
    actionsUnderPressureSuccessRate: 0.80
  });

  assert(youngTalentMui.score >= 0 && youngTalentMui.score <= 100, 'MUI score is bounded within [0, 100]');
  assert(youngTalentMui.confidence === 'HIGH', '850 mins has HIGH confidence');
  assert(youngTalentMui.components.ageFactor === 1.35, 'Components contain proper age factor (1.35)');
  assert(youngTalentMui.score > 70, 'Young gem in Tier 2 with high rating produces high MUI score');

  // --- 6. Tactical DNA Cosine Similarity Tests ---
  console.log('\n--- 6. Testing Cosine Similarity & Tactical DNA ---');
  const simIdentical = calculateCosineSimilarity(
    { pace: 80, passing: 90, tackling: 70 },
    { pace: 80, passing: 90, tackling: 70 }
  );
  assert(Math.abs(simIdentical.similarity - 1.0) < 0.001, 'Identical vectors have cosine similarity = 1.0 (100%)');

  const rodriArchetype = BENCHMARK_ARCHETYPES.find(a => a.id === 'deep-lying-playmaker')!;
  const matchedArchetypes = matchPlayerToArchetypes({
    passing: 9.5,
    vision: 9.0,
    ball_retention: 9.2,
    positioning: 8.8,
    tackling: 7.8
  }, 'DM_CM');

  assert(matchedArchetypes.length > 0, 'Archetype matcher returns candidate archetypes');
  assert(matchedArchetypes[0].archetypeId === 'deep-lying-playmaker', 'Player with high passing/retention matches Deep-lying Playmaker');
  assert(matchedArchetypes[0].similarityPercentage >= 85, 'Similarity percentage is >= 85%');
  assert(matchedArchetypes[0].radarData.length > 0, 'Radar chart overlay data is generated');

  // --- 7. Event Tagging & Clip Generation End-to-End ---
  console.log('\n--- 7. Testing Tagging & Review Queue Flow ---');
  const initialEvents = store.getReviewQueue();
  const suggestedCount = initialEvents.filter(e => e.status === 'suggested').length;
  assert(suggestedCount > 0, 'Suggested events exist in review queue');

  const firstSuggested = initialEvents.find(e => e.status === 'suggested')!;
  const confirmed = store.confirmEvent(firstSuggested.id);
  assert(confirmed?.status === 'confirmed', 'Event status transitioned to confirmed upon Scout verification');

  console.log('\n==============================================');
  console.log(`Results: ${passed} Passed, ${failed} Failed`);
  console.log('==============================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
