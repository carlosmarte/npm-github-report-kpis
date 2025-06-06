#!/usr/bin/env node

/*
JSON Report Structure:
{
  "metadata": {
    "repository": "owner/repo",
    "dateRange": {
      "start": "2024-01-01T00:00:00.000Z",
      "end": "2024-01-31T23:59:59.999Z"
    },
    "totalPRs": 150,
    "analysisDate": "2024-01-31T10:30:00.000Z"
  },
  "summary": {
    "totalLinesChanged": 45000,
    "averagePRSize": 300,
    "largestPR": {
      "number": 123,
      "size": 2500,
      "author": "john@example.com"
    }
  },
  "userStats": [
    {
      "email": "john@example.com",
      "name": "John Doe",
      "totalPRs": 25,
      "totalLinesAdded": 5000,
      "totalLinesRemoved": 2000,
      "totalPRSize": 7000,
      "averagePRSize": 280,
      "largestPR": {
        "number": 123,
        "size": 2500,
        "title": "Feature: New authentication system"
      },
      "smallestPR": {
        "number": 98,
        "size": 15,
        "title": "Fix: Typo in readme"
      }
    }
  ],
  "pullRequests": [
    {
      "number": 123,
      "title": "Feature: New authentication system",
      "author": {
        "email": "john@example.com",
        "name": "John Doe"
      },
      "linesAdded": 1800,
      "linesRemoved": 700,
      "prSize": 2500,
      "createdAt": "2024-01-15T09:00:00.000Z",
      "mergedAt": "2024-01-18T14:30:00.000Z",
      "reviewTime": "3.23 days"
    }
  ]
}

Use Cases:
1. Team Productivity Analysis: Track commit frequency and patterns
   - Weekly PR size trends per developer
   - Identify developers who consistently create large or small PRs
   
2. Code Quality Assessment: Monitor additions/deletions trends
   - Correlation between PR size and review time
   - Flag PRs exceeding size thresholds (>1000 LOC) for additional review
   
3. Collaboration Metrics: Analyze contributor participation
   - Compare PR sizes across team members
   - Identify patterns in code contribution styles
   
4. Development Patterns: Identify working time distributions
   - Average PR size per user per week/month
   - Seasonal trends in code contribution sizes
   
5. Process Improvements: Compare before/after periods for process changes
   - Impact of new code review policies on PR sizes
   - Effectiveness of "small PR" initiatives
*/

import { readFileSync } from "fs";
import { writeFileSync } from "fs";
import { createWriteStream } from "fs";
import https from "https";
import { URL } from "url";

class GitHubPRAnalyzer {
  constructor(repo, owner, startDate, endDate, token) {
    this.repo = repo;
    this.owner = owner;
    this.startDate = new Date(startDate);
    this.endDate = new Date(endDate);
    this.token = token;
    this.baseUrl = "https://api.github.com";
    this.userStats = new Map();
    this.pullRequests = [];
    this.retryAttempts = 3;
    this.retryDelay = 1000;
  }

  async makeRequest(url, options = {}) {
    const headers = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "GitHub-PR-Analyzer/1.0",
      ...options.headers,
    };

    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const requestOptions = {
        hostname: urlObj.hostname,
        port: urlObj.port || 443,
        path: urlObj.pathname + urlObj.search,
        method: options.method || "GET",
        headers,
      };

