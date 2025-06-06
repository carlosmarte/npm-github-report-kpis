#!/usr/bin/env node

/*
JSON Report Structure:
{
  "repository": "owner/repo",
  "analysis_period": {
    "start_date": "2024-01-01",
    "end_date": "2024-01-31"
  },
  "summary": {
    "total_reviewers": 5,
    "total_prs_reviewed": 25,
    "total_review_comments": 150,
    "total_review_iterations": 75
  },
  "reviewers": [
    {
      "username": "reviewer1",
      "total_review_comments": 45,
      "review_iterations": 20,
      "avg_comments_per_review": 2.25,
      "max_review_depth_per_pr": 8,
      "prs_reviewed": 12
    }
  ]
}

Use Cases:
- Team Performance Review: Identify most engaged reviewers
- Process Improvement: Analyze review thoroughness patterns
- Workload Distribution: Balance review assignments
- Quality Metrics: Track review depth trends over time
- Onboarding Assessment: Monitor new team member review engagement
- Release Planning: Understand review capacity for upcoming sprints
*/

import { program } from "commander";
import fs from "fs/promises";
import path from "path";

class GitHubReviewAnalyzer {
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
      "User-Agent": "GitHub-Review-Analyzer",
    };
    this.fetchCount = 0;
    this.maxFetches = 200;
  }

  async makeRequest(url, retries = 3) {
    if (this.maxFetches !== Infinity && this.fetchCount >= this.maxFetches) {
      console.log(
        `\n⚠️  Fetch limit reached (${this.maxFetches}). Use --fetchLimit infinite to continue.`
      );
      return null;
    }

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        this.fetchCount++;
        const response = await fetch(url, { headers: this.headers });

        if (response.status === 401) {
          throw new Error(
            "Authentication failed. Please check your GitHub token permissions and format."
          );
        }

        if (response.status === 403) {
          const resetTime = response.headers.get("X-RateLimit-Reset");
          if (resetTime) {
            const waitTime = parseInt(resetTime) * 1000 - Date.now();
            if (waitTime > 0) {
              console.log(
                `\n⏳ Rate limit exceeded. Waiting ${Math.ceil(
                  waitTime / 1000
                )}s...`
              );
              await this.sleep(waitTime);
              continue;
            }
          }
          throw new Error(
            "API rate limit exceeded or insufficient permissions."
          );
        }

        if (response.status === 404) {
          throw new Error(
            `Repository not found or access denied: ${this.owner}/${this.repo}`
          );
        }

        if (!response.ok) {
          throw new Error(
            `GitHub API error: ${response.status} ${response.statusText}`
          );
        }

        return response;
      } catch (error) {
        console.log(
          `\n❌ Request failed (attempt ${attempt}/${retries}): ${error.message}`
        );
        if (attempt === retries) throw error;
        await this.sleep(1000 * attempt);
      }
    }
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  updateProgress(current, total, message) {
    const percent = Math.round((current / total) * 100);
    const filled = Math.round(percent / 2);
    const empty = 50 - filled;
    const bar = "█".repeat(filled) + "░".repeat(empty);
    process.stdout.write(
      `\r${message}: [${bar}] ${percent}% (${current}/${total})`
    );
  }

  async fetchAllPages(endpoint, params = {}) {
    const results = [];
    let page = 1;
    let totalPages = 1;

    do {
      const url = new URL(`${this.baseUrl}${endpoint}`);
      url.searchParams.append("page", page);
      url.searchParams.append("per_page", "100");

      Object.entries(params).forEach(([key, value]) => {
        if (value) url.searchParams.append(key, value);
      });

      const response = await this.makeRequest(url.toString());
      if (!response) break;

      const data = await response.json();
      results.push(...data);

      const linkHeader = response.headers.get("Link");
      if (linkHeader) {
        const lastMatch = linkHeader.match(/page=(\d+)>; rel="last"/);
        if (lastMatch) {
          totalPages = parseInt(lastMatch[1]);
        }
      }

      this.updateProgress(page, totalPages, "Fetching data");
      page++;
    } while (
      page <= totalPages &&
      (this.maxFetches === Infinity || this.fetchCount < this.maxFetches)
    );

    return results;
  }

  async fetchPullRequests() {
    console.log("\n🔍 Fetching pull requests...");

    const params = {
      state: "all",
      sort: "updated",
      direction: "desc",
    };

    const prs = await this.fetchAllPages(
      `/repos/${this.owner}/${this.repo}/pulls`,
      params
    );

    // Filter by date range
    const filteredPrs = prs.filter((pr) => {
      const updatedAt = new Date(pr.updated_at);
      return (
        updatedAt >= new Date(this.startDate) &&
        updatedAt <= new Date(this.endDate)
      );
    });

    console.log(`\n✅ Found ${filteredPrs.length} PRs in date range`);
    return filteredPrs;
  }

  async fetchReviewsForPR(prNumber) {
    try {
      const reviews = await this.fetchAllPages(
        `/repos/${this.owner}/${this.repo}/pulls/${prNumber}/reviews`
      );
      const comments = await this.fetchAllPages(
        `/repos/${this.owner}/${this.repo}/pulls/${prNumber}/comments`
      );

      return { reviews, comments };
    } catch (error) {
      console.log(
        `\n⚠️  Error fetching reviews for PR #${prNumber}: ${error.message}`
      );
      return { reviews: [], comments: [] };
    }
  }

  async analyzeReviewDepth() {
    console.log("\n🚀 Starting GitHub Review Depth Analysis...");
    console.log(`📊 Repository: ${this.owner}/${this.repo}`);
    console.log(`📅 Period: ${this.startDate} to ${this.endDate}`);

    try {
      const pullRequests = await this.fetchPullRequests();

      if (pullRequests.length === 0) {
        throw new Error("No pull requests found in the specified date range.");
      }

      const reviewerStats = new Map();
      let processedPRs = 0;

      console.log("\n🔄 Analyzing reviews...");

      for (const pr of pullRequests) {
        const { reviews, comments } = await this.fetchReviewsForPR(pr.number);

        // Group reviews by reviewer
        const reviewsByUser = new Map();
        const commentsByUser = new Map();

        // Process reviews
        reviews.forEach((review) => {
          if (!review.user) return;

          const username = review.user.login;
          if (!reviewsByUser.has(username)) {
            reviewsByUser.set(username, new Set());
          }
          reviewsByUser.get(username).add(review.id);
        });

        // Process comments
        comments.forEach((comment) => {
          if (!comment.user) return;

          const username = comment.user.login;
          commentsByUser.set(username, (commentsByUser.get(username) || 0) + 1);
        });

        // Update reviewer statistics
        const allReviewers = new Set([
          ...reviewsByUser.keys(),
          ...commentsByUser.keys(),
        ]);

        allReviewers.forEach((username) => {
          if (!reviewerStats.has(username)) {
            reviewerStats.set(username, {
              username,
              total_review_comments: 0,
              review_iterations: 0,
              prs_reviewed: new Set(),
              pr_review_depths: [],
            });
          }

          const stats = reviewerStats.get(username);
          const commentsInThisPR = commentsByUser.get(username) || 0;
          const reviewsInThisPR = reviewsByUser.get(username)?.size || 0;

          if (commentsInThisPR > 0 || reviewsInThisPR > 0) {
            stats.prs_reviewed.add(pr.number);
            stats.total_review_comments += commentsInThisPR;
            stats.review_iterations += reviewsInThisPR;

            if (commentsInThisPR > 0) {
              stats.pr_review_depths.push(commentsInThisPR);
            }
          }
        });

        processedPRs++;
        this.updateProgress(
          processedPRs,
          pullRequests.length,
          "Processing PRs"
        );
      }

      // Calculate final metrics
      const finalStats = Array.from(reviewerStats.values())
        .map((stats) => ({
          username: stats.username,
          total_review_comments: stats.total_review_comments,
          review_iterations: stats.review_iterations,
          avg_comments_per_review:
            stats.review_iterations > 0
              ? parseFloat(
                  (
                    stats.total_review_comments / stats.review_iterations
                  ).toFixed(2)
                )
              : 0,
          max_review_depth_per_pr:
            stats.pr_review_depths.length > 0
              ? Math.max(...stats.pr_review_depths)
              : 0,
          prs_reviewed: stats.prs_reviewed.size,
        }))
        .sort((a, b) => b.total_review_comments - a.total_review_comments);

      console.log("\n✅ Analysis complete!");

      return {
        repository: `${this.owner}/${this.repo}`,
        analysis_period: {
          start_date: this.startDate,
          end_date: this.endDate,
        },
        summary: {
          total_reviewers: finalStats.length,
          total_prs_reviewed: pullRequests.length,
          total_review_comments: finalStats.reduce(
            (sum, s) => sum + s.total_review_comments,
            0
          ),
          total_review_iterations: finalStats.reduce(
            (sum, s) => sum + s.review_iterations,
            0
          ),
        },
        reviewers: finalStats,
      };
    } catch (error) {
      console.log(`\n❌ Analysis failed: ${error.message}`);
      console.log("Full error details:", error);
      throw error;
    }
  }
}

