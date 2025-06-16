#!/usr/bin/env node

/*
JSON Report Structure:
{
  "repository": {
    "owner": "string",
    "name": "string", 
    "analysis_period": {
      "start_date": "YYYY-MM-DD",
      "end_date": "YYYY-MM-DD"
    }
  },
  "summary": {
    "total_commits": number,
    "total_contributors": number,
    "total_lines_added": number,
    "total_lines_deleted": number,
    "average_lines_per_commit": number
  },
  "contributors": [
    {
      "email": "string",
      "name": "string",
      "commits_count": number,
      "total_lines_added": number,
      "total_lines_deleted": number,
      "average_lines_per_commit": number,
      "percentage_of_total_commits": number
    }
  ],
  "insights": {
    "most_active_contributor": "string",
    "largest_average_commit_size": "string",
    "commit_frequency_per_day": number
  }
}

Use Cases:
- Team Productivity Analysis: Track commit frequency and patterns
- Code Quality Assessment: Monitor additions/deletions trends  
- Collaboration Metrics: Analyze contributor participation
- Development Patterns: Identify working time distributions
- Process Improvements: Compare before/after periods for process changes
*/

import { writeFileSync } from "fs";
import { performance } from "perf_hooks";

class GitHubAnalyzer {
  constructor(token, options = {}) {
    this.token = token;
    this.baseUrl = "https://api.github.com";
    this.verbose = options.verbose || false;
    this.debug = options.debug || false;
    this.fetchLimit = options.fetchLimit || 200;
    this.retryAttempts = 3;
    this.retryDelay = 1000;
  }

  async analyzeRepo(owner, repo, startDate, endDate) {
    this.log(`Starting analysis for ${owner}/${repo}`, "info");
    this.log(`Date range: ${startDate} to ${endDate}`, "info");

    const startTime = performance.now();

    try {
      const commits = await this.fetchCommits(owner, repo, startDate, endDate);
      this.log(`Fetched ${commits.length} commits`, "info");

      const detailedCommits = await this.fetchCommitDetails(
        owner,
        repo,
        commits
      );
      const analysis = this.analyzeCommitData(
        detailedCommits,
        startDate,
        endDate
      );

      const endTime = performance.now();
      this.log(
        `Analysis completed in ${((endTime - startTime) / 1000).toFixed(
          2
        )} seconds`,
        "info"
      );

      return {
        repository: {
          owner,
          name: repo,
          analysis_period: {
            start_date: startDate,
            end_date: endDate,
          },
        },
        ...analysis,
      };
    } catch (error) {
      this.log(`Analysis failed: ${error.message}`, "error");
      throw error;
    }
  }

  async fetchWithRetry(url, options = {}) {
    const headers = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "GitHub-Analytics-CLI",
      ...options.headers,
    };

    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        this.log(`Fetching: ${url} (attempt ${attempt})`, "debug");

        const response = await fetch(url, { ...options, headers });

        if (response.status === 401) {
          throw new Error(
            "Authentication failed. GitHub API now requires Bearer token format. Please check your GitHub token permissions and ensure it's properly formatted."
          );
        }

        if (response.status === 403) {
          const resetTime = response.headers.get("X-RateLimit-Reset");
          const remaining = response.headers.get("X-RateLimit-Remaining");

          if (remaining === "0" && resetTime) {
            const resetDate = new Date(parseInt(resetTime) * 1000);
            throw new Error(
              `Rate limit exceeded. The request might be hitting rate limits. Limit resets at ${resetDate.toISOString()}. Please wait before retrying.`
            );
          }

          throw new Error(
            "API access forbidden. The token might lack proper repository access scopes. Please ensure your token has 'repo' permissions for private repositories or 'public_repo' for public ones."
          );
        }

        if (response.status === 404) {
          throw new Error(
            "Repository not found or you do not have access to it. Please verify the repository name and your token permissions."
          );
        }

        if (!response.ok) {
          throw new Error(
            `API request failed with HTTP ${response.status}: ${response.statusText}. The request might be using incorrect headers or hitting an invalid endpoint.`
          );
        }