      const req = https.request(requestOptions, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve({
                data: parsed,
                headers: res.headers,
                status: res.statusCode,
              });
            } else {
              reject(
                new Error(`HTTP ${res.statusCode}: ${parsed.message || data}`)
              );
            }
          } catch (e) {
            reject(new Error(`Failed to parse response: ${e.message}`));
          }
        });
      });

      req.on("error", reject);
      req.end();
    });
  }

  async makeRequestWithRetry(url, options = {}) {
    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        return await this.makeRequest(url, options);
      } catch (error) {
        if (attempt === this.retryAttempts) {
          throw error;
        }

        // Handle rate limiting
        if (
          error.message.includes("rate limit") ||
          error.message.includes("403")
        ) {
          const delay = this.retryDelay * Math.pow(2, attempt - 1);
          console.log(
            `Rate limited. Retrying in ${delay}ms... (attempt ${attempt}/${this.retryAttempts})`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          throw error;
        }
      }
    }
  }

  async fetchAllPullRequests(fetchLimit = 200) {
    let page = 1;
    let allPRs = [];
    let fetchedCount = 0;
    const perPage = Math.min(100, fetchLimit); // GitHub API max per page is 100

    console.log("🔍 Fetching pull requests...");

    while (true) {
      if (fetchLimit !== Infinity && fetchedCount >= fetchLimit) {
        console.log(`📊 Reached fetch limit of ${fetchLimit} PRs`);
        break;
      }

      const url = `${this.baseUrl}/repos/${this.owner}/${this.repo}/pulls?state=closed&sort=updated&direction=desc&page=${page}&per_page=${perPage}`;

      try {
        const response = await this.makeRequestWithRetry(url);
        const prs = response.data;

        if (prs.length === 0) {
          console.log("📄 No more pull requests found");
          break;
        }

        // Filter PRs by date range
        const filteredPRs = prs.filter((pr) => {
          if (!pr.merged_at) return false;
          const mergedDate = new Date(pr.merged_at);
          return mergedDate >= this.startDate && mergedDate <= this.endDate;
        });

        allPRs.push(...filteredPRs);
        fetchedCount += prs.length;

        // Update progress
        const progressBar = "█".repeat(
          Math.floor((fetchedCount / Math.min(fetchLimit, 1000)) * 20)
        );
        const progressPercent = Math.floor(
          (fetchedCount / Math.min(fetchLimit, 1000)) * 100
        );
        process.stdout.write(
          `\r📈 Progress: [${progressBar.padEnd(
            20
          )}] ${progressPercent}% (${fetchedCount} fetched, ${
            filteredPRs.length
          } in range)`
        );

        // Check if we've gone past our date range
        if (
          prs.length > 0 &&
          new Date(prs[prs.length - 1].updated_at) < this.startDate
        ) {
          console.log("\n📅 Reached PRs outside date range");
          break;
        }

        page++;

        // Small delay to be respectful to the API
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`\n❌ Error fetching PRs page ${page}:`, error.message);
        throw error;
      }
    }

    console.log(`\n✅ Found ${allPRs.length} pull requests in date range`);
    return allPRs;
  }

  async analyzePullRequest(pr) {
    const url = `${this.baseUrl}/repos/${this.owner}/${this.repo}/pulls/${pr.number}`;

    try {
      const response = await this.makeRequestWithRetry(url);
      const prDetails = response.data;

      const authorEmail =
        prDetails.user.email || `${prDetails.user.login}@github.local`;
      const authorName = prDetails.user.name || prDetails.user.login;

      const linesAdded = prDetails.additions || 0;
      const linesRemoved = prDetails.deletions || 0;
      const prSize = linesAdded + linesRemoved;

      const prData = {
        number: pr.number,
        title: pr.title,
        author: {
          email: authorEmail,
          name: authorName,
        },
        linesAdded,
        linesRemoved,
        prSize,
        createdAt: pr.created_at,
        mergedAt: pr.merged_at,
        reviewTime: this.calculateReviewTime(pr.created_at, pr.merged_at),
      };

      this.pullRequests.push(prData);
      this.updateUserStats(authorEmail, authorName, prData);

      return prData;
    } catch (error) {
      console.error(`❌ Error analyzing PR #${pr.number}:`, error.message);
      return null;
    }
  }

  updateUserStats(email, name, prData) {
    if (!this.userStats.has(email)) {
      this.userStats.set(email, {
        email,
        name,
        totalPRs: 0,
        totalLinesAdded: 0,
        totalLinesRemoved: 0,
        totalPRSize: 0,
        averagePRSize: 0,
        largestPR: null,
        smallestPR: null,
        prs: [],
      });
    }

    const userStat = this.userStats.get(email);
    userStat.totalPRs++;
    userStat.totalLinesAdded += prData.linesAdded;
    userStat.totalLinesRemoved += prData.linesRemoved;
    userStat.totalPRSize += prData.prSize;
    userStat.averagePRSize = Math.round(
      userStat.totalPRSize / userStat.totalPRs
    );
    userStat.prs.push(prData);

    // Update largest PR
    if (!userStat.largestPR || prData.prSize > userStat.largestPR.size) {
      userStat.largestPR = {
        number: prData.number,
        size: prData.prSize,
        title: prData.title,
      };
    }

    // Update smallest PR
    if (!userStat.smallestPR || prData.prSize < userStat.smallestPR.size) {
      userStat.smallestPR = {
        number: prData.number,
        size: prData.prSize,
        title: prData.title,
      };
    }
  }

  calculateReviewTime(createdAt, mergedAt) {
    const created = new Date(createdAt);
    const merged = new Date(mergedAt);
    const diffMs = merged - created;
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    return `${diffDays.toFixed(2)} days`;
  }

  async analyze(fetchLimit = 200) {
    console.log(`🚀 Starting analysis for ${this.owner}/${this.repo}`);
    console.log(
      `📅 Date range: ${this.startDate.toISOString().split("T")[0]} to ${
        this.endDate.toISOString().split("T")[0]
      }`
    );

    try {
      const pullRequests = await this.fetchAllPullRequests(fetchLimit);

      console.log("🔬 Analyzing pull request details...");

      for (let i = 0; i < pullRequests.length; i++) {
        const pr = pullRequests[i];

        // Progress indicator
        const progress = Math.floor((i / pullRequests.length) * 20);
        const progressBar = "█".repeat(progress) + "░".repeat(20 - progress);
        process.stdout.write(
          `\r📊 Analyzing: [${progressBar}] ${Math.floor(
            (i / pullRequests.length) * 100
          )}% (${i + 1}/${pullRequests.length})`
        );

        await this.analyzePullRequest(pr);

        // Small delay to respect rate limits
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      console.log("\n✅ Analysis complete!");
      return this.generateReport();
    } catch (error) {
      console.error("❌ Analysis failed:", error.message);
      throw error;
    }
  }

  generateReport() {
    const userStatsArray = Array.from(this.userStats.values()).map((user) => {
      const { prs, ...userWithoutPrs } = user;
      return userWithoutPrs;
    });

    // Sort by total PR size descending
    userStatsArray.sort((a, b) => b.totalPRSize - a.totalPRSize);

    const totalLinesChanged = this.pullRequests.reduce(
      (sum, pr) => sum + pr.prSize,
      0
    );
    const averagePRSize =
      this.pullRequests.length > 0
        ? Math.round(totalLinesChanged / this.pullRequests.length)
        : 0;

    const largestPR = this.pullRequests.reduce(
      (largest, pr) => (!largest || pr.prSize > largest.prSize ? pr : largest),
      null
    );

    return {
      metadata: {
        repository: `${this.owner}/${this.repo}`,
        dateRange: {
          start: this.startDate.toISOString(),
          end: this.endDate.toISOString(),
        },
        totalPRs: this.pullRequests.length,
        analysisDate: new Date().toISOString(),
      },
      summary: {
        totalLinesChanged,
        averagePRSize,
        largestPR: largestPR
          ? {
              number: largestPR.number,
              size: largestPR.prSize,
              author: largestPR.author.email,
            }
          : null,
      },
      userStats: userStatsArray,
      pullRequests: this.pullRequests.sort((a, b) => b.prSize - a.prSize),
    };
  }
}

