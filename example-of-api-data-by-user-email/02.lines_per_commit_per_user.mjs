#!/usr/bin/env node

import { writeFile } from "fs/promises";
import { program } from "commander";
import fetch from "node-fetch";
import { createObjectCsvWriter } from "csv-writer";
import chalk from "chalk";

class GitHubAnalyzer {
  constructor(options = {}) {
    this.options = {
      verbose: options.verbose || false,
      debug: options.debug || false,
      retryAttempts: options.retryAttempts || 3,
      retryDelay: options.retryDelay || 1000,
    };
    this.rateLimitRemaining = 5000;
    this.rateLimitReset = Date.now();
  }

  log(message, level = "info") {
    const timestamp = new Date().toISOString();
    const colors = {
      error: chalk.red,
      warn: chalk.yellow,
      info: chalk.blue,
      success: chalk.green,
      debug: chalk.gray,
    };

    if (level === "debug" && !this.options.debug) return;
    if (level === "verbose" && !this.options.verbose && !this.options.debug)
      return;

    console.log(
      `${
        colors[level] || chalk.white
      }[${timestamp}] ${level.toUpperCase()}: ${message}`
    );
  }

  createSimpleProgressBar(current, total, label = "Progress") {
    const percentage = Math.round((current / total) * 100);
    const barLength = 40;
    const filledLength = Math.round((barLength * current) / total);
    const bar = "█".repeat(filledLength) + "░".repeat(barLength - filledLength);

    process.stdout.write(
      `\r${chalk.blue(label)} [${chalk.cyan(
        bar
      )}] ${percentage}% (${current}/${total})`
    );

    if (current === total) {
      process.stdout.write("\n");
    }
  }

