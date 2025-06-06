#!/usr/bin/env node

/*
JSON Report Structure:
{
  summary: {
    repository: "owner/repo",
    dateRange: { start: "YYYY-MM-DD", end: "YYYY-MM-DD" },
    totalPRs: number,
    mergedPRs: number,
    analyzedAt: "ISO timestamp"
  },
  pullRequests: [{
    number: number,
    title: string,
    author: string,
    authorEmail: string,
    createdAt: "ISO timestamp",
    mergedAt: "ISO timestamp",
    timeToMerge: {
      totalMs: number,
      totalHours: number,
      totalDays: number,
      humanReadable: "Xd Yh Zm"
    }
  }],
  statistics: {
    timeToMerge: {
      count: number,
      mean: number,
      median: number,
      min: number,
      max: number,
      p90: number
    },
    byAuthorEmail: {
      "user@email.com": {
        count: number,
        mean: number,
        median: number,
        totalMergedPRs: number
      }
    }
  }
}

Use Cases:
- Team Productivity Analysis: Track merge frequency and patterns by developer email
- Performance Benchmarking: Compare merge times across different time periods
- Process Improvement: Identify bottlenecks in PR review and merge workflows
- Individual Developer Metrics: Analyze contribution patterns by email address
- Release Planning: Estimate merge times for future sprint planning
- Code Review Efficiency: Monitor time from PR creation to merge completion
*/

import { createWriteStream } from "fs";
import { writeFile } from "fs/promises";
import { basename } from "path";
import { performance } from "perf_hooks";

