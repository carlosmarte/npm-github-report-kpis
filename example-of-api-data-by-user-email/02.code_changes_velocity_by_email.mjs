#!/usr/bin/env node

import { writeFile } from "fs/promises";
import { performance } from "perf_hooks";

class GitHubAnalyzer {
  constructor(token, options = {}) {
    this.token = token;
    this.baseUrl = "https://api.github.com";
    this.verbose = options.verbose || false;
    this.debug = options.debug || false;
    this.retryAttempts = 3;
    this.retryDelay = 1000;
  }

  log(message, level = "info") {
    const timestamp = new Date().toISOString();
    if (level === "debug" && !this.debug) return;
    if (level === "verbose" && !this.verbose && !this.debug) return;

    const prefix =
      level === "error"
        ? "❌"
        : level === "debug"
        ? "🔍"
        : level === "verbose"
        ? "💬"
        : "ℹ️";
    console.log(`${prefix} [${timestamp}] ${message}`);
  }

  async makeRequest(url, retryCount = 0) {
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `token ${this.token}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "GitHub-Velocity-Analyzer-CLI",
        },
      });

      if (
        response.status === 403 &&
        response.headers.get("x-ratelimit-remaining") === "0"
      ) {
        const resetTime =
          parseInt(response.headers.get("x-ratelimit-reset")) * 1000;
        const waitTime = resetTime - Date.now() + 1000;
        this.log(
          `Rate limit exceeded. Waiting ${Math.ceil(waitTime / 1000)}s...`,
          "verbose"
        );
        await this.sleep(waitTime);
        return this.makeRequest(url, retryCount);
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      this.log(`API request successful: ${url}`, "debug");
      return { data, response };
    } catch (error) {
      if (retryCount < this.retryAttempts) {
        this.log(
          `Request failed, retrying (${retryCount + 1}/${
            this.retryAttempts
          }): ${error.message}`,
          "verbose"
        );
        await this.sleep(this.retryDelay * Math.pow(2, retryCount));
        return this.makeRequest(url, retryCount + 1);
      }
      throw error;
    }
  }

  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Simple progress bar without external dependencies
  showProgress(current, total, operation) {
    const percentage = Math.round((current / total) * 100);
    const barLength = 20;
    const filled = Math.round((percentage / 100) * barLength);
    const empty = barLength - filled;
    const bar = "█".repeat(filled) + "░".repeat(empty);

    process.stdout.write(
      `\r[${bar}] ${percentage}% - ${operation} (${current}/${total})`
    );
    if (current === total) process.stdout.write("\n");
  }

  async fetchAllPages(baseUrl, params = {}) {
    const allData = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const url = new URL(baseUrl);
      Object.entries({ ...params, page, per_page: 100 }).forEach(
        ([key, value]) => {
          if (value !== undefined) url.searchParams.set(key, value);
        }
      );

      const { data, response } = await this.makeRequest(url.toString());
      allData.push(...data);

      const linkHeader = response.headers.get("link");
      hasMore = linkHeader && linkHeader.includes('rel="next"');
      page++;

      this.log(`Fetched page ${page - 1}, ${data.length} items`, "debug");
    }

    return allData;
  }

  calculateVelocityMetrics(commits) {
    if (commits.length === 0) return null;

    const sortedCommits = commits.sort(
      (a, b) => new Date(a.date) - new Date(b.date)
    );
    const timeSpan =
      new Date(sortedCommits[sortedCommits.length - 1].date) -
      new Date(sortedCommits[0].date);
    const daysSpan = timeSpan / (1000 * 60 * 60 * 24);

    // Calculate time intervals between commits
    const intervals = [];
    for (let i = 1; i < sortedCommits.length; i++) {
      const interval =
        new Date(sortedCommits[i].date) - new Date(sortedCommits[i - 1].date);
      intervals.push(interval / (1000 * 60 * 60)); // Convert to hours
    }

    // Calculate velocity consistency (coefficient of variation)
    const dailyCommitCounts = this.getDailyCommitCounts(commits);
    const velocityConsistency = this.calculateCoefficientOfVariation(
      Object.values(dailyCommitCounts)
    );

    return {
      commitsPerDay: daysSpan > 0 ? commits.length / daysSpan : 0,
      averageTimeBetweenCommits:
        intervals.length > 0
          ? intervals.reduce((a, b) => a + b, 0) / intervals.length
          : 0,
      timeSpanDays: daysSpan,
      velocityConsistency: velocityConsistency,
      commitFrequency: {
        total: commits.length,
        timeSpanDays: daysSpan,
        rate: daysSpan > 0 ? commits.length / daysSpan : 0,
      },
      peakDays: this.findPeakCommitDays(commits),
      workingHoursDistribution: this.analyzeWorkingHours(commits),
    };
  }

  getDailyCommitCounts(commits) {
    const dailyCounts = {};
    commits.forEach((commit) => {
      const day = new Date(commit.date).toISOString().split("T")[0];
      dailyCounts[day] = (dailyCounts[day] || 0) + 1;
    });
    return dailyCounts;
  }

  calculateCoefficientOfVariation(values) {
    if (values.length === 0) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance =
      values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
      values.length;
    const stdDev = Math.sqrt(variance);
    return mean > 0 ? stdDev / mean : 0;
  }

  findPeakCommitDays(commits) {
    const dailyCounts = this.getDailyCommitCounts(commits);
    const sortedDays = Object.entries(dailyCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5);
    return sortedDays.map(([day, count]) => ({ day, count }));
  }

  analyzeWorkingHours(commits) {
    const hourCounts = {};
    commits.forEach((commit) => {
      const hour = new Date(commit.date).getUTCHours();
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    });

    // Find peak hours
    const sortedHours = Object.entries(hourCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3);

    return {
      hourlyDistribution: hourCounts,
      peakHours: sortedHours.map(([hour, count]) => ({
        hour: parseInt(hour),
        count,
      })),
    };
  }

  calculateStatistics(values) {
    if (values.length === 0) return null;

    const sorted = [...values].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, val) => acc + val, 0);

    return {
      count: sorted.length,
      mean: sum / sorted.length,
      median:
        sorted.length % 2 === 0
          ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
          : sorted[Math.floor(sorted.length / 2)],
      min: sorted[0],
      max: sorted[sorted.length - 1],
      sum: sum,
      p25: sorted[Math.floor(sorted.length * 0.25)],
      p75: sorted[Math.floor(sorted.length * 0.75)],
      p90: sorted[Math.floor(sorted.length * 0.9)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      standardDeviation: this.calculateStandardDeviation(values),
      coefficientOfVariation: this.calculateCoefficientOfVariation(values),
    };
  }

  calculateStandardDeviation(values) {
    if (values.length === 0) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance =
      values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
      values.length;
    return Math.sqrt(variance);
  }

  // Calculate normalized commit sizes (0-1 range)
  calculateNormalizedCommitSizes(commits) {
    const commitSizes = commits
      .map((c) => c.totalChanges)
      .filter((size) => size > 0);
    if (commitSizes.length === 0) return { maxSize: 0, normalizedCommits: [] };

    const maxSize = Math.max(...commitSizes);
    const normalizedCommits = commits.map((commit) => ({
      ...commit,
      commitSizeNormalized:
        commit.totalChanges > 0 ? commit.totalChanges / maxSize : 0,
    }));

    return { maxSize, normalizedCommits };
  }

  // Analyze commit size thresholds with enhanced 0-1 splits
  analyzeCommitSizeThresholds(commits) {
    const thresholds = [
      { name: "micro", min: 0, max: 0.1, description: "Tiny changes (0-10%)" },
      {
        name: "small",
        min: 0.1,
        max: 0.3,
        description: "Small changes (10-30%)",
      },
      {
        name: "medium",
        min: 0.3,
        max: 0.5,
        description: "Medium changes (30-50%)",
      },
      {
        name: "large",
        min: 0.5,
        max: 0.7,
        description: "Large changes (50-70%)",
      },
      {
        name: "huge",
        min: 0.7,
        max: 0.9,
        description: "Huge changes (70-90%)",
      },
      {
        name: "massive",
        min: 0.9,
        max: 1.0,
        description: "Massive changes (90-100%)",
      },
    ];

    const analysis = {};

    thresholds.forEach((threshold) => {
      const commitsInRange = commits.filter(
        (commit) =>
          (commit.commitSizeNormalized >= threshold.min &&
            commit.commitSizeNormalized < threshold.max) ||
          (threshold.max === 1.0 && commit.commitSizeNormalized === 1.0)
      );

      const velocityMetrics = this.calculateVelocityMetrics(commitsInRange);

      analysis[threshold.name] = {
        range: `${threshold.min}-${threshold.max}`,
        description: threshold.description,
        count: commitsInRange.length,
        percentage:
          commits.length > 0
            ? (commitsInRange.length / commits.length) * 100
            : 0,
        totalChanges: commitsInRange.reduce(
          (sum, c) => sum + c.totalChanges,
          0
        ),
        averageChanges:
          commitsInRange.length > 0
            ? commitsInRange.reduce((sum, c) => sum + c.totalChanges, 0) /
              commitsInRange.length
            : 0,
        velocity: velocityMetrics,
        commits: commitsInRange.map((c) => ({
          sha: c.shortSha,
          author: c.authorLogin,
          authorEmail: c.authorEmail,
          date: c.date,
          changes: c.totalChanges,
          normalizedSize: c.commitSizeNormalized,
          message: c.message.substring(0, 100),
        })),
      };
    });

    return analysis;
  }

  // Enhanced user velocity analysis
  calculateUserVelocityBreakdown(commits) {
    const userBreakdown = {};

    commits.forEach((commit) => {
      const userKey = commit.authorEmail || commit.authorLogin;
      if (!userBreakdown[userKey]) {
        userBreakdown[userKey] = {
          authorName: commit.author,
          authorLogin: commit.authorLogin,
          authorEmail: commit.authorEmail,
          commits: [],
          totalCommits: 0,
          totalAdditions: 0,
          totalDeletions: 0,
          totalChanges: 0,
          velocity: null,
          commitSizeDistribution: null,
          workingPatterns: null,
          productivityMetrics: null,
        };
      }

      userBreakdown[userKey].commits.push(commit);
      userBreakdown[userKey].totalCommits++;
      userBreakdown[userKey].totalAdditions += commit.additions;
      userBreakdown[userKey].totalDeletions += commit.deletions;
      userBreakdown[userKey].totalChanges += commit.totalChanges;
    });

    // Calculate detailed metrics for each user
    Object.keys(userBreakdown).forEach((userKey) => {
      const userData = userBreakdown[userKey];

      // Velocity metrics
      userData.velocity = this.calculateVelocityMetrics(userData.commits);

      // Normalized commit sizes for this user
      const { normalizedCommits } = this.calculateNormalizedCommitSizes(
        userData.commits
      );
      userData.commits = normalizedCommits;

      // Commit size distribution
      userData.commitSizeDistribution = this.analyzeCommitSizeThresholds(
        userData.commits
      );

      // Working patterns
      userData.workingPatterns = this.analyzeUserWorkingPatterns(
        userData.commits
      );

      // Productivity metrics
      userData.productivityMetrics = this.calculateUserProductivityMetrics(
        userData.commits
      );

      // User-specific statistics
      userData.statistics = {
        commitSizes: this.calculateStatistics(
          userData.commits.map((c) => c.totalChanges).filter((s) => s > 0)
        ),
        additions: this.calculateStatistics(
          userData.commits.map((c) => c.additions).filter((s) => s > 0)
        ),
        deletions: this.calculateStatistics(
          userData.commits.map((c) => c.deletions).filter((s) => s > 0)
        ),
        normalizedSizes: this.calculateStatistics(
          userData.commits
            .map((c) => c.commitSizeNormalized)
            .filter((s) => s > 0)
        ),
      };
    });

    return userBreakdown;
  }

  analyzeUserWorkingPatterns(commits) {
    const dayOfWeekCounts = {};
    const hourCounts = {};
    const monthCounts = {};

    commits.forEach((commit) => {
      const date = new Date(commit.date);
      const dayOfWeek = date.getDay();
      const hour = date.getUTCHours();
      const month = date.getMonth();

      dayOfWeekCounts[dayOfWeek] = (dayOfWeekCounts[dayOfWeek] || 0) + 1;
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
      monthCounts[month] = (monthCounts[month] || 0) + 1;
    });

    const dayNames = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    const monthNames = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];

    return {
      preferredDays: Object.entries(dayOfWeekCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([day, count]) => ({
          day: dayNames[day],
          dayNumber: parseInt(day),
          count,
        })),
      preferredHours: Object.entries(hourCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([hour, count]) => ({ hour: parseInt(hour), count })),
      monthlyDistribution: Object.entries(monthCounts)
        .map(([month, count]) => ({
          month: monthNames[month],
          monthNumber: parseInt(month),
          count,
        }))
        .sort((a, b) => b.count - a.count),
      isWeekendWorker:
        (dayOfWeekCounts[0] || 0) + (dayOfWeekCounts[6] || 0) >
        commits.length * 0.3,
      isNightOwl:
        Object.entries(hourCounts)
          .filter(([hour]) => parseInt(hour) >= 22 || parseInt(hour) <= 6)
          .reduce((sum, [, count]) => sum + count, 0) >
        commits.length * 0.3,
    };
  }

  calculateUserProductivityMetrics(commits) {
    if (commits.length === 0) return null;

    const sortedCommits = commits.sort(
      (a, b) => new Date(a.date) - new Date(b.date)
    );
    const totalDays =
      (new Date(sortedCommits[sortedCommits.length - 1].date) -
        new Date(sortedCommits[0].date)) /
      (1000 * 60 * 60 * 24);

    // Productivity consistency
    const dailyCommits = this.getDailyCommitCounts(commits);
    const activeDays = Object.keys(dailyCommits).length;
    const consistency = activeDays / Math.max(totalDays, 1);

    // Size consistency
    const commitSizes = commits.map((c) => c.totalChanges).filter((s) => s > 0);
    const sizeConsistency = this.calculateCoefficientOfVariation(commitSizes);

    // Output quality (estimated by commit size vs frequency balance)
    const avgCommitSize =
      commitSizes.length > 0
        ? commitSizes.reduce((a, b) => a + b, 0) / commitSizes.length
        : 0;
    const commitFrequency = commits.length / Math.max(totalDays, 1);
    const qualityScore =
      (avgCommitSize * commitFrequency) / Math.max(Math.max(...commitSizes), 1);

    return {
      activeDays: activeDays,
      totalDays: Math.ceil(totalDays),
      consistencyRatio: consistency,
      sizeConsistency: sizeConsistency,
      averageCommitSize: avgCommitSize,
      commitFrequency: commitFrequency,
      qualityScore: qualityScore,
      burstPeriods: this.findBurstPeriods(commits),
      longestStreak: this.calculateLongestStreak(commits),
    };
  }

  findBurstPeriods(commits) {
    // Find periods of high activity (more than 2x average daily commits)
    const dailyCommits = this.getDailyCommitCounts(commits);
    const avgDaily =
      Object.values(dailyCommits).reduce((a, b) => a + b, 0) /
      Math.max(Object.keys(dailyCommits).length, 1);
    const threshold = avgDaily * 2;

    return Object.entries(dailyCommits)
      .filter(([, count]) => count >= threshold)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([day, count]) => ({ day, count, multiplier: count / avgDaily }));
  }

  calculateLongestStreak(commits) {
    const dailyCommits = this.getDailyCommitCounts(commits);
    const sortedDays = Object.keys(dailyCommits).sort();

    let longestStreak = 0;
    let currentStreak = 1;
    let streakStart = sortedDays[0];
    let longestStreakStart = streakStart;
    let longestStreakEnd = streakStart;

    for (let i = 1; i < sortedDays.length; i++) {
      const prevDate = new Date(sortedDays[i - 1]);
      const currDate = new Date(sortedDays[i]);
      const dayDiff = (currDate - prevDate) / (1000 * 60 * 60 * 24);

      if (dayDiff <= 1) {
        currentStreak++;
      } else {
        if (currentStreak > longestStreak) {
          longestStreak = currentStreak;
          longestStreakStart = streakStart;
          longestStreakEnd = sortedDays[i - 1];
        }
        currentStreak = 1;
        streakStart = sortedDays[i];
      }
    }

    // Check final streak
    if (currentStreak > longestStreak) {
      longestStreak = currentStreak;
      longestStreakStart = streakStart;
      longestStreakEnd = sortedDays[sortedDays.length - 1];
    }

    return {
      days: longestStreak,
      startDate: longestStreakStart,
      endDate: longestStreakEnd,
    };
  }

  groupCommitsByTimeframe(commits, timeframe = "week") {
    const groups = {};

    commits.forEach((commit) => {
      const date = new Date(commit.date);
      let key;

      switch (timeframe) {
        case "day":
          key = date.toISOString().split("T")[0];
          break;
        case "week":
          const weekStart = new Date(date);
          weekStart.setDate(date.getDate() - date.getDay());
          key = weekStart.toISOString().split("T")[0];
          break;
        case "month":
          key = date.toISOString().substring(0, 7);
          break;
        default:
          key = date.toISOString().split("T")[0];
      }

      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(commit);
    });

    return groups;
  }

  // Main analysis method with required signature
  async analyzeCodeVelocity(repo, owner, startDate, endDate, token = null) {
    // Use provided token or fall back to instance token
    if (token) {
      this.token = token;
    }

    const startTime = performance.now();

    this.log(`Starting code velocity analysis for ${owner}/${repo}`, "info");
    this.log(`Date range: ${startDate} to ${endDate}`, "verbose");

    // Fetch all commits in date range
    const commitParams = {
      since: new Date(startDate).toISOString(),
      until: new Date(endDate + "T23:59:59").toISOString(),
    };

    this.log("Fetching commits...", "verbose");
    const commits = await this.fetchAllPages(
      `${this.baseUrl}/repos/${owner}/${repo}/commits`,
      commitParams
    );

    this.log(`Found ${commits.length} commits in date range`, "verbose");

    const analysisData = {
      commits: [],
      summary: {
        totalCommits: commits.length,
        totalAdditions: 0,
        totalDeletions: 0,
        totalChanges: 0,
        dateRange: { start: startDate, end: endDate },
        repository: `${owner}/${repo}`,
        analyzedAt: new Date().toISOString(),
        velocity: null,
        maxCommitSize: 0,
        uniqueContributors: 0,
      },
      statistics: {
        commitSizes: null,
        commitSizeThresholds: null,
        normalizedCommitSizes: null,
        additions: null,
        deletions: null,
        timeDistribution: null,
      },
      userVelocityBreakdown: {},
      trends: {
        weeklyVelocity: {},
        monthlyVelocity: {},
        commitSizeEvolution: {},
        velocityTrends: {},
        userProductivityTrends: {},
      },
    };

    const commitSizes = [];
    const additions = [];
    const deletions = [];

    // Process each commit to get detailed stats
    for (let i = 0; i < commits.length; i++) {
      const commit = commits[i];
      this.showProgress(
        i + 1,
        commits.length,
        `Processing commit ${commit.sha.substring(0, 7)}`
      );

      try {
        // Fetch individual commit details to get stats
        const { data: commitDetail } = await this.makeRequest(
          `${this.baseUrl}/repos/${owner}/${repo}/commits/${commit.sha}`
        );

        const commitAdditions = commitDetail.stats?.additions || 0;
        const commitDeletions = commitDetail.stats?.deletions || 0;
        const totalChanges = commitAdditions + commitDeletions;

        const commitData = {
          sha: commit.sha,
          shortSha: commit.sha.substring(0, 7),
          message: commit.commit.message.split("\n")[0], // First line only
          author: commit.commit.author.name,
          authorLogin: commit.author?.login || commit.commit.author.name,
          authorEmail:
            commit.commit.author.email ||
            `${
              commit.author?.login || commit.commit.author.name
            }@unknown.email`,
          date: commit.commit.author.date,
          additions: commitAdditions,
          deletions: commitDeletions,
          totalChanges: totalChanges,
          files: commitDetail.files ? commitDetail.files.length : 0,
          commitSize: this.categorizeCommitSize(totalChanges),
          commitSizeNormalized: 0, // Will be calculated later
        };

        analysisData.commits.push(commitData);

        // Accumulate totals
        analysisData.summary.totalAdditions += commitAdditions;
        analysisData.summary.totalDeletions += commitDeletions;
        analysisData.summary.totalChanges += totalChanges;

        // Track statistics
        if (totalChanges > 0) {
          commitSizes.push(totalChanges);
          additions.push(commitAdditions);
          deletions.push(commitDeletions);
        }
      } catch (error) {
        this.log(
          `Failed to fetch details for commit ${commit.sha}: ${error.message}`,
          "verbose"
        );
        // Continue with basic commit data
        const commitData = {
          sha: commit.sha,
          shortSha: commit.sha.substring(0, 7),
          message: commit.commit.message.split("\n")[0],
          author: commit.commit.author.name,
          authorLogin: commit.author?.login || commit.commit.author.name,
          authorEmail:
            commit.commit.author.email ||
            `${
              commit.author?.login || commit.commit.author.name
            }@unknown.email`,
          date: commit.commit.author.date,
          additions: 0,
          deletions: 0,
          totalChanges: 0,
          files: 0,
          commitSize: "unknown",
          commitSizeNormalized: 0,
        };
        analysisData.commits.push(commitData);
      }
    }

    // Calculate normalized commit sizes
    const { maxSize, normalizedCommits } = this.calculateNormalizedCommitSizes(
      analysisData.commits
    );
    analysisData.commits = normalizedCommits;
    analysisData.summary.maxCommitSize = maxSize;

    // Calculate unique contributors
    const uniqueContributors = new Set(
      analysisData.commits.map((c) => c.authorEmail)
    ).size;
    analysisData.summary.uniqueContributors = uniqueContributors;

    // Analyze commit size thresholds
    analysisData.statistics.commitSizeThresholds =
      this.analyzeCommitSizeThresholds(analysisData.commits);

    // Calculate overall velocity metrics
    analysisData.summary.velocity = this.calculateVelocityMetrics(
      analysisData.commits
    );

    // Calculate statistics
    analysisData.statistics.commitSizes = this.calculateStatistics(commitSizes);
    analysisData.statistics.normalizedCommitSizes = this.calculateStatistics(
      analysisData.commits
        .map((c) => c.commitSizeNormalized)
        .filter((s) => s > 0)
    );
    analysisData.statistics.additions = this.calculateStatistics(additions);
    analysisData.statistics.deletions = this.calculateStatistics(deletions);

    // Enhanced user velocity breakdown
    analysisData.userVelocityBreakdown = this.calculateUserVelocityBreakdown(
      analysisData.commits
    );

    // Enhanced trend analysis
    analysisData.trends.commitSizeEvolution = this.analyzeCommitSizeEvolution(
      analysisData.commits
    );
    analysisData.trends.velocityTrends = this.analyzeVelocityTrends(
      analysisData.commits
    );
    analysisData.trends.userProductivityTrends =
      this.analyzeUserProductivityTrends(analysisData.userVelocityBreakdown);

    // Calculate time distribution (hour of day analysis)
    const hourDistribution = {};
    analysisData.commits.forEach((commit) => {
      const hour = new Date(commit.date).getUTCHours();
      hourDistribution[hour] = (hourDistribution[hour] || 0) + 1;
    });
    analysisData.statistics.timeDistribution = hourDistribution;

    const endTime = performance.now();
    this.log(
      `Analysis completed in ${Math.round(endTime - startTime)}ms`,
      "info"
    );

    return analysisData;
  }

  // Analyze commit size evolution over time
  analyzeCommitSizeEvolution(commits) {
    const sortedCommits = commits.sort(
      (a, b) => new Date(a.date) - new Date(b.date)
    );
    const evolution = {};

    // Group by week and analyze size trends
    const weeklyGroups = this.groupCommitsByTimeframe(sortedCommits, "week");
    Object.entries(weeklyGroups).forEach(([week, weekCommits]) => {
      const sizes = weekCommits
        .map((c) => c.commitSizeNormalized)
        .filter((s) => s > 0);
      evolution[week] = {
        averageSize:
          sizes.length > 0
            ? sizes.reduce((a, b) => a + b, 0) / sizes.length
            : 0,
        maxSize: sizes.length > 0 ? Math.max(...sizes) : 0,
        commitCount: weekCommits.length,
        sizeVariance: this.calculateVariance(sizes),
        totalChanges: weekCommits.reduce((sum, c) => sum + c.totalChanges, 0),
      };
    });

    return evolution;
  }

  // Enhanced velocity trends analysis
  analyzeVelocityTrends(commits) {
    const weeklyGroups = this.groupCommitsByTimeframe(commits, "week");
    const monthlyGroups = this.groupCommitsByTimeframe(commits, "month");

    const weeklyData = Object.entries(weeklyGroups).map(
      ([week, weekCommits]) => ({
        period: week,
        commitCount: weekCommits.length,
        totalChanges: weekCommits.reduce((sum, c) => sum + c.totalChanges, 0),
        avgCommitSize:
          weekCommits.length > 0
            ? weekCommits.reduce((sum, c) => sum + c.totalChanges, 0) /
              weekCommits.length
            : 0,
      })
    );

    const monthlyData = Object.entries(monthlyGroups).map(
      ([month, monthCommits]) => ({
        period: month,
        commitCount: monthCommits.length,
        totalChanges: monthCommits.reduce((sum, c) => sum + c.totalChanges, 0),
        avgCommitSize:
          monthCommits.length > 0
            ? monthCommits.reduce((sum, c) => sum + c.totalChanges, 0) /
              monthCommits.length
            : 0,
      })
    );

    const trends = {
      weekly: {
        commitTrend: this.calculateTrend(
          weeklyData.map((d) => ({ period: d.period, value: d.commitCount }))
        ),
        changeTrend: this.calculateTrend(
          weeklyData.map((d) => ({ period: d.period, value: d.totalChanges }))
        ),
        sizeTrend: this.calculateTrend(
          weeklyData.map((d) => ({ period: d.period, value: d.avgCommitSize }))
        ),
        data: weeklyData,
      },
      monthly: {
        commitTrend: this.calculateTrend(
          monthlyData.map((d) => ({ period: d.period, value: d.commitCount }))
        ),
        changeTrend: this.calculateTrend(
          monthlyData.map((d) => ({ period: d.period, value: d.totalChanges }))
        ),
        sizeTrend: this.calculateTrend(
          monthlyData.map((d) => ({ period: d.period, value: d.avgCommitSize }))
        ),
        data: monthlyData,
      },
    };

    return trends;
  }

  // Analyze user productivity trends over time
  analyzeUserProductivityTrends(userBreakdown) {
    const trends = {};

    Object.entries(userBreakdown).forEach(([userKey, userData]) => {
      const userCommits = userData.commits;
      const weeklyGroups = this.groupCommitsByTimeframe(userCommits, "week");

      const weeklyData = Object.entries(weeklyGroups).map(
        ([week, weekCommits]) => ({
          period: week,
          commitCount: weekCommits.length,
          totalChanges: weekCommits.reduce((sum, c) => sum + c.totalChanges, 0),
          avgCommitSize:
            weekCommits.length > 0
              ? weekCommits.reduce((sum, c) => sum + c.totalChanges, 0) /
                weekCommits.length
              : 0,
        })
      );

      trends[userKey] = {
        commitTrend: this.calculateTrend(
          weeklyData.map((d) => ({ period: d.period, value: d.commitCount }))
        ),
        changeTrend: this.calculateTrend(
          weeklyData.map((d) => ({ period: d.period, value: d.totalChanges }))
        ),
        sizeTrend: this.calculateTrend(
          weeklyData.map((d) => ({ period: d.period, value: d.avgCommitSize }))
        ),
        weeklyData: weeklyData,
        authorName: userData.authorName,
        authorEmail: userData.authorEmail,
      };
    });

    return trends;
  }

  // Calculate trend direction (increasing/decreasing/stable)
  calculateTrend(data) {
    if (data.length < 2) return { direction: "insufficient_data", slope: 0 };

    const sortedData = data.sort((a, b) => a.period.localeCompare(b.period));
    const n = sortedData.length;

    // Simple linear regression to determine trend
    const sumX = sortedData.reduce((sum, _, i) => sum + i, 0);
    const sumY = sortedData.reduce((sum, item) => sum + item.value, 0);
    const sumXY = sortedData.reduce((sum, item, i) => sum + i * item.value, 0);
    const sumXX = sortedData.reduce((sum, _, i) => sum + i * i, 0);

    const denominator = n * sumXX - sumX * sumX;
    const slope =
      denominator !== 0 ? (n * sumXY - sumX * sumY) / denominator : 0;

    let direction = "stable";
    if (slope > 0.1) direction = "increasing";
    else if (slope < -0.1) direction = "decreasing";

    return { direction, slope, dataPoints: n };
  }

  // Calculate variance for size analysis
  calculateVariance(values) {
    if (values.length === 0) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance =
      values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
      values.length;
    return variance;
  }

  categorizeCommitSize(changes) {
    if (changes === 0) return "empty";
    if (changes <= 5) return "tiny";
    if (changes <= 50) return "small";
    if (changes <= 200) return "medium";
    if (changes <= 1000) return "large";
    return "huge";
  }

  getWeekKey(date) {
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - date.getDay());
    return weekStart.toISOString().split("T")[0];
  }

  async exportToJSON(data, filename) {
    try {
      await writeFile(filename, JSON.stringify(data, null, 2));
      this.log(`Data exported to JSON: ${filename}`, "info");
    } catch (error) {
      this.log(`Failed to export JSON: ${error.message}`, "error");
      throw error;
    }
  }

  async exportToCSV(data, filename) {
    try {
      const csvHeaders = [
        "Commit SHA",
        "Short SHA",
        "Message",
        "Author Name",
        "Author Login",
        "Author Email",
        "Date",
        "Additions",
        "Deletions",
        "Total Changes",
        "Files Changed",
        "Commit Size Category",
        "Normalized Commit Size",
      ];

      const csvRows = data.commits.map((commit) => [
        commit.sha,
        commit.shortSha,
        `"${commit.message.replace(/"/g, '""')}"`,
        `"${commit.author.replace(/"/g, '""')}"`,
        commit.authorLogin,
        commit.authorEmail,
        commit.date,
        commit.additions,
        commit.deletions,
        commit.totalChanges,
        commit.files,
        commit.commitSize,
        commit.commitSizeNormalized.toFixed(4),
      ]);

      const statsSection = [
        "",
        "# CODE VELOCITY ANALYSIS SUMMARY",
        `# Repository: ${data.summary.repository}`,
        `# Date Range: ${data.summary.dateRange.start} to ${data.summary.dateRange.end}`,
        `# Total Commits: ${data.summary.totalCommits}`,
        `# Unique Contributors: ${data.summary.uniqueContributors}`,
        `# Total Additions: ${data.summary.totalAdditions}`,
        `# Total Deletions: ${data.summary.totalDeletions}`,
        `# Total Changes: ${data.summary.totalChanges}`,
        `# Max Commit Size: ${data.summary.maxCommitSize}`,
        "",
        "# COMMIT SIZE THRESHOLD ANALYSIS (0-1 NORMALIZED)",
      ];

      if (data.statistics.commitSizeThresholds) {
        Object.entries(data.statistics.commitSizeThresholds).forEach(
          ([threshold, stats]) => {
            statsSection.push(
              `# ${threshold.toUpperCase()} (${stats.range}): ${
                stats.count
              } commits (${stats.percentage.toFixed(1)}%) - ${
                stats.description
              }`
            );
          }
        );
        statsSection.push("");
      }

      if (data.summary.velocity) {
        const velocity = data.summary.velocity;
        statsSection.push(
          `# Commits per day: ${velocity.commitsPerDay.toFixed(2)}`,
          `# Average time between commits (hours): ${velocity.averageTimeBetweenCommits.toFixed(
            2
          )}`,
          `# Velocity consistency: ${velocity.velocityConsistency.toFixed(3)}`,
          `# Time span (days): ${velocity.timeSpanDays.toFixed(1)}`,
          ""
        );
      }

      // Add user velocity breakdown summary
      if (data.userVelocityBreakdown) {
        statsSection.push("# TOP CONTRIBUTORS BY VELOCITY");
        const topUsers = Object.entries(data.userVelocityBreakdown)
          .sort(([, a], [, b]) => b.totalCommits - a.totalCommits)
          .slice(0, 10);

        topUsers.forEach(([email, userData], index) => {
          const avgSize =
            userData.totalCommits > 0
              ? (userData.totalChanges / userData.totalCommits).toFixed(0)
              : 0;
          const commitsPerDay = userData.velocity
            ? userData.velocity.commitsPerDay.toFixed(2)
            : "0.00";
          statsSection.push(
            `# ${index + 1}. ${userData.authorName} (${email}): ${
              userData.totalCommits
            } commits, ${commitsPerDay}/day, avg: ${avgSize} lines`
          );
        });
        statsSection.push("");
      }

      if (data.statistics.commitSizes) {
        const stats = data.statistics.commitSizes;
        statsSection.push(
          `# Average commit size: ${stats.mean.toFixed(0)} lines`,
          `# Median commit size: ${stats.median.toFixed(0)} lines`,
          `# Largest commit: ${stats.max} lines`,
          `# 90th percentile commit size: ${stats.p90} lines`,
          ""
        );
      }

      const csvContent = [
        `# GitHub Code Velocity Analysis Report - User Velocity Breakdown`,
        `# Generated: ${data.summary.analyzedAt}`,
        ...statsSection,
        csvHeaders.join(","),
        ...csvRows.map((row) => row.join(",")),
      ].join("\n");

      await writeFile(filename, csvContent);
      this.log(`Data exported to CSV: ${filename}`, "info");
    } catch (error) {
      this.log(`Failed to export CSV: ${error.message}`, "error");
      throw error;
    }
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    repo: null,
    format: "json",
    output: null,
    start: null,
    end: null,
    verbose: false,
    debug: false,
    token: null,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case "-r":
      case "--repo":
        options.repo = nextArg;
        i++;
        break;
      case "-f":
      case "--format":
        options.format = nextArg;
        i++;
        break;
      case "-o":
      case "--output":
        options.output = nextArg;
        i++;
        break;
      case "-s":
      case "--start":
        options.start = nextArg;
        i++;
        break;
      case "-e":
      case "--end":
        options.end = nextArg;
        i++;
        break;
      case "-t":
      case "--token":
        options.token = nextArg;
        i++;
        break;
      case "-v":
      case "--verbose":
        options.verbose = true;
        break;
      case "-d":
      case "--debug":
        options.debug = true;
        break;
      case "-h":
      case "--help":
        options.help = true;
        break;
    }
  }

  return options;
}

