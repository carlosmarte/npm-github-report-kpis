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
    "averageCodingTime": 2.5,
    "averageReviewWait": 8.2,
    "averageReviewTime": 15.7,
    "averageMergeDelay": 3.1
  },
  "cycleTimeMetrics": [
    {
      "authorEmail": "developer@company.com",
      "authorUsername": "dev-user",
      "totalPRs": 12,
      "avgCodingTime": 2.1,
      "avgReviewWait": 6.5,
      "avgReviewTime": 12.3,
      "avgMergeDelay": 2.8,
      "prs": [
        {
          "prNumber": 123,
          "title": "Feature: Add new API endpoint",
          "codingTime": 1.5,
          "reviewWait": 8.2,
          "reviewTime": 15.0,
          "mergeDelay": 1.0,
          "firstCommitDate": "2024-01-15T10:00:00Z",
          "prOpenDate": "2024-01-16T12:30:00Z",
          "firstReviewDate": "2024-01-17T20:45:00Z",
          "approvalDate": "2024-01-18T11:15:00Z",
          "mergeDate": "2024-01-18T12:15:00Z"
        }
      ]
    }
  ]
}

Use Cases:
1. Team Productivity Analysis: Track commit frequency and patterns
2. Code Quality Assessment: Monitor additions/deletions trends
3. Collaboration Metrics: Analyze contributor participation
4. Development Patterns: Identify working time distributions
5. Process Improvements: Compare before/after periods for process changes
6. Cycle Time per PR Stage Analysis: Identify bottlenecks in PR lifecycle
7. Engineering Performance Insight: Distinguish between individual dev speed vs. process bottlenecks
8. Process Diagnosis: Long "Review Wait" might mean reviewer load imbalance or async workflow issues
9. Team Health: Consistently long "Merge Delay" can indicate unclear ownership or risky PRs
10. Continuous Improvement: Empowers teams to streamline pipelines, automate steps, or rebalance workloads
*/

import { writeFileSync } from "fs";
import https from "https";
import { URL } from "url";

class GitHubPRCycleTimeAnalyzer {
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
        "User-Agent": "GitHub-PR-CycleTime-Analyzer/1.0",
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

    const filteredPRs = prs.filter((pr) => {
      const createdAt = new Date(pr.created_at);
      const start = new Date(this.startDate);
      const end = new Date(this.endDate);
      return createdAt >= start && createdAt <= end;
    });

    console.log(`Filtered ${filteredPRs.length} PRs within date range.`);
    return filteredPRs;
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

  calculateCycleTimeMetrics(pr, commits, reviews, comments) {
    const prOpenDate = new Date(pr.created_at);
    const mergeDate = pr.merged_at ? new Date(pr.merged_at) : null;

    // 1. Coding Time: First commit to PR open
    let firstCommitDate = null;
    if (commits.length > 0) {
      firstCommitDate = new Date(
        Math.min(...commits.map((c) => new Date(c.commit.author.date)))
      );
    }

    let codingTime = 0;
    if (firstCommitDate) {
      codingTime = (prOpenDate - firstCommitDate) / (1000 * 60 * 60); // hours
    }

    // 2. Review Wait: PR open to first review activity
    const allReviewEvents = [
      ...reviews.map((r) => ({
        date: new Date(r.submitted_at),
        type: "review",
      })),
      ...comments.map((c) => ({
        date: new Date(c.created_at),
        type: "comment",
      })),
    ].sort((a, b) => a.date - b.date);

    let reviewWait = 0;
    let firstReviewDate = null;
    if (allReviewEvents.length > 0) {
      firstReviewDate = allReviewEvents[0].date;
      reviewWait = (firstReviewDate - prOpenDate) / (1000 * 60 * 60); // hours
    }

    // 3. Review Time: First review to approval
    let reviewTime = 0;
    let approvalDate = null;
    const approvals = reviews.filter((r) => r.state === "APPROVED");
    if (approvals.length > 0 && firstReviewDate) {
      approvalDate = new Date(
        Math.max(...approvals.map((a) => new Date(a.submitted_at)))
      );
      reviewTime = (approvalDate - firstReviewDate) / (1000 * 60 * 60); // hours
    }

    // 4. Merge Delay: Approval to merge
    let mergeDelay = 0;
    if (approvalDate && mergeDate) {
      mergeDelay = (mergeDate - approvalDate) / (1000 * 60 * 60); // hours
    }

    return {
      prNumber: pr.number,
      title: pr.title,
      codingTime: Math.max(0, parseFloat(codingTime.toFixed(2))),
      reviewWait: Math.max(0, parseFloat(reviewWait.toFixed(2))),
      reviewTime: Math.max(0, parseFloat(reviewTime.toFixed(2))),
      mergeDelay: Math.max(0, parseFloat(mergeDelay.toFixed(2))),
      firstCommitDate: firstCommitDate ? firstCommitDate.toISOString() : null,
      prOpenDate: prOpenDate.toISOString(),
      firstReviewDate: firstReviewDate ? firstReviewDate.toISOString() : null,
      approvalDate: approvalDate ? approvalDate.toISOString() : null,
      mergeDate: mergeDate ? mergeDate.toISOString() : null,
    };
  }

