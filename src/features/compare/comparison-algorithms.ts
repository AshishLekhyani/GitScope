import { formatDistanceToNow } from "date-fns";

// =============================================================================
// ADVANCED COMPARISON ALGORITHMS
// Complex multi-dimensional scoring with statistical analysis
// =============================================================================

export interface RepositoryMetrics {
  stars: number;
  forks: number;
  watchers: number;
  openIssues: number;
  closedIssues: number;
  contributors: number;
  commits: number;
  size: number;
  createdAt: string;
  updatedAt: string;
  language: string;
  languages: Record<string, number>;
  prMergeRate: number;
  issueResolutionRate: number;
  avgPRMergeTime: number | null;
  hasWiki: boolean;
  hasPages: boolean;
  hasDiscussions: boolean;
  hasProjects: boolean;
  license: string | null;
  codeOfConduct: boolean;
  networkCount: number;
  subscribersCount: number;
  defaultBranch: string;
  pullRequests: any[];
  commitActivity: { week: number; total: number; days: number[] }[];
  topContributors: { login: string; contributions: number; avatar: string }[];
}

// =============================================================================
// STATISTICAL NORMALIZATION
// =============================================================================

/**
 * Calculate z-score for normalization across repositories
 * z = (x - μ) / σ
 */
export function calculateZScore(value: number, mean: number, stdDev: number): number {
  if (stdDev === 0) return 0;
  return (value - mean) / stdDev;
}

/**
 * Calculate percentile rank (0-100) within a cohort
 */
export function calculatePercentile(value: number, values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = sorted.findIndex(v => v >= value);
  if (index === -1) return 100;
  return (index / sorted.length) * 100;
}

/**
 * Normalize value to 0-100 scale using min-max scaling
 */
export function normalizeScore(
  value: number,
  min: number,
  max: number,
  options: { invert?: boolean; log?: boolean } = {}
): number {
  const { invert = false, log = false } = options;
  
  let normalized: number;
  
  if (log && value > 0 && max > 0) {
    // Logarithmic scaling for exponential distributions (stars, forks)
    const logValue = Math.log10(value + 1);
    const logMax = Math.log10(max + 1);
    const logMin = Math.log10(min + 1);
    normalized = ((logValue - logMin) / (logMax - logMin)) * 100;
  } else {
    // Linear scaling
    const range = max - min;
    normalized = range === 0 ? 50 : ((value - min) / range) * 100;
  }
  
  return Math.max(0, Math.min(100, invert ? 100 - normalized : normalized));
}

/**
 * Calculate decay-weighted average (recent values weighted more)
 */
export function decayWeightedAverage(
  values: number[],
  halfLife: number = 7 // days
): number {
  if (values.length === 0) return 0;
  
  const decayFactor = Math.log(2) / halfLife;
  let weightedSum = 0;
  let weightSum = 0;
  
  values.forEach((value, index) => {
    const weight = Math.exp(-decayFactor * index);
    weightedSum += value * weight;
    weightSum += weight;
  });
  
  return weightSum > 0 ? weightedSum / weightSum : 0;
}

// =============================================================================
// COMPOSITE SCORING INDICES
// =============================================================================

export interface CompositeScores {
  momentum: number;
  sustainability: number;
  influence: number;
  engagement: number;
  quality: number;
  velocity: number;
  communityHealth: number;
  overall: number;
}

export interface ScoreBreakdown {
  raw: Record<string, number>;
  normalized: Record<string, number>;
  weighted: Record<string, number>;
  confidence: number;
  trend: "rising" | "stable" | "declining";
  percentile: number;
}

/**
 * Calculate momentum score based on growth velocity and acceleration
 */