function showHelp() {
  console.log(`
GitHub Repository Analysis Tool - Code Velocity Report with User Breakdown

Usage: node main.mjs [options]

Options:
  -r, --repo <owner/repo>           Repository to analyze (required)
  -f, --format <format>             Output format: json (default) or csv
  -o, --output <filename>           Output filename (auto-generated if not provided)
  -s, --start <date>                Start date (ISO format: YYYY-MM-DD)
  -e, --end <date>                  End date (ISO format: YYYY-MM-DD)
  -v, --verbose                     Enable verbose logging
  -d, --debug                       Enable debug logging
  -t, --token <token>               GitHub Token (or use GITHUB_TOKEN env var)
  -h, --help                        Show help message

Examples:
  node main.mjs -r facebook/react -s 2024-01-01 -e 2024-06-30
  node main.mjs -r microsoft/vscode -f csv -o velocity_report.csv -v
  node main.mjs -r vercel/next.js -s 2023-06-01 -e 2024-01-01 -t ghp_token123

Environment Variables:
  GITHUB_TOKEN                      GitHub personal access token

Enhanced User Velocity Breakdown Features:
  - Code velocity metrics breakdown per user email
  - Normalized commit size analysis (0-1 range) with enhanced threshold splits
  - User working patterns analysis (preferred days, hours, weekend/night activity)
  - Productivity metrics including consistency, streaks, and burst periods
  - Individual user commit size distribution with 6-tier threshold analysis
  - User-specific velocity trends and evolution tracking
  - Comprehensive author statistics with productivity scoring

Commit Size Analysis (Enhanced 0-1 Splits):
  - Micro commits (0-0.1): Tiny changes up to 10% of max
  - Small commits (0.1-0.3): Small changes 10-30% of max
  - Medium commits (0.3-0.5): Medium changes 30-50% of max
  - Large commits (0.5-0.7): Large changes 50-70% of max
  - Huge commits (0.7-0.9): Huge changes 70-90% of max
  - Massive commits (0.9-1.0): Massive changes 90-100% of max

User Velocity Metrics Included:
  - Commits per day and frequency analysis per user
  - Individual commit size patterns and consistency
  - Working hour preferences and activity patterns
  - Productivity consistency and quality scoring
  - Longest streaks and burst activity periods
  - Trend analysis for each contributor
  - Author-specific velocity evolution over time
  - Weekend/night working pattern identification

Report Structure:
  - Overall repository velocity summary with date range
  - Individual user velocity breakdown by email
  - Commit size distribution analysis per user
  - Productivity trends and working patterns
  - Comparative velocity metrics across contributors
  - Time-based trend analysis (weekly/monthly)
  - Enhanced statistics with variance and consistency metrics
`);
}

