#!/usr/bin/env node

/*
JSON Report Structure:
{
  "metadata": {
    "repositoryAnalyzed": "owner/repo",
    "dateRange": {
      "start": "2023-01-01",
      "end": "2023-12-31"
    },
    "generatedAt": "2023-12-31T23:59:59.999Z",
    "totalContributorsInRepo": 150
  },
  "contributorsByEmail": [
    {
      "email": "user@example.com",
      "username": "github_username",
      "authorId": 12345,
      "avatarUrl": "https://avatars.githubusercontent.com/u/12345",
      "totalCommitsAllTime": 500,
      "activityInPeriod": {
        "commits": 45,
        "additions": 2000,
        "deletions": 800,
        "activeWeeks": 12
      },
      "weeklyBreakdown": [
        {
          "weekStart": "2023-01-01",
          "commits": 3,
          "additions": 150,
          "deletions": 50
        }
      ]
    }
  ],
  "summary": {
    "activeContributors": 25,
    "totalCommitsInPeriod": 1200,
    "totalAdditionsInPeriod": 50000,
    "totalDeletionsInPeriod": 20000,
    "averageCommitsPerContributor": 48.0,
    "averageLinesPerCommit": 58.33,
    "topContributorsByEmail": [
      {
        "email": "top@contributor.com",
        "username": "topuser",
        "commits": 85,
        "additions": 4000,
        "deletions": 1500
      }
    ]
  }
}

Use Cases:
- Team Productivity Analysis: Track commit frequency and patterns by email domains
- Code Quality Assessment: Monitor additions/deletions trends per contributor email
- Collaboration Metrics: Analyze contributor participation by email verification
- Development Patterns: Identify working time distributions across email domains
- Process Improvements: Compare before/after periods for team email-based analysis
- Contractor vs Employee Analysis: Separate internal vs external email domains
- Email-based Team Segmentation: Group contributors by organization email patterns
*/