  async makeRequest(url, token, options = {}) {
    const headers = {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "GitHub-Lines-Per-Commit-Analyzer/1.0.0",
      ...options.headers,
    };

    for (let attempt = 1; attempt <= this.options.retryAttempts; attempt++) {
      try {
        // Check rate limit
        if (this.rateLimitRemaining <= 10) {
          const waitTime = Math.max(0, this.rateLimitReset - Date.now());
          if (waitTime > 0) {
            this.log(
              `Rate limit approaching. Waiting ${Math.ceil(
                waitTime / 1000
              )} seconds...`,
              "warn"
            );
            await this.sleep(waitTime);
          }
        }

        this.log(`Making request to: ${url} (attempt ${attempt})`, "debug");

        const response = await fetch(url, { ...options, headers });

        // Update rate limit info
        this.rateLimitRemaining = parseInt(
          response.headers.get("x-ratelimit-remaining") || "5000"
        );
        this.rateLimitReset =
          parseInt(
            response.headers.get("x-ratelimit-reset") || Date.now() / 1000
          ) * 1000;

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error(
              `Repository not found or not accessible: ${response.status}`
            );
          }
          if (response.status === 403) {
            const resetTime = new Date(this.rateLimitReset).toISOString();
            throw new Error(`Rate limit exceeded. Resets at: ${resetTime}`);
          }
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return response;
      } catch (error) {
        this.log(
          `Request failed (attempt ${attempt}): ${error.message}`,
          "error"
        );

        if (attempt === this.options.retryAttempts) {
          throw error;
        }

        await this.sleep(this.options.retryDelay * attempt);
      }
    }
  }

  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async fetchAllPages(baseUrl, token, params = {}) {
    const results = [];
    let page = 1;
    let hasNextPage = true;
    let totalPages = 1;

    while (hasNextPage) {
      const url = new URL(baseUrl);
      Object.entries({ ...params, page, per_page: 100 }).forEach(
        ([key, value]) => {
          if (value !== undefined && value !== null) {
            url.searchParams.set(key, value);
          }
        }
      );

      try {
        const response = await this.makeRequest(url.toString(), token);
        const data = await response.json();

        if (Array.isArray(data)) {
          results.push(...data);
        } else {
          results.push(data);
        }

        // Check for next page
        const linkHeader = response.headers.get("link");
        hasNextPage = linkHeader && linkHeader.includes('rel="next"');

        // Update total pages from link header
        if (linkHeader && linkHeader.includes('rel="last"')) {
          const lastPageMatch = linkHeader.match(/page=(\d+).*rel="last"/);
          if (lastPageMatch) {
            totalPages = parseInt(lastPageMatch[1]);
          }
        }

        this.createSimpleProgressBar(page, totalPages, "Fetching pages");
        page++;

        this.log(
          `Fetched page ${page - 1}, got ${
            Array.isArray(data) ? data.length : 1
          } items`,
          "verbose"
        );
      } catch (error) {
        process.stdout.write("\n"); // Ensure we're on a new line after progress bar
        throw error;
      }
    }

    return results;
  }

  async analyzeLinesPerCommitPerUser(repo, owner, startDate, endDate, token) {
    this.log(`Starting lines per commit analysis for ${owner}/${repo}`, "info");
    this.log(`Date range: ${startDate} to ${endDate}`, "info");

    try {
      // Fetch commits with pagination
      const baseUrl = "https://api.github.com";
      const commits = await this.fetchAllPages(
        `${baseUrl}/repos/${owner}/${repo}/commits`,
        token,
        {
          since: startDate,
          until: endDate,
        }
      );

      this.log(`Found ${commits.length} commits in date range`, "success");

      if (commits.length === 0) {
        return {
          repository: `${owner}/${repo}`,
          dateRange: { start: startDate, end: endDate },
          totalCommits: 0,
          userMetrics: [],
          summary: {
            totalUsers: 0,
            totalCommits: 0,
            totalLinesChanged: 0,
            overallAverageLinesPerCommit: 0,
          },
        };
      }

      // Analyze each commit for line changes
      const userStats = {};
      this.log("Analyzing commit details for line changes...", "info");

      for (let i = 0; i < commits.length; i++) {
        const commit = commits[i];

        this.createSimpleProgressBar(
          i + 1,
          commits.length,
          "Analyzing commits"
        );

        try {
          // Fetch detailed commit info to get stats
          const detailResponse = await this.makeRequest(
            `${baseUrl}/repos/${owner}/${repo}/commits/${commit.sha}`,
            token
          );
          const detailedCommit = await detailResponse.json();

          const stats = detailedCommit.stats || { additions: 0, deletions: 0 };
          const author = commit.commit.author;
          const authorEmail = author.email;
          const authorName = author.name;
          const linesChanged = stats.additions + stats.deletions;

          // Initialize user stats if not exists
          if (!userStats[authorEmail]) {
            userStats[authorEmail] = {
              email: authorEmail,
              name: authorName,
              commits: 0,
              totalLinesChanged: 0,
              additions: 0,
              deletions: 0,
            };
          }

          // Update user stats
          userStats[authorEmail].commits++;
          userStats[authorEmail].totalLinesChanged += linesChanged;
          userStats[authorEmail].additions += stats.additions;
          userStats[authorEmail].deletions += stats.deletions;

          this.log(
            `Processed commit ${commit.sha.substring(
              0,
              8
            )} by ${authorName}: ${linesChanged} lines`,
            "debug"
          );
        } catch (error) {
          this.log(
            `Failed to analyze commit ${commit.sha}: ${error.message}`,
            "warn"
          );
        }
      }

      // Calculate averages and prepare user metrics
      const userMetrics = Object.values(userStats).map((user) => ({
        email: user.email,
        name: user.name,
        totalCommits: user.commits,
        totalLinesChanged: user.totalLinesChanged,
        totalAdditions: user.additions,
        totalDeletions: user.deletions,
        averageLinesPerCommit:
          user.commits > 0
            ? parseFloat((user.totalLinesChanged / user.commits).toFixed(2))
            : 0,
        averageAdditionsPerCommit:
          user.commits > 0
            ? parseFloat((user.additions / user.commits).toFixed(2))
            : 0,
        averageDeletionsPerCommit:
          user.commits > 0
            ? parseFloat((user.deletions / user.commits).toFixed(2))
            : 0,
      }));

      // Sort by total commits descending
      userMetrics.sort((a, b) => b.totalCommits - a.totalCommits);

      // Calculate summary statistics
      const totalUsers = userMetrics.length;
      const totalCommits = userMetrics.reduce(
        (sum, user) => sum + user.totalCommits,
        0
      );
      const totalLinesChanged = userMetrics.reduce(
        (sum, user) => sum + user.totalLinesChanged,
        0
      );
      const totalAdditions = userMetrics.reduce(
        (sum, user) => sum + user.totalAdditions,
        0
      );
      const totalDeletions = userMetrics.reduce(
        (sum, user) => sum + user.totalDeletions,
        0
      );

      const summary = {
        totalUsers,
        totalCommits,
        totalLinesChanged,
        totalAdditions,
        totalDeletions,
        overallAverageLinesPerCommit:
          totalCommits > 0
            ? parseFloat((totalLinesChanged / totalCommits).toFixed(2))
            : 0,
        overallAverageAdditionsPerCommit:
          totalCommits > 0
            ? parseFloat((totalAdditions / totalCommits).toFixed(2))
            : 0,
        overallAverageDeletionsPerCommit:
          totalCommits > 0
            ? parseFloat((totalDeletions / totalCommits).toFixed(2))
            : 0,
      };

      return {
        repository: `${owner}/${repo}`,
        dateRange: { start: startDate, end: endDate },
        analyzedAt: new Date().toISOString(),
        userMetrics,
        summary,
      };
    } catch (error) {
      this.log(`Analysis failed: ${error.message}`, "error");
      throw error;
    }
  }

  async exportToJson(data, filename) {
    await writeFile(filename, JSON.stringify(data, null, 2));
    this.log(`Exported JSON to: ${filename}`, "success");
  }

  async exportToCsv(data, filename) {
    const csvWriter = createObjectCsvWriter({
      path: filename,
      header: [
        { id: "email", title: "Email" },
        { id: "name", title: "Name" },
        { id: "totalCommits", title: "Total Commits" },
        { id: "totalLinesChanged", title: "Total Lines Changed" },
        { id: "totalAdditions", title: "Total Additions" },
        { id: "totalDeletions", title: "Total Deletions" },
        { id: "averageLinesPerCommit", title: "Average Lines Per Commit" },
        {
          id: "averageAdditionsPerCommit",
          title: "Average Additions Per Commit",
        },
        {
          id: "averageDeletionsPerCommit",
          title: "Average Deletions Per Commit",
        },
      ],
    });

    await csvWriter.writeRecords(data.userMetrics);
    this.log(`Exported CSV to: ${filename}`, "success");
  }
}

