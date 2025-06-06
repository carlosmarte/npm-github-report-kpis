#!/usr/bin/env node

/*
JSON Report Structure:
{
  "repository": "owner/repo",
  "dateRange": {
    "start": "YYYY-MM-DD",
    "end": "YYYY-MM-DD"
  },
  "fetchedAt": "ISO_TIMESTAMP",
  "totalCommits": number,
  "totalContributors": number,
  "participation": [
    {
      "email": "user@example.com",
      "author": "username",
      "totalCommits": number,
      "totalAdditions": number,
      "totalDeletions": number,
      "firstCommit": "ISO_TIMESTAMP",
      "lastCommit": "ISO_TIMESTAMP",
      "commitsByWeek": [
        {
          "weekDate": "YYYY-MM-DD",
          "commits": number,
          "additions": number,
          "deletions": number
        }
      ]
    }
  ]
}

Use Cases:
- Team Productivity Analysis: Track commit frequency and patterns by user
- Code Quality Assessment: Monitor additions/deletions trends per contributor
- Collaboration Metrics: Analyze contributor participation over time periods
- Development Patterns: Identify working time distributions and commit patterns
- Process Improvements: Compare before/after periods for process changes
*/

import { writeFile } from "fs/promises";
import { program } from "commander";
import fetch from "node-fetch";

class GitHubParticipationAnalyzer {
  constructor(token, options = {}) {
    this.token = token;
    this.baseUrl = "https://api.github.com";
    this.rateLimit = {
      limit: 5000,
      remaining: 5000,
      resetTime: Date.now(),
    };

    this.isDebug = options.debug || false;
    this.isVerbose = options.verbose || false;
    this.fetchLimit = options.fetchLimit || 200;

    // Bind logging methods
    this.debug = this.debug.bind(this);
    this.verbose = this.verbose.bind(this);
    this.log = this.log.bind(this);
  }

  debug(message, ...args) {
    if (this.isDebug) {
      console.log(`🐛 DEBUG: ${message}`, ...args);
    }
  }

  verbose(message, ...args) {
    if (this.isVerbose || this.isDebug) {
      console.log(`ℹ️  VERBOSE: ${message}`, ...args);
    }
  }

  log(message, ...args) {
    console.log(message, ...args);
  }

  async delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  showProgressBar(message) {
    process.stdout.write(`🔄 ${message}...`);
    const spinner = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    let i = 0;

    const interval = setInterval(() => {
      process.stdout.write(`\r${spinner[i]} ${message}...`);
      i = (i + 1) % spinner.length;
    }, 100);

    return () => {
      clearInterval(interval);
      process.stdout.write(`\r✅ ${message} completed\n`);
    };
  }