import https from "https";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class GitHubContributorAnalyzer {
  constructor(options = {}) {
    this.token = options.token || process.env.GITHUB_TOKEN;
    this.verbose = options.verbose || false;
    this.debug = options.debug || false;
    this.fetchLimit = options.fetchLimit || 200;
    this.retryAttempts = 3;
    this.retryDelay = 1000;
    this.rateLimitDelay = 60000; // 1 minute
  }

  log(message, level = "info") {
    const timestamp = new Date().toISOString();
    if (level === "debug" && !this.debug) return;
    if (level === "verbose" && !this.verbose && !this.debug) return;

    const prefix =
      {
        info: "📊",
        verbose: "🔍",
        debug: "🐛",
        error: "❌",
        success: "✅",
        warning: "⚠️",
      }[level] || "ℹ️";

    console.log(`${prefix} [${timestamp}] ${message}`);
  }

  async makeGitHubRequest(endpoint, attempt = 1) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: "api.github.com",
        path: endpoint,
        method: "GET",
        headers: {
          "User-Agent": "GitHub-Contributor-Analyzer/1.0",
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      };

      // Use Bearer token format for authentication
      if (this.token) {
        options.headers["Authorization"] = `Bearer ${this.token}`;
      } else {
        this.log(
          "No GitHub token provided - API requests may be rate limited",
          "warning"
        );
      }

      this.log(`Making request to: ${endpoint}`, "debug");

      const req = https.request(options, (res) => {
        let data = "";

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", async () => {
          try {
            if (res.statusCode === 200) {
              const parsed = JSON.parse(data);
              this.log(`✅ Request successful (${res.statusCode})`, "debug");
              resolve(parsed);
            } else if (res.statusCode === 401) {
              const error = JSON.parse(data);
              reject(
                new Error(
                  `Authentication failed: ${error.message}. Please check your GitHub token format and permissions.`
                )
              );
            } else if (res.statusCode === 403) {
              const error = JSON.parse(data);
              if (res.headers["x-ratelimit-remaining"] === "0") {
                const resetTime =
                  parseInt(res.headers["x-ratelimit-reset"]) * 1000;
                const waitTime = Math.max(resetTime - Date.now(), 0);
                this.log(
                  `Rate limit exceeded. Waiting ${Math.ceil(
                    waitTime / 1000
                  )}s...`,
                  "verbose"
                );

                setTimeout(() => {
                  this.makeGitHubRequest(endpoint, attempt)
                    .then(resolve)
                    .catch(reject);
                }, waitTime);
              } else {
                reject(
                  new Error(
                    `Access forbidden: ${error.message}. Please check your token has proper repository access scopes.`
                  )
                );
              }
            } else if (res.statusCode === 404) {
              const error = JSON.parse(data);
              reject(
                new Error(
                  `Repository not found: ${error.message}. Please check the repository name and your access permissions.`
                )
              );
            } else if (res.statusCode >= 500 && attempt < this.retryAttempts) {
              this.log(
                `Server error ${res.statusCode}. Retrying in ${this.retryDelay}ms... (${attempt}/${this.retryAttempts})`,
                "verbose"
              );

              setTimeout(() => {
                this.makeGitHubRequest(endpoint, attempt + 1)
                  .then(resolve)
                  .catch(reject);
              }, this.retryDelay * attempt);
            } else {
              const error = JSON.parse(data);
              reject(
                new Error(
                  `GitHub API Error ${res.statusCode}: ${
                    error.message || "Unknown error"
                  }`
                )
              );
            }
          } catch (parseError) {
            reject(
              new Error(
                `Failed to parse response: ${
                  parseError.message
                }\nResponse data: ${data.substring(0, 200)}...`
              )
            );
          }
        });
      });

      req.on("error", (error) => {
        if (attempt < this.retryAttempts) {
          this.log(
            `Network error: ${error.message}. Retrying in ${this.retryDelay}ms... (${attempt}/${this.retryAttempts})`,
            "verbose"
          );
          setTimeout(() => {
            this.makeGitHubRequest(endpoint, attempt + 1)
              .then(resolve)
              .catch(reject);
          }, this.retryDelay * attempt);
        } else {
          reject(
            new Error(
              `Network error after ${this.retryAttempts} attempts: ${error.message}`
            )
          );
        }
      });

      req.end();
    });
  }

  showProgress(message) {
    const progressChars = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    let progressIndex = 0;

    const interval = setInterval(() => {
      process.stdout.write(`\r${progressChars[progressIndex]} ${message}`);
      progressIndex = (progressIndex + 1) % progressChars.length;
    }, 100);

    return () => {
      clearInterval(interval);
      process.stdout.write(`\r✅ ${message} - Complete\n`);
    };
  }

  async fetchCommitsWithEmails(owner, repo, startDate, endDate) {
    this.log(`Fetching commits with email data for ${owner}/${repo}`, "info");
    this.log(
      `Date range: ${startDate || "repository start"} to ${
        endDate || "latest"
      }`,
      "verbose"
    );

    const stopProgress = this.showProgress(
      "Fetching commit data with emails..."
    );

    try {
      const commits = [];
      let page = 1;
      let hasMore = true;
      let fetchedCount = 0;

      // Build query parameters
      const params = new URLSearchParams();
      params.append("per_page", "100");
      if (startDate) params.append("since", new Date(startDate).toISOString());
      if (endDate) params.append("until", new Date(endDate).toISOString());

      while (
        hasMore &&
        (this.fetchLimit === -1 || fetchedCount < this.fetchLimit)
      ) {
        params.set("page", page.toString());
        const endpoint = `/repos/${owner}/${repo}/commits?${params.toString()}`;

        this.log(`Fetching page ${page} of commits`, "debug");
        const pageCommits = await this.makeGitHubRequest(endpoint);

        if (!pageCommits || pageCommits.length === 0) {
          hasMore = false;
          break;
        }

        commits.push(...pageCommits);
        fetchedCount += pageCommits.length;

        this.log(
          `Fetched ${pageCommits.length} commits (total: ${fetchedCount})`,
          "verbose"
        );

        // Check if we've reached the fetch limit
        if (this.fetchLimit !== -1 && fetchedCount >= this.fetchLimit) {
          this.log(
            `Reached fetch limit of ${this.fetchLimit} commits`,
            "verbose"
          );
          hasMore = false;
        }

        // If we got fewer than 100 results, we've reached the end
        if (pageCommits.length < 100) {
          hasMore = false;
        }

        page++;
      }

      stopProgress();
      this.log(`Fetched ${commits.length} total commits`, "info");

      return commits;
    } catch (error) {
      stopProgress();
      throw error;
    }
  }

  async analyzeContributorsByEmail(owner, repo, startDate, endDate, token) {
    // Set instance token if provided
    if (token) this.token = token;

    const commits = await this.fetchCommitsWithEmails(
      owner,
      repo,
      startDate,
      endDate
    );

    if (!commits || commits.length === 0) {
      throw new Error("No commits found in the specified date range");
    }

    this.log(
      `Processing ${commits.length} commits for email analysis`,
      "verbose"
    );

    const contributorsByEmail = new Map();
    const startTimestamp = startDate ? new Date(startDate).getTime() : 0;
    const endTimestamp = endDate ? new Date(endDate).getTime() : Date.now();

    commits.forEach((commit) => {
      const commitDate = new Date(commit.commit.author.date).getTime();

      // Skip commits outside date range
      if (commitDate < startTimestamp || commitDate > endTimestamp) {
        return;
      }

      const email = commit.commit.author.email;
      const username = commit.author?.login || commit.commit.author.name;
      const authorId = commit.author?.id || null;
      const avatarUrl = commit.author?.avatar_url || null;

      if (!contributorsByEmail.has(email)) {
        contributorsByEmail.set(email, {
          email,
          username,
          authorId,
          avatarUrl,
          totalCommitsAllTime: 0,
          activityInPeriod: {
            commits: 0,
            additions: 0,
            deletions: 0,
            activeWeeks: 0,
          },
          weeklyBreakdown: new Map(),
          commitDates: [],
        });
      }

      const contributor = contributorsByEmail.get(email);
      contributor.activityInPeriod.commits++;
      contributor.commitDates.push(new Date(commit.commit.author.date));

      // Calculate week start for weekly breakdown
      const commitDateObj = new Date(commit.commit.author.date);
      const weekStart = new Date(
        commitDateObj.getFullYear(),
        commitDateObj.getMonth(),
        commitDateObj.getDate() - commitDateObj.getDay()
      );
      const weekKey = weekStart.toISOString().split("T")[0];

      if (!contributor.weeklyBreakdown.has(weekKey)) {
        contributor.weeklyBreakdown.set(weekKey, {
          weekStart: weekKey,
          commits: 0,
          additions: 0,
          deletions: 0,
        });
      }

      contributor.weeklyBreakdown.get(weekKey).commits++;
    });

    // Convert weekly breakdown map to array and calculate active weeks
    contributorsByEmail.forEach((contributor) => {
      contributor.weeklyBreakdown = Array.from(
        contributor.weeklyBreakdown.values()
      ).sort((a, b) => a.weekStart.localeCompare(b.weekStart));

      contributor.activityInPeriod.activeWeeks =
        contributor.weeklyBreakdown.filter((week) => week.commits > 0).length;

      // For commit-only analysis, we don't have line change data
      contributor.activityInPeriod.additions = 0;
      contributor.activityInPeriod.deletions = 0;

      // Clean up temporary data
      delete contributor.commitDates;
    });

    return this.buildAnalysisReport(
      contributorsByEmail,
      owner,
      repo,
      startDate,
      endDate
    );
  }

  buildAnalysisReport(contributorsByEmail, owner, repo, startDate, endDate) {
    const contributorsArray = Array.from(contributorsByEmail.values());
    const activeContributors = contributorsArray.filter(
      (c) => c.activityInPeriod.commits > 0
    );

    const totalCommits = activeContributors.reduce(
      (sum, c) => sum + c.activityInPeriod.commits,
      0
    );
    const totalAdditions = activeContributors.reduce(
      (sum, c) => sum + c.activityInPeriod.additions,
      0
    );
    const totalDeletions = activeContributors.reduce(
      (sum, c) => sum + c.activityInPeriod.deletions,
      0
    );

    const analysis = {
      metadata: {
        repositoryAnalyzed: `${owner}/${repo}`,
        dateRange: {
          start: startDate || "Repository start",
          end: endDate || new Date().toISOString().split("T")[0],
        },
        generatedAt: new Date().toISOString(),
        totalContributorsInRepo: contributorsArray.length,
        fetchLimit: this.fetchLimit === -1 ? "unlimited" : this.fetchLimit,
      },
      contributorsByEmail: contributorsArray.sort(
        (a, b) => b.activityInPeriod.commits - a.activityInPeriod.commits
      ),
      summary: {
        activeContributors: activeContributors.length,
        totalCommitsInPeriod: totalCommits,
        totalAdditionsInPeriod: totalAdditions,
        totalDeletionsInPeriod: totalDeletions,
        averageCommitsPerContributor:
          activeContributors.length > 0
            ? Math.round((totalCommits / activeContributors.length) * 100) / 100
            : 0,
        averageLinesPerCommit:
          totalCommits > 0
            ? Math.round(
                ((totalAdditions + totalDeletions) / totalCommits) * 100
              ) / 100
            : 0,
        topContributorsByEmail: activeContributors.slice(0, 10).map((c) => ({
          email: c.email,
          username: c.username,
          commits: c.activityInPeriod.commits,
          additions: c.activityInPeriod.additions,
          deletions: c.activityInPeriod.deletions,
        })),
      },
    };

    this.log(
      `Analysis complete: ${activeContributors.length} active contributors, ${totalCommits} total commits`,
      "info"
    );
    return analysis;
  }

  formatAsCSV(analysis) {
    const lines = [];

    // Header
    lines.push(
      "Email,Username,Author ID,Total Commits All Time,Commits In Period,Additions In Period,Deletions In Period,Active Weeks,Lines Per Commit In Period"
    );

    // Data rows
    analysis.contributorsByEmail.forEach((contributor) => {
      const linesPerCommit =
        contributor.activityInPeriod.commits > 0
          ? Math.round(
              ((contributor.activityInPeriod.additions +
                contributor.activityInPeriod.deletions) /
                contributor.activityInPeriod.commits) *
                100
            ) / 100
          : 0;

      const row = [
        `"${contributor.email}"`,
        `"${contributor.username || ""}"`,
        contributor.authorId || "",
        contributor.totalCommitsAllTime,
        contributor.activityInPeriod.commits,
        contributor.activityInPeriod.additions,
        contributor.activityInPeriod.deletions,
        contributor.activityInPeriod.activeWeeks,
        linesPerCommit,
      ].join(",");

      lines.push(row);
    });

    return lines.join("\n");
  }

  async saveOutput(data, format, filename) {
    try {
      let content;
      let actualFilename;

      if (format === "csv") {
        content = this.formatAsCSV(data);
        actualFilename =
          filename ||
          `contributor-analysis-by-email-${
            new Date().toISOString().split("T")[0]
          }.csv`;
      } else {
        content = JSON.stringify(data, null, 2);
        actualFilename =
          filename ||
          `contributor-analysis-by-email-${
            new Date().toISOString().split("T")[0]
          }.json`;
      }

      await fs.writeFile(actualFilename, content);
      this.log(`Report saved to: ${actualFilename}`, "success");
      return actualFilename;
    } catch (error) {
      throw new Error(`Failed to save output: ${error.message}`);
    }
  }
}

