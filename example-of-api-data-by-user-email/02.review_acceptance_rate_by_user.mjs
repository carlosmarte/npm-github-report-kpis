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
    "generatedAt": "2024-01-31T12:00:00Z"
  },
  "reviewAcceptanceRates": [
    {
      "userEmail": "user@example.com",
      "userName": "username",
      "totalReviews": 50,
      "approvedReviews": 45,
      "rejectedReviews": 3,
      "commentOnlyReviews": 2,
      "acceptanceRate": 0.9
    }
  ],
  "repositoryInsights": {
    "totalPullRequests": 100,
    "totalReviews": 300,
    "averageReviewsPerPR": 3,
    "overallAcceptanceRate": 0.85,
    "topReviewers": [...],
    "reviewTimeDistribution": {...}
  }
}

Use Cases:
- Team Productivity Analysis: Track review participation and quality
- Code Quality Assessment: Monitor approval patterns and feedback
- Collaboration Metrics: Analyze reviewer workload distribution  
- Development Patterns: Identify review bottlenecks and timing
- Process Improvements: Compare review efficiency across periods
*/

import { program } from "commander";
import fs from "fs/promises";

class GitHubReviewAnalyzer {
  constructor() {
    this.baseURL = "https://api.github.com";
    this.rateLimitRemaining = 5000;
    this.rateLimitReset = Date.now();
    this.maxRetries = 3;
    this.retryDelay = 1000; // 1 second base delay
  }

  async analyzeReviewAcceptanceRate(
    repo,
    owner,
    startDate,
    endDate,
    token,
    options = {}
  ) {
    const { verbose = false, debug = false, fetchLimit = 200 } = options;

    if (verbose)
      console.log(
        `🔍 Analyzing reviews for ${owner}/${repo} from ${startDate} to ${endDate}`
      );

    try {
      const headers = this.getHeaders(token);

      // Fetch pull requests in date range
      const pullRequests = await this.fetchPullRequests(
        owner,
        repo,
        startDate,
        endDate,
        headers,
        fetchLimit,
        verbose
      );

      if (verbose) console.log(`📋 Found ${pullRequests.length} pull requests`);

      // Fetch reviews for each PR
      const reviewData = await this.fetchReviewsForPRs(
        owner,
        repo,
        pullRequests,
        headers,
        verbose
      );

      // Calculate acceptance rates per user
      const userStats = this.calculateUserAcceptanceRates(reviewData);

      // Calculate repository insights
      const repoInsights = this.calculateRepositoryInsights(
        pullRequests,
        reviewData
      );

      return {
        metadata: {
          repository: `${owner}/${repo}`,
          dateRange: {
            start: startDate,
            end: endDate,
          },
          generatedAt: new Date().toISOString(),
          fetchLimit: fetchLimit === -1 ? "infinite" : fetchLimit,
        },
        reviewAcceptanceRates: userStats,
        repositoryInsights: repoInsights,
      };
    } catch (error) {
      if (debug) console.error("🐛 Full error details:", error);
      throw this.handleError(error);
    }
  }

  getHeaders(token) {
    if (!token) {
      throw new Error(
        "GitHub token is required. Set GITHUB_TOKEN environment variable or use -t flag."
      );
    }

    // Ensure Bearer token format
    const authHeader = token.startsWith("Bearer ") ? token : `Bearer ${token}`;

    return {
      Authorization: authHeader,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "GitHub-Review-Analyzer/1.0",
    };
  }