  async makeRequest(url, retries = 3) {
    this.debug(`Making request to: ${url}`);

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        // Check rate limits
        if (
          this.rateLimit.remaining < 10 &&
          Date.now() < this.rateLimit.resetTime
        ) {
          const waitTime = this.rateLimit.resetTime - Date.now();
          this.verbose(`Rate limit low, waiting ${waitTime}ms`);
          await this.delay(waitTime);
        }

        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${this.token}`, // Fixed: Using Bearer format instead of token
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "GitHub-Participation-Analyzer/1.0",
          },
        });

        // Update rate limit info
        this.rateLimit.limit =
          parseInt(response.headers.get("x-ratelimit-limit")) || 5000;
        this.rateLimit.remaining =
          parseInt(response.headers.get("x-ratelimit-remaining")) || 5000;
        this.rateLimit.resetTime =
          parseInt(response.headers.get("x-ratelimit-reset")) * 1000 ||
          Date.now() + 3600000;

        this.debug(
          `Rate limit status: ${this.rateLimit.remaining}/${this.rateLimit.limit}`
        );

        if (response.status === 202) {
          this.verbose("API computing data, waiting...");
          await this.delay(2000);
          continue;
        }

        if (!response.ok) {
          if (response.status === 401) {
            throw new Error(
              "Authentication failed. Please check your GitHub token permissions and ensure it has repository access."
            );
          }
          if (response.status === 403) {
            const resetTime = new Date(this.rateLimit.resetTime);
            throw new Error(
              `Rate limit exceeded. Resets at ${resetTime.toISOString()}`
            );
          }
          if (response.status === 404) {
            throw new Error(
              "Repository not found. Please check the repository name and your access permissions."
            );
          }

          const errorText = await response.text();
          console.log(`Full error response: ${errorText}`); // Full error for debugging
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        this.debug(`Successfully fetched data from ${url}`);
        return data;
      } catch (error) {
        this.debug(`Attempt ${attempt} failed: ${error.message}`);

        if (attempt === retries) {
          throw error;
        }

        const backoffTime = Math.pow(2, attempt) * 1000;
        this.verbose(`Retrying in ${backoffTime}ms...`);
        await this.delay(backoffTime);
      }
    }
  }

  async getAllCommits(repo, owner, startDate, endDate) {
    const stopProgress = this.showProgressBar(
      "Fetching commits with user emails"
    );

    try {
      let allCommits = [];
      let page = 1;
      let hasMore = true;

      // Build query parameters
      const params = new URLSearchParams({
        per_page: "100",
        page: page.toString(),
      });

      if (startDate) {
        params.append("since", new Date(startDate).toISOString());
      }
      if (endDate) {
        params.append("until", new Date(endDate).toISOString());
      }

      while (
        hasMore &&
        (this.fetchLimit === "infinite" || allCommits.length < this.fetchLimit)
      ) {
        params.set("page", page.toString());
        const url = `${this.baseUrl}/repos/${owner}/${repo}/commits?${params}`;

        this.verbose(`Fetching page ${page} of commits`);
        const commits = await this.makeRequest(url);

        if (!commits || commits.length === 0) {
          hasMore = false;
          break;
        }

        // Process each commit to get detailed info including email
        for (const commit of commits) {
          if (
            this.fetchLimit !== "infinite" &&
            allCommits.length >= this.fetchLimit
          ) {
            hasMore = false;
            break;
          }

          try {
            // Get detailed commit info to access email
            const detailedCommit = await this.makeRequest(
              `${this.baseUrl}/repos/${owner}/${repo}/commits/${commit.sha}`
            );

            allCommits.push({
              sha: commit.sha,
              author: {
                name: detailedCommit.commit.author.name,
                email: detailedCommit.commit.author.email,
                username: detailedCommit.author?.login || "unknown",
              },
              committer: {
                name: detailedCommit.commit.committer.name,
                email: detailedCommit.commit.committer.email,
                username: detailedCommit.committer?.login || "unknown",
              },
              message: detailedCommit.commit.message,
              date: detailedCommit.commit.author.date,
              stats: detailedCommit.stats || {
                additions: 0,
                deletions: 0,
                total: 0,
              },
              url: detailedCommit.html_url,
            });

            // Add small delay to avoid hitting rate limits too hard
            await this.delay(50);
          } catch (error) {
            this.debug(
              `Failed to fetch detailed commit ${commit.sha}: ${error.message}`
            );
            // Continue with basic info if detailed fetch fails
            allCommits.push({
              sha: commit.sha,
              author: {
                name: commit.commit.author.name,
                email: commit.commit.author.email,
                username: commit.author?.login || "unknown",
              },
              committer: {
                name: commit.commit.committer.name,
                email: commit.commit.committer.email,
                username: commit.committer?.login || "unknown",
              },
              message: commit.commit.message,
              date: commit.commit.author.date,
              stats: { additions: 0, deletions: 0, total: 0 },
              url: commit.html_url,
            });
          }
        }

        page++;

        // GitHub API typically returns 30 items per page by default, 100 max
        if (commits.length < 100) {
          hasMore = false;
        }
      }

      stopProgress();
      this.verbose(`Fetched ${allCommits.length} commits total`);
      return allCommits;
    } catch (error) {
      stopProgress();
      throw error;
    }
  }

  async analyzeParticipation(repo, owner, startDate, endDate, token) {
    this.token = token; // Update token if provided

    try {
      // Fetch all commits with detailed information
      const commits = await this.getAllCommits(repo, owner, startDate, endDate);

      // Group commits by user email
      const participationMap = new Map();

      commits.forEach((commit) => {
        const email = commit.author.email;
        const username = commit.author.username;
        const commitDate = new Date(commit.date);

        if (!participationMap.has(email)) {
          participationMap.set(email, {
            email: email,
            author: username,
            totalCommits: 0,
            totalAdditions: 0,
            totalDeletions: 0,
            firstCommit: commitDate,
            lastCommit: commitDate,
            commitsByWeek: new Map(),
          });
        }

        const userStats = participationMap.get(email);
        userStats.totalCommits++;
        userStats.totalAdditions += commit.stats.additions || 0;
        userStats.totalDeletions += commit.stats.deletions || 0;

        // Update first/last commit dates
        if (commitDate < userStats.firstCommit) {
          userStats.firstCommit = commitDate;
        }
        if (commitDate > userStats.lastCommit) {
          userStats.lastCommit = commitDate;
        }

        // Group by week
        const weekStart = this.getWeekStart(commitDate);
        const weekKey = weekStart.toISOString().split("T")[0];

        if (!userStats.commitsByWeek.has(weekKey)) {
          userStats.commitsByWeek.set(weekKey, {
            weekDate: weekKey,
            commits: 0,
            additions: 0,
            deletions: 0,
          });
        }

        const weekStats = userStats.commitsByWeek.get(weekKey);
        weekStats.commits++;
        weekStats.additions += commit.stats.additions || 0;
        weekStats.deletions += commit.stats.deletions || 0;
      });

      // Convert to array and sort by total commits
      const participation = Array.from(participationMap.values())
        .map((user) => ({
          ...user,
          firstCommit: user.firstCommit.toISOString(),
          lastCommit: user.lastCommit.toISOString(),
          commitsByWeek: Array.from(user.commitsByWeek.values()).sort(
            (a, b) => new Date(a.weekDate) - new Date(b.weekDate)
          ),
        }))
        .sort((a, b) => b.totalCommits - a.totalCommits);

      return {
        repository: `${owner}/${repo}`,
        dateRange: {
          start: startDate || "beginning",
          end: endDate || "present",
        },
        fetchedAt: new Date().toISOString(),
        totalCommits: commits.length,
        totalContributors: participation.length,
        participation: participation,
      };
    } catch (error) {
      console.log(`Full error details: ${error.message}`); // Full error logging

      // Friendly error messages for common issues
      if (error.message.includes("Authentication failed")) {
        throw new Error(
          "❌ Authentication failed. Please ensure your GitHub token has proper repository access permissions."
        );
      } else if (error.message.includes("Rate limit exceeded")) {
        throw new Error(
          "❌ GitHub API rate limit exceeded. Please wait and try again later."
        );
      } else if (error.message.includes("Repository not found")) {
        throw new Error(
          "❌ Repository not found. Please check the repository name and your access permissions."
        );
      }

      throw error;
    }
  }

  getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day; // Get Monday
    return new Date(d.setDate(diff));
  }

  formatAsCSV(data) {
    let csvContent =
      "Email,Author,Total Commits,Total Additions,Total Deletions,First Commit,Last Commit\n";

    data.participation.forEach((user) => {
      csvContent += `"${user.email}","${user.author}",${user.totalCommits},${user.totalAdditions},${user.totalDeletions},"${user.firstCommit}","${user.lastCommit}"\n`;
    });

    return csvContent;
  }

  async saveOutput(data, filename, format) {
    if (format === "csv") {
      const csvData = this.formatAsCSV(data);
      await writeFile(filename, csvData, "utf8");
    } else {
      await writeFile(filename, JSON.stringify(data, null, 2), "utf8");
    }

    this.log(`📄 Output saved to: ${filename}`);
  }
}

function parseRepoArg(repoArg) {
  const parts = repoArg.split("/");
  if (parts.length !== 2) {
    throw new Error('Repository must be in format "owner/repo"');
  }
  return { owner: parts[0], repo: parts[1] };
}

function generateFilename(owner, repo, format, dateRange) {
  const timestamp = new Date().toISOString().split("T")[0];
  const dateStr =
    dateRange.start && dateRange.end
      ? `_${dateRange.start}_to_${dateRange.end}`
      : dateRange.start
      ? `_from_${dateRange.start}`
      : "";
  return `${owner}-${repo}-participation${dateStr}_${timestamp}.${format}`;
}

async function main() {
  program
    .name("github-participation-analyzer")
    .description("Analyze GitHub repository participation by user email")
    .version("1.0.0")
    .requiredOption(
      "-r, --repo <owner/repo>",
      "Repository to analyze (format: owner/repo)"
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
      (() => {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        return thirtyDaysAgo.toISOString().split("T")[0];
      })()
    )
    .option(
      "-e, --end <date>",
      "End date (ISO format: YYYY-MM-DD)",
      new Date().toISOString().split("T")[0]
    )
    .option("-t, --token <token>", "GitHub token (or use GITHUB_TOKEN env var)")
    .option("-v, --verbose", "Enable verbose logging")
    .option("-d, --debug", "Enable debug logging")
    .option(
      "-l, --fetchLimit <limit>",
      "Set fetch limit (default: 200, use 'infinite' for no limit)",
      "200"
    )
    .parse();

  const options = program.opts();

  try {
    // Get GitHub token
    const token = options.token || process.env.GITHUB_TOKEN;
    if (!token) {
      console.error(
        "❌ GitHub token required. Use --token or set GITHUB_TOKEN environment variable"
      );
      console.error(
        "💡 You can create a token at: https://github.com/settings/tokens"
      );
      process.exit(1);
    }

    // Parse repository
    const { owner, repo } = parseRepoArg(options.repo);

    // Validate date range
    if (options.start && options.end) {
      const startDate = new Date(options.start);
      const endDate = new Date(options.end);
      if (startDate > endDate) {
        console.error("❌ Start date must be before end date");
        process.exit(1);
      }
    }

    // Parse fetch limit
    const fetchLimit =
      options.fetchLimit === "infinite"
        ? "infinite"
        : parseInt(options.fetchLimit);
    if (fetchLimit !== "infinite" && (isNaN(fetchLimit) || fetchLimit <= 0)) {
      console.error("❌ Fetch limit must be a positive number or 'infinite'");
      process.exit(1);
    }

    // Initialize analyzer
    const analyzer = new GitHubParticipationAnalyzer(token, {
      debug: options.debug,
      verbose: options.verbose,
      fetchLimit: fetchLimit,
    });

    console.log(`🔍 Analyzing participation for ${owner}/${repo}`);
    console.log(`📅 Date range: ${options.start} to ${options.end}`);
    console.log(
      `📊 Fetch limit: ${
        fetchLimit === "infinite" ? "No limit" : fetchLimit
      } commits`
    );

    // Analyze participation
    const data = await analyzer.analyzeParticipation(
      repo,
      owner,
      options.start,
      options.end,
      token
    );

    // Generate filename if not provided
    const dateRange = { start: options.start, end: options.end };
    const filename =
      options.output ||
      generateFilename(owner, repo, options.format, dateRange);

    // Save output
    await analyzer.saveOutput(data, filename, options.format);

    // Display summary
    console.log(`\n📊 Participation Summary:`);
    console.log(`   Repository: ${data.repository}`);
    console.log(
      `   Date Range: ${data.dateRange.start} to ${data.dateRange.end}`
    );
    console.log(`   Total Commits: ${data.totalCommits}`);
    console.log(`   Total Contributors: ${data.totalContributors}`);
    console.log(`\n👥 Top 5 Contributors by Commits:`);

    data.participation.slice(0, 5).forEach((contributor, index) => {
      console.log(
        `   ${index + 1}. ${contributor.email} (${contributor.author}): ${
          contributor.totalCommits
        } commits`
      );
    });

    console.log(`\n🎉 Analysis complete! Report saved to: ${filename}`);
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    if (options.debug) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run the CLI
main().catch((error) => {
  console.error("❌ Unexpected error:", error.message);
  process.exit(1);
});