async function generateOutput(data, format, outputFile) {
  try {
    let content;
    let extension;

    if (format === "csv") {
      const headers = [
        "username",
        "total_review_comments",
        "review_iterations",
        "avg_comments_per_review",
        "max_review_depth_per_pr",
        "prs_reviewed",
      ];

      const csvRows = [
        headers.join(","),
        ...data.reviewers.map((reviewer) =>
          headers
            .map((header) =>
              typeof reviewer[header] === "string" &&
              reviewer[header].includes(",")
                ? `"${reviewer[header]}"`
                : reviewer[header]
            )
            .join(",")
        ),
      ];

      content = csvRows.join("\n");
      extension = ".csv";
    } else {
      content = JSON.stringify(data, null, 2);
      extension = ".json";
    }

    if (!outputFile) {
      const timestamp = new Date().toISOString().split("T")[0];
      const repoName = data.repository.replace("/", "_");
      outputFile = `review_depth_${repoName}_${timestamp}${extension}`;
    }

    await fs.writeFile(outputFile, content, "utf8");
    console.log(`\n📄 Report saved to: ${outputFile}`);

    return outputFile;
  } catch (error) {
    console.log(`\n❌ Failed to save output: ${error.message}`);
    throw error;
  }
}

function validateDate(dateString) {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) {
    throw new Error(
      `Invalid date format: ${dateString}. Use YYYY-MM-DD format.`
    );
  }
  return dateString;
}