class CLI {
  constructor() {
    this.args = process.argv.slice(2);
    this.options = this.parseArgs();
  }

  parseArgs() {
    const options = {};
    let i = 0;

    while (i < this.args.length) {
      const arg = this.args[i];

      switch (arg) {
        case "-r":
        case "--repo":
          options.repo = this.args[++i];
          break;
        case "-f":
        case "--format":
          options.format = this.args[++i];
          break;
        case "-o":
        case "--output":
          options.output = this.args[++i];
          break;
        case "-s":
        case "--start":
          options.start = this.args[++i];
          break;
        case "-e":
        case "--end":
          options.end = this.args[++i];
          break;
        case "-t":
        case "--token":
          options.token = this.args[++i];
          break;
        case "-l":
        case "--fetchLimit":
          const limit = this.args[++i];
          options.fetchLimit = limit === "infinite" ? -1 : parseInt(limit);
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
          this.showHelp();
          process.exit(0);
          break;
        default:
          if (arg.startsWith("-")) {
            console.error(`❌ Unknown option: ${arg}`);
            this.showHelp();
            process.exit(1);
          }
          break;
      }
      i++;
    }

    // Set default dates if not provided
    if (!options.start) {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      options.start = thirtyDaysAgo.toISOString().split("T")[0];
    }

    if (!options.end) {
      options.end = new Date().toISOString().split("T")[0];
    }

    return options;
  }

