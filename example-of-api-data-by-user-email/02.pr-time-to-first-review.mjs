#!/usr/bin/env node

/*
JSON Report Structure:
{
  "metadata": {
    "repository": "owner/repo",
    "period": {
      "start": "2024-01-01T00:00:00Z",
      "end": "2024-01-31T23:59:59Z"
    },
    "generatedAt": "2024-01-31T12:00:00Z",
    "totalPRsAnalyzed": 150
  },
  "summary": {
    "averageTimeToFirstReview": "2.5 hours",
    "medianTimeToFirstReview": "1.8 hours",
    "totalAuthors": 25
  },
  "perUserBreakdown": [
    {
      "authorEmail": "john.doe@company.com",
      "authorLogin": "johndoe",
      "prsAnalyzed": 8,
      "averageTimeToFirstReview": "1.2 hours",
      "medianTimeToFirstReview": "45 minutes",
      "timeToFirstReviewDistribution": {
        "min": "15 minutes",
        "max": "4.5 hours",
        "standardDeviation": "1.1 hours"
      },
      "pullRequests": [
        {
          "prNumber": 123,
          "title": "Fix authentication bug",
          "createdAt": "2024-01-15T09:00:00Z",
          "firstReviewAt": "2024-01-15T10:15:00Z",
          "timeToFirstReview": "1.25 hours"
        }
      ]
    }
  ]
}

Use Cases:
1. Team Productivity Analysis: Track how quickly teams respond to PRs
2. Code Review Efficiency: Identify bottlenecks in the review process
3. Developer Experience: Understand PR review wait times
4. Process Improvement: Compare before/after periods for process changes
5. Team Capacity Planning: Understand review workload distribution
6. Quality Assurance: Correlate review speed with code quality metrics
7. Remote Team Coordination: Analyze timezone impacts on review times
8. Sprint Planning: Factor review times into development estimates
*/

import { readFileSync } from "fs";
import { writeFileSync } from "fs";
import { createWriteStream } from "fs";
import https from "https";
import { URL } from "url";

class GitHubPRTimeToFirstReviewAnalyzer {
  constructor() {
    this.baseURL = "https://api.github.com";
    this.rateLimitRemaining = 5000;
    this.rateLimitReset = null;
  }

  async analyzeTimeToFirstReview(
    repo,
    owner,
    startDate,
    endDate,
    token,
    fetchLimit = 200
  ) {
    try {
      console.log(
        `🔍 Analyzing Pull Request Time to First Review for ${owner}/${repo}`
      );
      console.log(`📅 Period: ${startDate} to ${endDate}`);
      console.log(
        `🎯 Fetch limit: ${fetchLimit === Infinity ? "unlimited" : fetchLimit}`
      );

      const pulls = await this.fetchPullRequests(
        owner,
        repo,
        token,
        startDate,
        endDate,
        fetchLimit
      );
      console.log(
        `📊 Found ${pulls.length} pull requests in the specified period`
      );

      const analysisData = [];
      let processedCount = 0;

      for (const pr of pulls) {
        processedCount++;
        this.showProgress(
          processedCount,
          pulls.length,
          `Processing PR #${pr.number}`
        );

        const reviewData = await this.getFirstReviewTime(
          owner,
          repo,
          pr.number,
          token
        );

        if (reviewData.firstReviewAt) {
          const timeToFirstReview = this.calculateTimeDifference(
            pr.created_at,
            reviewData.firstReviewAt
          );

          analysisData.push({
            prNumber: pr.number,
            title: pr.title,
            authorEmail: pr.user.email || `${pr.user.login}@github.com`,
            authorLogin: pr.user.login,
            createdAt: pr.created_at,
            firstReviewAt: reviewData.firstReviewAt,
            timeToFirstReviewMinutes: timeToFirstReview.minutes,
            timeToFirstReviewHours: timeToFirstReview.hours,
            timeToFirstReviewFormatted: timeToFirstReview.formatted,
          });
        }

        // Rate limiting check
        if (this.rateLimitRemaining < 10) {
          console.log("\n⏳ Rate limit approaching, waiting...");
          await this.wait(60000); // Wait 1 minute
        }
      }

      console.log("\n✅ Analysis complete!");
      return this.generateReport(analysisData, owner, repo, startDate, endDate);
    } catch (error) {
      this.handleError(error);
      throw error;
    }
  }

