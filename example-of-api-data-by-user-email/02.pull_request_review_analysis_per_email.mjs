#!/usr/bin/env node

import { writeFile } from "fs/promises";
import { performance } from "perf_hooks";

class GitHubAnalyzer {
  constructor(options = {}) {
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

  async makeRequest(url, token, retryCount = 0) {
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `token ${token}`,
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
        return this.makeRequest(url, token, retryCount);
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
        return this.makeRequest(url, token, retryCount + 1);
      }
      throw error;
    }
  }

  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  showProgress(current, total, operation) {
    const percentage = Math.round((current / total) * 100);
    const bar = "=".repeat(Math.round(percentage / 2)).padEnd(50, "-");
    process.stdout.write(
      `\r[${bar}] ${percentage}% - ${operation} (${current}/${total})`
    );
    if (current === total) process.stdout.write("\n");
  }

  async fetchAllPages(baseUrl, token, params = {}) {
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

      const { data, response } = await this.makeRequest(url.toString(), token);
      allData.push(...data);

      const linkHeader = response.headers.get("link");
      hasMore = linkHeader && linkHeader.includes('rel="next"');
      page++;

      this.log(`Fetched page ${page - 1}, ${data.length} items`, "debug");
    }

    return allData;
  }

  async getUserEmail(username, token) {
    try {
      const { data } = await this.makeRequest(
        `${this.baseUrl}/users/${username}`,
        token
      );
      return data.email || `${username}@github.local`; // Fallback if email is private
    } catch (error) {
      this.log(
        `Failed to fetch email for ${username}: ${error.message}`,
        "debug"
      );
      return `${username}@github.local`;
    }
  }

  /**
   * Core method: Analyze review acceptance rate per user email
   * @param {string} repo - Repository name
   * @param {string} owner - Repository owner
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @param {string} endDate - End date (YYYY-MM-DD)
   * @param {string} token - GitHub token
   * @returns {Object} Analysis data with review acceptance rates per user email
   */
  async analyzeReviewAcceptanceRate(repo, owner, startDate, endDate, token) {
    const startTime = performance.now();

    this.log(
      `Starting review acceptance analysis for ${owner}/${repo}`,
      "info"
    );
    this.log(`Date range: ${startDate} to ${endDate}`, "verbose");

    // Fetch all pull requests in date range
    const prParams = {
      state: "all",
      sort: "created",
      direction: "desc",
    };

    const pullRequests = await this.fetchAllPages(
      `${this.baseUrl}/repos/${owner}/${repo}/pulls`,
      token,
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

    const reviewData = {
      reviewers: {},
      summary: {
        totalPRs: filteredPRs.length,
        totalReviews: 0,
        dateRange: { start: startDate, end: endDate },
        repository: `${owner}/${repo}`,
        analyzedAt: new Date().toISOString(),
      },
    };

    const userEmails = new Map();

    // Fetch reviews for each PR
    for (let i = 0; i < filteredPRs.length; i++) {
      const pr = filteredPRs[i];
      this.showProgress(
        i + 1,
        filteredPRs.length,
        `Fetching reviews for PR #${pr.number}`
      );

      try {
        const reviews = await this.fetchAllPages(
          `${this.baseUrl}/repos/${owner}/${repo}/pulls/${pr.number}/reviews`,
          token
        );

        reviewData.summary.totalReviews += reviews.length;

        // Process each review
        for (const review of reviews) {
          const reviewer = review.user.login;

          // Fetch email if not cached
          if (!userEmails.has(reviewer)) {
            const email = await this.getUserEmail(reviewer, token);
            userEmails.set(reviewer, email);
          }

          const reviewerEmail = userEmails.get(reviewer);

          if (!reviewData.reviewers[reviewerEmail]) {
            reviewData.reviewers[reviewerEmail] = {
              username: reviewer,
              email: reviewerEmail,
              totalReviews: 0,
              approved: 0,
              requestedChanges: 0,
              commented: 0,
              acceptanceRate: 0,
              reviewedPRs: [],
            };
          }

          const reviewerData = reviewData.reviewers[reviewerEmail];
          reviewerData.totalReviews++;
          reviewerData.reviewedPRs.push({
            prNumber: pr.number,
            prTitle: pr.title,
            state: review.state,
            submittedAt: review.submitted_at,
            prAuthor: pr.user.login,
          });

          switch (review.state) {
            case "APPROVED":
              reviewerData.approved++;
              break;
            case "CHANGES_REQUESTED":
              reviewerData.requestedChanges++;
              break;
            case "COMMENTED":
              reviewerData.commented++;
              break;
          }
        }
      } catch (error) {
        this.log(
          `Failed to fetch reviews for PR #${pr.number}: ${error.message}`,
          "error"
        );
      }
    }

    // Calculate acceptance rates
    Object.values(reviewData.reviewers).forEach((reviewer) => {
      if (reviewer.totalReviews > 0) {
        reviewer.acceptanceRate = Number(
          ((reviewer.approved / reviewer.totalReviews) * 100).toFixed(2)
        );
      }
    });

    // Sort reviewers by total reviews (most active first)
    const sortedReviewers = Object.entries(reviewData.reviewers)
      .sort(([, a], [, b]) => b.totalReviews - a.totalReviews)
      .reduce((obj, [key, value]) => {
        obj[key] = value;
        return obj;
      }, {});

    reviewData.reviewers = sortedReviewers;

    const endTime = performance.now();
    this.log(
      `Analysis completed in ${Math.round(endTime - startTime)}ms`,
      "info"
    );

    return reviewData;
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
        "Email",
        "Username",
        "Total Reviews",
        "Approved",
        "Changes Requested",
        "Commented",
        "Acceptance Rate (%)",
      ];

      const csvRows = Object.entries(data.reviewers).map(([email, stats]) => [
        email,
        stats.username,
        stats.totalReviews,
        stats.approved,
        stats.requestedChanges,
        stats.commented,
        stats.acceptanceRate,
      ]);

      const csvContent = [
        `# GitHub Review Acceptance Analysis Report`,
        `# Repository: ${data.summary.repository}`,
        `# Date Range: ${data.summary.dateRange.start} to ${data.summary.dateRange.end}`,
        `# Total PRs: ${data.summary.totalPRs}`,
        `# Total Reviews: ${data.summary.totalReviews}`,
        `# Generated: ${data.summary.analyzedAt}`,
        "",
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
GitHub Repository Analysis Tool - Review Acceptance Rate per User Email

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
  node main.mjs -r microsoft/vscode -f csv -o report.csv -v
  node main.mjs -r openai/gpt-4 -s 2023-06-01 -e 2024-01-01 -t ghp_token123

Environment Variables:
  GITHUB_TOKEN                      GitHub personal access token

Report Features:
  - Review acceptance rate per user email
  - Total reviews and breakdown by type (approved/changes/comments)
  - PR analysis within specified date ranges
  - Comprehensive activity metrics with user emails
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
  return `github_review_analysis_${repoName}${dateRangeStr}_${timestamp}.${format}`;
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
    const analyzer = new GitHubAnalyzer({
      verbose: options.verbose,
      debug: options.debug,
    });

    // Use the core method with exact signature: (repo, owner, startDate, endDate, token)
    const analysisData = await analyzer.analyzeReviewAcceptanceRate(
      repo,
      owner,
      startDate,
      endDate,
      token
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
    console.log("\n📊 Analysis Summary:");
    console.log(`   Repository: ${analysisData.summary.repository}`);
    console.log(
      `   Date Range: ${analysisData.summary.dateRange.start} to ${analysisData.summary.dateRange.end}`
    );
    console.log(`   Total PRs: ${analysisData.summary.totalPRs}`);
    console.log(`   Total Reviews: ${analysisData.summary.totalReviews}`);
    console.log(
      `   Active Reviewers: ${Object.keys(analysisData.reviewers).length}`
    );
    console.log(`   Output File: ${outputFilename}\n`);

    // Show top reviewers by email
    const topReviewers = Object.entries(analysisData.reviewers).slice(0, 5);
    if (topReviewers.length > 0) {
      console.log("🏆 Top Reviewers by Activity (Email-based):");
      topReviewers.forEach(([email, stats], index) => {
        console.log(
          `   ${index + 1}. ${email} (${stats.username}): ${
            stats.totalReviews
          } reviews (${stats.acceptanceRate}% approval rate)`
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
