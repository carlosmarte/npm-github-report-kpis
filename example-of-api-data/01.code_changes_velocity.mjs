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

  showProgress(current, total, operation) {
    const percentage = Math.round((current / total) * 100);
    const filled = Math.round(percentage / 5);
    const empty = 20 - filled;
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

    return {
      commitsPerDay: daysSpan > 0 ? commits.length / daysSpan : 0,
      averageTimeBetweenCommits:
        intervals.length > 0
          ? intervals.reduce((a, b) => a + b, 0) / intervals.length
          : 0,
      timeSpanDays: daysSpan,
      commitFrequency: {
        total: commits.length,
        timeSpanDays: daysSpan,
        rate: daysSpan > 0 ? commits.length / daysSpan : 0,
      },
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
    };
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

  // Analyze commit size thresholds (0-1 splits)
  analyzeCommitSizeThresholds(commits) {
    const thresholds = [
      { name: "tiny", min: 0, max: 0.2 },
      { name: "small", min: 0.2, max: 0.4 },
      { name: "medium", min: 0.4, max: 0.6 },
      { name: "large", min: 0.6, max: 0.8 },
      { name: "huge", min: 0.8, max: 1.0 },
    ];

    const analysis = {};

    thresholds.forEach((threshold) => {
      const commitsInRange = commits.filter(
        (commit) =>
          (commit.commitSizeNormalized >= threshold.min &&
            commit.commitSizeNormalized < threshold.max) ||
          (threshold.max === 1.0 && commit.commitSizeNormalized === 1.0)
      );

      analysis[threshold.name] = {
        range: `${threshold.min}-${threshold.max}`,
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
        commits: commitsInRange.map((c) => ({
          sha: c.shortSha,
          author: c.authorLogin,
          date: c.date,
          changes: c.totalChanges,
          normalizedSize: c.commitSizeNormalized,
        })),
      };
    });

    return analysis;
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
      },
      statistics: {
        commitSizes: null,
        commitSizeThresholds: null,
        normalizedCommitSizes: null,
        additions: null,
        deletions: null,
        byAuthor: {},
        byWeek: {},
        byMonth: {},
        timeDistribution: null,
      },
      trends: {
        weeklyVelocity: {},
        monthlyVelocity: {},
        authorProductivity: {},
        commitSizeEvolution: {},
        velocityTrends: {},
      },
    };

    const commitSizes = [];
    const additions = [];
    const deletions = [];
    const authorStats = {};
    const weeklyStats = {};
    const monthlyStats = {};

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

        // Track by author
        const authorKey = commitData.authorLogin;
        if (!authorStats[authorKey]) {
          authorStats[authorKey] = {
            commits: [],
            totalAdditions: 0,
            totalDeletions: 0,
            totalChanges: 0,
            commitCount: 0,
          };
        }
        authorStats[authorKey].commits.push(commitData);
        authorStats[authorKey].totalAdditions += commitAdditions;
        authorStats[authorKey].totalDeletions += commitDeletions;
        authorStats[authorKey].totalChanges += totalChanges;
        authorStats[authorKey].commitCount++;

        // Track by week
        const commitWeek = this.getWeekKey(new Date(commit.commit.author.date));
        if (!weeklyStats[commitWeek]) {
          weeklyStats[commitWeek] = {
            commits: [],
            totalAdditions: 0,
            totalDeletions: 0,
            totalChanges: 0,
            commitCount: 0,
          };
        }
        weeklyStats[commitWeek].commits.push(commitData);
        weeklyStats[commitWeek].totalAdditions += commitAdditions;
        weeklyStats[commitWeek].totalDeletions += commitDeletions;
        weeklyStats[commitWeek].totalChanges += totalChanges;
        weeklyStats[commitWeek].commitCount++;

        // Track by month
        const commitMonth = new Date(commit.commit.author.date)
          .toISOString()
          .substring(0, 7);
        if (!monthlyStats[commitMonth]) {
          monthlyStats[commitMonth] = {
            commits: [],
            totalAdditions: 0,
            totalDeletions: 0,
            totalChanges: 0,
            commitCount: 0,
          };
        }
        monthlyStats[commitMonth].commits.push(commitData);
        monthlyStats[commitMonth].totalAdditions += commitAdditions;
        monthlyStats[commitMonth].totalDeletions += commitDeletions;
        monthlyStats[commitMonth].totalChanges += totalChanges;
        monthlyStats[commitMonth].commitCount++;
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

    // Calculate author statistics and velocity
    Object.entries(authorStats).forEach(([author, data]) => {
      const authorVelocity = this.calculateVelocityMetrics(data.commits);
      const authorNormalized = this.calculateNormalizedCommitSizes(
        data.commits
      );

      analysisData.statistics.byAuthor[author] = {
        velocity: authorVelocity,
        commitSizes: this.calculateStatistics(
          data.commits.map((c) => c.totalChanges).filter((s) => s > 0)
        ),
        commitSizeThresholds: this.analyzeCommitSizeThresholds(
          authorNormalized.normalizedCommits
        ),
        commitCount: data.commitCount,
        totalAdditions: data.totalAdditions,
        totalDeletions: data.totalDeletions,
        totalChanges: data.totalChanges,
        averageCommitSize:
          data.commitCount > 0 ? data.totalChanges / data.commitCount : 0,
      };
    });

    // Calculate weekly trends with enhanced metrics
    Object.entries(weeklyStats).forEach(([week, data]) => {
      const weekVelocity = this.calculateVelocityMetrics(data.commits);
      const weekNormalized = this.calculateNormalizedCommitSizes(data.commits);

      analysisData.statistics.byWeek[week] = {
        velocity: weekVelocity,
        commitCount: data.commitCount,
        totalAdditions: data.totalAdditions,
        totalDeletions: data.totalDeletions,
        totalChanges: data.totalChanges,
        averageCommitSize:
          data.commitCount > 0 ? data.totalChanges / data.commitCount : 0,
        commitSizeThresholds: this.analyzeCommitSizeThresholds(
          weekNormalized.normalizedCommits
        ),
      };

      analysisData.trends.weeklyVelocity[week] = {
        commitsPerDay: weekVelocity ? weekVelocity.commitsPerDay : 0,
        totalChanges: data.totalChanges,
        commitCount: data.commitCount,
        averageCommitSize:
          data.commitCount > 0 ? data.totalChanges / data.commitCount : 0,
      };
    });

    // Calculate monthly trends with enhanced metrics
    Object.entries(monthlyStats).forEach(([month, data]) => {
      const monthVelocity = this.calculateVelocityMetrics(data.commits);
      const monthNormalized = this.calculateNormalizedCommitSizes(data.commits);

      analysisData.statistics.byMonth[month] = {
        velocity: monthVelocity,
        commitCount: data.commitCount,
        totalAdditions: data.totalAdditions,
        totalDeletions: data.totalDeletions,
        totalChanges: data.totalChanges,
        averageCommitSize:
          data.commitCount > 0 ? data.totalChanges / data.commitCount : 0,
        commitSizeThresholds: this.analyzeCommitSizeThresholds(
          monthNormalized.normalizedCommits
        ),
      };

      analysisData.trends.monthlyVelocity[month] = {
        commitsPerDay: monthVelocity ? monthVelocity.commitsPerDay : 0,
        totalChanges: data.totalChanges,
        commitCount: data.commitCount,
        averageCommitSize:
          data.commitCount > 0 ? data.totalChanges / data.commitCount : 0,
      };
    });

    // Enhanced trend analysis
    analysisData.trends.commitSizeEvolution = this.analyzeCommitSizeEvolution(
      analysisData.commits
    );
    analysisData.trends.velocityTrends = this.analyzeVelocityTrends(
      weeklyStats,
      monthlyStats
    );

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
      };
    });

    return evolution;
  }

  // Analyze velocity trends
  analyzeVelocityTrends(weeklyStats, monthlyStats) {
    const trends = {
      weeklyTrend: this.calculateTrend(
        Object.entries(weeklyStats).map(([week, data]) => ({
          period: week,
          value: data.commitCount,
        }))
      ),
      monthlyTrend: this.calculateTrend(
        Object.entries(monthlyStats).map(([month, data]) => ({
          period: month,
          value: data.commitCount,
        }))
      ),
      changeTrend: this.calculateTrend(
        Object.entries(weeklyStats).map(([week, data]) => ({
          period: week,
          value: data.totalChanges,
        }))
      ),
    };

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

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);

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
        "Author",
        "Author Login",
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
        `# Total Additions: ${data.summary.totalAdditions}`,
        `# Total Deletions: ${data.summary.totalDeletions}`,
        `# Total Changes: ${data.summary.totalChanges}`,
        `# Max Commit Size: ${data.summary.maxCommitSize}`,
        "",
        "# COMMIT SIZE THRESHOLD ANALYSIS",
      ];

      if (data.statistics.commitSizeThresholds) {
        Object.entries(data.statistics.commitSizeThresholds).forEach(
          ([threshold, stats]) => {
            statsSection.push(
              `# ${threshold.toUpperCase()} (${stats.range}): ${
                stats.count
              } commits (${stats.percentage.toFixed(1)}%)`
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
          `# Time span (days): ${velocity.timeSpanDays.toFixed(1)}`,
          ""
        );
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
        `# GitHub Code Velocity Analysis Report`,
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
GitHub Repository Analysis Tool - Code Velocity Report

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

Report Features:
  - Code velocity metrics (commits per day, time between commits)
  - Normalized commit size analysis (0-1 range with threshold splits)
  - Enhanced trend analysis and velocity evolution tracking
  - Author productivity breakdown with commit size patterns
  - Weekly and monthly velocity trends with size distribution
  - Time distribution analysis (working hours)
  - Statistical analysis of code changes with variance tracking
  - Export to JSON or CSV formats with embedded date ranges
  - Progress tracking and retry logic for API reliability

Commit Size Analysis:
  - Normalized commit sizes (0-1 range based on maximum commit in dataset)
  - Threshold splits: tiny (0-0.2), small (0.2-0.4), medium (0.4-0.6), large (0.6-0.8), huge (0.8-1.0)
  - Commit size evolution trends over time
  - Author-specific commit size patterns
  - Weekly/monthly commit size distribution analysis

Velocity Metrics Included:
  - Commits per day across date range
  - Average time between commits
  - Commit size distribution with normalized analysis
  - Author productivity comparisons with size patterns
  - Weekly/monthly velocity trends with size evolution
  - Peak activity time analysis
  - Code change patterns and statistical variance
  - Trend direction analysis (increasing/decreasing/stable)
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
  return `github_velocity_${repoName}${dateRangeStr}_${timestamp}.${format}`;
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

    // Display summary
    console.log("\n🚀 Code Velocity Analysis Summary:");
    console.log(`   Repository: ${analysisData.summary.repository}`);
    console.log(
      `   Date Range: ${analysisData.summary.dateRange.start} to ${analysisData.summary.dateRange.end}`
    );
    console.log(`   Total Commits: ${analysisData.summary.totalCommits}`);
    console.log(
      `   Total Code Changes: ${analysisData.summary.totalChanges.toLocaleString()} lines`
    );
    console.log(
      `   Max Commit Size: ${analysisData.summary.maxCommitSize.toLocaleString()} lines`
    );

    if (analysisData.summary.velocity) {
      const velocity = analysisData.summary.velocity;
      console.log(`\n📈 Velocity Metrics:`);
      console.log(`   Commits per day: ${velocity.commitsPerDay.toFixed(2)}`);
      console.log(
        `   Avg time between commits: ${velocity.averageTimeBetweenCommits.toFixed(
          1
        )} hours`
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
            `   ${threshold.padEnd(6)} (${stats.range}): ${stats.count
              .toString()
              .padStart(4)} commits (${stats.percentage
              .toFixed(1)
              .padStart(5)}%)`
          );
        }
      );
    }

    if (analysisData.statistics.commitSizes) {
      const stats = analysisData.statistics.commitSizes;
      console.log(`\n📊 Commit Size Statistics:`);
      console.log(`   Average: ${stats.mean.toFixed(0)} lines per commit`);
      console.log(`   Median: ${stats.median.toFixed(0)} lines per commit`);
      console.log(`   Largest commit: ${stats.max.toLocaleString()} lines`);
      console.log(`   90th percentile: ${stats.p90.toLocaleString()} lines`);
    }

    console.log(`\n📁 Output File: ${outputFilename}\n`);

    // Show top authors by commit count
    const topAuthors = Object.entries(analysisData.statistics.byAuthor)
      .sort(([, a], [, b]) => b.commitCount - a.commitCount)
      .slice(0, 5);

    if (topAuthors.length > 0) {
      console.log("👥 Top Contributors by Velocity:");
      topAuthors.forEach(([author, stats], index) => {
        const avgCommitSize = stats.averageCommitSize.toFixed(0);
        const commitsPerDay = stats.velocity
          ? stats.velocity.commitsPerDay.toFixed(2)
          : "0.00";
        console.log(
          `   ${index + 1}. ${author}: ${
            stats.commitCount
          } commits (${commitsPerDay}/day, avg: ${avgCommitSize} lines)`
        );
      });
    }

    // Show velocity trends
    if (analysisData.trends.velocityTrends) {
      console.log("\n📈 Velocity Trend Analysis:");
      const weeklyTrend = analysisData.trends.velocityTrends.weeklyTrend;
      const monthlyTrend = analysisData.trends.velocityTrends.monthlyTrend;

      console.log(
        `   Weekly commit trend: ${
          weeklyTrend.direction
        } (slope: ${weeklyTrend.slope.toFixed(3)})`
      );
      console.log(
        `   Monthly commit trend: ${
          monthlyTrend.direction
        } (slope: ${monthlyTrend.slope.toFixed(3)})`
      );
    }

    // Show peak activity weeks
    const weeklyEntries = Object.entries(analysisData.trends.weeklyVelocity)
      .sort(([, a], [, b]) => b.commitCount - a.commitCount)
      .slice(0, 3);

    if (weeklyEntries.length > 0) {
      console.log("\n📅 Most Active Weeks:");
      weeklyEntries.forEach(([week, stats], index) => {
        console.log(
          `   ${index + 1}. Week of ${week}: ${
            stats.commitCount
          } commits, ${stats.totalChanges.toLocaleString()} lines changed`
        );
      });
    }
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