  async fetchPullRequests(owner, repo, token, startDate, endDate, fetchLimit) {
    const pulls = [];
    let page = 1;
    const perPage = 100;
    let hasMorePages = true;

    console.log("📥 Fetching pull requests...");

    while (hasMorePages && pulls.length < fetchLimit) {
      const url = `/repos/${owner}/${repo}/pulls?state=all&sort=created&direction=desc&page=${page}&per_page=${perPage}`;

      try {
        const response = await this.makeGitHubRequest(url, token);
        const pagePulls = response.data;

        if (pagePulls.length === 0) {
          hasMorePages = false;
          break;
        }

        // Filter by date range
        for (const pr of pagePulls) {
          const prDate = new Date(pr.created_at);
          const start = new Date(startDate);
          const end = new Date(endDate);

          if (prDate >= start && prDate <= end) {
            pulls.push(pr);
            if (pulls.length >= fetchLimit) {
              hasMorePages = false;
              break;
            }
          } else if (prDate < start) {
            // PRs are sorted by creation date desc, so we can stop
            hasMorePages = false;
            break;
          }
        }

        this.showProgress(
          pulls.length,
          fetchLimit,
          `Fetched ${pulls.length} relevant PRs`
        );
        page++;
      } catch (error) {
        console.error(`❌ Error fetching page ${page}:`, error.message);
        break;
      }
    }

    return pulls;
  }

  async getFirstReviewTime(owner, repo, prNumber, token) {
    try {
      // Get PR reviews
      const reviewsUrl = `/repos/${owner}/${repo}/pulls/${prNumber}/reviews`;
      const reviewsResponse = await this.makeGitHubRequest(reviewsUrl, token);

      // Get PR review comments
      const commentsUrl = `/repos/${owner}/${repo}/pulls/${prNumber}/comments`;
      const commentsResponse = await this.makeGitHubRequest(commentsUrl, token);

      // Get issue comments (general PR comments)
      const issueCommentsUrl = `/repos/${owner}/${repo}/issues/${prNumber}/comments`;
      const issueCommentsResponse = await this.makeGitHubRequest(
        issueCommentsUrl,
        token
      );

      const allEvents = [
        ...reviewsResponse.data.map((r) => ({
          type: "review",
          timestamp: r.submitted_at,
        })),
        ...commentsResponse.data.map((c) => ({
          type: "review_comment",
          timestamp: c.created_at,
        })),
        ...issueCommentsResponse.data.map((c) => ({
          type: "issue_comment",
          timestamp: c.created_at,
        })),
      ];

      // Sort by timestamp and get the first one
      allEvents.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

      return {
        firstReviewAt: allEvents.length > 0 ? allEvents[0].timestamp : null,
        totalReviewEvents: allEvents.length,
      };
    } catch (error) {
      console.error(
        `❌ Error fetching review data for PR #${prNumber}:`,
        error.message
      );
      return { firstReviewAt: null, totalReviewEvents: 0 };
    }
  }

  calculateTimeDifference(startTime, endTime) {
    const start = new Date(startTime);
    const end = new Date(endTime);
    const diffMs = end - start;
    const diffMinutes = Math.round(diffMs / 60000);
    const diffHours = diffMinutes / 60;

    let formatted;
    if (diffMinutes < 60) {
      formatted = `${diffMinutes} minutes`;
    } else if (diffHours < 24) {
      formatted = `${diffHours.toFixed(1)} hours`;
    } else {
      const diffDays = diffHours / 24;
      formatted = `${diffDays.toFixed(1)} days`;
    }

    return {
      minutes: diffMinutes,
      hours: diffHours,
      formatted,
    };
  }