  async analyzeCycleTime(fetchLimit = 200) {
    try {
      const prs = await this.fetchPullRequests(fetchLimit);
      const cycleTimeMetrics = new Map();

      console.log("Analyzing cycle time for each PR...");
      let processedCount = 0;

      for (const pr of prs) {
        const authorEmail = pr.user.email || `${pr.user.login}@github.local`;
        const authorUsername = pr.user.login;

        if (!cycleTimeMetrics.has(authorEmail)) {
          cycleTimeMetrics.set(authorEmail, {
            authorEmail,
            authorUsername,
            totalPRs: 0,
            prs: [],
            totalCodingTime: 0,
            totalReviewWait: 0,
            totalReviewTime: 0,
            totalMergeDelay: 0,
          });
        }

        const authorData = cycleTimeMetrics.get(authorEmail);

        // Fetch detailed PR data
        const [commits, reviews, comments] = await Promise.all([
          this.fetchPRCommits(pr.number),
          this.fetchPRReviews(pr.number),
          this.fetchPRComments(pr.number),
        ]);

        // Calculate cycle time metrics for this PR
        const prMetrics = this.calculateCycleTimeMetrics(
          pr,
          commits,
          reviews,
          comments
        );

        authorData.totalPRs++;
        authorData.prs.push(prMetrics);
        authorData.totalCodingTime += prMetrics.codingTime;
        authorData.totalReviewWait += prMetrics.reviewWait;
        authorData.totalReviewTime += prMetrics.reviewTime;
        authorData.totalMergeDelay += prMetrics.mergeDelay;

        processedCount++;
        this.updateProgressBar(processedCount, prs.length, "Processing PRs");

        // Add small delay to be respectful to API
        await this.sleep(100);
      }

      console.log("\nCycle time analysis complete!");

      // Calculate averages
      const results = Array.from(cycleTimeMetrics.values()).map((author) => ({
        authorEmail: author.authorEmail,
        authorUsername: author.authorUsername,
        totalPRs: author.totalPRs,
        avgCodingTime:
          author.totalPRs > 0
            ? parseFloat((author.totalCodingTime / author.totalPRs).toFixed(2))
            : 0,
        avgReviewWait:
          author.totalPRs > 0
            ? parseFloat((author.totalReviewWait / author.totalPRs).toFixed(2))
            : 0,
        avgReviewTime:
          author.totalPRs > 0
            ? parseFloat((author.totalReviewTime / author.totalPRs).toFixed(2))
            : 0,
        avgMergeDelay:
          author.totalPRs > 0
            ? parseFloat((author.totalMergeDelay / author.totalPRs).toFixed(2))
            : 0,
        prs: author.prs.sort(
          (a, b) => new Date(b.prOpenDate) - new Date(a.prOpenDate)
        ),
      }));

      // Calculate global averages
      const totalPRs = results.reduce(
        (sum, author) => sum + author.totalPRs,
        0
      );
      const totalCodingTime = results.reduce(
        (sum, author) => sum + author.avgCodingTime * author.totalPRs,
        0
      );
      const totalReviewWait = results.reduce(
        (sum, author) => sum + author.avgReviewWait * author.totalPRs,
        0
      );
      const totalReviewTime = results.reduce(
        (sum, author) => sum + author.avgReviewTime * author.totalPRs,
        0
      );
      const totalMergeDelay = results.reduce(
        (sum, author) => sum + author.avgMergeDelay * author.totalPRs,
        0
      );

      return {
        repository: `${this.owner}/${this.repo}`,
        dateRange: {
          start: this.startDate,
          end: this.endDate,
        },
        summary: {
          totalPRs: totalPRs,
          totalAuthors: results.length,
          averageCodingTime:
            totalPRs > 0
              ? parseFloat((totalCodingTime / totalPRs).toFixed(2))
              : 0,
          averageReviewWait:
            totalPRs > 0
              ? parseFloat((totalReviewWait / totalPRs).toFixed(2))
              : 0,
          averageReviewTime:
            totalPRs > 0
              ? parseFloat((totalReviewTime / totalPRs).toFixed(2))
              : 0,
          averageMergeDelay:
            totalPRs > 0
              ? parseFloat((totalMergeDelay / totalPRs).toFixed(2))
              : 0,
        },
        cycleTimeMetrics: results.sort((a, b) => b.totalPRs - a.totalPRs),
      };
    } catch (error) {
      console.error("Cycle time analysis failed:", error.message);

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
GitHub PR Cycle Time Analysis Tool

📊 Cycle Time per PR Stage (per User Email)

🧾 Definition:
Breakdown of each stage in the PR lifecycle, measured individually:
  1. Coding Time: Time from the first commit to PR open
  2. Review Wait: Time from PR open to first review comment
  3. Review Time: Time from first review comment to approval
  4. Merge Delay: Time from approval to PR merge

🎯 Purpose:
By calculating these metrics per user email (i.e., author of the PR), you can:
  • Identify where contributors are bottlenecked
  • Highlight areas to optimize handoffs or automation
  • Detect team-level review delays or merge stagnation

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
  - Coding Time: Hours from first commit to PR creation
  - Review Wait: Hours from PR open to first review activity
  - Review Time: Hours from first review to approval
  - Merge Delay: Hours from approval to merge
`);
}

function formatAsCSV(data) {
  const lines = [
    "Author Email,Author Username,Total PRs,Avg Coding Time (hrs),Avg Review Wait (hrs),Avg Review Time (hrs),Avg Merge Delay (hrs)",
  ];

  data.cycleTimeMetrics.forEach((author) => {
    lines.push(
      `"${author.authorEmail}","${author.authorUsername}",${author.totalPRs},${author.avgCodingTime},${author.avgReviewWait},${author.avgReviewTime},${author.avgMergeDelay}`
    );
  });

  return lines.join("\n");
}

async function main() {
  try {
    const options = parseArgs();

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

    const [owner, repo] = options.repo.split("/");
    if (!owner || !repo) {
      console.error('Error: Repository must be in format "owner/repo"');
      process.exit(1);
    }

    if (!options.start) {
      const date = new Date();
      date.setDate(date.getDate() - 30);
      options.start = date.toISOString().split("T")[0];
    }

    if (!options.end) {
      options.end = new Date().toISOString().split("T")[0];
    }

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

    const analyzer = new GitHubPRCycleTimeAnalyzer(
      repo,
      owner,
      options.start,
      options.end,
      options.token
    );

    const results = await analyzer.analyzeCycleTime(options.fetchLimit);

    if (!options.output) {
      const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .split("T")[0];
      options.output = `pr-cycle-time-analysis-${owner}-${repo}-${timestamp}.${options.format}`;
    }

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
      `   ⏱️  Average coding time: ${results.summary.averageCodingTime}hrs`
    );
    console.log(
      `   ⏰ Average review wait: ${results.summary.averageReviewWait}hrs`
    );
    console.log(
      `   📝 Average review time: ${results.summary.averageReviewTime}hrs`
    );
    console.log(
      `   🔄 Average merge delay: ${results.summary.averageMergeDelay}hrs`
    );

    if (options.verbose) {
      console.log(`\n📋 Top authors by PR volume:`);
      results.cycleTimeMetrics.slice(0, 5).forEach((author, i) => {
        console.log(
          `   ${i + 1}. ${author.authorUsername}: ${
            author.totalPRs
          } PRs (Coding: ${author.avgCodingTime}hrs, Review Wait: ${
            author.avgReviewWait
          }hrs, Review: ${author.avgReviewTime}hrs, Merge: ${
            author.avgMergeDelay
          }hrs)`
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

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { GitHubPRCycleTimeAnalyzer };