        const data = await response.json();
        return { data, headers: response.headers };
      } catch (error) {
        this.log(`Attempt ${attempt} failed: ${error.message}`, "debug");

        if (attempt === this.retryAttempts) {
          throw error;
        }

        // Don't retry auth, rate limit, or permission errors
        if (
          error.message.includes("Authentication") ||
          error.message.includes("Rate limit") ||
          error.message.includes("forbidden") ||
          error.message.includes("not found")
        ) {
          throw error;
        }

        await new Promise((resolve) =>
          setTimeout(resolve, this.retryDelay * attempt)
        );
      }
    }
  }

  async fetchCommits(owner, repo, startDate, endDate) {
    const commits = [];
    let page = 1;
    let hasMore = true;
    let fetchedCount = 0;
    let progressBar = "";

    this.log("Fetching commits...", "info");

    while (
      hasMore &&
      (this.fetchLimit === -1 || fetchedCount < this.fetchLimit)
    ) {
      const url = `${this.baseUrl}/repos/${owner}/${repo}/commits?since=${startDate}T00:00:00Z&until=${endDate}T23:59:59Z&page=${page}&per_page=100`;

      const { data } = await this.fetchWithRetry(url);

      if (data.length === 0) {
        hasMore = false;
      } else {
        commits.push(...data);
        fetchedCount += data.length;
        page++;

        // Simple progress indicator
        const dots = ".".repeat((fetchedCount / 50) % 4);
        process.stdout.write(`\r📥 Fetched ${fetchedCount} commits${dots}   `);

        if (this.fetchLimit !== -1 && fetchedCount >= this.fetchLimit) {
          hasMore = false;
          this.log(
            `\n⚠️  Reached fetch limit of ${this.fetchLimit} commits`,
            "info"
          );
        }
      }
    }

    process.stdout.write("\n");
    return commits;
  }

  async fetchCommitDetails(owner, repo, commits) {
    const detailedCommits = [];
    const total = Math.min(
      commits.length,
      this.fetchLimit === -1 ? commits.length : this.fetchLimit
    );

    this.log("Fetching detailed commit stats...", "info");

    for (let i = 0; i < total; i++) {
      const commit = commits[i];
      try {
        const url = `${this.baseUrl}/repos/${owner}/${repo}/commits/${commit.sha}`;
        const { data } = await this.fetchWithRetry(url);

        detailedCommits.push({
          sha: data.sha,
          author: {
            name: data.commit.author.name,
            email: data.commit.author.email,
            date: data.commit.author.date,
          },
          message: data.commit.message,
          stats: data.stats || { additions: 0, deletions: 0, total: 0 },
        });

        // Simple progress bar
        const progress = Math.round(((i + 1) / total) * 20);
        const bar = "█".repeat(progress) + "░".repeat(20 - progress);
        process.stdout.write(
          `\r📊 [${bar}] ${i + 1}/${total} commits processed`
        );
      } catch (error) {
        this.log(
          `Failed to fetch details for commit ${commit.sha}: ${error.message}`,
          "debug"
        );
        // Include commit with zero stats if details fetch fails
        detailedCommits.push({
          sha: commit.sha,
          author: {
            name: commit.commit.author.name,
            email: commit.commit.author.email,
            date: commit.commit.author.date,
          },
          message: commit.commit.message,
          stats: { additions: 0, deletions: 0, total: 0 },
        });
      }
    }

    process.stdout.write("\n");
    return detailedCommits;
  }

  analyzeCommitData(commits, startDate, endDate) {
    this.log("Analyzing commit data...", "info");

    const contributors = new Map();
    let totalLinesAdded = 0;
    let totalLinesDeleted = 0;

    commits.forEach((commit) => {
      const email = commit.author.email;
      const stats = commit.stats;

      if (!contributors.has(email)) {
        contributors.set(email, {
          email,
          name: commit.author.name,
          commits_count: 0,
          total_lines_added: 0,
          total_lines_deleted: 0,
          commits: [],
        });
      }

      const contributor = contributors.get(email);
      contributor.commits_count++;
      contributor.total_lines_added += stats.additions;
      contributor.total_lines_deleted += stats.deletions;
      contributor.commits.push(commit);

      totalLinesAdded += stats.additions;
      totalLinesDeleted += stats.deletions;
    });

    // Calculate averages and additional metrics
    const contributorsArray = Array.from(contributors.values()).map(
      (contributor) => {
        const avgLinesPerCommit =
          contributor.commits_count > 0
            ? Math.round(
                (contributor.total_lines_added +
                  contributor.total_lines_deleted) /
                  contributor.commits_count
              )
            : 0;

        return {
          email: contributor.email,
          name: contributor.name,
          commits_count: contributor.commits_count,
          total_lines_added: contributor.total_lines_added,
          total_lines_deleted: contributor.total_lines_deleted,
          average_lines_per_commit: avgLinesPerCommit,
          percentage_of_total_commits:
            commits.length > 0
              ? Math.round(
                  (contributor.commits_count / commits.length) * 100 * 100
                ) / 100
              : 0,
        };
      }
    );

    // Sort by commits count descending
    contributorsArray.sort((a, b) => b.commits_count - a.commits_count);

    const totalLines = totalLinesAdded + totalLinesDeleted;
    const avgLinesPerCommit =
      commits.length > 0 ? Math.round(totalLines / commits.length) : 0;

    // Calculate insights
    const mostActiveContributor =
      contributorsArray.length > 0 ? contributorsArray[0].email : null;
    const largestAvgCommitContributor = contributorsArray.reduce(
      (max, current) =>
        current.average_lines_per_commit > (max?.average_lines_per_commit || 0)
          ? current
          : max,
      null
    );

    const dateRange =
      new Date(endDate).getTime() - new Date(startDate).getTime();
    const daysInRange = Math.ceil(dateRange / (1000 * 60 * 60 * 24));
    const commitFrequencyPerDay =
      daysInRange > 0
        ? Math.round((commits.length / daysInRange) * 100) / 100
        : 0;

    return {
      summary: {
        total_commits: commits.length,
        total_contributors: contributors.size,
        total_lines_added: totalLinesAdded,
        total_lines_deleted: totalLinesDeleted,
        average_lines_per_commit: avgLinesPerCommit,
      },
      contributors: contributorsArray,
      insights: {
        most_active_contributor: mostActiveContributor,
        largest_average_commit_size: largestAvgCommitContributor?.email || null,
        commit_frequency_per_day: commitFrequencyPerDay,
      },
    };
  }

  log(message, level = "info") {
    const timestamp = new Date().toISOString();

    if (level === "debug" && !this.debug) return;
    if (level === "info" && !this.verbose && !this.debug) return;

    const prefix = level === "error" ? "❌" : level === "debug" ? "🔍" : "ℹ️";
    console.log(`${prefix} [${timestamp}] ${message}`);
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
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
        options.fetchLimit =
          limit === "infinite" || limit === "-1" ? -1 : parseInt(limit);
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
🚀 GitHub Repository Analytics CLI

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
  -l, --fetchLimit                Set a fetch limit of 200, but user can change to infinite
  -h, --help                      Show help message

Examples:
  node main.mjs -r microsoft/vscode -s 2024-01-01 -e 2024-01-31 -v
  node main.mjs -r facebook/react -f csv -o react-analysis.csv
  node main.mjs -r owner/repo -l infinite -d

Environment Variables:
  GITHUB_TOKEN                    GitHub personal access token

Reports Generated:
  📊 Average lines of code per commit breakdown per user email
  📈 Total repository insights and contributor analysis
  🎯 Team productivity and collaboration metrics
`);
}

function formatAsCSV(data) {
  const lines = [];

  // Header
  lines.push(
    "Repository,Analysis Period,Email,Name,Commits Count,Total Lines Added,Total Lines Deleted,Average Lines Per Commit,Percentage of Total Commits"
  );

  // Data rows
  data.contributors.forEach((contributor) => {
    const row = [
      `${data.repository.owner}/${data.repository.name}`,
      `${data.repository.analysis_period.start_date} to ${data.repository.analysis_period.end_date}`,
      contributor.email,
      contributor.name,
      contributor.commits_count,
      contributor.total_lines_added,
      contributor.total_lines_deleted,
      contributor.average_lines_per_commit,
      contributor.percentage_of_total_commits,
    ].map((field) => `"${field}"`);

    lines.push(row.join(","));
  });

  return lines.join("\n");
}

async function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    return;
  }

  // Validate required parameters
  if (!options.repo) {
    console.error("❌ Error: Repository (-r, --repo) is required");
    showHelp();
    process.exit(1);
  }

  const [owner, repo] = options.repo.split("/");
  if (!owner || !repo) {
    console.error('❌ Error: Repository must be in format "owner/repo"');
    process.exit(1);
  }

  // Set defaults
  const token = options.token || process.env.GITHUB_TOKEN;
  if (!token) {
    console.error(
      "❌ Error: GitHub token is required. Set GITHUB_TOKEN environment variable or use -t flag"
    );
    process.exit(1);
  }

  const endDate = options.end || new Date().toISOString().split("T")[0];
  const startDate =
    options.start ||
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const format = options.format || "json";
  const fetchLimit =
    options.fetchLimit !== undefined ? options.fetchLimit : 200;

  console.log(`🚀 Starting GitHub Repository Analysis for ${owner}/${repo}`);
  console.log(`📅 Date Range: ${startDate} to ${endDate}`);
  console.log(`📊 Output Format: ${format.toUpperCase()}`);
  console.log(
    `🔢 Fetch Limit: ${fetchLimit === -1 ? "Unlimited" : fetchLimit}`
  );

  try {
    const analyzer = new GitHubAnalyzer(token, {
      verbose: options.verbose,
      debug: options.debug,
      fetchLimit: fetchLimit,
    });

    const analysis = await analyzer.analyzeRepo(
      owner,
      repo,
      startDate,
      endDate
    );

    // Generate output
    let outputContent;
    let fileExtension;

    if (format === "csv") {
      outputContent = formatAsCSV(analysis);
      fileExtension = "csv";
    } else {
      outputContent = JSON.stringify(analysis, null, 2);
      fileExtension = "json";
    }

    const outputFilename =
      options.output ||
      `${owner}-${repo}-analysis-${startDate}-to-${endDate}.${fileExtension}`;

    writeFileSync(outputFilename, outputContent);
    console.log(`✅ Analysis complete! Results saved to: ${outputFilename}`);

    // Display summary
    console.log("\n📈 Summary:");
    console.log(`   Total Commits: ${analysis.summary.total_commits}`);
    console.log(`   Contributors: ${analysis.summary.total_contributors}`);
    console.log(
      `   Average Lines per Commit: ${analysis.summary.average_lines_per_commit}`
    );
    console.log(
      `   Most Active Contributor: ${analysis.insights.most_active_contributor}`
    );
    console.log(
      `   Commit Frequency per Day: ${analysis.insights.commit_frequency_per_day}`
    );
  } catch (error) {
    console.error("\n❌ Analysis failed:");
    console.error(`   ${error.message}`);

    if (options.debug) {
      console.error("\n🔍 Full error details:");
      console.error(error);
    }

    process.exit(1);
  }
}

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
