#!/usr/bin/env node

import https from "https";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ContributorAnalyzer {
  constructor(options = {}) {
    this.token = options.token || process.env.GITHUB_TOKEN;
    this.verbose = options.verbose || false;
    this.debug = options.debug || false;
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

      if (this.token) {
        options.headers["Authorization"] = `Bearer ${this.token}`;
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
              this.log(`✅ Request successful`, "debug");
              resolve(parsed);
            } else if (
              res.statusCode === 403 &&
              res.headers["x-ratelimit-remaining"] === "0"
            ) {
              const resetTime =
                parseInt(res.headers["x-ratelimit-reset"]) * 1000;
              const waitTime = resetTime - Date.now();
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
              new Error(`Failed to parse response: ${parseError.message}`)
            );
          }
        });
      });

      req.on("error", (error) => {
        if (attempt < this.retryAttempts) {
          this.log(
            `Network error. Retrying in ${this.retryDelay}ms... (${attempt}/${this.retryAttempts})`,
            "verbose"
          );
          setTimeout(() => {
            this.makeGitHubRequest(endpoint, attempt + 1)
              .then(resolve)
              .catch(reject);
          }, this.retryDelay * attempt);
        } else {
          reject(error);
        }
      });

      req.end();
    });
  }

  async fetchContributorStats(owner, repo, startDate, endDate) {
    this.log(`Fetching contributor stats for ${owner}/${repo}`, "info");
    this.log(`Date range: ${startDate} to ${endDate}`, "verbose");

    // Create progress indicator
    const progressChars = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    let progressIndex = 0;
    const progressInterval = setInterval(() => {
      process.stdout.write(
        `\r${progressChars[progressIndex]} Fetching contributor data...`
      );
      progressIndex = (progressIndex + 1) % progressChars.length;
    }, 100);

    try {
      const endpoint = `/repos/${owner}/${repo}/stats/contributors`;
      const contributors = await this.makeGitHubRequest(endpoint);

      clearInterval(progressInterval);
      process.stdout.write("\r✅ Contributor data fetched successfully\n");

      if (!contributors || contributors.length === 0) {
        throw new Error("No contributor data found");
      }

      // Convert date strings to Unix timestamps (start of week)
      const startTimestamp = startDate
        ? Math.floor(new Date(startDate).getTime() / 1000)
        : 0;
      const endTimestamp = endDate
        ? Math.floor(new Date(endDate).getTime() / 1000)
        : Date.now() / 1000;

      this.log(`Processing ${contributors.length} contributors`, "verbose");
      this.log(
        `Filtering weeks between ${startTimestamp} and ${endTimestamp}`,
        "debug"
      );

      return this.analyzeContributorData(
        contributors,
        startTimestamp,
        endTimestamp,
        startDate,
        endDate
      );
    } catch (error) {
      clearInterval(progressInterval);
      process.stdout.write("\r❌ Failed to fetch contributor data\n");
      throw error;
    }
  }

  analyzeContributorData(
    contributors,
    startTimestamp,
    endTimestamp,
    startDate,
    endDate
  ) {
    const analysis = {
      metadata: {
        repositoryAnalyzed: null,
        dateRange: {
          start: startDate || "Repository start",
          end: endDate || "Latest data",
        },
        generatedAt: new Date().toISOString(),
        totalContributorsInRepo: contributors.length,
      },
      contributorActivity: [],
      summary: {
        activeContributors: 0,
        totalCommitsInPeriod: 0,
        totalAdditionsInPeriod: 0,
        totalDeletionsInPeriod: 0,
        averageCommitsPerContributor: 0,
        averageLinesPerCommit: 0,
        topContributors: [],
      },
    };

    let activeContributors = 0;
    let totalCommits = 0;
    let totalAdditions = 0;
    let totalDeletions = 0;

    contributors.forEach((contributor) => {
      const contributorData = {
        author: contributor.author.login,
        authorId: contributor.author.id,
        avatarUrl: contributor.author.avatar_url,
        totalCommitsAllTime: contributor.total,
        activityInPeriod: {
          commits: 0,
          additions: 0,
          deletions: 0,
          activeWeeks: 0,
        },
        weeklyBreakdown: [],
      };

      // Filter weeks by date range
      const relevantWeeks = contributor.weeks.filter((week) => {
        return week.w >= startTimestamp && week.w <= endTimestamp;
      });

      let hasActivityInPeriod = false;

      relevantWeeks.forEach((week) => {
        if (week.c > 0 || week.a > 0 || week.d > 0) {
          hasActivityInPeriod = true;
          contributorData.activityInPeriod.commits += week.c;
          contributorData.activityInPeriod.additions += week.a;
          contributorData.activityInPeriod.deletions += week.d;
          contributorData.activityInPeriod.activeWeeks++;
        }

        contributorData.weeklyBreakdown.push({
          weekStart: new Date(week.w * 1000).toISOString().split("T")[0],
          commits: week.c,
          additions: week.a,
          deletions: week.d,
        });
      });

      if (hasActivityInPeriod) {
        activeContributors++;
        totalCommits += contributorData.activityInPeriod.commits;
        totalAdditions += contributorData.activityInPeriod.additions;
        totalDeletions += contributorData.activityInPeriod.deletions;
      }

      analysis.contributorActivity.push(contributorData);
    });

    // Calculate summary metrics
    analysis.summary.activeContributors = activeContributors;
    analysis.summary.totalCommitsInPeriod = totalCommits;
    analysis.summary.totalAdditionsInPeriod = totalAdditions;
    analysis.summary.totalDeletionsInPeriod = totalDeletions;
    analysis.summary.averageCommitsPerContributor =
      activeContributors > 0
        ? Math.round((totalCommits / activeContributors) * 100) / 100
        : 0;
    analysis.summary.averageLinesPerCommit =
      totalCommits > 0
        ? Math.round(((totalAdditions + totalDeletions) / totalCommits) * 100) /
          100
        : 0;

    // Get top contributors (by commits in period)
    analysis.summary.topContributors = analysis.contributorActivity
      .filter((c) => c.activityInPeriod.commits > 0)
      .sort((a, b) => b.activityInPeriod.commits - a.activityInPeriod.commits)
      .slice(0, 10)
      .map((c) => ({
        author: c.author,
        commits: c.activityInPeriod.commits,
        additions: c.activityInPeriod.additions,
        deletions: c.activityInPeriod.deletions,
      }));

    this.log(
      `Analysis complete: ${activeContributors} active contributors, ${totalCommits} total commits`,
      "info"
    );

    return analysis;
  }

  formatAsCSV(analysis) {
    const lines = [];

    // Header
    lines.push(
      "Author,Author ID,Total Commits All Time,Commits In Period,Additions In Period,Deletions In Period,Active Weeks,Lines Per Commit In Period"
    );

    // Data rows
    analysis.contributorActivity.forEach((contributor) => {
      const linesPerCommit =
        contributor.activityInPeriod.commits > 0
          ? Math.round(
              ((contributor.activityInPeriod.additions +
                contributor.activityInPeriod.deletions) /
                contributor.activityInPeriod.commits) *
                100
            ) / 100
          : 0;

      lines.push(
        [
          contributor.author,
          contributor.authorId,
          contributor.totalCommitsAllTime,
          contributor.activityInPeriod.commits,
          contributor.activityInPeriod.additions,
          contributor.activityInPeriod.deletions,
          contributor.activityInPeriod.activeWeeks,
          linesPerCommit,
        ].join(",")
      );
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
          `contributor-analysis-${new Date().toISOString().split("T")[0]}.csv`;
      } else {
        content = JSON.stringify(data, null, 2);
        actualFilename =
          filename ||
          `contributor-analysis-${new Date().toISOString().split("T")[0]}.json`;
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

    return options;
  }

  showHelp() {
    console.log(`
🔍 GitHub Contributor Activity Analyzer

Analyze contributor-level activity and participation trends in GitHub repositories.
Compare active contributors count and per-person commit ratios across date ranges.

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
  node main.mjs -r microsoft/vscode -s 2023-01-01 -e 2023-12-31
  node main.mjs -r facebook/react -f csv -o react-analysis.csv --verbose
  node main.mjs -r owner/repo --start 2023-06-01 --debug

Environment Variables:
  GITHUB_TOKEN                      GitHub personal access token

Report Features:
  • Team Productivity Analysis: Track commit frequency and patterns  
  • Code Quality Assessment: Monitor additions/deletions trends
  • Collaboration Metrics: Analyze contributor participation
  • Development Patterns: Identify working time distributions
  • Process Improvements: Compare before/after periods for process changes

Note: Date ranges are applied to weekly contributor statistics. The tool automatically 
handles API rate limiting and includes retry logic for reliable data collection.
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
  }

  async run() {
    try {
      this.validateOptions();

      const [owner, repo] = this.options.repo.split("/");
      const analyzer = new ContributorAnalyzer({
        token: this.options.token,
        verbose: this.options.verbose,
        debug: this.options.debug,
      });

      console.log("🚀 Starting GitHub Contributor Analysis...\n");

      const analysis = await analyzer.fetchContributorStats(
        owner,
        repo,
        this.options.start,
        this.options.end
      );

      // Set repository name in metadata
      analysis.metadata.repositoryAnalyzed = this.options.repo;

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
      console.log(`   Output File: ${filename}`);

      if (analysis.summary.topContributors.length > 0) {
        console.log("\n🏆 Top Contributors (by commits in period):");
        analysis.summary.topContributors
          .slice(0, 5)
          .forEach((contributor, index) => {
            console.log(
              `   ${index + 1}. ${contributor.author}: ${
                contributor.commits
              } commits`
            );
          });
      }

      console.log("\n✅ Analysis completed successfully!");
    } catch (error) {
      console.error(`❌ Error: ${error.message}`);
      if (this.options.debug) {
        console.error(error.stack);
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

export { ContributorAnalyzer, CLI };