  showHelp() {
    console.log(`
🔍 GitHub Contributor Activity Analyzer (Email-based)

Analyze contributor-level activity and participation trends in GitHub repositories by email address.
Compare active contributors count and per-person commit ratios across date ranges with email-based grouping.

Usage: node main.mjs [options]

Options:
  -r, --repo <owner/repo>           Repository to analyze (required)
  -f, --format <format>             Output format: json (default) or csv
  -o, --output <filename>           Output filename (auto-generated if not provided)
  -s, --start <date>                Start date (ISO format: YYYY-MM-DD) default -30Days
  -e, --end <date>                  End date (ISO format: YYYY-MM-DD) default: now
  -v, --verbose                     Enable verbose logging
  -d, --debug                       Enable debug logging
  -t, --token <token>               GitHub Token (or use GITHUB_TOKEN env var)
  -l, --fetchLimit <number>         Set fetch limit (default: 200, "infinite" for unlimited)
  -h, --help                        Show help message

Examples:
  node main.mjs -r microsoft/vscode -s 2023-01-01 -e 2023-12-31
  node main.mjs -r facebook/react -f csv -o react-analysis.csv --verbose
  node main.mjs -r owner/repo --start 2023-06-01 --debug --fetchLimit infinite
  node main.mjs -r organization/project -l 500 --token ghp_xxxxxxxxxxxx

Environment Variables:
  GITHUB_TOKEN                      GitHub personal access token

Report Features:
  • Team Productivity Analysis: Track commit frequency and patterns by email
  • Code Quality Assessment: Monitor commit trends per contributor email
  • Collaboration Metrics: Analyze contributor participation by email domains
  • Development Patterns: Identify working time distributions across email addresses
  • Process Improvements: Compare before/after periods for email-based team changes
  • Contractor vs Employee Analysis: Separate internal vs external email domains
  • Email-based Team Segmentation: Group contributors by organization email patterns

Note: This tool fetches commit data with email information for comprehensive contributor analysis.
The tool automatically handles API rate limiting and includes retry logic for reliable data collection.
Date ranges are applied to commit timestamps with attached date range included in output.
`);
  }