function generateCSV(data) {
  const headers = [
    "Email",
    "Name",
    "Total PRs",
    "Total Lines Added",
    "Total Lines Removed",
    "Total PR Size",
    "Average PR Size",
    "Largest PR Number",
    "Largest PR Size",
    "Smallest PR Number",
    "Smallest PR Size",
  ];

  let csv = headers.join(",") + "\n";

  data.userStats.forEach((user) => {
    const row = [
      `"${user.email}"`,
      `"${user.name}"`,
      user.totalPRs,
      user.totalLinesAdded,
      user.totalLinesRemoved,
      user.totalPRSize,
      user.averagePRSize,
      user.largestPR ? user.largestPR.number : "",
      user.largestPR ? user.largestPR.size : "",
      user.smallestPR ? user.smallestPR.number : "",
      user.smallestPR ? user.smallestPR.size : "",
    ];
    csv += row.join(",") + "\n";
  });

  return csv;
}

function generateFilename(format, repo, startDate, endDate) {
  const start = startDate.toISOString().split("T")[0];
  const end = endDate.toISOString().split("T")[0];
  const repoName = repo.replace("/", "_");
  return `pr-analysis_${repoName}_${start}_to_${end}.${format}`;
}

function parseArguments() {
  const args = process.argv.slice(2);
  const options = {
    repo: null,
    format: "json",
    output: null,
    start: null,
    end: null,
    verbose: false,
    debug: false,
    token: process.env.GITHUB_TOKEN,
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
        options.fetchLimit =
          nextArg === "infinite" ? Infinity : parseInt(nextArg);
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
        console.log(`
GitHub PR Size Analyzer

Analyzes pull requests in a GitHub repository to generate reports on PR sizes per user.

Options:
  -r, --repo <owner/repo>         Repository to analyze (required)
  -f, --format <format>           Output format: json (default) or csv
  -o, --output <filename>         Output filename (auto-generated if not provided)
  -s, --start <date>              Start date (ISO format: YYYY-MM-DD) default -30 days
  -e, --end <date>                End date (ISO format: YYYY-MM-DD) default: now
  -v, --verbose                   Enable verbose logging
  -d, --debug                     Enable debug logging
  -t, --token <token>             GitHub Token (or use GITHUB_TOKEN env var)
  -l, --fetchLimit <number>       Set fetch limit (default: 200, use 'infinite' for no limit)
  -h, --help                      Show help message

Examples:
  node main.mjs -r microsoft/vscode -s 2024-01-01 -e 2024-01-31
  node main.mjs -r facebook/react -f csv -l infinite
  node main.mjs -r owner/repo -t ghp_your_token_here

Environment Variables:
  GITHUB_TOKEN                    GitHub personal access token
        `);
        process.exit(0);
      default:
        if (arg.startsWith("-")) {
          console.error(`❌ Unknown option: ${arg}`);
          process.exit(1);
        }
    }
  }

  return options;
}

