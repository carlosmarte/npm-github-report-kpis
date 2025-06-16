#!/usr/bin/env node

/**
 * GitHub Repository Contributor Analysis CLI
 *
 * JSON Report Structure:
 * {
 *   "repository": {
 *     "name": "repo-name",
 *     "owner": "owner-name",
 *     "url": "https://github.com/owner/repo",
 *     "analysisDateRange": {
 *       "start": "2024-01-01",
 *       "end": "2024-12-31"
 *     }
 *   },
 *   "summary": {
 *     "totalCommits": 150,
 *     "totalContributors": 5,
 *     "dateRange": "2024-01-01 to 2024-12-31",
 *     "analysisTimestamp": "2024-01-15T10:30:00Z"
 *   },
 *   "contributors": [
 *     {
 *       "email": "developer@example.com",
 *       "name": "John Developer",
 *       "commitCount": 45,
 *       "linesAdded": 1250,
 *       "linesDeleted": 320,
 *       "firstCommit": "2024-01-15T09:30:00Z",
 *       "lastCommit": "2024-03-20T14:45:00Z",
 *       "commitMessages": [
 *         {
 *           "sha": "abc123",
 *           "message": "Add user authentication feature",
 *           "date": "2024-01-15T09:30:00Z",
 *           "additions": 85,
 *           "deletions": 12
 *         }
 *       ]
 *     }
 *   ],
 *   "insights": {
 *     "topContributorByCommits": "developer@example.com",
 *     "topContributorByLinesAdded": "developer@example.com",
 *     "averageCommitsPerContributor": 30,
 *     "codeChurnRate": 0.15
 *   }
 * }
 *
 * Use Cases:
 * 1. Team Productivity Analysis: Track commit frequency and patterns across team members
 * 2. Code Quality Assessment: Monitor code additions/deletions trends and commit message quality
 * 3. Collaboration Metrics: Analyze contributor participation and engagement levels
 * 4. Development Patterns: Identify working time distributions and peak productivity periods
 * 5. Process Improvements: Compare before/after periods for development process changes
 * 6. Onboarding Assessment: Track new team member integration and contribution growth
 * 7. Technical Debt Analysis: Identify contributors with high deletion ratios indicating refactoring
 * 8. Release Planning: Understand team velocity and capacity for sprint planning
 */

import { promises as fs } from "fs";
import { performance } from "perf_hooks";

class GitHubAnalyzer {
  constructor() {
    this.baseUrl = "https://api.github.com";
    this.requestCount = 0;
    this.rateLimitRemaining = 5000;
    this.rateLimitReset = null;
    this.verbose = false;
    this.debug = false;
  }

  /**
   * Main analysis method
   * @param {string} repo - Repository name
   * @param {string} owner - Repository owner
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @param {string} endDate - End date (YYYY-MM-DD)
   * @param {string} token - GitHub token
   * @param {number} limit - Maximum number of commits to fetch (default: 200, 0 for infinite)
   * @param {boolean} verbose - Enable verbose logging
   * @param {boolean} debug - Enable debug logging
   * @returns {Object} Analysis results
   */
  async analyzeRepository(
    repo,
    owner,
    startDate,
    endDate,
    token,
    limit = 200,
    verbose = false,
    debug = false
  ) {
    this.token = token;
    this.verbose = verbose;
    this.debug = debug;

    this.validateInputs(repo, owner, startDate, endDate, token);

    if (this.verbose) {
      console.log(`🔍 Analyzing repository: ${owner}/${repo}`);
      console.log(
        `📅 Date range: ${startDate || "All time"} to ${endDate || "All time"}`
      );
      console.log(`📊 Commit limit: ${limit === 0 ? "Unlimited" : limit}`);
      console.log("");
    }

    const startTime = performance.now();

    try {
      // Get repository information
      const repoInfo = await this.fetchRepositoryInfo(owner, repo);

      // Fetch commits in date range with limit
      const commits = await this.fetchCommitsInDateRange(
        owner,
        repo,
        startDate,
        endDate,
        limit
      );

      // Process contributor data
      const contributorData = await this.processContributorData(
        commits,
        owner,
        repo
      );

      // Generate insights
      const insights = this.generateInsights(contributorData);

      const endTime = performance.now();
      const duration = ((endTime - startTime) / 1000).toFixed(2);

      const report = {
        repository: {
          name: repo,
          owner: owner,
          url: `https://github.com/${owner}/${repo}`,
          analysisDateRange: {
            start: startDate || null,
            end: endDate || null,
          },
        },
        summary: {
          totalCommits: commits.length,
          totalContributors: Object.keys(contributorData).length,
          dateRange: `${startDate || "Beginning"} to ${endDate || "Latest"}`,
          analysisTimestamp: new Date().toISOString(),
          processingTimeSeconds: parseFloat(duration),
          commitLimit: limit === 0 ? "unlimited" : limit,
        },
        contributors: Object.values(contributorData).sort(
          (a, b) => b.commitCount - a.commitCount
        ),
        insights,
      };

      if (this.verbose) {
        console.log(`\n✅ Analysis completed in ${duration}s`);
        console.log(`📊 Total commits analyzed: ${commits.length}`);
        console.log(
          `👥 Contributors found: ${Object.keys(contributorData).length}`
        );
      }

      return report;
    } catch (error) {
      console.error("❌ Analysis failed:", error.message);
      if (this.debug && error.response) {
        console.error(
          "API Response:",
          error.response.status,
          error.response.statusText
        );
      }
      throw error;
    }
  }

