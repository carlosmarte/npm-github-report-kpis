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
    "averageReviewIterationsPerPR": 2.1,
    "totalReviewIterations": 315,
    "highIterationPRs": 15
  },
  "authorMetrics": [
    {
      "authorEmail": "developer@company.com",
      "authorUsername": "dev-user",
      "totalPRs": 12,
      "totalReviewIterations": 31,
      "avgReviewIterationsPerPR": 2.58,
      "highIterationPRs": 3,
      "prDetails": [
        {
          "prNumber": 123,
          "prTitle": "Feature implementation",
          "reviewIterations": 4,
          "firstReviewDate": "2024-01-15T10:30:00Z",
          "commits": 6,
          "postReviewCommits": 3
        }
      ]
    }
  ],
  "iterationDistribution": {
    "0-1": 45,
    "2-3": 67,
    "4+": 38
  }
}

Use Cases:
1. Code Quality Assessment: Monitor how often PRs require multiple review cycles
2. Developer Mentoring: Identify developers who might need clearer requirements or additional support
3. Process Improvement: Track team-wide trends in PR preparation and review efficiency
4. Workload Analysis: Understand review burden and iteration patterns
5. Team Performance: Compare before/after periods for process changes
*/

import { writeFileSync } from "fs";
import https from "https";
import { URL } from "url";