// CLI Setup
program
  .name("github-lines-analyzer")
  .description(
    "Analyze average lines of code per commit per user for GitHub repositories"
  )
  .version("1.0.0")
  .requiredOption(
    "-r, --repo <owner/repo>",
    "Repository to analyze (format: owner/repo)"
  )
  .option("-f, --format <format>", "Output format: json or csv", "json")
  .option(
    "-o, --output <filename>",
    "Output filename (auto-generated if not provided)"
  )
  .option("-s, --start <date>", "Start date (ISO format: YYYY-MM-DD)")
  .option("-e, --end <date>", "End date (ISO format: YYYY-MM-DD)")
  .option("-v, --verbose", "Enable verbose logging", false)
  .option("-d, --debug", "Enable debug logging", false)
  .option(
    "-t, --token <token>",
    "GitHub token (can also use GITHUB_TOKEN env var)"
  )
  .action(async (options) => {
    try {
      // Validate inputs
      const [owner, repo] = options.repo.split("/");
      if (!owner || !repo) {
        console.error(
          chalk.red('Error: Repository must be in format "owner/repo"')
        );
        process.exit(1);
      }

      // Get GitHub token
      const token = options.token || process.env.GITHUB_TOKEN;
      if (!token) {
        console.error(
          chalk.red(
            "Error: GitHub token required. Use --token or set GITHUB_TOKEN environment variable"
          )
        );
        process.exit(1);
      }

      // Set default dates if not provided (last 90 days)
      const endDate = options.end || new Date().toISOString().split("T")[0];
      const startDate =
        options.start ||
        new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split("T")[0];

      // Generate output filename if not provided
      const timestamp = new Date().toISOString().split("T")[0];
      const defaultFilename = `${owner}-${repo}-lines-per-commit-${startDate}-to-${endDate}-${timestamp}`;
      const outputFilename =
        options.output || `${defaultFilename}.${options.format}`;

      console.log(chalk.blue("📊 GitHub Lines Per Commit Analysis Tool\n"));

      // Initialize analyzer
      const analyzer = new GitHubAnalyzer({
        verbose: options.verbose,
        debug: options.debug,
      });

      // Run analysis using the specific method signature requested
      const results = await analyzer.analyzeLinesPerCommitPerUser(
        repo,
        owner,
        startDate,
        endDate,
        token
      );

      // Display summary
      console.log(chalk.green("\n📋 Analysis Summary:"));
      console.log(`Repository: ${results.repository}`);
      console.log(
        `Date Range: ${results.dateRange.start} to ${results.dateRange.end}`
      );
      console.log(`Total Users: ${results.summary.totalUsers}`);
      console.log(`Total Commits: ${results.summary.totalCommits}`);
      console.log(
        `Total Lines Changed: ${results.summary.totalLinesChanged.toLocaleString()}`
      );
      console.log(
        `Overall Average Lines Per Commit: ${results.summary.overallAverageLinesPerCommit}`
      );

      // Display top users
      if (results.userMetrics.length > 0) {
        console.log(chalk.blue("\n👥 Top Contributors by Commit Count:"));
        results.userMetrics.slice(0, 5).forEach((user, index) => {
          console.log(
            `${index + 1}. ${user.name} (${user.email}): ${
              user.totalCommits
            } commits, ${user.averageLinesPerCommit} avg lines/commit`
          );
        });
      }

      // Export results
      if (options.format === "csv") {
        await analyzer.exportToCsv(results, outputFilename);
      } else {
        await analyzer.exportToJson(results, outputFilename);
      }

      console.log(
        chalk.green(
          `\n✅ Analysis complete! Results saved to: ${outputFilename}`
        )
      );
    } catch (error) {
      console.error(chalk.red(`\n❌ Error: ${error.message}`));
      if (options.debug) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

program.parse();
