#!/usr/bin/env node

/*
JSON Report Structure:
{
  "repository": "owner/repo",
  "dateRange": {
    "start": "2024-01-01",
    "end": "2024-01-31"
  },
  "summary": {
    "totalPRs": 150,
    "totalAuthors": 25,
    "averageReviewersPerAuthor": 3.2,
    "uniqueReviewersAcrossAll": 45,
    "commonReviewersAcrossAll": 8,
    "neverReviewersCount": 12,
    "rarelyReviewersCount": 15
  },
  "reviewerMetrics": [
    {
      "authorEmail": "developer@company.com",
      "authorUsername": "dev-user",
      "totalPRs": 12,
      "uniqueReviewers": 5,
      "commonReviewers": 2,
      "reviewers": [
        {
          "username": "reviewer1",
          "email": "reviewer1@company.com",
          "reviewCount": 8,
          "isCommonReviewer": true,
          "reviewCategory": "common"
        }
      ]
    }
  ],
  "globalReviewers": {
    "uniqueReviewers": ["reviewer1", "reviewer2", ...],
    "commonReviewers": ["frequent-reviewer1", "frequent-reviewer2", ...],
    "neverReviewers": ["inactive-user1", "inactive-user2", ...],
    "rarelyReviewers": ["occasional-reviewer1", "occasional-reviewer2", ...]
  },
  "reviewerCategories": {
    "common": { "threshold": ">=3 reviews", "count": 8 },
    "rarely": { "threshold": "1-2 reviews", "count": 15 },
    "never": { "threshold": "0 reviews", "count": 12 }
  }
}

Use Cases:
1. Team Productivity Analysis: Track commit frequency and patterns
2. Code Quality Assessment: Monitor additions/deletions trends
3. Collaboration Metrics: Analyze contributor participation
4. Development Patterns: Identify working time distributions
5. Process Improvements: Compare before/after periods for process changes
6. Review Engagement Analysis: Identify inactive or under-engaged reviewers
7. Knowledge Distribution: Assess review coverage across team members
*/

import { writeFileSync } from "fs";
import https from "https";
import { URL } from "url";

class GitHubPRAnalyzer {
  constructor(repo, owner, startDate, endDate, token) {
    this.repo = repo;
    this.owner = owner;
    this.startDate = startDate;
    this.endDate = endDate;
    this.token = token;
    this.baseUrl = "https://api.github.com";
    this.retryCount = 3;
    this.retryDelay = 1000;
    this.allRepoUsers = new Set(); // Track all users who have contributed to the repo
  }