class GitHubPRReviewIterationAnalyzer {
  constructor(repo, owner, startDate, endDate, token) {
    this.repo = repo;
    this.owner = owner;
    this.startDate = startDate;
    this.endDate = endDate;
    this.token = token;
    this.baseUrl = "https://api.github.com";
    this.retryCount = 3;
    this.retryDelay = 1000;
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
        "User-Agent": "GitHub-PR-Review-Iteration-Analyzer/1.0",
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

  async fetchPullRequests(fetchLimit = 200) {
    console.log("Fetching pull requests...");
    const endpoint = `/repos/${this.owner}/${this.repo}/pulls`;
    const params = new URLSearchParams({
      state: "all",
      sort: "updated",
      direction: "desc",
    });

    const prs = await this.fetchAllPages(`${endpoint}?${params}`, fetchLimit);

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

  async fetchPRCommits(prNumber) {
    try {
      const endpoint = `/repos/${this.owner}/${this.repo}/pulls/${prNumber}/commits`;
      const response = await this.retryRequest(endpoint, 1, 100);
      return response.data || [];
    } catch (error) {
      console.log(
        `Warning: Could not fetch commits for PR #${prNumber}: ${error.message}`
      );
      return [];
    }
  }

  findFirstReviewTimestamp(reviews, comments) {
    const allReviewActivities = [];

    // Add review submissions
    reviews.forEach((review) => {
      if (review.state !== "PENDING" && review.submitted_at) {
        allReviewActivities.push({
          timestamp: new Date(review.submitted_at),
          type: "review",
          user: review.user.login,
        });
      }
    });

    // Add review comments
    comments.forEach((comment) => {
      allReviewActivities.push({
        timestamp: new Date(comment.created_at),
        type: "comment",
        user: comment.user.login,
      });
    });

    // Sort by timestamp and return the first one
    if (allReviewActivities.length === 0) return null;

    allReviewActivities.sort((a, b) => a.timestamp - b.timestamp);
    return allReviewActivities[0].timestamp;
  }

  countPostReviewCommits(commits, firstReviewTimestamp) {
    if (!firstReviewTimestamp) return 0;

    return commits.filter((commit) => {
      const commitDate = new Date(commit.commit.author.date);
      return commitDate > firstReviewTimestamp;
    }).length;
  }

  calculateReviewIterations(commits, firstReviewTimestamp, reviews, comments) {
    if (!firstReviewTimestamp) return 0;

    // Count commits after first review
    const postReviewCommits = this.countPostReviewCommits(
      commits,
      firstReviewTimestamp
    );

    // Count distinct review submissions after first review
    const postReviewReviews = reviews.filter((review) => {
      if (!review.submitted_at || review.state === "PENDING") return false;
      const reviewDate = new Date(review.submitted_at);
      return reviewDate > firstReviewTimestamp;
    }).length;

    // Count review comments after first review
    const postReviewComments = comments.filter((comment) => {
      const commentDate = new Date(comment.created_at);
      return commentDate > firstReviewTimestamp;
    }).length;

    // Calculate iterations based on activity cycles
    // Each commit push after review counts as an iteration
    // Group reviews/comments that happen close together as single iteration
    return Math.max(postReviewCommits, Math.ceil(postReviewReviews / 2));
  }

  async analyzeReviewIterations(fetchLimit = 200) {
    try {
      const prs = await this.fetchPullRequests(fetchLimit);
      const authorMetrics = new Map();

      console.log("Analyzing review iterations for each PR...");
      let processedCount = 0;

      for (const pr of prs) {
        const authorEmail = pr.user.email || `${pr.user.login}@github.local`;
        const authorUsername = pr.user.login;

        if (!authorMetrics.has(authorEmail)) {
          authorMetrics.set(authorEmail, {
            authorEmail,
            authorUsername,
            totalPRs: 0,
            totalReviewIterations: 0,
            prDetails: [],
          });
        }

        const authorData = authorMetrics.get(authorEmail);

        // Fetch PR data
        const [reviews, comments, commits] = await Promise.all([
          this.fetchPRReviews(pr.number),
          this.fetchPRComments(pr.number),
          this.fetchPRCommits(pr.number),
        ]);

        // Analyze this PR
        const firstReviewTimestamp = this.findFirstReviewTimestamp(
          reviews,
          comments
        );
        const reviewIterations = this.calculateReviewIterations(
          commits,
          firstReviewTimestamp,
          reviews,
          comments
        );
        const postReviewCommits = this.countPostReviewCommits(
          commits,
          firstReviewTimestamp
        );

        // Update author metrics
        authorData.totalPRs++;
        authorData.totalReviewIterations += reviewIterations;
        authorData.prDetails.push({
          prNumber: pr.number,
          prTitle: pr.title,
          reviewIterations,
          firstReviewDate: firstReviewTimestamp
            ? firstReviewTimestamp.toISOString()
            : null,
          commits: commits.length,
          postReviewCommits,
        });

        processedCount++;
        this.updateProgressBar(processedCount, prs.length, "Processing PRs");
      }

      console.log("\nAnalysis complete!");

      // Convert to final format with calculated averages
      const results = Array.from(authorMetrics.values()).map((author) => ({
        authorEmail: author.authorEmail,
        authorUsername: author.authorUsername,
        totalPRs: author.totalPRs,
        totalReviewIterations: author.totalReviewIterations,
        avgReviewIterationsPerPR:
          author.totalPRs > 0
            ? parseFloat(
                (author.totalReviewIterations / author.totalPRs).toFixed(2)
              )
            : 0,
        highIterationPRs: author.prDetails.filter(
          (pr) => pr.reviewIterations >= 4
        ).length,
        prDetails: author.prDetails.sort(
          (a, b) => b.reviewIterations - a.reviewIterations
        ),
      }));

      // Calculate summary statistics
      const totalPRs = results.reduce(
        (sum, author) => sum + author.totalPRs,
        0
      );
      const totalReviewIterations = results.reduce(
        (sum, author) => sum + author.totalReviewIterations,
        0
      );

      // Calculate iteration distribution
      const iterationDistribution = { "0-1": 0, "2-3": 0, "4+": 0 };
      results.forEach((author) => {
        author.prDetails.forEach((pr) => {
          if (pr.reviewIterations <= 1) iterationDistribution["0-1"]++;
          else if (pr.reviewIterations <= 3) iterationDistribution["2-3"]++;
          else iterationDistribution["4+"]++;
        });
      });

      return {
        repository: `${this.owner}/${this.repo}`,
        dateRange: {
          start: this.startDate,
          end: this.endDate,
        },
        summary: {
          totalPRs,
          totalAuthors: results.length,
          averageReviewIterationsPerPR:
            totalPRs > 0
              ? parseFloat((totalReviewIterations / totalPRs).toFixed(2))
              : 0,
          totalReviewIterations,
          highIterationPRs: iterationDistribution["4+"],
        },
        authorMetrics: results.sort(
          (a, b) => b.avgReviewIterationsPerPR - a.avgReviewIterationsPerPR
        ),
        iterationDistribution,
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
GitHub PR Review Iteration Analysis Tool

Measures the number of times a Pull Request (PR) authored by a user was updated 
(i.e., via commits) after the first review comment, triggering additional review cycles.

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
  - Review Iterations: Number of commit pushes after the first review comment
  - Low Count (0-1): Clean code, clear scope, or lack of deep review
  - Moderate Count (2-3): Normal feedback loop and collaborative improvement  
  - High Count (4+): May signal unclear requirements, rushed code, or evolving specs

Why It Matters:
  - Identifies developers needing mentoring or clearer task scopes
  - Flags PRs that are repeatedly reworked, impacting review efficiency
  - Reveals team-wide trends in PR preparation and clarity
`);
}

function formatAsCSV(data) {
  const lines = [
    "Author Email,Author Username,Total PRs,Total Review Iterations,Avg Review Iterations per PR,High Iteration PRs",
  ];

  data.authorMetrics.forEach((author) => {
    lines.push(
      `"${author.authorEmail}","${author.authorUsername}",${author.totalPRs},${author.totalReviewIterations},${author.avgReviewIterationsPerPR},${author.highIterationPRs}`
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

    console.log(`\n🔄 Analyzing PR review iterations: ${options.repo}`);
    console.log(`📅 Date range: ${options.start} to ${options.end}`);
    console.log(
      `📊 Fetch limit: ${
        options.fetchLimit === -1 ? "unlimited" : options.fetchLimit
      }`
    );

    // Create analyzer
    const analyzer = new GitHubPRReviewIterationAnalyzer(
      repo,
      owner,
      options.start,
      options.end,
      options.token
    );

    // Run analysis
    const results = await analyzer.analyzeReviewIterations(options.fetchLimit);

    // Generate output filename if not provided
    if (!options.output) {
      const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .split("T")[0];
      options.output = `pr-review-iterations-${owner}-${repo}-${timestamp}.${options.format}`;
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
      `   🔄 Average review iterations per PR: ${results.summary.averageReviewIterationsPerPR}`
    );
    console.log(
      `   🚩 High iteration PRs (4+): ${results.summary.highIterationPRs}`
    );

    console.log(`\n📊 Iteration Distribution:`);
    console.log(`   🟢 Low (0-1): ${results.iterationDistribution["0-1"]} PRs`);
    console.log(
      `   🟡 Moderate (2-3): ${results.iterationDistribution["2-3"]} PRs`
    );
    console.log(`   🔴 High (4+): ${results.iterationDistribution["4+"]} PRs`);

    if (options.verbose) {
      console.log(`\n📋 Top authors by review iterations:`);
      results.authorMetrics.slice(0, 5).forEach((author, i) => {
        console.log(
          `   ${i + 1}. ${author.authorUsername}: ${
            author.avgReviewIterationsPerPR
          } avg iterations (${author.totalPRs} PRs, ${
            author.highIterationPRs
          } high)`
        );
      });

      console.log(`\n🚩 Most problematic PRs:`);
      const allPRs = results.authorMetrics
        .flatMap((author) =>
          author.prDetails.map((pr) => ({
            ...pr,
            authorUsername: author.authorUsername,
          }))
        )
        .sort((a, b) => b.reviewIterations - a.reviewIterations)
        .slice(0, 5);

      allPRs.forEach((pr, i) => {
        console.log(
          `   ${i + 1}. PR #${pr.prNumber} by ${pr.authorUsername}: ${
            pr.reviewIterations
          } iterations`
        );
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

export { GitHubPRReviewIterationAnalyzer };