function validateOptions(options) {
  if (!options.repo) {
    console.error("❌ Repository is required. Use -r or --repo option.");
    process.exit(1);
  }

  if (!options.token) {
    console.error(
      "❌ GitHub token is required. Use -t option or set GITHUB_TOKEN environment variable."
    );
    console.error("   Get a token at: https://github.com/settings/tokens");
    process.exit(1);
  }

  if (!options.repo.includes("/")) {
    console.error("❌ Repository must be in format: owner/repo");
    process.exit(1);
  }

  if (!["json", "csv"].includes(options.format)) {
    console.error('❌ Format must be either "json" or "csv"');
    process.exit(1);
  }

  // Set default dates
  if (!options.end) {
    options.end = new Date().toISOString().split("T")[0];
  }

  if (!options.start) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    options.start = thirtyDaysAgo.toISOString().split("T")[0];
  }

  return options;
}

async function main() {
  try {
    const options = validateOptions(parseArguments());

    if (options.verbose) {
      console.log("📋 Configuration:", {
        repo: options.repo,
        format: options.format,
        dateRange: `${options.start} to ${options.end}`,
        fetchLimit:
          options.fetchLimit === Infinity ? "infinite" : options.fetchLimit,
      });
    }

    const [owner, repo] = options.repo.split("/");
    const startDate = new Date(options.start);
    const endDate = new Date(options.end);

    const analyzer = new GitHubPRAnalyzer(
      repo,
      owner,
      startDate,
      endDate,
      options.token
    );
    const report = await analyzer.analyze(options.fetchLimit);

    // Generate output filename if not provided
    if (!options.output) {
      options.output = generateFilename(
        options.format,
        options.repo,
        startDate,
        endDate
      );
    }

    // Write output
    let content;
    if (options.format === "csv") {
      content = generateCSV(report);
    } else {
      content = JSON.stringify(report, null, 2);
    }

    writeFileSync(options.output, content, "utf8");

    console.log(`\n📊 Report Summary:`);
    console.log(`   Repository: ${options.repo}`);
    console.log(`   Date Range: ${options.start} to ${options.end}`);
    console.log(`   Total PRs: ${report.metadata.totalPRs}`);
    console.log(
      `   Total Lines Changed: ${report.summary.totalLinesChanged.toLocaleString()}`
    );
    console.log(`   Average PR Size: ${report.summary.averagePRSize} lines`);
    console.log(
      `   Top Contributors: ${report.userStats
        .slice(0, 3)
        .map((u) => `${u.name} (${u.totalPRs} PRs)`)
        .join(", ")}`
    );
    console.log(`\n💾 Report saved to: ${options.output}`);
  } catch (error) {
    console.error("\n❌ Error:", error.message);

    if (options?.debug) {
      console.error("🐛 Debug info:", error);
    }

    // Common error explanations
    if (
      error.message.includes("401") ||
      error.message.includes("Bad credentials")
    ) {
      console.error("\n💡 Authentication Issue:");
      console.error("   - Check that your GitHub token is valid");
      console.error(
        "   - Ensure the token has proper repository access scopes"
      );
      console.error("   - GitHub API now requires Bearer token format");
    } else if (error.message.includes("404")) {
      console.error("\n💡 Repository Not Found:");
      console.error("   - Check that the repository owner/name is correct");
      console.error("   - Ensure your token has access to this repository");
    } else if (error.message.includes("rate limit")) {
      console.error("\n💡 Rate Limit Issue:");
      console.error("   - GitHub API rate limits have been exceeded");
      console.error("   - Try again later or use a token with higher limits");
    }

    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