  validateOptions() {
    if (!this.options.repo) {
      console.error("❌ Error: Repository (-r, --repo) is required");
      this.showHelp();
      process.exit(1);
    }

    if (!this.options.repo.includes("/")) {
      console.error('❌ Error: Repository must be in format "owner/repo"');
      process.exit(1);
    }

    if (this.options.format && !["json", "csv"].includes(this.options.format)) {
      console.error('❌ Error: Format must be either "json" or "csv"');
      process.exit(1);
    }

    // Validate dates if provided
    if (this.options.start && isNaN(Date.parse(this.options.start))) {
      console.error("❌ Error: Start date must be in ISO format (YYYY-MM-DD)");
      process.exit(1);
    }

    if (this.options.end && isNaN(Date.parse(this.options.end))) {
      console.error("❌ Error: End date must be in ISO format (YYYY-MM-DD)");
      process.exit(1);
    }

    if (
      this.options.start &&
      this.options.end &&
      new Date(this.options.start) > new Date(this.options.end)
    ) {
      console.error("❌ Error: Start date must be before end date");
      process.exit(1);
    }

    // Validate fetch limit
    if (
      this.options.fetchLimit !== undefined &&
      this.options.fetchLimit !== -1 &&
      (isNaN(this.options.fetchLimit) || this.options.fetchLimit <= 0)
    ) {
      console.error(
        "❌ Error: Fetch limit must be a positive number or 'infinite'"
      );
      process.exit(1);
    }
  }