  async fetchWithRetry(url, headers, retryCount = 0) {
    try {
      await this.checkRateLimit(headers);

      const response = await fetch(url, { headers });

      if (!response.ok) {
        if (response.status === 429 && retryCount < this.maxRetries) {
          // Rate limited, wait and retry
          const retryAfter =
            parseInt(response.headers.get("retry-after") || "60") * 1000;
          console.log(
            `⏳ Rate limited. Waiting ${retryAfter / 1000}s before retry ${
              retryCount + 1
            }/${this.maxRetries}`
          );
          await new Promise((resolve) => setTimeout(resolve, retryAfter));
          return this.fetchWithRetry(url, headers, retryCount + 1);
        }

        throw new Error(
          `GitHub API error: ${response.status} ${response.statusText}`
        );
      }

      this.updateRateLimit(response);
      return response;
    } catch (error) {
      if (
        retryCount < this.maxRetries &&
        !error.message.includes("GitHub API error")
      ) {
        const delay = this.retryDelay * Math.pow(2, retryCount); // Exponential backoff
        console.log(
          `🔄 Retrying request in ${delay / 1000}s (attempt ${retryCount + 1}/${
            this.maxRetries
          })`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.fetchWithRetry(url, headers, retryCount + 1);
      }
      throw error;
    }
  }

  async fetchPullRequests(
    owner,
    repo,
    startDate,
    endDate,
    headers,
    fetchLimit,
    verbose
  ) {
    const pulls = [];
    let page = 1;
    const perPage = 100;

    while (pulls.length < fetchLimit || fetchLimit === -1) {
      if (verbose) {
        const progress =
          fetchLimit === -1 ? pulls.length : `${pulls.length}/${fetchLimit}`;
        process.stdout.write(`\r📥 Fetching PRs... ${progress}`);
      }

      const url = `${this.baseURL}/repos/${owner}/${repo}/pulls?state=all&sort=updated&direction=desc&page=${page}&per_page=${perPage}`;

      const response = await this.fetchWithRetry(url, headers);
      const data = await response.json();

      if (data.length === 0) break;

      // Filter by date range
      const filteredPulls = data.filter((pr) => {
        const prDate = new Date(pr.updated_at);
        return prDate >= new Date(startDate) && prDate <= new Date(endDate);
      });

      pulls.push(...filteredPulls);

      // Stop if we've gone past our date range
      if (
        data.length > 0 &&
        new Date(data[data.length - 1].updated_at) < new Date(startDate)
      ) {
        break;
      }

      if (fetchLimit !== -1 && pulls.length >= fetchLimit) {
        pulls.splice(fetchLimit);
        break;
      }

      page++;
    }

    if (verbose) console.log(`\n✅ Fetched ${pulls.length} pull requests`);
    return pulls;
  }

  async fetchReviewsForPRs(owner, repo, pullRequests, headers, verbose) {
    const allReviews = [];

    for (let i = 0; i < pullRequests.length; i++) {
      const pr = pullRequests[i];

      if (verbose) {
        process.stdout.write(
          `\r🔍 Fetching reviews... ${i + 1}/${pullRequests.length}`
        );
      }

      const url = `${this.baseURL}/repos/${owner}/${repo}/pulls/${pr.number}/reviews`;

      try {
        const response = await this.fetchWithRetry(url, headers);
        const reviews = await response.json();

        // Add PR context to each review
        reviews.forEach((review) => {
          review.pr_number = pr.number;
          review.pr_title = pr.title;
          review.pr_author = pr.user.login;
        });

        allReviews.push(...reviews);
      } catch (error) {
        console.warn(
          `\n⚠️  Warning: Could not fetch reviews for PR #${pr.number}: ${error.message}`
        );
        continue;
      }
    }

    if (verbose) console.log(`\n✅ Fetched ${allReviews.length} reviews total`);
    return allReviews;
  }

  calculateUserAcceptanceRates(reviews) {
    const userStats = new Map();

    reviews.forEach((review) => {
      const userEmail =
        review.user.email || `${review.user.login}@users.noreply.github.com`;
      const userName = review.user.login;

      if (!userStats.has(userEmail)) {
        userStats.set(userEmail, {
          userEmail,
          userName,
          totalReviews: 0,
          approvedReviews: 0,
          rejectedReviews: 0,
          commentOnlyReviews: 0,
          reviewTimes: [],
        });
      }

      const stats = userStats.get(userEmail);
      stats.totalReviews++;

      switch (review.state) {
        case "APPROVED":
          stats.approvedReviews++;
          break;
        case "CHANGES_REQUESTED":
          stats.rejectedReviews++;
          break;
        case "COMMENTED":
          stats.commentOnlyReviews++;
          break;
      }

      // Store review submission time
      if (review.submitted_at) {
        stats.reviewTimes.push(new Date(review.submitted_at));
      }
    });

    // Calculate final stats
    return Array.from(userStats.values())
      .map((stats) => {
        const acceptanceRate =
          stats.totalReviews > 0
            ? stats.approvedReviews / stats.totalReviews
            : 0;

        return {
          userEmail: stats.userEmail,
          userName: stats.userName,
          totalReviews: stats.totalReviews,
          approvedReviews: stats.approvedReviews,
          rejectedReviews: stats.rejectedReviews,
          commentOnlyReviews: stats.commentOnlyReviews,
          acceptanceRate: Math.round(acceptanceRate * 1000) / 1000,
        };
      })
      .sort((a, b) => b.totalReviews - a.totalReviews);
  }

  calculateRepositoryInsights(pullRequests, reviews) {
    const totalPullRequests = pullRequests.length;
    const totalReviews = reviews.length;
    const averageReviewsPerPR =
      totalPullRequests > 0 ? totalReviews / totalPullRequests : 0;

    const approvedReviews = reviews.filter(
      (r) => r.state === "APPROVED"
    ).length;
    const overallAcceptanceRate =
      totalReviews > 0 ? approvedReviews / totalReviews : 0;

    // Top reviewers
    const reviewerCounts = new Map();
    reviews.forEach((review) => {
      const reviewer = review.user.login;
      reviewerCounts.set(reviewer, (reviewerCounts.get(reviewer) || 0) + 1);
    });

    const topReviewers = Array.from(reviewerCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([reviewer, count]) => ({ reviewer, reviewCount: count }));

    return {
      totalPullRequests,
      totalReviews,
      averageReviewsPerPR: Math.round(averageReviewsPerPR * 100) / 100,
      overallAcceptanceRate: Math.round(overallAcceptanceRate * 1000) / 1000,
      topReviewers,
      reviewTimeDistribution: this.calculateReviewTimeDistribution(reviews),
    };
  }

  calculateReviewTimeDistribution(reviews) {
    const distribution = {
      morning: 0, // 6-12
      afternoon: 0, // 12-18
      evening: 0, // 18-24
      night: 0, // 0-6
    };

    reviews.forEach((review) => {
      if (review.submitted_at) {
        const hour = new Date(review.submitted_at).getHours();
        if (hour >= 6 && hour < 12) distribution.morning++;
        else if (hour >= 12 && hour < 18) distribution.afternoon++;
        else if (hour >= 18 && hour < 24) distribution.evening++;
        else distribution.night++;
      }
    });

    return distribution;
  }

  async checkRateLimit(headers) {
    if (this.rateLimitRemaining <= 10 && Date.now() < this.rateLimitReset) {
      const waitTime = this.rateLimitReset - Date.now();
      console.log(
        `\n⏳ Rate limit low. Waiting ${Math.ceil(waitTime / 1000)} seconds...`
      );
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }

  updateRateLimit(response) {
    this.rateLimitRemaining = parseInt(
      response.headers.get("x-ratelimit-remaining") || "5000"
    );
    this.rateLimitReset =
      parseInt(response.headers.get("x-ratelimit-reset") || "0") * 1000;
  }

  handleError(error) {
    console.log("🚨 Full error message:", error.message);

    if (error.message.includes("401")) {
      return new Error(
        "❌ Authentication failed. GitHub API now requires Bearer token format. Please check your GitHub token and ensure it's valid."
      );
    } else if (error.message.includes("403")) {
      return new Error(
        '❌ Access forbidden. Your token might lack proper repository access scopes or you\'ve hit rate limits. Ensure your token has "repo" scope.'
      );
    } else if (error.message.includes("404")) {
      return new Error(
        "❌ Repository not found. Please check the owner/repo format and ensure the repository exists and is accessible."
      );
    } else if (error.message.includes("422")) {
      return new Error(
        "❌ Validation failed. Check your date format (YYYY-MM-DD) and other parameters."
      );
    } else {
      return new Error(`❌ ${error.message}`);
    }
  }
}

// CLI Implementation
async function main() {
  program
    .name("github-review-analyzer")
    .description(
      "Analyze GitHub repository review acceptance rates and insights"
    )
    .version("1.0.0")
    .requiredOption(
      "-r, --repo <owner/repo>",
      "Repository to analyze (required)"
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
      getDefaultStartDate()
    )
    .option(
      "-e, --end <date>",
      "End date (ISO format: YYYY-MM-DD)",
      new Date().toISOString().split("T")[0]
    )
    .option("-v, --verbose", "Enable verbose logging", false)
    .option("-d, --debug", "Enable debug logging", false)
    .option("-t, --token <token>", "GitHub Token")
    .option(
      "-l, --fetchLimit <limit>",
      'Set fetch limit (default: 200, use "infinite" for no limit)',
      "200"
    )
    .parse();

  const options = program.opts();

  // Parse repository
  const [owner, repo] = options.repo.split("/");
  if (!owner || !repo) {
    console.error('❌ Error: Repository must be in format "owner/repo"');
    process.exit(1);
  }

  // Get GitHub token
  const token = options.token || process.env.GITHUB_TOKEN;
  if (!token) {
    console.error(
      "❌ Error: GitHub token is required. Set GITHUB_TOKEN environment variable or use -t flag."
    );
    process.exit(1);
  }

  // Parse fetch limit
  const fetchLimit =
    options.fetchLimit === "infinite" ? -1 : parseInt(options.fetchLimit);

  try {
    const analyzer = new GitHubReviewAnalyzer();

    console.log(`🚀 GitHub Review Analyzer`);
    console.log(`📊 Repository: ${owner}/${repo}`);
    console.log(`📅 Date range: ${options.start} to ${options.end}`);
    console.log(
      `🔢 Fetch limit: ${fetchLimit === -1 ? "infinite" : fetchLimit}`
    );
    console.log("");

    const result = await analyzer.analyzeReviewAcceptanceRate(
      repo,
      owner,
      options.start,
      options.end,
      token,
      {
        verbose: options.verbose,
        debug: options.debug,
        fetchLimit,
      }
    );

    // Generate output filename if not provided
    let outputFile = options.output;
    if (!outputFile) {
      const dateRange = `${options.start}_to_${options.end}`.replace(/-/g, "");
      outputFile = `${owner}-${repo}-review-analysis-${dateRange}.${options.format}`;
    }

    // Output data
    if (options.format === "csv") {
      await outputCSV(result, outputFile);
    } else {
      await outputJSON(result, outputFile);
    }

    console.log(`\n✅ Analysis complete! Results saved to: ${outputFile}`);

    // Show summary
    console.log("\n📈 --- Summary ---");
    console.log(
      `📋 Total PRs analyzed: ${result.repositoryInsights.totalPullRequests}`
    );
    console.log(`👥 Total reviews: ${result.repositoryInsights.totalReviews}`);
    console.log(
      `✅ Overall acceptance rate: ${(
        result.repositoryInsights.overallAcceptanceRate * 100
      ).toFixed(1)}%`
    );
    console.log(`👤 Active reviewers: ${result.reviewAcceptanceRates.length}`);

    if (result.reviewAcceptanceRates.length > 0) {
      console.log("\n🏆 Top Reviewers:");
      result.reviewAcceptanceRates.slice(0, 5).forEach((user, index) => {
        console.log(
          `${index + 1}. ${user.userName} - ${user.totalReviews} reviews (${(
            user.acceptanceRate * 100
          ).toFixed(1)}% acceptance)`
        );
      });
    }
  } catch (error) {
    console.error(`${error.message}`);
    if (options.debug) {
      console.error("🐛 Stack trace:", error.stack);
    }
    process.exit(1);
  }
}

function getDefaultStartDate() {
  const date = new Date();
  date.setDate(date.getDate() - 30);
  return date.toISOString().split("T")[0];
}

async function outputJSON(data, filename) {
  await fs.writeFile(filename, JSON.stringify(data, null, 2));
}

async function outputCSV(data, filename) {
  const csvLines = [];

  // Header
  csvLines.push(
    "User Email,User Name,Total Reviews,Approved Reviews,Rejected Reviews,Comment Only Reviews,Acceptance Rate"
  );

  // Data rows
  data.reviewAcceptanceRates.forEach((user) => {
    csvLines.push(
      [
        `"${user.userEmail}"`,
        `"${user.userName}"`,
        user.totalReviews,
        user.approvedReviews,
        user.rejectedReviews,
        user.commentOnlyReviews,
        user.acceptanceRate,
      ].join(",")
    );
  });

  // Add repository insights as additional rows
  csvLines.push("");
  csvLines.push("Repository Insights");
  csvLines.push(
    `Total Pull Requests,${data.repositoryInsights.totalPullRequests}`
  );
  csvLines.push(`Total Reviews,${data.repositoryInsights.totalReviews}`);
  csvLines.push(
    `Average Reviews Per PR,${data.repositoryInsights.averageReviewsPerPR}`
  );
  csvLines.push(
    `Overall Acceptance Rate,${data.repositoryInsights.overallAcceptanceRate}`
  );

  await fs.writeFile(filename, csvLines.join("\n"));
}

// Run the CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("💥 Unexpected error:", error);
    process.exit(1);
  });
}