  validateInputs(repo, owner, startDate, endDate, token) {
    if (!repo || !owner || !token) {
      throw new Error("Repository, owner, and token are required");
    }

    if (startDate && !this.isValidDate(startDate)) {
      throw new Error("Invalid start date format. Use YYYY-MM-DD");
    }

    if (endDate && !this.isValidDate(endDate)) {
      throw new Error("Invalid end date format. Use YYYY-MM-DD");
    }

    if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
      throw new Error("Start date must be before end date");
    }
  }

  isValidDate(dateString) {
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!regex.test(dateString)) return false;
    const date = new Date(dateString);
    return (
      date instanceof Date &&
      !isNaN(date) &&
      dateString === date.toISOString().split("T")[0]
    );
  }

  async fetchRepositoryInfo(owner, repo) {
    const url = `${this.baseUrl}/repos/${owner}/${repo}`;
    try {
      const response = await this.makeRequest(url);
      return response;
    } catch (error) {
      if (error.message.includes("404")) {
        throw new Error(
          `Repository ${owner}/${repo} not found or access denied. Please check the repository name and your token permissions.`
        );
      }
      throw error;
    }
  }

  async fetchCommitsInDateRange(owner, repo, startDate, endDate, limit = 200) {
    let allCommits = [];
    let page = 1;
    const perPage = 100;
    let hasMore = true;
    let fetchedCount = 0;

    if (this.verbose) {
      console.log("📡 Fetching commit data...");
    }

    const progressChars = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    let progressIndex = 0;

    while (hasMore && (limit === 0 || fetchedCount < limit)) {
      const remainingLimit =
        limit === 0 ? perPage : Math.min(perPage, limit - fetchedCount);

      const params = new URLSearchParams({
        page: page.toString(),
        per_page: remainingLimit.toString(),
      });

      if (startDate) params.append("since", new Date(startDate).toISOString());
      if (endDate)
        params.append("until", new Date(endDate + "T23:59:59Z").toISOString());

      const url = `${this.baseUrl}/repos/${owner}/${repo}/commits?${params}`;

      // Show progress
      if (this.verbose) {
        process.stdout.write(
          `\r${progressChars[progressIndex]} Fetching page ${page}... (${allCommits.length} commits)`
        );
        progressIndex = (progressIndex + 1) % progressChars.length;
      }

      const commits = await this.makeRequest(url);

      if (commits.length === 0) {
        hasMore = false;
      } else {
        // Get detailed commit info with stats
        const detailedCommits = await Promise.all(
          commits.map((commit) =>
            this.fetchCommitDetails(owner, repo, commit.sha)
          )
        );

        const validCommits = detailedCommits.filter(
          (commit) => commit !== null
        );
        allCommits.push(...validCommits);
        fetchedCount += validCommits.length;
        page++;

        // Check if we've reached the limit
        if (limit > 0 && fetchedCount >= limit) {
          hasMore = false;
          allCommits = allCommits.slice(0, limit); // Ensure exact limit
        }

        // Rate limiting: small delay between requests
        await this.sleep(100);
      }
    }

    if (this.verbose) {
      process.stdout.write("\r" + " ".repeat(60) + "\r"); // Clear progress line
    }

    return allCommits;
  }

  async fetchCommitDetails(owner, repo, sha) {
    const url = `${this.baseUrl}/repos/${owner}/${repo}/commits/${sha}`;
    try {
      const commit = await this.makeRequest(url);
      return commit;
    } catch (error) {
      if (this.debug) {
        console.log(
          `\n⚠️  Warning: Could not fetch details for commit ${sha}: ${error.message}`
        );
      }
      return null;
    }
  }

  async processContributorData(commits, owner, repo) {
    const contributors = {};

    if (this.verbose) {
      console.log("🔄 Processing contributor data...");
    }

    commits
      .filter((commit) => commit !== null)
      .forEach((commit, index) => {
        if (this.verbose && index % 10 === 0) {
          process.stdout.write(
            `\r📊 Processing commit ${index + 1}/${commits.length}`
          );
        }

        const email = commit.commit?.author?.email || "unknown@unknown.com";
        const name = commit.commit?.author?.name || "Unknown";
        const date = commit.commit?.author?.date;
        const message = commit.commit?.message || "";
        const additions = commit.stats?.additions || 0;
        const deletions = commit.stats?.deletions || 0;

        if (!contributors[email]) {
          contributors[email] = {
            email,
            name,
            commitCount: 0,
            linesAdded: 0,
            linesDeleted: 0,
            firstCommit: date,
            lastCommit: date,
            commitMessages: [],
          };
        }

        const contributor = contributors[email];
        contributor.commitCount++;
        contributor.linesAdded += additions;
        contributor.linesDeleted += deletions;

        if (new Date(date) < new Date(contributor.firstCommit)) {
          contributor.firstCommit = date;
        }
        if (new Date(date) > new Date(contributor.lastCommit)) {
          contributor.lastCommit = date;
        }

        contributor.commitMessages.push({
          sha: commit.sha,
          message: message.split("\n")[0], // First line only
          date,
          additions,
          deletions,
        });
      });

    if (this.verbose) {
      process.stdout.write("\r" + " ".repeat(50) + "\r"); // Clear progress line
    }

    // Sort commit messages by date for each contributor
    Object.values(contributors).forEach((contributor) => {
      contributor.commitMessages.sort(
        (a, b) => new Date(b.date) - new Date(a.date)
      );
    });

    return contributors;
  }

  generateInsights(contributorData) {
    const contributors = Object.values(contributorData);

    if (contributors.length === 0) {
      return {
        topContributorByCommits: null,
        topContributorByLinesAdded: null,
        averageCommitsPerContributor: 0,
        codeChurnRate: 0,
      };
    }

    const topByCommits = contributors.reduce((max, contributor) =>
      contributor.commitCount > max.commitCount ? contributor : max
    );

    const topByLinesAdded = contributors.reduce((max, contributor) =>
      contributor.linesAdded > max.linesAdded ? contributor : max
    );

    const totalCommits = contributors.reduce(
      (sum, contributor) => sum + contributor.commitCount,
      0
    );
    const totalAdditions = contributors.reduce(
      (sum, contributor) => sum + contributor.linesAdded,
      0
    );
    const totalDeletions = contributors.reduce(
      (sum, contributor) => sum + contributor.linesDeleted,
      0
    );

    const averageCommitsPerContributor = Math.round(
      totalCommits / contributors.length
    );
    const codeChurnRate =
      totalAdditions > 0 ? totalDeletions / totalAdditions : 0;

    return {
      topContributorByCommits: topByCommits.email,
      topContributorByLinesAdded: topByLinesAdded.email,
      averageCommitsPerContributor,
      codeChurnRate: Math.round(codeChurnRate * 100) / 100,
      totalLinesAdded: totalAdditions,
      totalLinesDeleted: totalDeletions,
      mostActiveDay: this.findMostActiveDay(contributors),
      contributorDistribution: this.getContributorDistribution(contributors),
    };
  }

  findMostActiveDay(contributors) {
    const dayCount = {};

    contributors.forEach((contributor) => {
      contributor.commitMessages.forEach((commit) => {
        const day = new Date(commit.date).toLocaleDateString("en-US", {
          weekday: "long",
        });
        dayCount[day] = (dayCount[day] || 0) + 1;
      });
    });

    return Object.entries(dayCount).reduce(
      (max, [day, count]) => (count > max.count ? { day, count } : max),
      { day: "Unknown", count: 0 }
    );
  }

  getContributorDistribution(contributors) {
    const totalCommits = contributors.reduce(
      (sum, c) => sum + c.commitCount,
      0
    );

    return contributors
      .map((contributor) => ({
        email: contributor.email,
        percentage: Math.round((contributor.commitCount / totalCommits) * 100),
      }))
      .sort((a, b) => b.percentage - a.percentage);
  }

  async makeRequest(url, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await this.checkRateLimit();

        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "GitHub-Analyzer-CLI/1.0",
          },
        });

        // Update rate limit info
        this.rateLimitRemaining = parseInt(
          response.headers.get("x-ratelimit-remaining") || "0"
        );
        this.rateLimitReset = parseInt(
          response.headers.get("x-ratelimit-reset") || "0"
        );
        this.requestCount++;

        if (!response.ok) {
          if (response.status === 401) {
            throw new Error(
              "❌ Authentication failed. Please check your GitHub token format and permissions. GitHub API now requires Bearer token format instead of the legacy token format. Ensure your token has proper repository access scopes."
            );
          } else if (response.status === 403) {
            const errorBody = await response.text();
            console.log(`Debug - Full error response: ${errorBody}`);
            if (errorBody.includes("rate limit")) {
              throw new Error(
                "❌ Rate limit exceeded. The request might be hitting rate limits. Please wait before retrying or check your API usage."
              );
            } else {
              throw new Error(
                `❌ Access forbidden. The token might lack proper repository access scopes. Ensure your token has 'repo' scope for private repositories or 'public_repo' for public ones. Status: ${response.status}`
              );
            }
          } else if (response.status === 404) {
            throw new Error(
              "❌ Repository not found or access denied. Check repository name and token permissions. Verify the repository exists and your token has access to it."
            );
          } else {
            const errorBody = await response.text();
            throw new Error(
              `❌ API request failed: ${response.status} ${response.statusText}. The request might be using incorrect headers or hitting an invalid endpoint. Details: ${errorBody}`
            );
          }
        }

        const data = await response.json();
        return data;
      } catch (error) {
        if (this.debug) {
          console.log(
            `\n⚠️  Request attempt ${attempt}/${retries} failed: ${error.message}`
          );
        }

        if (attempt === retries) {
          throw error;
        }

        // Exponential backoff
        const delay = Math.pow(2, attempt) * 1000;
        if (this.verbose) {
          console.log(`⏳ Retrying in ${delay / 1000}s...`);
        }
        await this.sleep(delay);
      }
    }
  }

  async checkRateLimit() {
    if (this.rateLimitRemaining <= 10 && this.rateLimitReset) {
      const now = Math.floor(Date.now() / 1000);
      const waitTime = (this.rateLimitReset - now + 60) * 1000; // Add 1 minute buffer

      if (waitTime > 0) {
        console.log(
          `\n⏸️  Rate limit nearly exceeded. Waiting ${Math.ceil(
            waitTime / 1000
          )}s...`
        );
        await this.sleep(waitTime);
      }
    }
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// CLI Interface
class GitHubAnalyzerCLI {
  constructor() {
    this.analyzer = new GitHubAnalyzer();
  }

  parseArguments() {
    const args = process.argv.slice(2);
    const options = {
      repo: null,
      owner: null,
      format: "json",
      output: null,
      start: null,
      end: null,
      verbose: false,
      debug: false,
      token: process.env.GITHUB_TOKEN || null,
      limit: 200,
    };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      const next = args[i + 1];

      switch (arg) {
        case "-r":
        case "--repo":
          if (next && next.includes("/")) {
            const [owner, repo] = next.split("/");
            options.owner = owner;
            options.repo = repo;
            i++;
          } else {
            throw new Error('Repository must be in format "owner/repo"');
          }
          break;
        case "-f":
        case "--format":
          if (next && ["json", "csv"].includes(next)) {
            options.format = next;
            i++;
          } else {
            throw new Error('Format must be "json" or "csv"');
          }
          break;
        case "-o":
        case "--output":
          options.output = next;
          i++;
          break;
        case "-s":
        case "--start":
          options.start = next;
          i++;
          break;
        case "-e":
        case "--end":
          options.end = next;
          i++;
          break;
        case "-l":
        case "--limit":
          const limitValue = parseInt(next);
          if (isNaN(limitValue) || limitValue < 0) {
            throw new Error(
              "Limit must be a positive number or 0 for unlimited"
            );
          }
          options.limit = limitValue;
          i++;
          break;
        case "-t":
        case "--token":
          options.token = next;
          i++;
          break;
        case "-v":
        case "--verbose":
          options.verbose = true;
          break;
        case "-d":
        case "--debug":
          options.debug = true;
          options.verbose = true;
          break;
        case "-h":
        case "--help":
          this.showHelp();
          process.exit(0);
          break;
        default:
          if (arg.startsWith("-")) {
            throw new Error(`Unknown option: ${arg}`);
          }
      }
    }

    return options;
  }

  showHelp() {
    console.log(`
🔍 GitHub Repository Contributor Analysis CLI

Usage: node main.mjs [options]

Options:
  -r, --repo <owner/repo>     Repository to analyze (required)
  -f, --format <format>       Output format: json (default) or csv
  -o, --output <filename>     Output filename (auto-generated if not provided)
  -s, --start <date>          Start date (ISO format: YYYY-MM-DD)
  -e, --end <date>            End date (ISO format: YYYY-MM-DD)
  -l, --limit <number>        Max commits to fetch (default: 200, 0 = unlimited)
  -v, --verbose               Enable verbose logging
  -d, --debug                 Enable debug logging
  -t, --token                 GitHub Token (or use GITHUB_TOKEN env var)
  -h, --help                  Show help message

Examples:
  node main.mjs -r microsoft/typescript -s 2024-01-01 -e 2024-03-31
  node main.mjs -r facebook/react --format csv --output react-analysis.csv
  node main.mjs -r owner/repo --token ghp_xxxxxxxxxxxx --verbose --limit 500
  node main.mjs -r owner/repo --limit 0  # Unlimited commits

Environment Variables:
  GITHUB_TOKEN                GitHub personal access token

Commit Limiting:
  - Default: 200 commits (good balance of speed vs. data)
  - Set --limit 0 for unlimited commits (may take longer)
  - Higher limits provide more comprehensive analysis but take more time
        `);
  }

  generateOutputFilename(owner, repo, format, start, end, limit) {
    const timestamp = new Date().toISOString().split("T")[0];
    const dateRange = start && end ? `_${start}_to_${end}` : "";
    const limitSuffix = limit === 0 ? "_unlimited" : `_${limit}commits`;
    return `${owner}_${repo}_contributors${dateRange}${limitSuffix}_${timestamp}.${format}`;
  }

  async formatOutput(data, format) {
    if (format === "json") {
      return JSON.stringify(data, null, 2);
    } else if (format === "csv") {
      return this.convertToCSV(data);
    } else {
      throw new Error(`Unsupported format: ${format}`);
    }
  }

  convertToCSV(data) {
    const headers = [
      "Email",
      "Name",
      "Commit Count",
      "Lines Added",
      "Lines Deleted",
      "First Commit",
      "Last Commit",
      "Latest Commit Message",
      "Percentage of Total Commits",
    ];

    const totalCommits = data.summary.totalCommits;

    const rows = data.contributors.map((contributor) => {
      const percentage = Math.round(
        (contributor.commitCount / totalCommits) * 100
      );
      const latestMessage = contributor.commitMessages[0]?.message || "";

      return [
        contributor.email,
        contributor.name,
        contributor.commitCount,
        contributor.linesAdded,
        contributor.linesDeleted,
        contributor.firstCommit,
        contributor.lastCommit,
        `"${latestMessage.replace(/"/g, '""')}"`, // Escape quotes
        `${percentage}%`,
      ];
    });

    const csvContent = [
      `# GitHub Repository Analysis: ${data.repository.owner}/${data.repository.name}`,
      `# Date Range: ${data.summary.dateRange}`,
      `# Generated: ${data.summary.analysisTimestamp}`,
      `# Total Commits: ${data.summary.totalCommits}`,
      `# Total Contributors: ${data.summary.totalContributors}`,
      `# Commit Limit: ${data.summary.commitLimit}`,
      "",
      headers.join(","),
      ...rows.map((row) => row.join(",")),
    ].join("\n");

    return csvContent;
  }

  async run() {
    try {
      console.log("🚀 GitHub Repository Contributor Analysis CLI\n");

      const options = this.parseArguments();

      // Validate required options
      if (!options.repo || !options.owner) {
        console.error("❌ Error: Repository is required. Use -r owner/repo");
        console.log("\nUse --help for usage information.");
        process.exit(1);
      }

      if (!options.token) {
        console.error(
          "❌ Error: GitHub token is required. Use -t token or set GITHUB_TOKEN environment variable"
        );
        process.exit(1);
      }

      if (options.verbose) {
        console.log("🔧 Configuration:");
        console.log(`   Repository: ${options.owner}/${options.repo}`);
        console.log(`   Format: ${options.format}`);
        console.log(`   Start Date: ${options.start || "All time"}`);
        console.log(`   End Date: ${options.end || "All time"}`);
        console.log(
          `   Commit Limit: ${
            options.limit === 0 ? "Unlimited" : options.limit
          }`
        );
        console.log(
          `   Token: ${options.token ? "***provided***" : "Not provided"}`
        );
        console.log("");
      }

      // Run analysis
      const report = await this.analyzer.analyzeRepository(
        options.repo,
        options.owner,
        options.start,
        options.end,
        options.token,
        options.limit,
        options.verbose,
        options.debug
      );

      // Generate output filename if not provided
      const outputFilename =
        options.output ||
        this.generateOutputFilename(
          options.owner,
          options.repo,
          options.format,
          options.start,
          options.end,
          options.limit
        );

      // Format and save output
      const formattedOutput = await this.formatOutput(report, options.format);
      await fs.writeFile(outputFilename, formattedOutput, "utf8");

      console.log(`\n✅ Report saved to: ${outputFilename}`);
      console.log(
        `📁 File size: ${(formattedOutput.length / 1024).toFixed(2)} KB`
      );

      // Show summary
      console.log("\n📊 Summary:");
      console.log(`   Total Contributors: ${report.summary.totalContributors}`);
      console.log(`   Total Commits: ${report.summary.totalCommits}`);
      console.log(`   Commit Limit: ${report.summary.commitLimit}`);
      console.log(
        `   Top Contributor: ${report.insights.topContributorByCommits}`
      );
      console.log(`   Analysis Period: ${report.summary.dateRange}`);

      if (options.verbose) {
        console.log("\n🏆 Top 3 Contributors by Commits:");
        report.contributors.slice(0, 3).forEach((contributor, index) => {
          console.log(
            `   ${index + 1}. ${contributor.email} (${
              contributor.commitCount
            } commits)`
          );
        });
      }
    } catch (error) {
      console.error("\n❌ Error:", error.message);
      if (
        error.stack &&
        (process.env.DEBUG || process.argv.includes("--debug"))
      ) {
        console.error("\nStack trace:", error.stack);
      }
      process.exit(1);
    }
  }
}

// Run the CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const cli = new GitHubAnalyzerCLI();
  cli.run();
}

export { GitHubAnalyzer, GitHubAnalyzerCLI };