  async run() {
    try {
      this.validateOptions();

      const [owner, repo] = this.options.repo.split("/");
      const analyzer = new GitHubContributorAnalyzer({
        token: this.options.token,
        verbose: this.options.verbose,
        debug: this.options.debug,
        fetchLimit: this.options.fetchLimit || 200,
      });

      console.log("🚀 Starting GitHub Contributor Analysis by Email...\n");

      const analysis = await analyzer.analyzeContributorsByEmail(
        owner,
        repo,
        this.options.start,
        this.options.end,
        this.options.token
      );

      const filename = await analyzer.saveOutput(
        analysis,
        this.options.format || "json",
        this.options.output
      );

      console.log("\n📊 Analysis Summary:");
      console.log(`   Repository: ${this.options.repo}`);
      console.log(
        `   Date Range: ${analysis.metadata.dateRange.start} to ${analysis.metadata.dateRange.end}`
      );
      console.log(
        `   Active Contributors: ${analysis.summary.activeContributors}`
      );
      console.log(`   Total Commits: ${analysis.summary.totalCommitsInPeriod}`);
      console.log(
        `   Avg Commits/Contributor: ${analysis.summary.averageCommitsPerContributor}`
      );
      console.log(`   Fetch Limit: ${analysis.metadata.fetchLimit}`);
      console.log(`   Output File: ${filename}`);

      if (analysis.summary.topContributorsByEmail.length > 0) {
        console.log("\n🏆 Top Contributors by Email (by commits in period):");
        analysis.summary.topContributorsByEmail
          .slice(0, 5)
          .forEach((contributor, index) => {
            console.log(
              `   ${index + 1}. ${contributor.email} (${
                contributor.username
              }): ${contributor.commits} commits`
            );
          });
      }

      console.log("\n✅ Analysis completed successfully!");
    } catch (error) {
      console.error(`❌ Error: ${error.message}`);
      if (this.options.debug) {
        console.error(error.stack);
      }

      // Provide specific guidance for common errors
      if (error.message.includes("Authentication failed")) {
        console.error(
          "\n💡 Solution: Ensure your GitHub token uses Bearer format and has proper permissions."
        );
        console.error(
          "   Create a token at: https://github.com/settings/tokens"
        );
        console.error(
          "   Required scopes: repo (for private repos) or public_repo (for public repos)"
        );
      } else if (error.message.includes("Rate limit exceeded")) {
        console.error(
          "\n💡 Solution: Wait for the rate limit to reset or use a GitHub token for higher limits."
        );
      } else if (error.message.includes("Repository not found")) {
        console.error(
          "\n💡 Solution: Check the repository name and ensure you have access permissions."
        );
      }

      process.exit(1);
    }
  }
}

// Run CLI if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const cli = new CLI();
  cli.run();
}

export { GitHubContributorAnalyzer, CLI };
