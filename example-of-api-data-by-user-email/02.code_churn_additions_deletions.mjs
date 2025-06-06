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
          "User-Agent": "GitHub-Analyzer-CLI",
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

  calculateChurnRate(additions, deletions) {
    const totalChanges = additions + deletions;
    if (totalChanges === 0) return 0;
    return deletions / totalChanges;
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
      p25: sorted[Math.floor(sorted.length * 0.25)],
      p75: sorted[Math.floor(sorted.length * 0.75)],
      p90: sorted[Math.floor(sorted.length * 0.9)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
    };
  }

  /**
   * Analyze code churn rate with detailed breakdown per user email
   * @param {string} repo - Repository name
   * @param {string} owner - Repository owner
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @param {string} endDate - End date (YYYY-MM-DD)
   * @param {string} token - GitHub token (optional, uses instance token if not provided)
   * @returns {Object} Analysis data with detailed user breakdown
   */
  async analyzeCodeChurnRate(repo, owner, startDate, endDate, token = null) {
    // Use provided token or instance token
    if (token) this.token = token;

    const startTime = performance.now();

    this.log(`Starting code churn rate analysis for ${owner}/${repo}`, "info");
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
      metadata: {
        repository: `${owner}/${repo}`,
        dateRange: { start: startDate, end: endDate },
        analyzedAt: new Date().toISOString(),
        totalCommitsFound: commits.length,
      },
      summary: {
        totalCommits: commits.length,
        totalAdditions: 0,
        totalDeletions: 0,
        totalChanges: 0,
        overallChurnRate: 0,
        overallChurnPercentage: 0,
        uniqueContributors: 0,
      },
      commits: [],
      userBreakdown: {},
      statistics: {
        global: {
          churnRates: null,
          additions: null,
          deletions: null,
        },
        byUserEmail: {},
        monthlyTrends: {},
      },
    };

    const globalChurnRates = [];
    const globalAdditions = [];
    const globalDeletions = [];
    const userStats = {};
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
        const churnRate = this.calculateChurnRate(
          commitAdditions,
          commitDeletions
        );

        // Extract user information - prioritize email from commit
        const authorEmail = commit.commit.author.email;
        const authorName = commit.commit.author.name;
        const authorLogin = commit.author?.login || authorName;
        const userKey = authorEmail; // Use email as primary key

        const commitData = {
          sha: commit.sha,
          shortSha: commit.sha.substring(0, 7),
          message: commit.commit.message.split("\n")[0],
          author: {
            name: authorName,
            email: authorEmail,
            login: authorLogin,
          },
          date: commit.commit.author.date,
          stats: {
            additions: commitAdditions,
            deletions: commitDeletions,
            totalChanges: totalChanges,
            churnRate: churnRate,
            churnPercentage: Math.round(churnRate * 100 * 100) / 100,
          },
        };

        analysisData.commits.push(commitData);

        // Accumulate global totals
        analysisData.summary.totalAdditions += commitAdditions;
        analysisData.summary.totalDeletions += commitDeletions;
        analysisData.summary.totalChanges += totalChanges;

        // Only include commits with changes for statistics
        if (totalChanges > 0) {
          globalChurnRates.push(churnRate);
          globalAdditions.push(commitAdditions);
          globalDeletions.push(commitDeletions);

          // Track detailed user statistics
          if (!userStats[userKey]) {
            userStats[userKey] = {
              email: authorEmail,
              name: authorName,
              login: authorLogin,
              commits: [],
              churnRates: [],
              additions: [],
              deletions: [],
              commitCount: 0,
              totalAdditions: 0,
              totalDeletions: 0,
              totalChanges: 0,
            };
          }

          userStats[userKey].commits.push(commitData);
          userStats[userKey].churnRates.push(churnRate);
          userStats[userKey].additions.push(commitAdditions);
          userStats[userKey].deletions.push(commitDeletions);
          userStats[userKey].commitCount++;
          userStats[userKey].totalAdditions += commitAdditions;
          userStats[userKey].totalDeletions += commitDeletions;
          userStats[userKey].totalChanges += totalChanges;

          // Track monthly trends
          const commitMonth = new Date(commit.commit.author.date)
            .toISOString()
            .substring(0, 7);
          if (!monthlyStats[commitMonth]) {
            monthlyStats[commitMonth] = {
              churnRates: [],
              additions: [],
              deletions: [],
              commitCount: 0,
              totalAdditions: 0,
              totalDeletions: 0,
              uniqueUsers: new Set(),
            };
          }
          monthlyStats[commitMonth].churnRates.push(churnRate);
          monthlyStats[commitMonth].additions.push(commitAdditions);
          monthlyStats[commitMonth].deletions.push(commitDeletions);
          monthlyStats[commitMonth].commitCount++;
          monthlyStats[commitMonth].totalAdditions += commitAdditions;
          monthlyStats[commitMonth].totalDeletions += commitDeletions;
          monthlyStats[commitMonth].uniqueUsers.add(userKey);
        }
      } catch (error) {
        this.log(
          `Failed to fetch details for commit ${commit.sha}: ${error.message}`,
          "verbose"
        );

        // Continue with basic commit data
        const authorEmail = commit.commit.author.email;
        const authorName = commit.commit.author.name;
        const authorLogin = commit.author?.login || authorName;

        const commitData = {
          sha: commit.sha,
          shortSha: commit.sha.substring(0, 7),
          message: commit.commit.message.split("\n")[0],
          author: {
            name: authorName,
            email: authorEmail,
            login: authorLogin,
          },
          date: commit.commit.author.date,
          stats: {
            additions: 0,
            deletions: 0,
            totalChanges: 0,
            churnRate: 0,
            churnPercentage: 0,
          },
        };
        analysisData.commits.push(commitData);
      }
    }

    // Calculate overall metrics
    analysisData.summary.overallChurnRate = this.calculateChurnRate(
      analysisData.summary.totalAdditions,
      analysisData.summary.totalDeletions
    );
    analysisData.summary.overallChurnPercentage =
      Math.round(analysisData.summary.overallChurnRate * 100 * 100) / 100;
    analysisData.summary.uniqueContributors = Object.keys(userStats).length;

    // Calculate global statistics
    analysisData.statistics.global.churnRates =
      this.calculateStatistics(globalChurnRates);
    analysisData.statistics.global.additions =
      this.calculateStatistics(globalAdditions);
    analysisData.statistics.global.deletions =
      this.calculateStatistics(globalDeletions);

    // Calculate detailed user breakdown statistics
    Object.entries(userStats).forEach(([email, data]) => {
      const userChurnRate = this.calculateChurnRate(
        data.totalAdditions,
        data.totalDeletions
      );

      analysisData.userBreakdown[email] = {
        userInfo: {
          email: data.email,
          name: data.name,
          login: data.login,
        },
        metrics: {
          commitCount: data.commitCount,
          totalAdditions: data.totalAdditions,
          totalDeletions: data.totalDeletions,
          totalChanges: data.totalChanges,
          overallChurnRate: userChurnRate,
          overallChurnPercentage: Math.round(userChurnRate * 100 * 100) / 100,
          averageCommitSize: Math.round(data.totalChanges / data.commitCount),
          contributionPercentage:
            Math.round(
              (data.totalChanges / analysisData.summary.totalChanges) *
                100 *
                100
            ) / 100,
        },
        statistics: {
          churnRates: this.calculateStatistics(data.churnRates),
          additions: this.calculateStatistics(data.additions),
          deletions: this.calculateStatistics(data.deletions),
        },
        topCommits: data.commits
          .sort((a, b) => b.stats.totalChanges - a.stats.totalChanges)
          .slice(0, 5),
      };

      analysisData.statistics.byUserEmail[email] =
        analysisData.userBreakdown[email];
    });

    // Calculate monthly trends
    Object.entries(monthlyStats).forEach(([month, data]) => {
      analysisData.statistics.monthlyTrends[month] = {
        commitCount: data.commitCount,
        totalAdditions: data.totalAdditions,
        totalDeletions: data.totalDeletions,
        overallChurnRate: this.calculateChurnRate(
          data.totalAdditions,
          data.totalDeletions
        ),
        uniqueContributors: data.uniqueUsers.size,
        statistics: {
          churnRates: this.calculateStatistics(data.churnRates),
          additions: this.calculateStatistics(data.additions),
          deletions: this.calculateStatistics(data.deletions),
        },
      };
    });

    const endTime = performance.now();
    this.log(
      `Analysis completed in ${Math.round(endTime - startTime)}ms`,
      "info"
    );

    return analysisData;
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
      const csvLines = [];

      // Header with metadata
      csvLines.push(`# GitHub Code Churn Rate Analysis Report`);
      csvLines.push(`# Repository: ${data.metadata.repository}`);
      csvLines.push(
        `# Date Range: ${data.metadata.dateRange.start} to ${data.metadata.dateRange.end}`
      );
      csvLines.push(`# Generated: ${data.metadata.analyzedAt}`);
      csvLines.push(`# Total Commits: ${data.summary.totalCommits}`);
      csvLines.push(
        `# Unique Contributors: ${data.summary.uniqueContributors}`
      );
      csvLines.push(
        `# Overall Churn Rate: ${data.summary.overallChurnPercentage}%`
      );
      csvLines.push(``);

      // User breakdown section
      csvLines.push(`# USER EMAIL BREAKDOWN`);
      const userHeaders = [
        "User Email",
        "User Name",
        "Login",
        "Commit Count",
        "Total Additions",
        "Total Deletions",
        "Total Changes",
        "Churn Rate %",
        "Contribution %",
        "Avg Commit Size",
        "Median Churn Rate %",
        "Max Churn Rate %",
      ];
      csvLines.push(userHeaders.join(","));

      Object.entries(data.userBreakdown)
        .sort(([, a], [, b]) => b.metrics.totalChanges - a.metrics.totalChanges)
        .forEach(([email, userData]) => {
          const medianChurn = userData.statistics.churnRates?.median
            ? (userData.statistics.churnRates.median * 100).toFixed(2)
            : "0.00";
          const maxChurn = userData.statistics.churnRates?.max
            ? (userData.statistics.churnRates.max * 100).toFixed(2)
            : "0.00";

          const row = [
            `"${email}"`,
            `"${userData.userInfo.name.replace(/"/g, '""')}"`,
            userData.userInfo.login,
            userData.metrics.commitCount,
            userData.metrics.totalAdditions,
            userData.metrics.totalDeletions,
            userData.metrics.totalChanges,
            userData.metrics.overallChurnPercentage,
            userData.metrics.contributionPercentage,
            userData.metrics.averageCommitSize,
            medianChurn,
            maxChurn,
          ];
          csvLines.push(row.join(","));
        });

      csvLines.push(``);
      csvLines.push(`# DETAILED COMMIT DATA`);

      // Commit details section
      const commitHeaders = [
        "Commit SHA",
        "Short SHA",
        "Message",
        "Author Name",
        "Author Email",
        "Author Login",
        "Date",
        "Additions",
        "Deletions",
        "Total Changes",
        "Churn Rate",
        "Churn Percentage",
      ];
      csvLines.push(commitHeaders.join(","));

      data.commits.forEach((commit) => {
        const row = [
          commit.sha,
          commit.shortSha,
          `"${commit.message.replace(/"/g, '""')}"`,
          `"${commit.author.name.replace(/"/g, '""')}"`,
          commit.author.email,
          commit.author.login,
          commit.date,
          commit.stats.additions,
          commit.stats.deletions,
          commit.stats.totalChanges,
          commit.stats.churnRate.toFixed(4),
          commit.stats.churnPercentage,
        ];
        csvLines.push(row.join(","));
      });

      await writeFile(filename, csvLines.join("\n"));
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
GitHub Repository Code Churn Rate Analysis Tool

