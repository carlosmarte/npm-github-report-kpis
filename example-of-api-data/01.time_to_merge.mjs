#!/usr/bin/env node

import { createWriteStream } from "fs";
import { writeFile } from "fs/promises";
import { basename } from "path";
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

  async analyzeTimeToMerge(repo, owner, startDate, endDate) {
    const startTime = performance.now();

    this.log(`Starting time-to-merge analysis for ${owner}/${repo}`, "info");
    this.log(`Date range: ${startDate} to ${endDate}`, "verbose");

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
      },
      statistics: {
        timeToMerge: null,
        byAuthor: {},
        byMonth: {},
      },
    };

    const mergeTimes = [];
    const authorStats = {};
    const monthlyStats = {};

    // Process each PR
    for (let i = 0; i < filteredPRs.length; i++) {
      const pr = filteredPRs[i];
      this.showProgress(
        i + 1,
        filteredPRs.length,
        `Processing PR #${pr.number}`
      );

      const prData = {
        number: pr.number,
        title: pr.title,
        author: pr.user.login,
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

        // Track by author
        const author = pr.user.login;
        if (!authorStats[author]) {
          authorStats[author] = { mergeTimes: [], count: 0 };
        }
        authorStats[author].mergeTimes.push(timeToMerge.totalHours);
        authorStats[author].count++;

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

    // Calculate author statistics
    Object.entries(authorStats).forEach(([author, data]) => {
      analysisData.statistics.byAuthor[author] = {
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
        `# GitHub Time-to-Merge Analysis Report`,
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
GitHub Repository Analysis Tool - Time-to-Merge per PR Report

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
  node main.mjs -r microsoft/vscode -f csv -o merge_report.csv -v
  node main.mjs -r vercel/next.js -s 2023-06-01 -e 2024-01-01 -t ghp_token123

Environment Variables:
  GITHUB_TOKEN                      GitHub personal access token

Report Features:
  - Time-to-merge calculation for all PRs in date range
  - Statistical analysis (mean, median, percentiles)
  - Breakdown by author and month
  - Comprehensive PR metadata (additions, deletions, labels)
  - Export to JSON or CSV formats with embedded date ranges
  - Progress tracking and retry logic for API reliability

Metrics Included:
  - Individual PR merge times
  - Statistical distribution of merge times
  - Author-based analysis
  - Monthly trends
  - PR metadata (size, complexity indicators)
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
  return `github_time_to_merge_${repoName}${dateRangeStr}_${timestamp}.${format}`;
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

    const analysisData = await analyzer.analyzeTimeToMerge(
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
    console.log("\n📊 Time-to-Merge Analysis Summary:");
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

    if (analysisData.statistics.timeToMerge) {
      const stats = analysisData.statistics.timeToMerge;
      const formatDuration = analyzer.formatDuration.bind(analyzer);
      console.log(`\n⏱️  Merge Time Statistics:`);
      console.log(`   Average: ${formatDuration(stats.mean)}`);
      console.log(`   Median: ${formatDuration(stats.median)}`);
      console.log(
        `   Range: ${formatDuration(stats.min)} - ${formatDuration(stats.max)}`
      );
      console.log(`   90th percentile: ${formatDuration(stats.p90)}`);
    }

    console.log(`\n📁 Output File: ${outputFilename}\n`);

    // Show top authors by merge count
    const topAuthors = Object.entries(analysisData.statistics.byAuthor)
      .sort(([, a], [, b]) => b.totalMergedPRs - a.totalMergedPRs)
      .slice(0, 5);

    if (topAuthors.length > 0) {
      console.log("👥 Top Contributors by Merged PRs:");
      topAuthors.forEach(([author, stats], index) => {
        const avgTime = analyzer.formatDuration(stats.mean);
        console.log(
          `   ${index + 1}. ${author}: ${
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
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`❌ Unexpected error: ${error.message}`);
  process.exit(1);
});