function calculateMomentumScore(
  repo: RepositoryMetrics,
  allRepos: RepositoryMetrics[]
): { score: number; breakdown: Record<string, number> } {
  const ageInDays = Math.max(1, (Date.now() - new Date(repo.createdAt).getTime()) / (1000 * 60 * 60 * 24));
  
  // Growth rates (per day)
  const starsPerDay = repo.stars / ageInDays;
  const forksPerDay = repo.forks / ageInDays;
  const contributorsPerDay = repo.contributors / ageInDays;
  
  // Recent activity (last 4 weeks from commit activity)
  const recentActivity = repo.commitActivity?.slice(-4) || [];
  const recentCommits = recentActivity.reduce((sum, week) => sum + week.total, 0);
  const weeklyVelocity = recentActivity.length > 0 ? recentCommits / recentActivity.length : 0;
  
  // Cohort comparison for velocity
  const allStarsPerDay = allRepos.map(r => r.stars / Math.max(1, (Date.now() - new Date(r.createdAt).getTime()) / (1000 * 60 * 60 * 24)));
  const allForksPerDay = allRepos.map(r => r.forks / Math.max(1, (Date.now() - new Date(r.createdAt).getTime()) / (1000 * 60 * 60 * 24)));
  
  const starsVelocity = normalizeScore(starsPerDay, Math.min(...allStarsPerDay), Math.max(...allStarsPerDay), { log: true });
  const forksVelocity = normalizeScore(forksPerDay, Math.min(...allForksPerDay), Math.max(...allForksPerDay), { log: true });
  const commitVelocity = Math.min(100, (weeklyVelocity / 50) * 100); // 50 commits/week = 100%
  
  // Weighted momentum
  const score = starsVelocity * 0.4 + forksVelocity * 0.3 + commitVelocity * 0.3;
  
  return {
    score,
    breakdown: {
      starsVelocity,
      forksVelocity,
      commitVelocity,
      weeklyCommits: weeklyVelocity,
    },
  };
}

/**
 * Calculate sustainability score based on maintenance patterns
 */
