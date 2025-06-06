#!/usr/bin/env node

/*
JSON Report Structure:
{
  "summary": {
    "repository": "owner/repo",
    "dateRange": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
    "totalCommits": number,
    "totalAdditions": number,
    "totalDeletions": number,
    "totalChurnRate": number,
    "analyzedAt": "ISO date"
  },
  "commits": [
    {
      "sha": "commit hash",
      "author": "user email",
      "date": "ISO date",
      "additions": number,
      "deletions": number,
      "churnRate": number
    }
  ],
  "userStats": {
    "user@email.com": {
      "totalCommits": number,
      "totalAdditions": number,
      "totalDeletions": number,
      "avgChurnRate": number
    }
  }
}

Use Cases:
- Team Productivity Analysis: Track commit frequency and patterns
- Code Quality Assessment: Monitor additions/deletions trends  
- Collaboration Metrics: Analyze contributor participation
- Development Patterns: Identify working time distributions
- Process Improvements: Compare before/after periods for process changes
*/

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
    this.fetchLimit = options.fetchLimit || 200;
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
      // Fix: Use Bearer token format for better authentication
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "GitHub-Analyzer-CLI/1.0",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });

      // Enhanced rate limiting handling
      if (response.status === 403) {
        const rateLimitRemaining = response.headers.get(
          "x-ratelimit-remaining"
        );
        const rateLimitReset = response.headers.get("x-ratelimit-reset");

        if (rateLimitRemaining === "0") {
          const resetTime = parseInt(rateLimitReset) * 1000;
          const waitTime = resetTime - Date.now() + 1000;
          this.log(
            `Rate limit exceeded. Waiting ${Math.ceil(waitTime / 1000)}s...`,
            "verbose"
          );
          await this.sleep(waitTime);
          return this.makeRequest(url, retryCount);
        }
      }

      // Enhanced error handling for authentication and permissions
      if (response.status === 401) {
        throw new Error(
          "Authentication failed. Please check your GitHub token format and validity."
        );
      }

      if (response.status === 404) {
        throw new Error(
          "Repository not found. Please verify the repository name and your access permissions."
        );
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `HTTP ${response.status}: ${response.statusText} - ${errorText}`
        );
      }

      const data = await response.json();
      this.log(`API request successful: ${url}`, "debug");
      return { data, response };
    } catch (error) {
      // Enhanced error logging with full details
      console.log(`Full error details: ${error.message}`);

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
    let totalFetched = 0;

    while (
      hasMore &&
      (this.fetchLimit === -1 || totalFetched < this.fetchLimit)
    ) {
      const url = new URL(baseUrl);
      Object.entries({ ...params, page, per_page: 100 }).forEach(
        ([key, value]) => {
          if (value !== undefined) url.searchParams.set(key, value);
        }
      );

      const { data, response } = await this.makeRequest(url.toString());
      allData.push(...data);
      totalFetched += data.length;

      const linkHeader = response.headers.get("link");
      hasMore =
        linkHeader && linkHeader.includes('rel="next"') && data.length > 0;
      page++;

      this.log(
        `Fetched page ${page - 1}, ${
          data.length
        } items (total: ${totalFetched})`,
        "debug"
      );

      // Check fetch limit
      if (this.fetchLimit !== -1 && totalFetched >= this.fetchLimit) {
        this.log(`Reached fetch limit of ${this.fetchLimit} items`, "verbose");
        break;
      }
    }

    return allData;
  }

  calculateChurnRate(additions, deletions) {
    const totalChanges = additions + deletions;
    if (totalChanges === 0) return 0;
    return deletions / totalChanges;
  }

  async analyzeCodeChurnByUser(repo, owner, startDate, endDate) {
    const startTime = performance.now();

    this.log(
      `Starting code churn analysis by user for ${owner}/${repo}`,
      "info"
    );
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
      summary: {
        repository: `${owner}/${repo}`,
        dateRange: { start: startDate, end: endDate },
        totalCommits: commits.length,
        totalAdditions: 0,
        totalDeletions: 0,
        totalChurnRate: 0,
        analyzedAt: new Date().toISOString(),
      },
      commits: [],
      userStats: {},
    };

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

        // Get user email (prefer commit author email over GitHub username)
        const userEmail = commit.commit.author.email;
        const userName = commit.commit.author.name;
        const userKey = userEmail || userName;

        const commitData = {
          sha: commit.sha,
          shortSha: commit.sha.substring(0, 7),
          message: commit.commit.message.split("\n")[0],
          author: userKey,
          authorName: userName,
          date: commit.commit.author.date,
          additions: commitAdditions,
          deletions: commitDeletions,
          totalChanges: commitAdditions + commitDeletions,
          churnRate: churnRate,
        };

        analysisData.commits.push(commitData);

        // Accumulate totals
        analysisData.summary.totalAdditions += commitAdditions;
        analysisData.summary.totalDeletions += commitDeletions;

        // Track by user email
        if (!analysisData.userStats[userKey]) {
          analysisData.userStats[userKey] = {
            userName: userName,
            totalCommits: 0,
            totalAdditions: 0,
            totalDeletions: 0,
            totalChanges: 0,
            avgChurnRate: 0,
            commits: [],
          };
        }

        const userStats = analysisData.userStats[userKey];
        userStats.totalCommits++;
        userStats.totalAdditions += commitAdditions;
        userStats.totalDeletions += commitDeletions;
        userStats.totalChanges += commitAdditions + commitDeletions;
        userStats.commits.push({
          sha: commit.sha,
          date: commit.commit.author.date,
          additions: commitAdditions,
          deletions: commitDeletions,
          churnRate: churnRate,
        });
      } catch (error) {
        this.log(
          `Failed to fetch details for commit ${commit.sha}: ${error.message}`,
          "verbose"
        );

        // Continue with basic commit data
        const userEmail = commit.commit.author.email;
        const userName = commit.commit.author.name;
        const userKey = userEmail || userName;

        const commitData = {
          sha: commit.sha,
          shortSha: commit.sha.substring(0, 7),
          message: commit.commit.message.split("\n")[0],
          author: userKey,
          authorName: userName,
          date: commit.commit.author.date,
          additions: 0,
          deletions: 0,
          totalChanges: 0,
          churnRate: 0,
        };
        analysisData.commits.push(commitData);

        if (!analysisData.userStats[userKey]) {
          analysisData.userStats[userKey] = {
            userName: userName,
            totalCommits: 0,
            totalAdditions: 0,
            totalDeletions: 0,
            totalChanges: 0,
            avgChurnRate: 0,
            commits: [],
          };
        }
        analysisData.userStats[userKey].totalCommits++;
      }
    }

    // Calculate overall churn rate and user averages
    analysisData.summary.totalChurnRate = this.calculateChurnRate(
      analysisData.summary.totalAdditions,
      analysisData.summary.totalDeletions
    );

    // Calculate average churn rates for each user
    Object.values(analysisData.userStats).forEach((userStats) => {
      if (userStats.totalChanges > 0) {
        userStats.avgChurnRate = this.calculateChurnRate(
          userStats.totalAdditions,
          userStats.totalDeletions
        );
      }
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
        "User Email",
        "User Name",
        "Total Commits",
        "Total Additions",
        "Total Deletions",
        "Total Changes",
        "Average Churn Rate",
        "Churn Percentage",
      ];

      const csvRows = Object.entries(data.userStats).map(([email, stats]) => [
        `"${email}"`,
        `"${stats.userName.replace(/"/g, '""')}"`,
        stats.totalCommits,
        stats.totalAdditions,
        stats.totalDeletions,
        stats.totalChanges,
        stats.avgChurnRate.toFixed(4),
        (stats.avgChurnRate * 100).toFixed(2),
      ]);

      const statsSection = [
        `# GitHub Code Churn Analysis by User Email`,
        `# Generated: ${data.summary.analyzedAt}`,
        `# Repository: ${data.summary.repository}`,
        `# Date Range: ${data.summary.dateRange.start} to ${data.summary.dateRange.end}`,
        `# Total Commits: ${data.summary.totalCommits}`,
        `# Total Additions: ${data.summary.totalAdditions}`,
        `# Total Deletions: ${data.summary.totalDeletions}`,
        `# Overall Churn Rate: ${(data.summary.totalChurnRate * 100).toFixed(
          2
        )}%`,
        "",
        csvHeaders.join(","),
        ...csvRows.map((row) => row.join(",")),
      ];

      await writeFile(filename, statsSection.join("\n"));
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
    fetchLimit: 200,
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
      case "-l":
      case "--fetchLimit":
        options.fetchLimit = nextArg === "infinite" ? -1 : parseInt(nextArg);
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
GitHub Code Churn Analysis by User Email

Usage: node main.mjs [options]

Options:
  -r, --repo <owner/repo>         Repository to analyze (required)
  -f, --format <format>           Output format: json (default) or csv
  -o, --output <filename>         Output filename (auto-generated if not provided)
  -s, --start <date>              Start date (ISO format: YYYY-MM-DD) default -30Days
  -e, --end <date>                End date (ISO format: YYYY-MM-DD) default: now
  -v, --verbose                   Enable verbose logging
  -d, --debug                     Enable debug logging
  -t, --token                     GitHub Token
  -l, --fetchLimit                Set fetch limit (default: 200, use 'infinite' for no limit)
  -h, --help                      Show help message

Environment Variables:
  GITHUB_TOKEN                    GitHub personal access token

Examples:
  node main.mjs -r facebook/react -s 2024-01-01 -e 2024-06-30
  node main.mjs -r microsoft/vscode -f csv -o churn_by_user.csv -v
  node main.mjs -r vercel/next.js -l infinite -t ghp_token123

Report Features:
- Code churn analysis grouped by user email
- Additions, deletions, and churn rate per user
- Date range filtering with automatic defaults
- Progress tracking with retry logic
- Export to JSON or CSV formats
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
  return `github_churn_by_user_${repoName}${dateRangeStr}_${timestamp}.${format}`;
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
    const analyzer = new GitHubAnalyzer(token, {
      verbose: options.verbose,
      debug: options.debug,
      fetchLimit: options.fetchLimit,
    });

    const analysisData = await analyzer.analyzeCodeChurnByUser(
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
    console.log("\n📊 Code Churn Analysis by User Summary:");
    console.log(`   Repository: ${analysisData.summary.repository}`);
    console.log(
      `   Date Range: ${analysisData.summary.dateRange.start} to ${analysisData.summary.dateRange.end}`
    );
    console.log(`   Total Commits: ${analysisData.summary.totalCommits}`);
    console.log(
      `   Unique Users: ${Object.keys(analysisData.userStats).length}`
    );
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

    console.log(`\n📁 Output File: ${outputFilename}\n`);

    // Show top contributors
    const topContributors = Object.entries(analysisData.userStats)
      .sort(([, a], [, b]) => b.totalCommits - a.totalCommits)
      .slice(0, 5);

    if (topContributors.length > 0) {
      console.log("👥 Top Contributors by Commit Count:");
      topContributors.forEach(([email, stats], index) => {
        const churnRate = (stats.avgChurnRate * 100).toFixed(1);
        console.log(
          `   ${index + 1}. ${email}: ${
            stats.totalCommits
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