  async makeRequest(endpoint, page = 1, perPage = 100) {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    url.searchParams.append("page", page.toString());
    url.searchParams.append("per_page", perPage.toString());

    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "GitHub-PR-Analyzer/1.0",
      },
    };

    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve({
                data: parsed,
                headers: res.headers,
                statusCode: res.statusCode,
              });
            } else {
              reject(
                new Error(
                  `GitHub API Error: ${res.statusCode} - ${
                    parsed.message || "Unknown error"
                  }`
                )
              );
            }
          } catch (error) {
            reject(new Error(`Failed to parse response: ${error.message}`));
          }
        });
      });

      req.on("error", reject);
      req.setTimeout(30000, () => {
        req.destroy();
        reject(new Error("Request timeout"));
      });

      req.end();
    });
  }

  async retryRequest(endpoint, page = 1, perPage = 100, attempt = 1) {
    try {
      return await this.makeRequest(endpoint, page, perPage);
    } catch (error) {
      if (attempt < this.retryCount) {
        console.log(
          `Retry ${attempt}/${this.retryCount} for ${endpoint} (page ${page})`
        );
        await this.sleep(this.retryDelay * attempt);
        return this.retryRequest(endpoint, page, perPage, attempt + 1);
      }
      throw error;
    }
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  updateProgressBar(current, total, message = "Progress") {
    const percentage = Math.floor((current / total) * 100);
    const barLength = 30;
    const filledLength = Math.floor((current / total) * barLength);
    const bar = "█".repeat(filledLength) + "░".repeat(barLength - filledLength);
    process.stdout.write(
      `\r${message}: [${bar}] ${percentage}% (${current}/${total})`
    );
  }

  async fetchAllPages(endpoint, fetchLimit = 200) {
    const allData = [];
    let page = 1;
    let hasMore = true;
    let fetchedCount = 0;

    while (hasMore && (fetchLimit === -1 || fetchedCount < fetchLimit)) {
      try {
        const response = await this.retryRequest(endpoint, page, 100);
        const data = response.data;

        if (!Array.isArray(data) || data.length === 0) {
          hasMore = false;
          break;
        }

        allData.push(...data);
        fetchedCount += data.length;

        // Update progress bar
        this.updateProgressBar(
          fetchedCount,
          Math.max(
            fetchedCount,
            fetchLimit === -1 ? fetchedCount + 100 : fetchLimit
          ),
          "Fetching"
        );

        // Check rate limit
        const remaining = parseInt(
          response.headers["x-ratelimit-remaining"] || "0"
        );
        if (remaining < 10) {
          const resetTime =
            parseInt(response.headers["x-ratelimit-reset"] || "0") * 1000;
          const waitTime = Math.max(0, resetTime - Date.now()) + 1000;
          console.log(
            `\nRate limit approaching. Waiting ${Math.ceil(
              waitTime / 1000
            )}s...`
          );
          await this.sleep(waitTime);
        }

        page++;

        if (data.length < 100) {
          hasMore = false;
        }
      } catch (error) {
        console.error(`\nError fetching page ${page}: ${error.message}`);
        throw error;
      }
    }

    console.log(`\nCompleted fetching ${allData.length} items.`);
    return allData;
  }

  async fetchRepositoryContributors(fetchLimit = 200) {
    console.log("Fetching repository contributors...");
    try {
      const endpoint = `/repos/${this.owner}/${this.repo}/contributors`;
      const contributors = await this.fetchAllPages(endpoint, fetchLimit);

      contributors.forEach((contributor) => {
        this.allRepoUsers.add(contributor.login);
      });

      console.log(`Found ${contributors.length} contributors.`);
      return contributors;
    } catch (error) {
      console.log(`Warning: Could not fetch contributors: ${error.message}`);
      return [];
    }
  }

  async fetchPullRequests(fetchLimit = 200) {
    console.log("Fetching pull requests...");
    const endpoint = `/repos/${this.owner}/${this.repo}/pulls`;
    const params = new URLSearchParams({
      state: "all",
      sort: "updated",
      direction: "desc",
    });

    const prs = await this.fetchAllPages(`${endpoint}?${params}`, fetchLimit);

    // Collect all PR authors as part of repo users
    prs.forEach((pr) => {
      this.allRepoUsers.add(pr.user.login);
    });

    // Filter by date range
    const filteredPRs = prs.filter((pr) => {
      const createdAt = new Date(pr.created_at);
      const start = new Date(this.startDate);
      const end = new Date(this.endDate);
      return createdAt >= start && createdAt <= end;
    });

    console.log(`Filtered ${filteredPRs.length} PRs within date range.`);
    return filteredPRs;
  }

  async fetchPRReviews(prNumber) {
    try {
      const endpoint = `/repos/${this.owner}/${this.repo}/pulls/${prNumber}/reviews`;
      const response = await this.retryRequest(endpoint, 1, 100);
      return response.data || [];
    } catch (error) {
      console.log(
        `Warning: Could not fetch reviews for PR #${prNumber}: ${error.message}`
      );
      return [];
    }
  }

  async fetchPRComments(prNumber) {
    try {
      const endpoint = `/repos/${this.owner}/${this.repo}/pulls/${prNumber}/comments`;
      const response = await this.retryRequest(endpoint, 1, 100);
      return response.data || [];
    } catch (error) {
      console.log(
        `Warning: Could not fetch comments for PR #${prNumber}: ${error.message}`
      );
      return [];
    }
  }

  categorizeReviewers(reviewerStats, commonThreshold = 3, rarelyThreshold = 2) {
    const reviewerCategories = {
      common: [],
      rarely: [],
      never: [],
    };

    // Get all users who have done any reviewing
    const activeReviewers = new Set(Object.keys(reviewerStats));

    // Categorize active reviewers
    Object.entries(reviewerStats).forEach(([username, stats]) => {
      if (stats.totalReviews >= commonThreshold) {
        reviewerCategories.common.push(username);
      } else if (
        stats.totalReviews >= 1 &&
        stats.totalReviews <= rarelyThreshold
      ) {
        reviewerCategories.rarely.push(username);
      }
    });

    // Find users who never reviewed (exist in repo but not in reviewer stats)
    this.allRepoUsers.forEach((username) => {
      if (!activeReviewers.has(username)) {
        reviewerCategories.never.push(username);
      }
    });

    return {
      categories: reviewerCategories,
      thresholds: {
        common: `>=${commonThreshold} reviews`,
        rarely: `1-${rarelyThreshold} reviews`,
        never: "0 reviews",
      },
    };
  }

  analyzeCommonReviewers(reviewerMetrics, threshold = 2) {
    // Count how many authors each reviewer has reviewed and total review count
    const reviewerToAuthorsMap = new Map();
    const reviewerStats = {}; // Track total review count per reviewer

    reviewerMetrics.forEach((author) => {
      author.reviewers.forEach((reviewer) => {
        if (!reviewerToAuthorsMap.has(reviewer.username)) {
          reviewerToAuthorsMap.set(reviewer.username, new Set());
        }
        reviewerToAuthorsMap.get(reviewer.username).add(author.authorUsername);

        // Track total reviews
        if (!reviewerStats[reviewer.username]) {
          reviewerStats[reviewer.username] = {
            totalReviews: 0,
            authorsReviewed: new Set(),
          };
        }
        reviewerStats[reviewer.username].totalReviews += reviewer.reviewCount;
        reviewerStats[reviewer.username].authorsReviewed.add(
          author.authorUsername
        );
      });
    });

    // Identify common reviewers (those who review for multiple authors)
    const commonReviewers = Array.from(reviewerToAuthorsMap.entries())
      .filter(([reviewer, authors]) => authors.size >= threshold)
      .map(([reviewer]) => reviewer);

    const uniqueReviewers = Array.from(reviewerToAuthorsMap.keys());

    // Categorize all reviewers
    const { categories, thresholds } = this.categorizeReviewers(reviewerStats);

    return {
      uniqueReviewers,
      commonReviewers,
      neverReviewers: categories.never,
      rarelyReviewers: categories.rarely,
      reviewerToAuthorsMap,
      reviewerStats,
      categories,
      thresholds,
    };
  }

  async analyzeReviewers(fetchLimit = 200) {
    try {
      // First fetch contributors to get all repo users
      await this.fetchRepositoryContributors(fetchLimit);

      const prs = await this.fetchPullRequests(fetchLimit);
      const reviewerMetrics = new Map();

      console.log("Analyzing reviewers for each PR...");
      let processedCount = 0;

      for (const pr of prs) {
        const authorEmail = pr.user.email || `${pr.user.login}@github.local`;
        const authorUsername = pr.user.login;

        if (!reviewerMetrics.has(authorEmail)) {
          reviewerMetrics.set(authorEmail, {
            authorEmail,
            authorUsername,
            totalPRs: 0,
            reviewers: new Map(),
          });
        }

        const authorData = reviewerMetrics.get(authorEmail);
        authorData.totalPRs++;

        // Fetch reviews and comments
        const [reviews, comments] = await Promise.all([
          this.fetchPRReviews(pr.number),
          this.fetchPRComments(pr.number),
        ]);

        // Process reviews
        reviews.forEach((review) => {
          if (review.user.login !== authorUsername) {
            const reviewerEmail =
              review.user.email || `${review.user.login}@github.local`;
            const reviewerUsername = review.user.login;

            if (!authorData.reviewers.has(reviewerUsername)) {
              authorData.reviewers.set(reviewerUsername, {
                username: reviewerUsername,
                email: reviewerEmail,
                reviewCount: 0,
              });
            }
            authorData.reviewers.get(reviewerUsername).reviewCount++;
          }
        });

        // Process comments (review comments)
        comments.forEach((comment) => {
          if (comment.user.login !== authorUsername) {
            const reviewerEmail =
              comment.user.email || `${comment.user.login}@github.local`;
            const reviewerUsername = comment.user.login;

            if (!authorData.reviewers.has(reviewerUsername)) {
              authorData.reviewers.set(reviewerUsername, {
                username: reviewerUsername,
                email: reviewerEmail,
                reviewCount: 0,
              });
            }
            authorData.reviewers.get(reviewerUsername).reviewCount++;
          }
        });

        processedCount++;
        this.updateProgressBar(processedCount, prs.length, "Processing PRs");
      }

      console.log("\nAnalysis complete!");

      // Convert to final format
      const results = Array.from(reviewerMetrics.values()).map((author) => ({
        authorEmail: author.authorEmail,
        authorUsername: author.authorUsername,
        totalPRs: author.totalPRs,
        uniqueReviewers: author.reviewers.size,
        reviewers: Array.from(author.reviewers.values()),
      }));

      // Analyze common vs unique reviewers and categorize all reviewers
      const {
        uniqueReviewers,
        commonReviewers,
        neverReviewers,
        rarelyReviewers,
        reviewerToAuthorsMap,
        reviewerStats,
        categories,
        thresholds,
      } = this.analyzeCommonReviewers(results);

      // Mark reviewer categories in results
      results.forEach((author) => {
        let commonReviewerCount = 0;
        author.reviewers.forEach((reviewer) => {
          reviewer.isCommonReviewer = commonReviewers.includes(
            reviewer.username
          );

          // Categorize reviewer
          if (categories.common.includes(reviewer.username)) {
            reviewer.reviewCategory = "common";
          } else if (categories.rarely.includes(reviewer.username)) {
            reviewer.reviewCategory = "rarely";
          } else {
            reviewer.reviewCategory = "occasional";
          }

          if (reviewer.isCommonReviewer) {
            commonReviewerCount++;
          }
        });
        author.commonReviewers = commonReviewerCount;
      });

      return {
        repository: `${this.owner}/${this.repo}`,
        dateRange: {
          start: this.startDate,
          end: this.endDate,
        },
        summary: {
          totalPRs: prs.length,
          totalAuthors: results.length,
          averageReviewersPerAuthor:
            results.length > 0
              ? parseFloat(
                  (
                    results.reduce(
                      (sum, author) => sum + author.uniqueReviewers,
                      0
                    ) / results.length
                  ).toFixed(2)
                )
              : 0,
          uniqueReviewersAcrossAll: uniqueReviewers.length,
          commonReviewersAcrossAll: commonReviewers.length,
          neverReviewersCount: neverReviewers.length,
          rarelyReviewersCount: rarelyReviewers.length,
        },
        reviewerMetrics: results.sort(
          (a, b) => b.uniqueReviewers - a.uniqueReviewers
        ),
        globalReviewers: {
          uniqueReviewers,
          commonReviewers,
          neverReviewers,
          rarelyReviewers,
        },
        reviewerCategories: {
          common: {
            threshold: thresholds.common,
            count: categories.common.length,
          },
          rarely: {
            threshold: thresholds.rarely,
            count: categories.rarely.length,
          },
          never: {
            threshold: thresholds.never,
            count: categories.never.length,
          },
        },
      };
    } catch (error) {
      console.error("Analysis failed:", error.message);

      // Handle common errors with friendly messaging
      if (error.message.includes("401")) {
        console.error(
          "\n❌ Authentication Error: GitHub API requires a valid Bearer token."
        );
        console.error("   Please check your token format and permissions.");
        console.error(
          '   Token should have "repo" scope for private repositories.'
        );
      } else if (error.message.includes("403")) {
        console.error(
          "\n❌ API Rate Limit: You have exceeded GitHub API rate limits."
        );
        console.error(
          "   Please wait and try again, or use a token with higher limits."
        );
      } else if (error.message.includes("404")) {
        console.error(
          "\n❌ Repository Not Found: Please verify the repository owner/name."
        );
        console.error("   Make sure your token has access to this repository.");
      }

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
    token: process.env.GITHUB_TOKEN || null,
    fetchLimit: 200,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
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
        const limit = args[++i];
        options.fetchLimit = limit === "infinite" ? -1 : parseInt(limit) || 200;
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
        showHelp();
        process.exit(0);
      default:
        if (args[i].startsWith("-")) {
          console.error(`Unknown option: ${args[i]}`);
          process.exit(1);
        }
    }
  }

  return options;
}