  generateReport(analysisData, owner, repo, startDate, endDate) {
    // Group by author
    const byAuthor = {};

    analysisData.forEach((item) => {
      if (!byAuthor[item.authorEmail]) {
        byAuthor[item.authorEmail] = {
          authorEmail: item.authorEmail,
          authorLogin: item.authorLogin,
          pullRequests: [],
          times: [],
        };
      }
      byAuthor[item.authorEmail].pullRequests.push(item);
      byAuthor[item.authorEmail].times.push(item.timeToFirstReviewMinutes);
    });

    // Calculate statistics per author
    const perUserBreakdown = Object.values(byAuthor).map((author) => {
      const times = author.times.sort((a, b) => a - b);
      const avg = times.reduce((sum, time) => sum + time, 0) / times.length;
      const median = times[Math.floor(times.length / 2)];
      const min = Math.min(...times);
      const max = Math.max(...times);

      // Standard deviation
      const variance =
        times.reduce((sum, time) => sum + Math.pow(time - avg, 2), 0) /
        times.length;
      const stdDev = Math.sqrt(variance);

      return {
        authorEmail: author.authorEmail,
        authorLogin: author.authorLogin,
        prsAnalyzed: author.pullRequests.length,
        averageTimeToFirstReview: this.formatMinutes(avg),
        medianTimeToFirstReview: this.formatMinutes(median),
        timeToFirstReviewDistribution: {
          min: this.formatMinutes(min),
          max: this.formatMinutes(max),
          standardDeviation: this.formatMinutes(stdDev),
        },
        pullRequests: author.pullRequests.map((pr) => ({
          prNumber: pr.prNumber,
          title: pr.title,
          createdAt: pr.createdAt,
          firstReviewAt: pr.firstReviewAt,
          timeToFirstReview: pr.timeToFirstReviewFormatted,
        })),
      };
    });

    // Overall statistics
    const allTimes = analysisData.map((item) => item.timeToFirstReviewMinutes);
    const overallAvg =
      allTimes.reduce((sum, time) => sum + time, 0) / allTimes.length;
    const sortedTimes = allTimes.sort((a, b) => a - b);
    const overallMedian = sortedTimes[Math.floor(sortedTimes.length / 2)];

    return {
      metadata: {
        repository: `${owner}/${repo}`,
        period: {
          start: startDate,
          end: endDate,
        },
        generatedAt: new Date().toISOString(),
        totalPRsAnalyzed: analysisData.length,
      },
      summary: {
        averageTimeToFirstReview: this.formatMinutes(overallAvg),
        medianTimeToFirstReview: this.formatMinutes(overallMedian),
        totalAuthors: Object.keys(byAuthor).length,
      },
      perUserBreakdown: perUserBreakdown.sort(
        (a, b) => b.prsAnalyzed - a.prsAnalyzed
      ),
    };
  }

  formatMinutes(minutes) {
    if (isNaN(minutes)) return "0 minutes";

    if (minutes < 60) {
      return `${Math.round(minutes)} minutes`;
    } else if (minutes < 1440) {
      // Less than 24 hours
      const hours = minutes / 60;
      return `${hours.toFixed(1)} hours`;
    } else {
      const days = minutes / 1440;
      return `${days.toFixed(1)} days`;
    }
  }

  async makeGitHubRequest(endpoint, token) {
    return new Promise((resolve, reject) => {
      const url = new URL(this.baseURL + endpoint);

      const options = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "GitHub-PR-TimeToFirstReview-CLI/1.0.0",
        },
      };

      const req = https.request(options, (res) => {
        let data = "";

        // Update rate limit info
        this.rateLimitRemaining =
          parseInt(res.headers["x-ratelimit-remaining"]) || 0;
        this.rateLimitReset = parseInt(res.headers["x-ratelimit-reset"]) || 0;

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          try {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve({ data: JSON.parse(data), headers: res.headers });
            } else {
              reject(
                new Error(`GitHub API error: ${res.statusCode} - ${data}`)
              );
            }
          } catch (error) {
            reject(new Error(`Failed to parse response: ${error.message}`));
          }
        });
      });

      req.on("error", (error) => {
        reject(new Error(`Request failed: ${error.message}`));
      });

      req.setTimeout(30000, () => {
        req.destroy();
        reject(new Error("Request timeout"));
      });

      req.end();
    });
  }

  showProgress(current, total, message = "") {
    const percentage = Math.round((current / total) * 100);
    const progressBar =
      "█".repeat(Math.round(percentage / 2)) +
      "░".repeat(50 - Math.round(percentage / 2));
    process.stdout.write(`\r[${progressBar}] ${percentage}% ${message}`);
  }

  async wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  handleError(error) {
    console.error("\n❌ Error occurred:");

    if (error.message.includes("401")) {
      console.error(
        "🔑 Authentication Error: GitHub API requires Bearer token format."
      );
      console.error(
        "   Make sure your token is valid and has proper repository access scopes."
      );
      console.error(
        "   Set your token using: export GITHUB_TOKEN=your_token_here"
      );
    } else if (error.message.includes("403")) {
      console.error(
        "🚫 Forbidden: The token might lack proper repository access scopes."
      );
      console.error(
        '   Ensure your token has "repo" scope for private repositories.'
      );
    } else if (error.message.includes("404")) {
      console.error(
        "❓ Not Found: Repository might not exist or token lacks access."
      );
    } else if (error.message.includes("rate limit")) {
      console.error("⏱️  Rate Limit: GitHub API rate limit exceeded.");
      console.error(
        "   Wait for the rate limit to reset or use a token with higher limits."
      );
    } else {
      console.error(`💥 Unexpected error: ${error.message}`);
    }

    console.log("\nFull error details:", error);
  }
}

