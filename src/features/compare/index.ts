// Compare feature exports
export { CompareBattle } from "./compare-battle";
export { CompareMetrics } from "./compare-metrics";
export { CompareRadar } from "./compare-radar";
export { CompareReposPanel } from "./compare-repos";
export { CompareSearch } from "./compare-search";
export { CommitVelocity } from "./commit-velocity";
export { ShareComparison } from "./share-comparison";
export { SuggestedComparisons } from "./suggested-comparisons";

// Advanced comparison algorithms
export {
  performAdvancedComparison,
  calculateZScore,
  calculatePercentile,
  normalizeScore,
  decayWeightedAverage,
  formatScoreWithIndicator,
  getTrendIcon,
  calculateSignificance,
  BATTLE_ROUNDS,
  type RepositoryMetrics,
  type CompositeScores,
  type AdvancedComparisonResult,
  type BattleRound,
} from "./comparison-algorithms";