function showHelp() {
  console.log(`
GitHub PR Reviewer Analysis Tool

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
  -l, --fetchLimit                Set a fetch limit (default: 200, use 'infinite' for no limit)
  -h, --help                      Show help message

Environment Variables:
  GITHUB_TOKEN                    GitHub personal access token

Examples:
  node main.mjs -r facebook/react -s 2024-01-01 -e 2024-01-31
  node main.mjs -r microsoft/vscode --format csv --fetchLimit infinite
  node main.mjs -r owner/repo --token your_token_here

Metrics Explained:
  - Unique Reviewers: Total count of distinct individuals who reviewed PRs for each author
  - Common Reviewers: Reviewers who consistently review across multiple authors (shows collaboration patterns)
  - Never Reviewers: Repository contributors who have never reviewed any PRs in the date range
  - Rarely Reviewers: Contributors who have reviewed 1-2 PRs only (low engagement)
  - Review Count: Number of times a specific reviewer reviewed a specific author's PRs

Reviewer Categories:
  - Common: >=3 reviews (active reviewers)
  - Rarely: 1-2 reviews (low engagement)
  - Never: 0 reviews (inactive in reviews)
`);
}

function formatAsCSV(data) {
  const lines = [
    "Author Email,Author Username,Total PRs,Unique Reviewers,Common Reviewers,Reviewer Usernames,Common Reviewer Usernames,Never Reviewers Count,Rarely Reviewers Count",
  ];

  data.reviewerMetrics.forEach((author) => {
    const reviewerNames = author.reviewers.map((r) => r.username).join(";");
    const commonReviewerNames = author.reviewers
      .filter((r) => r.isCommonReviewer)
      .map((r) => r.username)
      .join(";");

    lines.push(
      `"${author.authorEmail}","${author.authorUsername}",${author.totalPRs},${author.uniqueReviewers},${author.commonReviewers},"${reviewerNames}","${commonReviewerNames}",${data.summary.neverReviewersCount},${data.summary.rarelyReviewersCount}`
    );
  });

  return lines.join("\n");
}