class GitHubPRMergeAnalyzer {
  constructor(token, options = {}) {
    this.token = token;
    this.baseUrl = "https://api.github.com";
    this.verbose = options.verbose || false;
    this.debug = options.debug || false;
    this.fetchLimit = options.fetchLimit || 200;
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
      // Fix: Use Bearer token format instead of legacy token format
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "GitHub-PR-Merge-Analyzer-CLI",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });

      // Fix: Better rate limit handling
      if (response.status === 403) {
        const rateLimitRemaining = response.headers.get(
          "x-ratelimit-remaining"
        );
        if (rateLimitRemaining === "0") {
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
      }

      // Fix: Better error handling for authentication and permissions
      if (response.status === 401) {
        throw new Error(
          "Authentication failed: Invalid or expired GitHub token. Please check your token permissions."
        );
      }

      if (
        response.status === 403 &&
        !response.headers.get("x-ratelimit-remaining")
      ) {
        throw new Error(
          "Access forbidden: Token may lack proper repository access scopes. Ensure token has 'repo' or 'public_repo' scope."
        );
      }

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "Unknown error");
        throw new Error(
          `HTTP ${response.status}: ${response.statusText}. ${errorBody}`
        );
      }

      const data = await response.json();
      this.log(`API request successful: ${url}`, "debug");
      return { data, response };
    } catch (error) {
      // Fix: Better error logging with full error details
      this.log(`Request error details: ${error.message}`, "debug");
      console.log(`Full error:`, error);

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
    let fetchedCount = 0;

    while (
      hasMore &&
      (this.fetchLimit === "infinite" || fetchedCount < this.fetchLimit)
    ) {
      const url = new URL(baseUrl);
      Object.entries({ ...params, page, per_page: 100 }).forEach(
        ([key, value]) => {
          if (value !== undefined) url.searchParams.set(key, value);
        }
      );

      const { data, response } = await this.makeRequest(url.toString());
      allData.push(...data);
      fetchedCount += data.length;

      const linkHeader = response.headers.get("link");
      hasMore =
        linkHeader && linkHeader.includes('rel="next"') && data.length > 0;
      page++;

      this.log(
        `Fetched page ${page - 1}, ${
          data.length
        } items (total: ${fetchedCount})`,
        "debug"
      );

      // Check fetch limit
      if (this.fetchLimit !== "infinite" && fetchedCount >= this.fetchLimit) {
        this.log(`Reached fetch limit of ${this.fetchLimit} items`, "verbose");
        break;
      }
    }

    return allData;
  }

  async getUserEmail(username) {
    try {
      const { data } = await this.makeRequest(
        `${this.baseUrl}/users/${username}`
      );
      return data.email || `${username}@users.noreply.github.com`;
    } catch (error) {
      this.log(
        `Failed to fetch email for ${username}: ${error.message}`,
        "debug"
      );
      return `${username}@users.noreply.github.com`;
    }
  }

  calculateTimeToMerge(createdAt, mergedAt) {
    if (!mergedAt) return null;

    const created = new Date(createdAt);
    const merged = new Date(mergedAt);
    const diffMs = merged - created;

    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor(
      (diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
    );
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    return {
      totalMs: diffMs,
      totalHours: diffMs / (1000 * 60 * 60),
      totalDays: diffMs / (1000 * 60 * 60 * 24),
      humanReadable: `${days}d ${hours}h ${minutes}m`,
    };
  }

  calculateStatistics(mergeTimes) {
    if (mergeTimes.length === 0) return null;

    const sorted = [...mergeTimes].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, time) => acc + time, 0);

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

  formatDuration(hours) {
    if (hours < 1) {
      return `${Math.round(hours * 60)}m`;
    } else if (hours < 24) {
      return `${Math.round(hours * 10) / 10}h`;
    } else {
      const days = Math.floor(hours / 24);
      const remainingHours = Math.round(hours % 24);
      return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
    }
  }

  async analyzeTimeToMergeByUserEmail(repo, owner, startDate, endDate) {
    const startTime = performance.now();

    this.log(
      `Starting time-to-merge analysis by user email for ${owner}/${repo}`,
      "info"
    );
    this.log(`Date range: ${startDate} to ${endDate}`, "verbose");
    this.log(`Fetch limit: ${this.fetchLimit}`, "verbose");

    // Fetch all pull requests in date range
    const prParams = {
      state: "all",
      sort: "created",
      direction: "desc",
    };

    this.log("Fetching pull requests...", "verbose");
    const pullRequests = await this.fetchAllPages(
      `${this.baseUrl}/repos/${owner}/${repo}/pulls`,
      prParams
    );

    // Filter PRs by date range
    const filteredPRs = pullRequests.filter((pr) => {
      const createdAt = new Date(pr.created_at);
      const start = new Date(startDate);
      const end = new Date(endDate);
      return createdAt >= start && createdAt <= end;
    });

    this.log(
      `Found ${filteredPRs.length} PRs in date range (filtered from ${pullRequests.length} total)`,
      "verbose"
    );

    const analysisData = {
      pullRequests: [],
      summary: {
        totalPRs: filteredPRs.length,
        mergedPRs: 0,
        closedWithoutMerge: 0,
        stillOpen: 0,
        dateRange: { start: startDate, end: endDate },
        repository: `${owner}/${repo}`,
        analyzedAt: new Date().toISOString(),
        fetchLimit: this.fetchLimit,
      },
      statistics: {
        timeToMerge: null,
        byAuthorEmail: {},
        byMonth: {},
      },
    };

    const mergeTimes = [];
    const authorEmailStats = {};
    const monthlyStats = {};
    const userEmailCache = new Map();

    // Process each PR
    for (let i = 0; i < filteredPRs.length; i++) {
      const pr = filteredPRs[i];
      this.showProgress(
        i + 1,
        filteredPRs.length,
        `Processing PR #${pr.number}`
      );

      // Get user email (with caching)
      let authorEmail;
      if (userEmailCache.has(pr.user.login)) {
        authorEmail = userEmailCache.get(pr.user.login);
      } else {
        authorEmail = await this.getUserEmail(pr.user.login);
        userEmailCache.set(pr.user.login, authorEmail);
      }

      const prData = {
        number: pr.number,
        title: pr.title,
        author: pr.user.login,
        authorEmail: authorEmail,
        createdAt: pr.created_at,
        mergedAt: pr.merged_at,
        closedAt: pr.closed_at,
        state: pr.state,
        merged: pr.merged_at !== null,
        timeToMerge: null,
        labels: pr.labels.map((label) => label.name),
        additions: pr.additions || 0,
        deletions: pr.deletions || 0,
        changedFiles: pr.changed_files || 0,
      };

      // Calculate time to merge if PR was merged
      if (pr.merged_at) {
        analysisData.summary.mergedPRs++;
        const timeToMerge = this.calculateTimeToMerge(
          pr.created_at,
          pr.merged_at
        );
        prData.timeToMerge = timeToMerge;
        mergeTimes.push(timeToMerge.totalHours);

        // Track by author email
        if (!authorEmailStats[authorEmail]) {
          authorEmailStats[authorEmail] = { mergeTimes: [], count: 0 };
        }
        authorEmailStats[authorEmail].mergeTimes.push(timeToMerge.totalHours);
        authorEmailStats[authorEmail].count++;

        // Track by month
        const mergedMonth = new Date(pr.merged_at)
          .toISOString()
          .substring(0, 7);
        if (!monthlyStats[mergedMonth]) {
          monthlyStats[mergedMonth] = { mergeTimes: [], count: 0 };
        }
        monthlyStats[mergedMonth].mergeTimes.push(timeToMerge.totalHours);
        monthlyStats[mergedMonth].count++;
      } else if (pr.state === "closed") {
        analysisData.summary.closedWithoutMerge++;
      } else {
        analysisData.summary.stillOpen++;
      }

      analysisData.pullRequests.push(prData);
    }

    // Calculate overall statistics
    analysisData.statistics.timeToMerge = this.calculateStatistics(mergeTimes);

    // Calculate author email statistics
    Object.entries(authorEmailStats).forEach(([email, data]) => {
      analysisData.statistics.byAuthorEmail[email] = {
        ...this.calculateStatistics(data.mergeTimes),
        totalMergedPRs: data.count,
      };
    });

    // Calculate monthly statistics
    Object.entries(monthlyStats).forEach(([month, data]) => {
      analysisData.statistics.byMonth[month] = {
        ...this.calculateStatistics(data.mergeTimes),
        totalMergedPRs: data.count,
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
      const csvHeaders = [
        "PR Number",
        "Title",
        "Author",
        "Author Email",
        "Created At",
        "Merged At",
        "State",
        "Time to Merge (Hours)",
        "Time to Merge (Human)",
        "Additions",
        "Deletions",
        "Changed Files",
        "Labels",
      ];

      const csvRows = data.pullRequests.map((pr) => [
        pr.number,
        `"${pr.title.replace(/"/g, '""')}"`,
        pr.author,
        pr.authorEmail,
        pr.createdAt,
        pr.mergedAt || "",
        pr.state,
        pr.timeToMerge ? pr.timeToMerge.totalHours.toFixed(2) : "",
        pr.timeToMerge ? pr.timeToMerge.humanReadable : "",
        pr.additions,
        pr.deletions,
        pr.changedFiles,
        `"${pr.labels.join(", ")}"`,
      ]);

      const statsSection = [
        "",
        "# STATISTICS SUMMARY",
        `# Repository: ${data.summary.repository}`,
        `# Date Range: ${data.summary.dateRange.start} to ${data.summary.dateRange.end}`,
        `# Total PRs: ${data.summary.totalPRs}`,
        `# Merged PRs: ${data.summary.mergedPRs}`,
        `# Closed without merge: ${data.summary.closedWithoutMerge}`,
        `# Still open: ${data.summary.stillOpen}`,
        `# Fetch Limit: ${data.summary.fetchLimit}`,
        "",
      ];

      if (data.statistics.timeToMerge) {
        const stats = data.statistics.timeToMerge;
        statsSection.push(
          `# Average time to merge: ${this.formatDuration(stats.mean)}`,
          `# Median time to merge: ${this.formatDuration(stats.median)}`,
          `# Min time to merge: ${this.formatDuration(stats.min)}`,
          `# Max time to merge: ${this.formatDuration(stats.max)}`,
          `# 90th percentile: ${this.formatDuration(stats.p90)}`,
          ""
        );
      }

      const csvContent = [
        `# GitHub Time-to-Merge Analysis Report by User Email`,
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
    fetchLimit: 200,
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
      case "-l":
      case "--fetchLimit":
        options.fetchLimit =
          nextArg === "infinite" ? "infinite" : parseInt(nextArg);
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
GitHub Repository Analysis Tool - Time-to-Merge by User Email Report

Usage: node main.mjs [options]

Options:
  -r, --repo <owner/repo>           Repository to analyze (required)
  -f, --format <format>             Output format: json (default) or csv
  -o, --output <filename>           Output filename (auto-generated if not provided)
  -s, --start <date>                Start date (ISO format: YYYY-MM-DD) default: -30 days
  -e, --end <date>                  End date (ISO format: YYYY-MM-DD) default: now
  -v, --verbose                     Enable verbose logging
  -d, --debug                       Enable debug logging
  -t, --token <token>               GitHub Token (or use GITHUB_TOKEN env var)
  -l, --fetchLimit <number|infinite> Set fetch limit (default: 200, use 'infinite' for no limit)
  -h, --help                        Show help message

Examples:
  node main.mjs -r facebook/react -s 2024-01-01 -e 2024-06-30
  node main.mjs -r microsoft/vscode -f csv -o merge_report.csv -v
  node main.mjs -r vercel/next.js -s 2023-06-01 -e 2024-01-01 -t ghp_token123 -l infinite
  node main.mjs -r nodejs/node -l 500 --verbose

Environment Variables:
  GITHUB_TOKEN                      GitHub personal access token

Report Features:
  - Time-to-merge calculation for all PRs in date range
  - Analysis by user email address for team productivity tracking
  - Statistical analysis (mean, median, percentiles)
  - Breakdown by author email and month
  - Comprehensive PR metadata (additions, deletions, labels)
  - Export to JSON or CSV formats with embedded date ranges
  - Progress tracking and retry logic for API reliability
  - Configurable fetch limits for large repositories

Metrics Included:
  - Individual PR merge times by user email
  - Statistical distribution of merge times per developer
  - Email-based team performance analysis
  - Monthly trends with date range inclusion
  - PR metadata (size, complexity indicators)

Team Productivity Use Cases:
  - Track individual developer merge efficiency
  - Identify team collaboration patterns
  - Monitor code review bottlenecks by contributor
  - Analyze development velocity trends
  - Compare performance across team members
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

  if (
    options.fetchLimit !== "infinite" &&
    (isNaN(options.fetchLimit) || options.fetchLimit < 1)
  ) {
    errors.push('Fetch limit must be a positive number or "infinite"');
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
  return `github_merge_time_by_email_${repoName}${dateRangeStr}_${timestamp}.${format}`;
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

  // Set default date range if not provided (last 30 days)
  const endDate = options.end || new Date().toISOString().split("T")[0];
  const startDate =
    options.start ||
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  try {
    const analyzer = new GitHubPRMergeAnalyzer(token, {
      verbose: options.verbose,
      debug: options.debug,
      fetchLimit: options.fetchLimit,
    });

    const analysisData = await analyzer.analyzeTimeToMergeByUserEmail(
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
    console.log("\n📊 Time-to-Merge Analysis by User Email Summary:");
    console.log(`   Repository: ${analysisData.summary.repository}`);
    console.log(
      `   Date Range: ${analysisData.summary.dateRange.start} to ${analysisData.summary.dateRange.end}`
    );
    console.log(`   Total PRs: ${analysisData.summary.totalPRs}`);
    console.log(`   Merged PRs: ${analysisData.summary.mergedPRs}`);
    console.log(
      `   Closed without merge: ${analysisData.summary.closedWithoutMerge}`
    );
    console.log(`   Still open: ${analysisData.summary.stillOpen}`);
    console.log(`   Fetch Limit: ${analysisData.summary.fetchLimit}`);

    if (analysisData.statistics.timeToMerge) {
      const stats = analysisData.statistics.timeToMerge;
      const formatDuration = analyzer.formatDuration.bind(analyzer);
      console.log(`\n⏱️  Overall Merge Time Statistics:`);
      console.log(`   Average: ${formatDuration(stats.mean)}`);
      console.log(`   Median: ${formatDuration(stats.median)}`);
      console.log(
        `   Range: ${formatDuration(stats.min)} - ${formatDuration(stats.max)}`
      );
      console.log(`   90th percentile: ${formatDuration(stats.p90)}`);
    }

    console.log(`\n📁 Output File: ${outputFilename}\n`);

    // Show top contributors by merge count with email
    const topContributors = Object.entries(
      analysisData.statistics.byAuthorEmail
    )
      .sort(([, a], [, b]) => b.totalMergedPRs - a.totalMergedPRs)
      .slice(0, 5);

    if (topContributors.length > 0) {
      console.log("👥 Top Contributors by Merged PRs (by email):");
      topContributors.forEach(([email, stats], index) => {
        const avgTime = analyzer.formatDuration(stats.mean);
        console.log(
          `   ${index + 1}. ${email}: ${
            stats.totalMergedPRs
          } PRs (avg: ${avgTime})`
        );
      });
    }
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    if (options.debug) {
      console.error(error.stack);
    }

    // Common error explanations and solutions
    if (error.message.includes("Authentication failed")) {
      console.error("\n💡 Solution: Check your GitHub token:");
      console.error("   • Ensure the token is valid and not expired");
      console.error(
        "   • Use the new fine-grained personal access tokens if available"
      );
      console.error(
        "   • Set token via -t flag or GITHUB_TOKEN environment variable"
      );
    } else if (error.message.includes("Access forbidden")) {
      console.error("\n💡 Solution: Check token permissions:");
      console.error('   • Ensure token has "repo" scope for private repos');
      console.error('   • Use "public_repo" scope for public repositories');
      console.error("   • Regenerate token with proper scopes if needed");
    } else if (error.message.includes("Rate limit")) {
      console.error("\n💡 Solution: Wait for rate limit reset or:");
      console.error("   • Use authenticated requests (token provided)");
      console.error("   • Reduce fetch limit with -l flag");
      console.error("   • Try again in a few minutes");
    }

    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`❌ Unexpected error: ${error.message}`);
  process.exit(1);
});