function calculateSustainabilityScore(
  repo: RepositoryMetrics,
  allRepos: RepositoryMetrics[]
): { score: number; breakdown: Record<string, number> } {
  const ageInDays = Math.max(1, (Date.now() - new Date(repo.createdAt).getTime()) / (1000 * 60 * 60 * 24));
  const daysSinceUpdate = (Date.now() - new Date(repo.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
  
  // Recency factor (exponential decay)
  const recencyScore = Math.exp(-daysSinceUpdate / 30) * 100; // 30-day half-life
  
  // Issue resolution health
  const totalIssues = repo.openIssues + repo.closedIssues;
  const issueHealth = totalIssues > 0 
    ? (repo.closedIssues / totalIssues) * 100 
    : 50; // Neutral if no issues
  
  // PR merge efficiency
  const prEfficiency = repo.prMergeRate;
  const prSpeedScore = repo.avgPRMergeTime !== null
    ? Math.max(0, 100 - (repo.avgPRMergeTime / 24) * 10) // Penalty for slow merges
    : 50;
  
  // Documentation completeness
  const docScore = [
    repo.license ? 25 : 0,
    repo.codeOfConduct ? 25 : 0,
    repo.hasWiki ? 15 : 0,
    repo.hasPages ? 15 : 0,
    repo.hasDiscussions ? 10 : 0,
    repo.hasProjects ? 10 : 0,
  ].reduce((a, b) => a + b, 0);
  
  // Age-adjusted activity (older repos need less frequent updates)
  const ageFactor = Math.min(1, ageInDays / 365);
  const adjustedRecency = recencyScore * (0.5 + 0.5 * ageFactor);
  
  const score = adjustedRecency * 0.25 + issueHealth * 0.2 + prEfficiency * 0.15 + prSpeedScore * 0.15 + docScore * 0.25;
  
  return {
    score,
    breakdown: {
      recencyScore: adjustedRecency,
      issueHealth,
      prEfficiency,
      prSpeedScore,
      docScore,
    },
  };
}

/**
 * Calculate influence score based on network effects
 */
function calculateInfluenceScore(
  repo: RepositoryMetrics,
  allRepos: RepositoryMetrics[]
): { score: number; breakdown: Record<string, number> } {
  const maxStars = Math.max(...allRepos.map(r => r.stars), 1);
  const maxForks = Math.max(...allRepos.map(r => r.forks), 1);
  const maxNetwork = Math.max(...allRepos.map(r => r.networkCount || 0), 1);
  
  // Network reach
  const networkScore = normalizeScore(repo.networkCount || 0, 0, maxNetwork, { log: true });
  
  // Star power (log-scaled)
  const starScore = normalizeScore(repo.stars, 0, maxStars, { log: true });
  
  // Fork adoption (log-scaled)
  const forkScore = normalizeScore(repo.forks, 0, maxForks, { log: true });
  
  // Watcher engagement (higher ratio = more engaged community)
  const watcherRatio = repo.stars > 0 ? (repo.watchers || 0) / repo.stars : 0;
  const allWatcherRatios = allRepos.map(r => r.stars > 0 ? (r.watchers || 0) / r.stars : 0);
  const engagementScore = normalizeScore(watcherRatio, Math.min(...allWatcherRatios), Math.max(...allWatcherRatios));
  
  // Contributor diversity (lower concentration = healthier)
  const topContributorShare = repo.contributors > 0 && repo.topContributors[0]
    ? repo.topContributors[0].contributions / repo.contributors
    : 1;
  const diversityScore = Math.max(0, 100 - topContributorShare * 100);
  
  const score = starScore * 0.35 + forkScore * 0.25 + networkScore * 0.15 + engagementScore * 0.1 + diversityScore * 0.15;
  
  return {
    score,
    breakdown: {
      starScore,
      forkScore,
      networkScore,
      engagementScore,
      diversityScore,
    },
  };
}

/**
 * Calculate engagement depth score
 */
function calculateEngagementScore(
  repo: RepositoryMetrics,
  allRepos: RepositoryMetrics[]
): { score: number; breakdown: Record<string, number> } {
  const totalIssues = repo.openIssues + repo.closedIssues;
  const totalPRs = repo.pullRequests?.length || 0;
  
  // Issue engagement (issues per star - indicates user engagement)
  const issueDensity = repo.stars > 0 ? (totalIssues / repo.stars) * 1000 : 0;
  const allDensities = allRepos.map(r => {
    const t = r.openIssues + r.closedIssues;
    return r.stars > 0 ? (t / r.stars) * 1000 : 0;
  });
  const issueEngagement = normalizeScore(issueDensity, Math.min(...allDensities), Math.max(...allDensities));
  
  // PR engagement (community contribution level)
  const prDensity = repo.stars > 0 ? (totalPRs / repo.stars) * 100 : 0;
  const allPRDensities = allRepos.map(r => r.stars > 0 ? ((r.pullRequests?.length || 0) / r.stars) * 100 : 0);
  const prEngagement = normalizeScore(prDensity, Math.min(...allPRDensities), Math.max(...allPRDensities));
  
  // Discussion features (proxy for community building)
  const featureScore = [
    repo.hasDiscussions ? 30 : 0,
    repo.hasWiki ? 20 : 0,
    repo.hasProjects ? 25 : 0,
    repo.hasPages ? 15 : 0,
  ].reduce((a, b) => a + b, 0);
  
  // Response time proxy (issue resolution rate)
  const responsiveness = repo.issueResolutionRate;
  
  const score = issueEngagement * 0.2 + prEngagement * 0.25 + featureScore * 0.3 + responsiveness * 0.25;
  
  return {
    score,
    breakdown: {
      issueEngagement,
      prEngagement,
      featureScore,
      responsiveness,
    },
  };
}

/**
 * Calculate code quality proxy score
 */
function calculateQualityScore(
  repo: RepositoryMetrics,
  allRepos: RepositoryMetrics[]
): { score: number; breakdown: Record<string, number> } {
  const totalIssues = repo.openIssues + repo.closedIssues;
  
  // Bug density proxy (open issues relative to size)
  const bugDensity = repo.size > 0 ? (repo.openIssues / repo.size) * 1000 : 0;
  const allDensities = allRepos.map(r => r.size > 0 ? (r.openIssues / r.size) * 1000 : 0);
  const bugScore = normalizeScore(bugDensity, Math.min(...allDensities), Math.max(...allDensities), { invert: true });
  
  // PR quality (merge rate indicates code review quality)
  const prQuality = repo.prMergeRate;
  
  // Maintenance velocity (how fast issues are addressed)
  const maintenanceScore = totalIssues > 0 
    ? (repo.closedIssues / totalIssues) * 100
    : 50;
  
  // Language diversity (more languages = more complex, but also more capability)
  const langCount = Object.keys(repo.languages || {}).length;
  const langDiversity = Math.min(100, langCount * 20);
  
  // License presence (professionalism indicator)
  const licenseScore = repo.license ? 100 : 30;
  
  const score = bugScore * 0.25 + prQuality * 0.2 + maintenanceScore * 0.25 + langDiversity * 0.15 + licenseScore * 0.15;
  
  return {
    score,
    breakdown: {
      bugScore,
      prQuality,
      maintenanceScore,
      langDiversity,
      licenseScore,
    },
  };
}

/**
 * Calculate velocity score based on development speed
 */
function calculateVelocityScore(
  repo: RepositoryMetrics,
  allRepos: RepositoryMetrics[]
): { score: number; breakdown: Record<string, number>; trend: "accelerating" | "stable" | "decelerating" } {
  const commitActivity = repo.commitActivity || [];
  
  if (commitActivity.length < 2) {
    return { score: 50, breakdown: { recentVelocity: 50, consistency: 50, acceleration: 50 }, trend: "stable" };
  }
  
  // Recent velocity (last 4 weeks)
  const recent = commitActivity.slice(-4);
  const recentTotal = recent.reduce((sum, w) => sum + w.total, 0);
  const recentVelocity = recentTotal / 4;
  
  // Consistency (coefficient of variation inverse)
  const weeks = commitActivity.map(w => w.total);
  const mean = weeks.reduce((a, b) => a + b, 0) / weeks.length;
  const variance = weeks.reduce((sum, w) => sum + Math.pow(w - mean, 2), 0) / weeks.length;
  const stdDev = Math.sqrt(variance);
  const cv = mean > 0 ? stdDev / mean : 0;
  const consistency = Math.max(0, 100 - cv * 100);
  
  // Acceleration (comparing first half to second half)
  const mid = Math.floor(commitActivity.length / 2);
  const firstHalf = commitActivity.slice(0, mid);
  const secondHalf = commitActivity.slice(mid);
  const firstAvg = firstHalf.reduce((sum, w) => sum + w.total, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((sum, w) => sum + w.total, 0) / secondHalf.length;
  const acceleration = firstAvg > 0 ? ((secondAvg - firstAvg) / firstAvg) * 100 : 0;
  const normalizedAcceleration = normalizeScore(acceleration, -50, 50);
  
  // Trend detection
  let trend: "accelerating" | "stable" | "decelerating";
  if (acceleration > 20) trend = "accelerating";
  else if (acceleration < -20) trend = "decelerating";
  else trend = "stable";
  
  // All repos comparison
  const allVelocities = allRepos.map(r => {
    const act = r.commitActivity || [];
    if (act.length === 0) return 0;
    const recent = act.slice(-4);
    return recent.reduce((sum, w) => sum + w.total, 0) / recent.length;
  });
  const velocityScore = normalizeScore(recentVelocity, Math.min(...allVelocities), Math.max(...allVelocities), { log: true });
  
  const score = velocityScore * 0.4 + consistency * 0.35 + normalizedAcceleration * 0.25;
  
  return {
    score,
    breakdown: {
      recentVelocity: velocityScore,
      consistency,
      acceleration: normalizedAcceleration,
      weeklyAvg: recentVelocity,
    },
    trend,
  };
}

/**
 * Calculate community health score
 */
function calculateCommunityHealthScore(
  repo: RepositoryMetrics,
  allRepos: RepositoryMetrics[]
): { score: number; breakdown: Record<string, number> } {
  const maxContributors = Math.max(...allRepos.map(r => r.contributors), 1);
  
  // Contributor base (log-scaled)
  const contributorScore = normalizeScore(repo.contributors, 0, maxContributors, { log: true });
  
  // Contributor distribution (Gini coefficient approximation)
  const top5Contributions = repo.topContributors.slice(0, 5).reduce((sum, c) => sum + c.contributions, 0);
  const totalEstimated = Math.max(top5Contributions, repo.contributors);
  const concentration = totalEstimated > 0 ? top5Contributions / totalEstimated : 1;
  const distributionScore = Math.max(0, 100 - concentration * 100);
  
  // Onboarding ease (PR merge rate as proxy)
  const onboardingScore = repo.prMergeRate;
  
  // Responsiveness (issue resolution)
  const responsiveness = repo.issueResolutionRate;
  
  // External engagement (forks per star ratio)
  const forkRatio = repo.stars > 0 ? repo.forks / repo.stars : 0;
  const allRatios = allRepos.map(r => r.stars > 0 ? r.forks / r.stars : 0);
  const engagementScore = normalizeScore(forkRatio, Math.min(...allRatios), Math.max(...allRatios));
  
  const score = contributorScore * 0.3 + distributionScore * 0.2 + onboardingScore * 0.15 + responsiveness * 0.2 + engagementScore * 0.15;
  
  return {
    score,
    breakdown: {
      contributorScore,
      distributionScore,
      onboardingScore,
      responsiveness,
      engagementScore,
    },
  };
}

// =============================================================================
// MAIN COMPARISON ENGINE
// =============================================================================

export interface AdvancedComparisonResult {
  repo: RepositoryMetrics;
  composite: CompositeScores;
  breakdowns: {
    momentum: Record<string, number>;
    sustainability: Record<string, number>;
    influence: Record<string, number>;
    engagement: Record<string, number>;
    quality: Record<string, number>;
    velocity: Record<string, number>;
    communityHealth: Record<string, number>;
  };
  velocity: {
    score: number;
    trend: "accelerating" | "stable" | "decelerating";
  };
  percentiles: Record<string, number>;
  confidence: number;
  rank: number;
  tier: "S" | "A" | "B" | "C" | "D";
  badges: string[];
  predictions: {
    projectedStars30d: number;
    projectedStars90d: number;
    growthTrajectory: "rocket" | "steady" | "plateau" | "decline";
  };
}

/**
 * Main function to perform advanced comparison across repositories
 */
export function performAdvancedComparison(
  repos: RepositoryMetrics[]
): AdvancedComparisonResult[] {
  if (repos.length === 0) return [];
  
  // Calculate all composite scores for each repo
  const results: AdvancedComparisonResult[] = repos.map(repo => {
    const momentum = calculateMomentumScore(repo, repos);
    const sustainability = calculateSustainabilityScore(repo, repos);
    const influence = calculateInfluenceScore(repo, repos);
    const engagement = calculateEngagementScore(repo, repos);
    const quality = calculateQualityScore(repo, repos);
    const velocity = calculateVelocityScore(repo, repos);
    const communityHealth = calculateCommunityHealthScore(repo, repos);
    
    // Weighted overall score
    const overall = 
      momentum.score * 0.15 +
      sustainability.score * 0.15 +
      influence.score * 0.2 +
      engagement.score * 0.15 +
      quality.score * 0.15 +
      velocity.score * 0.1 +
      communityHealth.score * 0.1;
    
    // Calculate confidence based on data completeness
    const confidence = calculateConfidence(repo);
    
    // Generate predictions
    const predictions = generatePredictions(repo, velocity);
    
    return {
      repo,
      composite: {
        momentum: momentum.score,
        sustainability: sustainability.score,
        influence: influence.score,
        engagement: engagement.score,
        quality: quality.score,
        velocity: velocity.score,
        communityHealth: communityHealth.score,
        overall,
      },
      breakdowns: {
        momentum: momentum.breakdown,
        sustainability: sustainability.breakdown,
        influence: influence.breakdown,
        engagement: engagement.breakdown,
        quality: quality.breakdown,
        velocity: velocity.breakdown,
        communityHealth: communityHealth.breakdown,
      },
      velocity: {
        score: velocity.score,
        trend: velocity.trend,
      },
      percentiles: {}, // Will be calculated after all results
      confidence,
      rank: 0, // Will be assigned after sorting
      tier: assignTier(overall),
      badges: generateBadges(repo, { momentum, sustainability, influence, quality, communityHealth }),
      predictions,
    };
  });
  
  // Calculate percentiles for each metric
  const allScores = {
    momentum: results.map(r => r.composite.momentum),
    sustainability: results.map(r => r.composite.sustainability),
    influence: results.map(r => r.composite.influence),
    engagement: results.map(r => r.composite.engagement),
    quality: results.map(r => r.composite.quality),
    velocity: results.map(r => r.composite.velocity),
    communityHealth: results.map(r => r.composite.communityHealth),
    overall: results.map(r => r.composite.overall),
  };
  
  results.forEach(result => {
    result.percentiles = {
      momentum: calculatePercentile(result.composite.momentum, allScores.momentum),
      sustainability: calculatePercentile(result.composite.sustainability, allScores.sustainability),
      influence: calculatePercentile(result.composite.influence, allScores.influence),
      engagement: calculatePercentile(result.composite.engagement, allScores.engagement),
      quality: calculatePercentile(result.composite.quality, allScores.quality),
      velocity: calculatePercentile(result.composite.velocity, allScores.velocity),
      communityHealth: calculatePercentile(result.composite.communityHealth, allScores.communityHealth),
      overall: calculatePercentile(result.composite.overall, allScores.overall),
    };
  });
  
  // Sort and assign ranks
  results.sort((a, b) => b.composite.overall - a.composite.overall);
  results.forEach((r, i) => { r.rank = i + 1; });
  
  return results;
}

/**
 * Calculate data confidence score
 */
function calculateConfidence(repo: RepositoryMetrics): number {
  let confidence = 100;
  
  // Penalize missing data
  if (!repo.commitActivity || repo.commitActivity.length === 0) confidence -= 20;
  if (!repo.pullRequests || repo.pullRequests.length === 0) confidence -= 15;
  if (!repo.topContributors || repo.topContributors.length === 0) confidence -= 10;
  if (Object.keys(repo.languages || {}).length === 0) confidence -= 10;
  
  // Penalize stale data
  const daysSinceUpdate = (Date.now() - new Date(repo.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceUpdate > 90) confidence -= 15;
  
  return Math.max(0, confidence);
}

/**
 * Assign tier based on overall score
 */
function assignTier(score: number): "S" | "A" | "B" | "C" | "D" {
  if (score >= 90) return "S";
  if (score >= 75) return "A";
  if (score >= 60) return "B";
  if (score >= 40) return "C";
  return "D";
}

/**
 * Generate achievement badges
 */
function generateBadges(
  repo: RepositoryMetrics,
  scores: {
    momentum: { score: number; breakdown: Record<string, number> };
    sustainability: { score: number; breakdown: Record<string, number> };
    influence: { score: number; breakdown: Record<string, number> };
    quality: { score: number; breakdown: Record<string, number> };
    communityHealth: { score: number; breakdown: Record<string, number> };
  }
): string[] {
  const badges: string[] = [];
  
  // Velocity badges
  if (scores.momentum.score >= 85) badges.push("🔥 Trending");
  if (scores.momentum.breakdown.weeklyCommits > 50) badges.push("⚡ High Velocity");
  
  // Quality badges
  if (scores.quality.score >= 80) badges.push("✨ Quality Code");
  if (repo.prMergeRate >= 85) badges.push("🎯 Merge Master");
  if (repo.issueResolutionRate >= 80) badges.push("🐛 Bug Crusher");
  
  // Influence badges
  if (repo.stars >= 10000) badges.push("⭐ Star Power");
  if (repo.forks >= 1000) badges.push("🍴 Fork Magnet");
  if (scores.influence.score >= 80) badges.push("🌐 Network Effect");
  
  // Community badges
  if (repo.contributors >= 100) badges.push("👥 Community Giant");
  if (scores.communityHealth.score >= 80) badges.push("💚 Healthy Community");
  
  // Sustainability badges
  if (scores.sustainability.score >= 85) badges.push("🌱 Well Maintained");
  if (repo.license && repo.codeOfConduct) badges.push("📋 Professional");
  
  return badges;
}

/**
 * Generate growth predictions
 */
function generatePredictions(
  repo: RepositoryMetrics,
  velocity: { score: number; trend: "accelerating" | "stable" | "decelerating" }
): { projectedStars30d: number; projectedStars90d: number; growthTrajectory: "rocket" | "steady" | "plateau" | "decline" } {
  const ageInDays = Math.max(1, (Date.now() - new Date(repo.createdAt).getTime()) / (1000 * 60 * 60 * 24));
  const starsPerDay = repo.stars / ageInDays;
  
  // Adjust based on trend
  let trendMultiplier = 1;
  if (velocity.trend === "accelerating") trendMultiplier = 1.5;
  else if (velocity.trend === "decelerating") trendMultiplier = 0.7;
  
  const projected30d = Math.round(starsPerDay * 30 * trendMultiplier);
  const projected90d = Math.round(starsPerDay * 90 * trendMultiplier);
  
  let growthTrajectory: "rocket" | "steady" | "plateau" | "decline";
  if (velocity.trend === "accelerating" && starsPerDay > 10) growthTrajectory = "rocket";
  else if (starsPerDay > 1) growthTrajectory = "steady";
  else if (velocity.trend === "decelerating") growthTrajectory = "decline";
  else growthTrajectory = "plateau";
  
  return { projectedStars30d: projected30d, projectedStars90d: projected90d, growthTrajectory };
}

// =============================================================================
// BATTLE MODE ENHANCEMENTS
// =============================================================================

export interface BattleRound {
  id: string;
  title: string;
  icon: string;
  color: string;
  metric: keyof CompositeScores;
  description: string;
  getWinner: (results: AdvancedComparisonResult[]) => AdvancedComparisonResult;
  getScoreDisplay: (result: AdvancedComparisonResult) => string;
}

export const BATTLE_ROUNDS: BattleRound[] = [
  {
    id: "influence",
    title: "Influence War",
    icon: "public",
    color: "from-amber-500 to-orange-500",
    metric: "influence",
    description: "Network reach, stars, forks, and overall impact",
    getWinner: (results) => results.reduce((a, b) => a.composite.influence > b.composite.influence ? a : b),
    getScoreDisplay: (r) => `Influence: ${Math.round(r.composite.influence)}/100`,
  },
  {
    id: "velocity",
    title: "Velocity Clash",
    icon: "speed",
    color: "from-blue-500 to-indigo-500",
    metric: "velocity",
    description: "Development speed, consistency, and acceleration",
    getWinner: (results) => results.reduce((a, b) => a.composite.velocity > b.composite.velocity ? a : b),
    getScoreDisplay: (r) => `${r.velocity.trend === "accelerating" ? "🚀" : r.velocity.trend === "stable" ? "📊" : "📉"} ${Math.round(r.composite.velocity)}/100`,
  },
  {
    id: "quality",
    title: "Quality Arena",
    icon: "verified",
    color: "from-emerald-500 to-teal-500",
    metric: "quality",
    description: "Code quality, PR efficiency, and maintenance health",
    getWinner: (results) => results.reduce((a, b) => a.composite.quality > b.composite.quality ? a : b),
    getScoreDisplay: (r) => `Quality: ${Math.round(r.composite.quality)}/100`,
  },
  {
    id: "community",
    title: "Community Battle",
    icon: "groups",
    color: "from-purple-500 to-pink-500",
    metric: "communityHealth",
    description: "Contributor health, engagement, and diversity",
    getWinner: (results) => results.reduce((a, b) => a.composite.communityHealth > b.composite.communityHealth ? a : b),
    getScoreDisplay: (r) => `Community: ${Math.round(r.composite.communityHealth)}/100`,
  },
  {
    id: "sustainability",
    title: "Sustainability Test",
    icon: "eco",
    color: "from-green-500 to-lime-500",
    metric: "sustainability",
    description: "Long-term maintenance and project health",
    getWinner: (results) => results.reduce((a, b) => a.composite.sustainability > b.composite.sustainability ? a : b),
    getScoreDisplay: (r) => `Sustainability: ${Math.round(r.composite.sustainability)}/100`,
  },
  {
    id: "overall",
    title: "Grand Championship",
    icon: "emoji_events",
    color: "from-yellow-500 to-red-500",
    metric: "overall",
    description: "Overall composite score across all dimensions",
    getWinner: (results) => results[0], // Already sorted by overall
    getScoreDisplay: (r) => `Score: ${Math.round(r.composite.overall)}/100 (${r.tier}-Tier)`,
  },
];

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Format score with appropriate emoji indicator
 */
export function formatScoreWithIndicator(score: number): string {
  if (score >= 90) return `🔥 ${Math.round(score)}`;
  if (score >= 75) return `✨ ${Math.round(score)}`;
  if (score >= 60) return `👍 ${Math.round(score)}`;
  if (score >= 40) return `📊 ${Math.round(score)}`;
  return `⚠️ ${Math.round(score)}`;
}

/**
 * Get trend icon based on velocity trend
 */
export function getTrendIcon(trend: "accelerating" | "stable" | "decelerating"): string {
  switch (trend) {
    case "accelerating": return "trending_up";
    case "decelerating": return "trending_down";
    case "stable": return "trending_flat";
  }
}

/**
 * Calculate statistical significance of difference between two repos
 */
export function calculateSignificance(
  repoA: AdvancedComparisonResult,
  repoB: AdvancedComparisonResult,
  metric: keyof CompositeScores
): { winner: "A" | "B" | "tie"; margin: number; significance: "high" | "medium" | "low" } {
  const diff = repoA.composite[metric] - repoB.composite[metric];
  const avgConfidence = (repoA.confidence + repoB.confidence) / 2;
  const margin = Math.abs(diff);
  
  let significance: "high" | "medium" | "low";
  if (margin > 20 && avgConfidence > 70) significance = "high";
  else if (margin > 10 && avgConfidence > 50) significance = "medium";
  else significance = "low";
  
  return {
    winner: diff > 0 ? "A" : diff < 0 ? "B" : "tie",
    margin,
    significance,
  };
}