async function main() {
  program
    .name("github-review-analyzer")
    .description("Analyze GitHub pull request review depth and engagement")
    .version("1.0.0")
    .requiredOption(
      "-r, --repo <owner/repo>",
      "Repository to analyze (format: owner/repo)"
    )
    .option(
      "-f, --format <format>",
      "Output format: json (default) or csv",
      "json"
    )
    .option(
      "-o, --output <filename>",
      "Output filename (auto-generated if not provided)"
    )
    .option(
      "-s, --start <date>",
      "Start date (ISO format: YYYY-MM-DD)",
      (date) => validateDate(date)
    )
    .option("-e, --end <date>", "End date (ISO format: YYYY-MM-DD)", (date) =>
      validateDate(date)
    )
    .option("-v, --verbose", "Enable verbose logging")
    .option("-d, --debug", "Enable debug logging")
    .option("-t, --token <token>", "GitHub API token")
    .option(
      "-l, --fetchLimit <limit>",
      'Set fetch limit (default: 200, use "infinite" for no limit)',
      "200"
    )
    .parse();

  const options = program.opts();

  try {
    // Validate repository format
    const repoMatch = options.repo.match(/^([^\/]+)\/([^\/]+)$/);
    if (!repoMatch) {
      throw new Error('Repository must be in format "owner/repo"');
    }

    const [, owner, repo] = repoMatch;

    // Get GitHub token
    const token = options.token || process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error(
        "GitHub token required. Use --token flag or set GITHUB_TOKEN environment variable."
      );
    }

    // Set date range
    const endDate = options.end || new Date().toISOString().split("T")[0];
    const startDate =
      options.start ||
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];

    // Validate format
    if (!["json", "csv"].includes(options.format)) {
      throw new Error('Format must be either "json" or "csv"');
    }

    // Create analyzer instance
    const analyzer = new GitHubReviewAnalyzer(
      repo,
      owner,
      startDate,
      endDate,
      token
    );

    // Set fetch limit
    if (options.fetchLimit === "infinite") {
      analyzer.maxFetches = Infinity;
    } else {
      const limit = parseInt(options.fetchLimit);
      if (isNaN(limit) || limit < 1) {
        throw new Error('Fetch limit must be a positive number or "infinite"');
      }
      analyzer.maxFetches = limit;
    }

    if (options.verbose) {
      console.log("🔧 Configuration:");
      console.log(`   Repository: ${owner}/${repo}`);
      console.log(`   Date range: ${startDate} to ${endDate}`);
      console.log(`   Output format: ${options.format}`);
      console.log(`   Fetch limit: ${analyzer.maxFetches}`);
    }

    // Run analysis
    const results = await analyzer.analyzeReviewDepth();

    // Generate output
    const outputFile = await generateOutput(
      results,
      options.format,
      options.output
    );

    // Display summary
    console.log("\n📊 Summary:");
    console.log(`   Total reviewers: ${results.summary.total_reviewers}`);
    console.log(`   Total PRs: ${results.summary.total_prs_reviewed}`);
    console.log(`   Total comments: ${results.summary.total_review_comments}`);
    console.log(
      `   Total iterations: ${results.summary.total_review_iterations}`
    );

    if (options.verbose && results.reviewers.length > 0) {
      console.log("\n🏆 Top Reviewers:");
      results.reviewers.slice(0, 5).forEach((reviewer, index) => {
        console.log(
          `   ${index + 1}. ${reviewer.username}: ${
            reviewer.total_review_comments
          } comments, ${reviewer.review_iterations} iterations`
        );
      });
    }
  } catch (error) {
    console.error(`\n💥 Error: ${error.message}`);
    if (options.debug) {
      console.error("Debug info:", error);
    }
    process.exit(1);
  }
}

// Run the CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export default GitHubReviewAnalyzer;