// CLI Interface
async function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help || !options.repo) {
    showHelp();
    process.exit(options.help ? 0 : 1);
  }

  try {
    const [owner, repo] = options.repo.split("/");
    if (!owner || !repo) {
      throw new Error('Repository must be in format "owner/repo"');
    }

    const token = options.token || process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error(
        "GitHub token is required. Use --token or set GITHUB_TOKEN environment variable."
      );
    }

    // Set default dates if not provided
    const endDate = options.end || new Date().toISOString().split("T")[0];
    const startDate =
      options.start ||
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];

    const analyzer = new GitHubPRTimeToFirstReviewAnalyzer();
    const fetchLimit =
      options.fetchLimit === "infinite"
        ? Infinity
        : parseInt(options.fetchLimit) || 200;

    const report = await analyzer.analyzeTimeToFirstReview(
      repo,
      owner,
      startDate,
      endDate,
      token,
      fetchLimit
    );

    // Generate output filename if not provided
    const outputFile =
      options.output ||
      `pr-time-to-first-review-${owner}-${repo}-${startDate}-to-${endDate}.${options.format}`;

    // Save report
    if (options.format === "csv") {
      saveAsCSV(report, outputFile);
    } else {
      saveAsJSON(report, outputFile);
    }

    console.log(`\n✅ Report saved to: ${outputFile}`);
    console.log(`📊 Total PRs analyzed: ${report.metadata.totalPRsAnalyzed}`);
    console.log(`👥 Total authors: ${report.summary.totalAuthors}`);
    console.log(
      `⏱️  Average time to first review: ${report.summary.averageTimeToFirstReview}`
    );
  } catch (error) {
    console.error("\n❌ Error:", error.message);
    process.exit(1);
  }
}

function parseArgs(args) {
  const options = {
    format: "json",
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
        options.fetchLimit = nextArg;
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
GitHub Pull Request Time to First Review Analyzer

Measures the elapsed time between when a Pull Request is created and when the first 
review comment (approve, request changes, or comment) is made.

Usage:
  node main.mjs -r owner/repo [options]

Options:
  -r, --repo <owner/repo>         Repository to analyze (required)
  -f, --format <format>           Output format: json (default) or csv
  -o, --output <filename>         Output filename (auto-generated if not provided)
  -s, --start <date>              Start date (ISO format: YYYY-MM-DD) default -30Days
  -e, --end <date>                End date (ISO format: YYYY-MM-DD) default: now
  -v, --verbose                   Enable verbose logging
  -d, --debug                     Enable debug logging
  -t, --token                     GitHub Token
  -l, --fetchLimit                Set a fetch limit of 200, but user can change to infinite
  -h, --help                      Show help message

Environment Variables:
  GITHUB_TOKEN                    GitHub personal access token

Examples:
  node main.mjs -r facebook/react
  node main.mjs -r microsoft/vscode -s 2024-01-01 -e 2024-01-31 -f csv
  node main.mjs -r owner/repo -l infinite --token ghp_xxxxxxxxxxxx
`);
}

function saveAsJSON(report, filename) {
  const jsonOutput = JSON.stringify(report, null, 2);
  writeFileSync(filename, jsonOutput, "utf8");
}

function saveAsCSV(report, filename) {
  const rows = [];

  // Header
  rows.push([
    "Author Email",
    "Author Login",
    "PR Number",
    "PR Title",
    "Created At",
    "First Review At",
    "Time to First Review (Minutes)",
    "Time to First Review (Formatted)",
  ]);

  // Data rows
  report.perUserBreakdown.forEach((user) => {
    user.pullRequests.forEach((pr) => {
      rows.push([
        user.authorEmail,
        user.authorLogin,
        pr.prNumber,
        pr.title.replace(/"/g, '""'), // Escape quotes for CSV
        pr.createdAt,
        pr.firstReviewAt,
        Math.round(
          (new Date(pr.firstReviewAt) - new Date(pr.createdAt)) / 60000
        ),
        pr.timeToFirstReview,
      ]);
    });
  });

  const csvContent = rows
    .map((row) => row.map((field) => `"${field}"`).join(","))
    .join("\n");

  writeFileSync(filename, csvContent, "utf8");
}

// Run the CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export default GitHubPRTimeToFirstReviewAnalyzer;