function validateOptions(options) {
  const errors = [];

  if (!options.repo) {
    errors.push("Repository (-r, --repo) is required");
  } else if (!options.repo.includes("/")) {
    errors.push('Repository must be in format "owner/repo"');
  }

  if (!options.token && !process.env.GITHUB_TOKEN) {
    errors.push(
      "GitHub token is required via -t/--token flag or GITHUB_TOKEN environment variable"
    );
  }

  if (options.start && !isValidDate(options.start)) {
    errors.push("Start date must be in ISO format (YYYY-MM-DD)");
  }

  if (options.end && !isValidDate(options.end)) {
    errors.push("End date must be in ISO format (YYYY-MM-DD)");
  }

  if (
    options.start &&
    options.end &&
    new Date(options.start) > new Date(options.end)
  ) {
    errors.push("Start date must be before end date");
  }

  if (!["json", "csv"].includes(options.format)) {
    errors.push('Format must be either "json" or "csv"');
  }

  return errors;
}

function isValidDate(dateString) {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateString)) return false;

  const date = new Date(dateString);
  return date instanceof Date && !isNaN(date);
}

function generateFilename(repo, format, dateRange) {
  const repoName = repo.replace("/", "_");
  const timestamp = new Date().toISOString().split("T")[0];
  const dateRangeStr = dateRange
    ? `_${dateRange.start}_to_${dateRange.end}`
    : "";
  return `github_velocity_breakdown_${repoName}${dateRangeStr}_${timestamp}.${format}`;
}