async function main() {
  try {
    const options = parseArgs();

    // Validate required options
    if (!options.repo) {
      console.error("Error: Repository is required. Use -r or --repo option.");
      process.exit(1);
    }

    if (!options.token) {
      console.error(
        "Error: GitHub token is required. Use -t option or set GITHUB_TOKEN environment variable."
      );
      process.exit(1);
    }

    // Parse repository
    const [owner, repo] = options.repo.split("/");
    if (!owner || !repo) {
      console.error('Error: Repository must be in format "owner/repo"');
      process.exit(1);
    }

    // Set default dates
    if (!options.start) {
      const date = new Date();
      date.setDate(date.getDate() - 30);
      options.start = date.toISOString().split("T")[0];
    }

    if (!options.end) {
      options.end = new Date().toISOString().split("T")[0];
    }

    // Validate dates
    const startDate = new Date(options.start);
    const endDate = new Date(options.end);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      console.error("Error: Invalid date format. Use YYYY-MM-DD");
      process.exit(1);
    }

    if (startDate > endDate) {
      console.error("Error: Start date must be before end date");
      process.exit(1);
    }

    console.log(`\n🔍 Analyzing repository: ${options.repo}`);
    console.log(`📅 Date range: ${options.start} to ${options.end}`);
    console.log(
      `📊 Fetch limit: ${
        options.fetchLimit === -1 ? "unlimited" : options.fetchLimit
      }`
    );

    // Create analyzer
    const analyzer = new GitHubPRAnalyzer(
      repo,
      owner,
      options.start,
      options.end,
      options.token
    );

    // Run analysis
    const results = await analyzer.analyzeReviewers(options.fetchLimit);

    // Generate output filename if not provided
    if (!options.output) {
      const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .split("T")[0];
      options.output = `pr-reviewer-analysis-${owner}-${repo}-${timestamp}.${options.format}`;
    }

    // Format and save results
    let outputContent;
    if (options.format === "csv") {
      outputContent = formatAsCSV(results);
    } else {
      outputContent = JSON.stringify(results, null, 2);
    }

    writeFileSync(options.output, outputContent, "utf8");

    console.log(`\n✅ Analysis complete!`);
    console.log(`📁 Results saved to: ${options.output}`);
    console.log(`\n📈 Summary:`);
    console.log(`   📋 Total PRs analyzed: ${results.summary.totalPRs}`);
    console.log(`   👥 Total authors: ${results.summary.totalAuthors}`);
    console.log(
      `   ⭐ Average reviewers per author: ${results.summary.averageReviewersPerAuthor}`
    );
    console.log(
      `   🌟 Unique reviewers across all: ${results.summary.uniqueReviewersAcrossAll}`
    );
    console.log(
      `   🔄 Common reviewers across all: ${results.summary.commonReviewersAcrossAll}`
    );
    console.log(
      `   😴 Never reviewers: ${results.summary.neverReviewersCount}`
    );
    console.log(
      `   🤏 Rarely reviewers: ${results.summary.rarelyReviewersCount}`
    );

    if (options.verbose) {
      console.log(`\n📋 Top authors by reviewer diversity:`);
      results.reviewerMetrics.slice(0, 5).forEach((author, i) => {
        console.log(
          `   ${i + 1}. ${author.authorUsername}: ${
            author.uniqueReviewers
          } unique reviewers (${author.commonReviewers} common)`
        );
      });

      console.log(`\n🔄 Most common reviewers:`);
      results.globalReviewers.commonReviewers
        .slice(0, 5)
        .forEach((reviewer, i) => {
          console.log(`   ${i + 1}. ${reviewer}`);
        });

      console.log(`\n😴 Never reviewers (first 10):`);
      results.globalReviewers.neverReviewers
        .slice(0, 10)
        .forEach((reviewer, i) => {
          console.log(`   ${i + 1}. ${reviewer}`);
        });

      console.log(`\n🤏 Rarely reviewers (first 10):`);
      results.globalReviewers.rarelyReviewers
        .slice(0, 10)
        .forEach((reviewer, i) => {
          console.log(`   ${i + 1}. ${reviewer}`);
        });

      console.log(`\n📊 Reviewer Categories:`);
      Object.entries(results.reviewerCategories).forEach(([category, data]) => {
        console.log(`   ${category}: ${data.count} users (${data.threshold})`);
      });
    }
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    if (options?.debug) {
      console.error("Stack trace:", error.stack);
    }
    process.exit(1);
  }
}

// Run the CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { GitHubPRAnalyzer };
