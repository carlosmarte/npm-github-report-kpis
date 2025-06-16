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

  async analyzeCodeChurnRate(repo, owner, startDate, endDate) {
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
      commits: [],
      summary: {
        totalCommits: commits.length,
        totalAdditions: 0,
        totalDeletions: 0,
        totalChurnRate: 0,
        dateRange: { start: startDate, end: endDate },
        repository: `${owner}/${repo}`,
        analyzedAt: new Date().toISOString(),
      },
      statistics: {
        churnRates: null,
        byAuthor: {},
        byMonth: {},
        additions: null,
        deletions: null,
      },
    };

    const churnRates = [];
    const additions = [];
    const deletions = [];
    const authorStats = {};
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
        const churnRate = this.calculateChurnRate(
          commitAdditions,
          commitDeletions
        );

        const commitData = {
          sha: commit.sha,
          shortSha: commit.sha.substring(0, 7),
          message: commit.commit.message.split("\n")[0], // First line only
          author: commit.commit.author.name,
          authorLogin: commit.author?.login || commit.commit.author.name,
          date: commit.commit.author.date,
          additions: commitAdditions,
          deletions: commitDeletions,
          totalChanges: commitAdditions + commitDeletions,
          churnRate: churnRate,
          churnPercentage: Math.round(churnRate * 100 * 100) / 100, // 2 decimal places
        };

        analysisData.commits.push(commitData);

        // Accumulate totals
        analysisData.summary.totalAdditions += commitAdditions;
        analysisData.summary.totalDeletions += commitDeletions;

        // Only include commits with changes for statistics
        if (commitAdditions + commitDeletions > 0) {
          churnRates.push(churnRate);
          additions.push(commitAdditions);
          deletions.push(commitDeletions);

          // Track by author
          const authorKey = commitData.authorLogin;
          if (!authorStats[authorKey]) {
            authorStats[authorKey] = {
              churnRates: [],
              additions: [],
              deletions: [],
              commitCount: 0,
              totalAdditions: 0,
              totalDeletions: 0,
            };
          }
          authorStats[authorKey].churnRates.push(churnRate);
          authorStats[authorKey].additions.push(commitAdditions);
          authorStats[authorKey].deletions.push(commitDeletions);
          authorStats[authorKey].commitCount++;
          authorStats[authorKey].totalAdditions += commitAdditions;
          authorStats[authorKey].totalDeletions += commitDeletions;

          // Track by month
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
            };
          }
          monthlyStats[commitMonth].churnRates.push(churnRate);
          monthlyStats[commitMonth].additions.push(commitAdditions);
          monthlyStats[commitMonth].deletions.push(commitDeletions);
          monthlyStats[commitMonth].commitCount++;
          monthlyStats[commitMonth].totalAdditions += commitAdditions;
          monthlyStats[commitMonth].totalDeletions += commitDeletions;
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
          date: commit.commit.author.date,
          additions: 0,
          deletions: 0,
          totalChanges: 0,
          churnRate: 0,
          churnPercentage: 0,
        };
        analysisData.commits.push(commitData);
      }
    }

    // Calculate overall churn rate
    analysisData.summary.totalChurnRate = this.calculateChurnRate(
      analysisData.summary.totalAdditions,
      analysisData.summary.totalDeletions
    );

    // Calculate statistics
    analysisData.statistics.churnRates = this.calculateStatistics(churnRates);
    analysisData.statistics.additions = this.calculateStatistics(additions);
    analysisData.statistics.deletions = this.calculateStatistics(deletions);

    // Calculate author statistics
    Object.entries(authorStats).forEach(([author, data]) => {
      analysisData.statistics.byAuthor[author] = {
        churnRates: this.calculateStatistics(data.churnRates),
        additions: this.calculateStatistics(data.additions),
        deletions: this.calculateStatistics(data.deletions),
        commitCount: data.commitCount,
        totalAdditions: data.totalAdditions,
        totalDeletions: data.totalDeletions,
        overallChurnRate: this.calculateChurnRate(
          data.totalAdditions,
          data.totalDeletions
        ),
      };
    });

    // Calculate monthly statistics
    Object.entries(monthlyStats).forEach(([month, data]) => {
      analysisData.statistics.byMonth[month] = {
        churnRates: this.calculateStatistics(data.churnRates),
        additions: this.calculateStatistics(data.additions),
        deletions: this.calculateStatistics(data.deletions),
        commitCount: data.commitCount,
        totalAdditions: data.totalAdditions,
        totalDeletions: data.totalDeletions,
        overallChurnRate: this.calculateChurnRate(
          data.totalAdditions,
          data.totalDeletions
        ),
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
        "Commit SHA",
        "Short SHA",
        "Message",
        "Author",
        "Author Login",
        "Date",
        "Additions",
        "Deletions",
        "Total Changes",
        "Churn Rate",
        "Churn Percentage",
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
        commit.churnRate.toFixed(4),
        commit.churnPercentage,
      ]);

      const statsSection = [
        "",
        "# CODE CHURN RATE ANALYSIS SUMMARY",
        `# Repository: ${data.summary.repository}`,
        `# Date Range: ${data.summary.dateRange.start} to ${data.summary.dateRange.end}`,
        `# Total Commits: ${data.summary.totalCommits}`,
        `# Total Additions: ${data.summary.totalAdditions}`,
        `# Total Deletions: ${data.summary.totalDeletions}`,
        `# Overall Churn Rate: ${(data.summary.totalChurnRate * 100).toFixed(
          2
        )}%`,
        "",
      ];

      if (data.statistics.churnRates) {
        const stats = data.statistics.churnRates;
        statsSection.push(
          `# Average churn rate: ${(stats.mean * 100).toFixed(2)}%`,
          `# Median churn rate: ${(stats.median * 100).toFixed(2)}%`,
          `# Min churn rate: ${(stats.min * 100).toFixed(2)}%`,
          `# Max churn rate: ${(stats.max * 100).toFixed(2)}%`,
          `# 90th percentile: ${(stats.p90 * 100).toFixed(2)}%`,
          ""
        );
      }

      const csvContent = [
        `# GitHub Code Churn Rate Analysis Report`,
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
GitHub Repository Analysis Tool - Code Churn Rate Report

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

Report Features:
  - Code churn rate calculation (deletions/total changes) for all commits
  - Statistical analysis of churn rates (mean, median, percentiles)  
  - Breakdown by author and month
  - Comprehensive commit metadata (additions, deletions, messages)
  - Export to JSON or CSV formats with embedded date ranges
  - Progress tracking and retry logic for API reliability

Metrics Included:
  - Individual commit churn rates
  - Statistical distribution of churn rates
  - Author-based churn analysis
  - Monthly churn trends
  - Commit metadata (size, complexity indicators)
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
  return `github_code_churn_${repoName}${dateRangeStr}_${timestamp}.${format}`;
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

    // Display summary
    console.log("\n📊 Code Churn Rate Analysis Summary:");
    console.log(`   Repository: ${analysisData.summary.repository}`);
    console.log(
      `   Date Range: ${analysisData.summary.dateRange.start} to ${analysisData.summary.dateRange.end}`
    );
    console.log(`   Total Commits: ${analysisData.summary.totalCommits}`);
    console.log(
      `   Total Additions: ${analysisData.summary.totalAdditions.toLocaleString()}`
    );
    console.log(
      `   Total Deletions: ${analysisData.summary.totalDeletions.toLocaleString()}`
    );
    console.log(
      `   Overall Churn Rate: ${(
        analysisData.summary.totalChurnRate * 100
      ).toFixed(2)}%`
    );

    if (analysisData.statistics.churnRates) {
      const stats = analysisData.statistics.churnRates;
      console.log(`\n📈 Churn Rate Statistics:`);
      console.log(`   Average: ${(stats.mean * 100).toFixed(2)}%`);
      console.log(`   Median: ${(stats.median * 100).toFixed(2)}%`);
      console.log(
        `   Range: ${(stats.min * 100).toFixed(2)}% - ${(
          stats.max * 100
        ).toFixed(2)}%`
      );
      console.log(`   90th percentile: ${(stats.p90 * 100).toFixed(2)}%`);
    }

    console.log(`\n📁 Output File: ${outputFilename}\n`);

    // Show top authors by commit count
    const topAuthors = Object.entries(analysisData.statistics.byAuthor)
      .sort(([, a], [, b]) => b.commitCount - a.commitCount)
      .slice(0, 5);

    if (topAuthors.length > 0) {
      console.log("👥 Top Contributors by Commit Count:");
      topAuthors.forEach(([author, stats], index) => {
        const churnRate = (stats.overallChurnRate * 100).toFixed(1);
        console.log(
          `   ${index + 1}. ${author}: ${
            stats.commitCount
          } commits (churn: ${churnRate}%)`
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