This tool analyzes code churn rates (deletions/total changes) with detailed 
breakdown per user email for any GitHub repository within a specified date range.

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
  node main.mjs -r microsoft/vscode -f csv -o churn_report.csv -v
  node main.mjs -r vercel/next.js -s 2023-06-01 -e 2024-01-01 -t ghp_token123

Environment Variables:
  GITHUB_TOKEN                      GitHub personal access token

Features:
  • Code churn rate calculation (deletions/total changes) for all commits
  • Detailed breakdown per user email with contribution percentages
  • Statistical analysis of churn rates (mean, median, percentiles)
  • Monthly trend analysis and top contributor identification
  • Comprehensive commit metadata with retry logic and rate limiting
  • Export to JSON or CSV formats with embedded date ranges
  • Progress tracking for long-running analysis

Report Sections:
  • Global Summary: Overall repository churn metrics
  • User Breakdown: Detailed analysis per contributor email
  • Commit Details: Individual commit churn rates and metadata
  • Statistical Analysis: Distribution analysis and trend identification
  • Monthly Trends: Time-based churn rate patterns
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
  return `github_churn_analysis_${repoName}${dateRangeStr}_${timestamp}.${format}`;
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

    console.log(`\n🔍 Analyzing code churn rates for ${owner}/${repo}`);
    console.log(`📅 Date range: ${startDate} to ${endDate}\n`);

    const analysisData = await analyzer.analyzeCodeChurnRate(
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
    console.log("\n📊 Code Churn Rate Analysis Summary:");
    console.log(`   Repository: ${analysisData.metadata.repository}`);
    console.log(
      `   Date Range: ${analysisData.metadata.dateRange.start} to ${analysisData.metadata.dateRange.end}`
    );
    console.log(`   Total Commits: ${analysisData.summary.totalCommits}`);
    console.log(
      `   Unique Contributors: ${analysisData.summary.uniqueContributors}`
    );
    console.log(
      `   Total Additions: ${analysisData.summary.totalAdditions.toLocaleString()}`
    );
    console.log(
      `   Total Deletions: ${analysisData.summary.totalDeletions.toLocaleString()}`
    );
    console.log(
      `   Overall Churn Rate: ${analysisData.summary.overallChurnPercentage}%`
    );

    if (analysisData.statistics.global.churnRates) {
      const stats = analysisData.statistics.global.churnRates;
      console.log(`\n📈 Global Churn Rate Statistics:`);
      console.log(`   Average: ${(stats.mean * 100).toFixed(2)}%`);
      console.log(`   Median: ${(stats.median * 100).toFixed(2)}%`);
      console.log(
        `   Range: ${(stats.min * 100).toFixed(2)}% - ${(
          stats.max * 100
        ).toFixed(2)}%`
      );
      console.log(`   90th percentile: ${(stats.p90 * 100).toFixed(2)}%`);
    }

    // Show top contributors by code changes
    const topContributors = Object.entries(analysisData.userBreakdown)
      .sort(([, a], [, b]) => b.metrics.totalChanges - a.metrics.totalChanges)
      .slice(0, 5);

    if (topContributors.length > 0) {
      console.log("\n👥 Top Contributors by Code Changes:");
      topContributors.forEach(([email, userData], index) => {
        const churnRate = userData.metrics.overallChurnPercentage;
        const contribution = userData.metrics.contributionPercentage;
        console.log(`   ${index + 1}. ${userData.userInfo.name} (${email})`);
        console.log(
          `      Changes: ${userData.metrics.totalChanges.toLocaleString()} | Churn: ${churnRate}% | Contribution: ${contribution}%`
        );
      });
    }

    // Show highest churn rate contributors
    const highestChurnContributors = Object.entries(analysisData.userBreakdown)
      .filter(([, userData]) => userData.metrics.commitCount >= 5) // Only users with significant commits
      .sort(
        ([, a], [, b]) =>
          b.metrics.overallChurnRate - a.metrics.overallChurnRate
      )
      .slice(0, 3);

    if (highestChurnContributors.length > 0) {
      console.log("\n🔥 Highest Churn Rate Contributors (5+ commits):");
      highestChurnContributors.forEach(([email, userData], index) => {
        const churnRate = userData.metrics.overallChurnPercentage;
        console.log(
          `   ${index + 1}. ${
            userData.userInfo.name
          } (${email}): ${churnRate}% churn rate`
        );
      });
    }

    console.log(`\n📁 Analysis exported to: ${outputFilename}`);
    console.log(`📈 Format: ${options.format.toUpperCase()}\n`);
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
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
