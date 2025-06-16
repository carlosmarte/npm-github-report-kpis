#!/usr/bin/env node

/*
JSON Report Structure:
{
  "metadata": {
    "repository": "owner/repo",
    "dateRange": {
      "start": "2024-01-01",
      "end": "2024-01-31"
    },
    "generatedAt": "2024-01-31T10:30:00Z",
    "totalPRsAnalyzed": 50,
    "totalReviewersAnalyzed": 8
  },
  "reviewerMetrics": {
    "user1@company.com": {
      "totalReviews": 15,
      "averageDurationHours": 24.5,
      "medianDurationHours": 18.2,
      "minDurationHours": 2.1,
      "maxDurationHours": 72.8,
      "reviews": [
        {
          "prNumber": 123,
          "prTitle": "Feature: Add new component",
          "firstReviewTime": "2024-01-15T09:00:00Z",
          "decisionTime": "2024-01-16T10:30:00Z",
          "durationHours": 25.5,
          "decision": "approved"
        }
      ]
    }
  },
  "summary": {
    "fastestReviewer": "user2@company.com",
    "slowestReviewer": "user3@company.com",
    "teamAverageDurationHours": 28.7,
    "teamMedianDurationHours": 22.1
  }
}

Use Cases:
1. Team Performance Analysis: Identify reviewers who consistently provide fast vs slow feedback
2. Process Optimization: Detect bottlenecks in code review process
3. Quality vs Speed Balance: Ensure reviews aren't too fast (rubber-stamping) or too slow (blocking)
4. Individual Development: Help reviewers understand their review patterns
5. Management Insights: Track team efficiency and identify training needs
6. Process Improvements: Compare review times before/after process changes
7. Workload Distribution: Identify overloaded reviewers affecting review speed
*/

import { createWriteStream } from "fs";
import { writeFile } from "fs/promises";