async function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    return;
  }

  const validationErrors = validateOptions(options);
  if (validationErrors.length > 0) {
    console.error("❌ Validation errors:");
    validationErrors.forEach((error) => console.error(`   • ${error}`));
    console.error("\nUse -h or --help for usage information.");
    process.exit(1);
  }

  const token = options.token || process.env.GITHUB_TOKEN;
  const [owner, repo] = options.repo.split("/");

  // Set default date range if not provided (last 90 days)
  const endDate = options.end || new Date().toISOString().split("T")[0];
  const startDate =
    options.start ||
    new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  try {
    const analyzer = new GitHubAnalyzer(token, {
      verbose: options.verbose,
      debug: options.debug,
    });

    const analysisData = await analyzer.analyzeCodeVelocity(
      repo,
      owner,
      startDate,
      endDate
    );

    // Generate output filename if not provided
    const outputFilename =
      options.output ||
      generateFilename(options.repo, options.format, {
        start: startDate,
        end: endDate,
      });

    // Export data
    if (options.format === "csv") {
      await analyzer.exportToCSV(analysisData, outputFilename);
    } else {
      await analyzer.exportToJSON(analysisData, outputFilename);
    }

    // Display comprehensive summary
    console.log("\n🚀 Code Velocity Analysis Summary with User Breakdown:");
    console.log(`   Repository: ${analysisData.summary.repository}`);
    console.log(
      `   Date Range: ${analysisData.summary.dateRange.start} to ${analysisData.summary.dateRange.end}`
    );
    console.log(`   Total Commits: ${analysisData.summary.totalCommits}`);
    console.log(
      `   Unique Contributors: ${analysisData.summary.uniqueContributors}`
    );
    console.log(
      `   Total Code Changes: ${analysisData.summary.totalChanges.toLocaleString()} lines`
    );
    console.log(
      `   Max Commit Size: ${analysisData.summary.maxCommitSize.toLocaleString()} lines`
    );

    if (analysisData.summary.velocity) {
      const velocity = analysisData.summary.velocity;
      console.log(`\n📈 Overall Repository Velocity:`);
      console.log(`   Commits per day: ${velocity.commitsPerDay.toFixed(2)}`);
      console.log(
        `   Avg time between commits: ${velocity.averageTimeBetweenCommits.toFixed(
          1
        )} hours`
      );
      console.log(
        `   Velocity consistency: ${velocity.velocityConsistency.toFixed(3)}`
      );
      console.log(
        `   Analysis timespan: ${velocity.timeSpanDays.toFixed(1)} days`
      );
    }

    if (analysisData.statistics.commitSizeThresholds) {
      console.log(`\n📊 Commit Size Distribution (Normalized 0-1):`);
      Object.entries(analysisData.statistics.commitSizeThresholds).forEach(
        ([threshold, stats]) => {
          console.log(
            `   ${threshold.padEnd(8)} (${stats.range}): ${stats.count
              .toString()
              .padStart(4)} commits (${stats.percentage
              .toFixed(1)
              .padStart(5)}%) - ${stats.description}`
          );
        }
      );
    }

    // Enhanced user velocity breakdown display
    if (analysisData.userVelocityBreakdown) {
      console.log(`\n👥 Top Contributors by Velocity (Email Breakdown):`);
      const topUsers = Object.entries(analysisData.userVelocityBreakdown)
        .sort(([, a], [, b]) => b.totalCommits - a.totalCommits)
        .slice(0, 10);

      topUsers.forEach(([email, userData], index) => {
        const avgSize =
          userData.totalCommits > 0
            ? (userData.totalChanges / userData.totalCommits).toFixed(0)
            : 0;
        const commitsPerDay = userData.velocity
          ? userData.velocity.commitsPerDay.toFixed(2)
          : "0.00";
        const consistency = userData.velocity
          ? userData.velocity.velocityConsistency.toFixed(3)
          : "0.000";

        console.log(`   ${index + 1}. ${userData.authorName} <${email}>`);
        console.log(
          `      Commits: ${userData.totalCommits}, Rate: ${commitsPerDay}/day, Avg size: ${avgSize} lines, Consistency: ${consistency}`
        );

        // Show working patterns
        if (userData.workingPatterns) {
          const topDay = userData.workingPatterns.preferredDays[0];
          const topHour = userData.workingPatterns.preferredHours[0];
          const patterns = [];
          if (userData.workingPatterns.isWeekendWorker)
            patterns.push("weekend worker");
          if (userData.workingPatterns.isNightOwl) patterns.push("night owl");
          const patternStr =
            patterns.length > 0 ? ` (${patterns.join(", ")})` : "";

          console.log(
            `      Peak: ${topDay ? topDay.day : "N/A"}, ${
              topHour ? topHour.hour + ":00" : "N/A"
            }${patternStr}`
          );
        }

        // Show commit size distribution
        if (userData.commitSizeDistribution) {
          const topSizes = Object.entries(userData.commitSizeDistribution)
            .filter(([, stats]) => stats.count > 0)
            .sort(([, a], [, b]) => b.count - a.count)
            .slice(0, 3);

          const sizeStr = topSizes
            .map(([size, stats]) => `${size}:${stats.count}`)
            .join(", ");

          console.log(`      Sizes: ${sizeStr}`);
        }

        console.log(); // Empty line for spacing
      });
    }

    // Show velocity trends
    if (analysisData.trends.velocityTrends) {
      console.log("📈 Velocity Trend Analysis:");
      const weeklyTrend = analysisData.trends.velocityTrends.weekly;
      const monthlyTrend = analysisData.trends.velocityTrends.monthly;

      console.log(
        `   Weekly commit trend: ${
          weeklyTrend.commitTrend.direction
        } (slope: ${weeklyTrend.commitTrend.slope.toFixed(3)})`
      );
      console.log(
        `   Weekly size trend: ${
          weeklyTrend.sizeTrend.direction
        } (slope: ${weeklyTrend.sizeTrend.slope.toFixed(3)})`
      );
      console.log(
        `   Monthly commit trend: ${
          monthlyTrend.commitTrend.direction
        } (slope: ${monthlyTrend.commitTrend.slope.toFixed(3)})`
      );
    }

    // Show peak activity periods
    if (
      analysisData.trends.velocityTrends &&
      analysisData.trends.velocityTrends.weekly.data
    ) {
      const weeklyEntries = analysisData.trends.velocityTrends.weekly.data
        .sort((a, b) => b.commitCount - a.commitCount)
        .slice(0, 3);

      if (weeklyEntries.length > 0) {
        console.log("\n📅 Most Active Weeks:");
        weeklyEntries.forEach(([week, stats], index) => {
          console.log(
            `   ${index + 1}. Week of ${week.period}: ${
              week.commitCount
            } commits, ${week.totalChanges.toLocaleString()} lines changed`
          );
        });
      }
    }

    console.log(`\n📁 Output File: ${outputFilename}\n`);
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    if (options.debug) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`❌ Unexpected error: ${error.message}`);
  process.exit(1);
});