class PRReviewAnalyzer {
  constructor(repo, owner, startDate, endDate, token) {
    this.repo = repo;
    this.owner = owner;
    this.startDate = startDate;
    this.endDate = endDate;
    this.token = token;
    this.baseUrl = "https://api.github.com";
    this.headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "PR-Review-Analyzer/1.0",
    };
    this.rateLimitRemaining = 5000;
    this.rateLimitReset = null;
  }

  async makeRequest(url, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        // Check rate limit
        if (this.rateLimitRemaining < 10) {
          const resetTime = new Date(this.rateLimitReset * 1000);
          const waitTime = resetTime.getTime() - Date.now() + 1000;
          if (waitTime > 0) {
            console.log(
              `Rate limit approaching. Waiting ${Math.ceil(
                waitTime / 1000
              )}s...`
            );
            await new Promise((resolve) => setTimeout(resolve, waitTime));
          }
        }

        const response = await fetch(url, { headers: this.headers });

        // Update rate limit info
        this.rateLimitRemaining = parseInt(
          response.headers.get("x-ratelimit-remaining") || "5000"
        );
        this.rateLimitReset = parseInt(
          response.headers.get("x-ratelimit-reset") || "0"
        );

        if (response.status === 401) {
          throw new Error(
            "Authentication failed. Please check your GitHub token and ensure it has proper repository access scopes."
          );
        }

        if (response.status === 403) {
          const resetTime = new Date(this.rateLimitReset * 1000);
          throw new Error(
            `GitHub API rate limit exceeded. Reset at: ${resetTime.toISOString()}`
          );
        }

        if (response.status === 404) {
          throw new Error(
            "Repository not found or token lacks access permissions."
          );
        }

        if (!response.ok) {
          throw new Error(
            `GitHub API error: ${response.status} ${response.statusText}`
          );
        }

        return await response.json();
      } catch (error) {
        console.log(`Request attempt ${attempt} failed:`, error.message);

        if (attempt === retries) {
          throw error;
        }

        const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
        console.log(`Retrying in ${delay / 1000}s...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  async fetchAllPages(url, limit = 200) {
    const results = [];
    let page = 1;
    let fetchedCount = 0;

    while (fetchedCount < limit) {
      const perPage = Math.min(100, limit - fetchedCount);
      const pageUrl = `${url}${
        url.includes("?") ? "&" : "?"
      }page=${page}&per_page=${perPage}`;

      try {
        const data = await this.makeRequest(pageUrl);

        if (!Array.isArray(data) || data.length === 0) {
          break;
        }

        results.push(...data);
        fetchedCount += data.length;

        if (data.length < perPage) {
          break; // Last page
        }

        page++;
      } catch (error) {
        console.error(`Error fetching page ${page}:`, error.message);
        break;
      }
    }

    return results;
  }

  async fetchPullRequests(verbose = false) {
    const startIso = this.startDate.toISOString();
    const endIso = this.endDate.toISOString();

    console.log(`Fetching PRs from ${startIso} to ${endIso}...`);

    const url = `${this.baseUrl}/repos/${this.owner}/${this.repo}/pulls?state=all&sort=updated&direction=desc`;
    const prs = await this.fetchAllPages(url);

    // Filter by date range
    const filteredPrs = prs.filter((pr) => {
      const createdAt = new Date(pr.created_at);
      const updatedAt = new Date(pr.updated_at);
      return (
        (createdAt >= this.startDate && createdAt <= this.endDate) ||
        (updatedAt >= this.startDate && updatedAt <= this.endDate)
      );
    });

    if (verbose) {
      console.log(
        `Found ${filteredPrs.length} PRs in date range (from ${prs.length} total)`
      );
    }

    return filteredPrs;
  }

  async fetchPRReviews(prNumber, verbose = false) {
    const url = `${this.baseUrl}/repos/${this.owner}/${this.repo}/pulls/${prNumber}/reviews`;
    const reviews = await this.makeRequest(url);

    if (verbose) {
      console.log(`  Found ${reviews.length} reviews for PR #${prNumber}`);
    }

    return reviews;
  }

  async fetchPRReviewComments(prNumber, verbose = false) {
    const url = `${this.baseUrl}/repos/${this.owner}/${this.repo}/pulls/${prNumber}/comments`;
    const comments = await this.makeRequest(url);

    if (verbose) {
      console.log(
        `  Found ${comments.length} review comments for PR #${prNumber}`
      );
    }

    return comments;
  }

  calculateReviewDurations(pr, reviews, comments, verbose = false) {
    const reviewerMetrics = new Map();

    // Group reviews and comments by user
    const userActivities = new Map();

    // Add reviews
    reviews.forEach((review) => {
      const userLogin = review.user.login;
      if (!userActivities.has(userLogin)) {
        userActivities.set(userLogin, { reviews: [], comments: [] });
      }
      userActivities.get(userLogin).reviews.push(review);
    });

    // Add comments
    comments.forEach((comment) => {
      const userLogin = comment.user.login;
      if (!userActivities.has(userLogin)) {
        userActivities.set(userLogin, { reviews: [], comments: [] });
      }
      userActivities.get(userLogin).comments.push(comment);
    });

    // Calculate durations for each reviewer
    userActivities.forEach((activities, userLogin) => {
      const allActivities = [
        ...activities.reviews.map((r) => ({ ...r, type: "review" })),
        ...activities.comments.map((c) => ({ ...c, type: "comment" })),
      ].sort(
        (a, b) =>
          new Date(a.created_at || a.submitted_at) -
          new Date(b.created_at || b.submitted_at)
      );

      if (allActivities.length === 0) return;

      const firstActivity = allActivities[0];
      const firstTime = new Date(
        firstActivity.created_at || firstActivity.submitted_at
      );

      // Find the final decision (approval or request for changes)
      const finalDecision = activities.reviews
        .filter(
          (r) => r.state === "APPROVED" || r.state === "CHANGES_REQUESTED"
        )
        .sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at))[0];

      if (finalDecision) {
        const decisionTime = new Date(finalDecision.submitted_at);
        const durationMs = decisionTime.getTime() - firstTime.getTime();
        const durationHours = durationMs / (1000 * 60 * 60);

        if (durationHours >= 0) {
          // Ensure positive duration
          const userEmail = `${userLogin}@github.com`; // Simplified email mapping

          if (!reviewerMetrics.has(userEmail)) {
            reviewerMetrics.set(userEmail, []);
          }

          reviewerMetrics.get(userEmail).push({
            prNumber: pr.number,
            prTitle: pr.title,
            firstReviewTime: firstTime.toISOString(),
            decisionTime: decisionTime.toISOString(),
            durationHours: Math.round(durationHours * 100) / 100,
            decision: finalDecision.state.toLowerCase().replace("_", " "),
          });

          if (verbose) {
            console.log(
              `    ${userEmail}: ${durationHours.toFixed(1)}h (${
                finalDecision.state
              })`
            );
          }
        }
      }
    });

    return reviewerMetrics;
  }

  calculateStatistics(durations) {
    if (durations.length === 0) return null;

    const sorted = [...durations].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);

    return {
      count: sorted.length,
      average: Math.round((sum / sorted.length) * 100) / 100,
      median:
        sorted.length % 2 === 0
          ? Math.round(
              ((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) /
                2) *
                100
            ) / 100
          : Math.round(sorted[Math.floor(sorted.length / 2)] * 100) / 100,
      min: Math.round(sorted[0] * 100) / 100,
      max: Math.round(sorted[sorted.length - 1] * 100) / 100,
    };
  }

  async analyze(verbose = false, fetchLimit = 200) {
    console.log("Starting PR review duration analysis...");
    console.log(`Repository: ${this.owner}/${this.repo}`);
    console.log(
      `Date range: ${this.startDate.toISOString().split("T")[0]} to ${
        this.endDate.toISOString().split("T")[0]
      }`
    );
    console.log(
      `Fetch limit: ${fetchLimit === Infinity ? "unlimited" : fetchLimit}`
    );

    const startTime = Date.now();

    try {
      // Fetch all PRs
      const prs = await this.fetchPullRequests(verbose);
      console.log(`📥 Fetched ${prs.length} pull requests`);

      if (prs.length === 0) {
        console.log("No pull requests found in the specified date range.");
        return null;
      }

      const allReviewerMetrics = new Map();
      let processedCount = 0;
      const totalPrs = Math.min(prs.length, fetchLimit);

      // Process each PR
      for (const pr of prs.slice(0, fetchLimit)) {
        processedCount++;
        const progress = Math.round((processedCount / totalPrs) * 100);
        process.stdout.write(
          `\r🔍 Analyzing PR #${pr.number} (${processedCount}/${totalPrs} - ${progress}%)`
        );

        try {
          const [reviews, comments] = await Promise.all([
            this.fetchPRReviews(pr.number, verbose),
            this.fetchPRReviewComments(pr.number, verbose),
          ]);

          const prMetrics = this.calculateReviewDurations(
            pr,
            reviews,
            comments,
            verbose
          );

          // Merge into all metrics
          prMetrics.forEach((durations, email) => {
            if (!allReviewerMetrics.has(email)) {
              allReviewerMetrics.set(email, []);
            }
            allReviewerMetrics.get(email).push(...durations);
          });
        } catch (error) {
          console.error(`\nError processing PR #${pr.number}:`, error.message);
        }
      }

      console.log("\n✅ Analysis complete!");

      // Build final report
      const reviewerMetrics = {};
      const allDurations = [];

      allReviewerMetrics.forEach((reviews, email) => {
        const durations = reviews.map((r) => r.durationHours);
        const stats = this.calculateStatistics(durations);

        if (stats) {
          reviewerMetrics[email] = {
            totalReviews: reviews.length,
            averageDurationHours: stats.average,
            medianDurationHours: stats.median,
            minDurationHours: stats.min,
            maxDurationHours: stats.max,
            reviews: reviews,
          };
          allDurations.push(...durations);
        }
      });

      // Calculate team statistics
      const teamStats = this.calculateStatistics(allDurations);

      // Find fastest and slowest reviewers
      const reviewerAverages = Object.entries(reviewerMetrics)
        .map(([email, metrics]) => ({
          email,
          average: metrics.averageDurationHours,
        }))
        .sort((a, b) => a.average - b.average);

      const report = {
        metadata: {
          repository: `${this.owner}/${this.repo}`,
          dateRange: {
            start: this.startDate.toISOString().split("T")[0],
            end: this.endDate.toISOString().split("T")[0],
          },
          generatedAt: new Date().toISOString(),
          totalPRsAnalyzed: processedCount,
          totalReviewersAnalyzed: Object.keys(reviewerMetrics).length,
          executionTimeMs: Date.now() - startTime,
        },
        reviewerMetrics,
        summary: {
          fastestReviewer: reviewerAverages[0]?.email || null,
          slowestReviewer:
            reviewerAverages[reviewerAverages.length - 1]?.email || null,
          teamAverageDurationHours: teamStats?.average || 0,
          teamMedianDurationHours: teamStats?.median || 0,
          totalReviewsAnalyzed: allDurations.length,
        },
      };

      return report;
    } catch (error) {
      console.error("\n❌ Analysis failed:", error.message);
      throw error;
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const options = {};

  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "-r":
      case "--repo":
        options.repo = args[++i];
        break;
      case "-f":
      case "--format":
        options.format = args[++i];
        break;
      case "-o":
      case "--output":
        options.output = args[++i];
        break;
      case "-s":
      case "--start":
        options.start = args[++i];
        break;
      case "-e":
      case "--end":
        options.end = args[++i];
        break;
      case "-t":
      case "--token":
        options.token = args[++i];
        break;
      case "-l":
      case "--fetchLimit":
        options.fetchLimit =
          args[++i] === "infinite" ? Infinity : parseInt(args[++i - 1]);
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
        console.log(`
PR Review Duration Analysis CLI

Usage: node main.mjs -r <owner/repo> [options]

Options:
  -r, --repo <owner/repo>         Repository to analyze (required)
  -f, --format <format>           Output format: json (default) or csv
  -o, --output <filename>         Output filename (auto-generated if not provided)
  -s, --start <date>              Start date (ISO format: YYYY-MM-DD) default -30 days
  -e, --end <date>                End date (ISO format: YYYY-MM-DD) default: now
  -v, --verbose                   Enable verbose logging
  -d, --debug                     Enable debug logging
  -t, --token                     GitHub Token
  -l, --fetchLimit                Set fetch limit (default: 200, use 'infinite' for no limit)
  -h, --help                      Show help message

Environment Variables:
  GITHUB_TOKEN                    GitHub personal access token

Examples:
  node main.mjs -r microsoft/vscode -s 2024-01-01 -e 2024-01-31
  node main.mjs -r facebook/react --format csv --verbose
  node main.mjs -r owner/repo --fetchLimit infinite
        `);
        process.exit(0);
        break;
    }
  }

  // Validate required parameters
  if (!options.repo) {
    console.error("❌ Error: Repository is required. Use -r <owner/repo>");
    process.exit(1);
  }

  const [owner, repo] = options.repo.split("/");
  if (!owner || !repo) {
    console.error('❌ Error: Repository must be in format "owner/repo"');
    process.exit(1);
  }

  // Get GitHub token
  const token = options.token || process.env.GITHUB_TOKEN;
  if (!token) {
    console.error(
      "❌ Error: GitHub token is required. Use -t <token> or set GITHUB_TOKEN environment variable"
    );
    process.exit(1);
  }

  // Set date range
  const endDate = options.end ? new Date(options.end) : new Date();
  const startDate = options.start
    ? new Date(options.start)
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  if (startDate >= endDate) {
    console.error("❌ Error: Start date must be before end date");
    process.exit(1);
  }

  // Set defaults
  const format = options.format || "json";
  const fetchLimit = options.fetchLimit || 200;
  const verbose = options.verbose || options.debug || false;

  try {
    // Create analyzer and run analysis
    const analyzer = new PRReviewAnalyzer(
      repo,
      owner,
      startDate,
      endDate,
      token
    );
    const report = await analyzer.analyze(verbose, fetchLimit);

    if (!report) {
      console.log("No data to export.");
      process.exit(0);
    }

    // Generate output filename if not provided
    const dateRange = `${startDate.toISOString().split("T")[0]}_to_${
      endDate.toISOString().split("T")[0]
    }`;
    const defaultFilename = `pr_review_analysis_${owner}_${repo}_${dateRange}.${format}`;
    const outputFile = options.output || defaultFilename;

    // Export data
    if (format === "csv") {
      await exportToCSV(report, outputFile);
    } else {
      await exportToJSON(report, outputFile);
    }

    // Display summary
    console.log("\n📊 Analysis Summary:");
    console.log(`   Repository: ${report.metadata.repository}`);
    console.log(
      `   Date Range: ${report.metadata.dateRange.start} to ${report.metadata.dateRange.end}`
    );
    console.log(`   PRs Analyzed: ${report.metadata.totalPRsAnalyzed}`);
    console.log(
      `   Reviewers Found: ${report.metadata.totalReviewersAnalyzed}`
    );
    console.log(`   Total Reviews: ${report.summary.totalReviewsAnalyzed}`);
    console.log(`   Team Average: ${report.summary.teamAverageDurationHours}h`);
    console.log(`   Team Median: ${report.summary.teamMedianDurationHours}h`);
    if (report.summary.fastestReviewer) {
      console.log(`   Fastest Reviewer: ${report.summary.fastestReviewer}`);
    }
    if (report.summary.slowestReviewer) {
      console.log(`   Slowest Reviewer: ${report.summary.slowestReviewer}`);
    }
    console.log(
      `   Execution Time: ${(report.metadata.executionTimeMs / 1000).toFixed(
        2
      )}s`
    );
    console.log(`\n✅ Report saved to: ${outputFile}`);
  } catch (error) {
    console.error("\n❌ Error:", error.message);
    if (options.debug) {
      console.error("Stack trace:", error.stack);
    }
    process.exit(1);
  }
}

async function exportToJSON(data, filename) {
  await writeFile(filename, JSON.stringify(data, null, 2));
}

async function exportToCSV(data, filename) {
  const csvLines = [];

  // Header
  csvLines.push(
    "reviewer_email,total_reviews,avg_duration_hours,median_duration_hours,min_duration_hours,max_duration_hours"
  );

  // Data rows
  Object.entries(data.reviewerMetrics).forEach(([email, metrics]) => {
    csvLines.push(
      `"${email}",${metrics.totalReviews},${metrics.averageDurationHours},${metrics.medianDurationHours},${metrics.minDurationHours},${metrics.maxDurationHours}`
    );
  });

  await writeFile(filename, csvLines.join("\n"));
}

// Run the CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
