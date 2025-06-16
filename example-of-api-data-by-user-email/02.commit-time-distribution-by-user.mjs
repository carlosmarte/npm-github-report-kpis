#!/usr/bin/env node

import fs from "fs/promises";
import path from "path";
import { performance } from "perf_hooks";

/*
JSON Report Structure:
{
  "repository": "owner/repo",
  "analysis_date": "2024-01-15T10:30:00.000Z",
  "date_range": {
    "start": "2024-01-01",
    "end": "2024-01-31",
    "note": "Date filtering applied to commit data"
  },
  "commit_time_distribution_by_user": {
    "user@example.com": {
      "total_commits": 150,
      "punch_card_data": [
        {
          "day_of_week": 1,
          "day_name": "Monday",
          "hour": 9,
          "hour_label": "9:00 AM",
          "commits": 5,
          "is_business_hours": true,
          "is_weekend": false
        }
      ],
      "summary": {
        "business_hours_percentage": 75,
        "weekend_percentage": 15,
        "peak_activity": {
          "hour": { "time": "10:00 AM", "day": "Tuesday", "commits": 8 },
          "day": { "day": "Wednesday", "commits": 25 }
        },
        "working_patterns": {
          "early_bird": { "commits": 20, "percentage": 13 },
          "traditional": { "commits": 100, "percentage": 67 },
          "evening": { "commits": 25, "percentage": 17 },
          "night_owl": { "commits": 5, "percentage": 3 }
        }
      }
    }
  },
  "overall_summary": {
    "total_users": 5,
    "total_commits": 750,
    "average_commits_per_user": 150,
    "most_active_user": "user@example.com",
    "team_working_patterns": {...}
  },
  "metadata": {
    "total_commits_fetched": 750,
    "analysis_duration_ms": 5000,
    "api_rate_limit_remaining": 4500,
    "fetch_limit_applied": 200
  }
}

Use Cases:
1. Team Productivity Analysis: Track commit frequency and patterns across team members
2. Code Quality Assessment: Monitor additions/deletions trends by developer
3. Collaboration Metrics: Analyze contributor participation and timing
4. Development Patterns: Identify working time distributions across the team
5. Process Improvements: Compare before/after periods for process changes
6. Resource Planning: Understand when team members are most active
7. Work-Life Balance: Monitor after-hours and weekend commit patterns
8. Time Zone Analysis: Identify global team coordination patterns
*/

class GitHubCommitAnalyzer {
  constructor(options = {}) {
    this.baseUrl = "https://api.github.com";
    this.options = {
      verbose: false,
      debug: false,
      retryCount: 3,
      retryDelay: 1000,
      fetchLimit: 200,
      ...options,
    };
    this.rateLimitRemaining = 5000;
    this.rateLimitReset = null;
    this.progressBar = null;
  }

  log(message, level = "info") {
    const timestamp = new Date().toISOString();
    const levels = {
      debug: this.options.debug,
      verbose: this.options.verbose || this.options.debug,
      info: true,
      warn: true,
      error: true,
    };

    if (levels[level]) {
      const prefix =
        level === "error"
          ? "❌"
          : level === "warn"
          ? "⚠️"
          : level === "debug"
          ? "🔍"
          : "📊";
      console.log(`${prefix} [${timestamp}] ${message}`);
    }
  }

  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  showProgress(current, total, message) {
    if (!this.options.verbose) return;

    const percentage = Math.round((current / total) * 100);
    const filled = Math.round((current / total) * 20);
    const empty = 20 - filled;
    const bar = "█".repeat(filled) + "░".repeat(empty);

    process.stdout.write(
      `\r🔄 ${message} [${bar}] ${percentage}% (${current}/${total})`
    );

    if (current === total) {
      process.stdout.write("\n");
    }
  }

  async makeRequest(url, retryCount = 0, token) {
    try {
      this.log(`Making request to: ${url}`, "debug");

      // Check rate limit
      if (this.rateLimitRemaining < 10 && this.rateLimitReset) {
        const waitTime = this.rateLimitReset - Date.now();
        if (waitTime > 0) {
          this.log(
            `Rate limit approaching, waiting ${Math.ceil(waitTime / 1000)}s...`,
            "warn"
          );
          await this.sleep(waitTime);
        }
      }

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`, // Updated to Bearer format
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "GitHub-Commit-Analyzer/1.0.0",
          "X-GitHub-Api-Version": "2022-11-28", // Added API version header
        },
      });

      // Update rate limit info
      this.rateLimitRemaining = parseInt(
        response.headers.get("X-RateLimit-Remaining") || "5000"
      );
      this.rateLimitReset =
        parseInt(response.headers.get("X-RateLimit-Reset")) * 1000;

      this.log(`Rate limit remaining: ${this.rateLimitRemaining}`, "debug");

      if (!response.ok) {
        const errorBody = await response.text();
        this.log(`API Error Response: ${errorBody}`, "debug");

        // Handle authentication errors specifically
        if (response.status === 401) {
          throw new Error(
            `Authentication failed. Please check your GitHub token permissions. Make sure the token has 'repo' scope for private repositories or 'public_repo' for public repositories.`
          );
        }

        if (response.status === 403) {
          const errorMessage =
            JSON.parse(errorBody || "{}").message || "Forbidden";
          if (errorMessage.includes("rate limit")) {
            if (retryCount < this.options.retryCount) {
              const retryAfter =
                parseInt(response.headers.get("Retry-After") || "60") * 1000;
              this.log(
                `Rate limited, retrying after ${retryAfter / 1000}s (attempt ${
                  retryCount + 1
                }/${this.options.retryCount})`,
                "warn"
              );
              await this.sleep(retryAfter);
              return this.makeRequest(url, retryCount + 1, token);
            }
          }
          throw new Error(
            `Access forbidden: ${errorMessage}. Check if the repository exists and your token has proper permissions.`
          );
        }

        if (response.status === 404) {
          throw new Error(
            `Repository not found. Please verify the repository name and your access permissions.`
          );
        }

        if (response.status >= 500 && retryCount < this.options.retryCount) {
          const delay = this.options.retryDelay * Math.pow(2, retryCount);
          this.log(
            `Server error (${
              response.status
            }), retrying in ${delay}ms (attempt ${retryCount + 1}/${
              this.options.retryCount
            })`,
            "warn"
          );
          await this.sleep(delay);
          return this.makeRequest(url, retryCount + 1, token);
        }

        throw new Error(
          `GitHub API error: ${response.status} ${response.statusText} - ${errorBody}`
        );
      }

      return await response.json();
    } catch (error) {
      if (
        retryCount < this.options.retryCount &&
        (error.code === "ECONNRESET" ||
          error.code === "ETIMEDOUT" ||
          error.name === "AbortError" ||
          error.message.includes("fetch"))
      ) {
        const delay = this.options.retryDelay * Math.pow(2, retryCount);
        this.log(
          `Network error (${error.message}), retrying in ${delay}ms (attempt ${
            retryCount + 1
          }/${this.options.retryCount})`,
          "warn"
        );
        await this.sleep(delay);
        return this.makeRequest(url, retryCount + 1, token);
      }
      throw error;
    }
  }

  async fetchCommitTimeDistributionByUser(
    repo,
    owner,
    startDate,
    endDate,
    token
  ) {
    const startTime = performance.now();

    this.log(
      `Analyzing commit time distribution by user for ${owner}/${repo}`,
      "info"
    );
    this.log(
      `Date range: ${startDate || "30 days ago"} to ${endDate || "present"}`,
      "verbose"
    );

    try {
      // Set default dates if not provided
      const end = endDate ? new Date(endDate) : new Date();
      const start = startDate
        ? new Date(startDate)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      this.log(
        `Fetching commits from ${start.toISOString()} to ${end.toISOString()}`,
        "verbose"
      );

      // Fetch commits with pagination
      const commits = await this.fetchAllCommits(
        owner,
        repo,
        start,
        end,
        token
      );

      if (commits.length === 0) {
        throw new Error("No commits found in the specified date range.");
      }

      this.log(`Found ${commits.length} commits to analyze`, "info");

      // Group commits by user email and analyze time distribution
      const userCommitDistribution = this.analyzeCommitsByUser(commits);

      // Generate overall summary
      const overallSummary = this.generateOverallSummary(
        userCommitDistribution
      );

      const endTime = performance.now();
      this.log(
        `Analysis completed in ${Math.round(endTime - startTime)}ms`,
        "debug"
      );

      return {
        repository: `${owner}/${repo}`,
        analysis_date: new Date().toISOString(),
        date_range: {
          start: start.toISOString().split("T")[0],
          end: end.toISOString().split("T")[0],
          note: "Date filtering applied to commit data",
        },
        commit_time_distribution_by_user: userCommitDistribution,
        overall_summary: overallSummary,
        metadata: {
          total_commits_fetched: commits.length,
          analysis_duration_ms: Math.round(endTime - startTime),
          api_rate_limit_remaining: this.rateLimitRemaining,
          fetch_limit_applied: this.options.fetchLimit,
        },
      };
    } catch (error) {
      this.log(
        `Error fetching commit time distribution: ${error.message}`,
        "error"
      );
      console.error(`Full error details: ${error.message}`);
      throw error;
    }
  }

  async fetchAllCommits(owner, repo, startDate, endDate, token) {
    let allCommits = [];
    let page = 1;
    const perPage = 100;
    let totalFetched = 0;

    this.log("Starting commit fetch with pagination...", "verbose");

    while (totalFetched < this.options.fetchLimit) {
      const url = `${
        this.baseUrl
      }/repos/${owner}/${repo}/commits?per_page=${perPage}&page=${page}&since=${startDate.toISOString()}&until=${endDate.toISOString()}`;

      this.showProgress(
        totalFetched,
        this.options.fetchLimit,
        "Fetching commits"
      );

      const commits = await this.makeRequest(url, 0, token);

      if (commits.length === 0) {
        this.log("No more commits found, stopping pagination", "verbose");
        break;
      }

      allCommits.push(...commits);
      totalFetched += commits.length;
      page++;

      this.log(
        `Fetched page ${page - 1}: ${
          commits.length
        } commits (total: ${totalFetched})`,
        "debug"
      );

      // Check if we've reached our limit
      if (totalFetched >= this.options.fetchLimit) {
        this.log(
          `Reached fetch limit of ${this.options.fetchLimit} commits`,
          "warn"
        );
        allCommits = allCommits.slice(0, this.options.fetchLimit);
        break;
      }

      // Small delay to be nice to the API
      await this.sleep(100);
    }

    if (this.options.verbose) {
      process.stdout.write("\n");
    }

    this.log(`Total commits fetched: ${allCommits.length}`, "info");
    return allCommits;
  }

  analyzeCommitsByUser(commits) {
    const userStats = {};

    commits.forEach((commit) => {
      if (!commit.commit || !commit.commit.author) return;

      const email = commit.commit.author.email;
      const date = new Date(commit.commit.author.date);

      if (!userStats[email]) {
        userStats[email] = {
          total_commits: 0,
          punch_card_data: Array(7)
            .fill(null)
            .map(() => Array(24).fill(0)),
          commits_by_date: [],
        };
      }

      userStats[email].total_commits++;
      userStats[email].commits_by_date.push(date);

      const dayOfWeek = date.getDay();
      const hour = date.getHours();
      userStats[email].punch_card_data[dayOfWeek][hour]++;
    });

    // Transform punch card data and generate summaries
    const result = {};
    Object.entries(userStats).forEach(([email, stats]) => {
      const punchCardFormatted = this.formatPunchCardData(
        stats.punch_card_data
      );
      const summary = this.generateUserSummary(punchCardFormatted);

      result[email] = {
        total_commits: stats.total_commits,
        punch_card_data: punchCardFormatted,
        summary: summary,
      };
    });

    return result;
  }

  formatPunchCardData(punchCardData) {
    const dayNames = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];

    const formatted = [];
    for (let day = 0; day < 7; day++) {
      for (let hour = 0; hour < 24; hour++) {
        if (punchCardData[day][hour] > 0) {
          formatted.push({
            day_of_week: day,
            day_name: dayNames[day],
            hour: hour,
            hour_label: this.formatHour(hour),
            commits: punchCardData[day][hour],
            is_business_hours: this.isBusinessHours(day, hour),
            is_weekend: day === 0 || day === 6,
          });
        }
      }
    }

    return formatted;
  }

  formatHour(hour) {
    const period = hour < 12 ? "AM" : "PM";
    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return `${displayHour}:00 ${period}`;
  }

  isBusinessHours(day, hour) {
    // Monday-Friday (1-5), 9 AM - 5 PM (9-17)
    return day >= 1 && day <= 5 && hour >= 9 && hour <= 17;
  }

  generateUserSummary(punchCardData) {
    const totalCommits = punchCardData.reduce(
      (sum, item) => sum + item.commits,
      0
    );
    const businessHoursCommits = punchCardData
      .filter((item) => item.is_business_hours)
      .reduce((sum, item) => sum + item.commits, 0);
    const weekendCommits = punchCardData
      .filter((item) => item.is_weekend)
      .reduce((sum, item) => sum + item.commits, 0);

    // Find peak activity periods
    const peakHour = punchCardData.reduce(
      (max, item) => (item.commits > max.commits ? item : max),
      { commits: 0 }
    );

    const peakDay = this.getPeakDay(punchCardData);

    return {
      business_hours_percentage:
        totalCommits > 0
          ? Math.round((businessHoursCommits / totalCommits) * 100)
          : 0,
      weekend_percentage:
        totalCommits > 0
          ? Math.round((weekendCommits / totalCommits) * 100)
          : 0,
      peak_activity: {
        hour: {
          time: peakHour.hour_label || "N/A",
          day: peakHour.day_name || "N/A",
          commits: peakHour.commits,
        },
        day: peakDay,
      },
      working_patterns: this.analyzeWorkingPatterns(punchCardData),
    };
  }

  getPeakDay(punchCardData) {
    const dayTotals = {};

    punchCardData.forEach((item) => {
      if (!dayTotals[item.day_name]) {
        dayTotals[item.day_name] = 0;
      }
      dayTotals[item.day_name] += item.commits;
    });

    const peakDay = Object.entries(dayTotals).reduce(
      (max, [day, commits]) => (commits > max.commits ? { day, commits } : max),
      { day: "N/A", commits: 0 }
    );

    return peakDay;
  }

  analyzeWorkingPatterns(punchCardData) {
    const patterns = {
      early_bird: punchCardData
        .filter((item) => item.hour >= 6 && item.hour <= 9)
        .reduce((sum, item) => sum + item.commits, 0),
      traditional: punchCardData
        .filter((item) => item.hour >= 9 && item.hour <= 17)
        .reduce((sum, item) => sum + item.commits, 0),
      evening: punchCardData
        .filter((item) => item.hour >= 17 && item.hour <= 22)
        .reduce((sum, item) => sum + item.commits, 0),
      night_owl: punchCardData
        .filter((item) => item.hour >= 22 || item.hour <= 6)
        .reduce((sum, item) => sum + item.commits, 0),
    };

    const total = Object.values(patterns).reduce(
      (sum, count) => sum + count,
      0
    );

    return Object.entries(patterns).reduce((result, [pattern, count]) => {
      result[pattern] = {
        commits: count,
        percentage: total > 0 ? Math.round((count / total) * 100) : 0,
      };
      return result;
    }, {});
  }

  generateOverallSummary(userCommitDistribution) {
    const users = Object.keys(userCommitDistribution);
    const totalCommits = users.reduce(
      (sum, email) => sum + userCommitDistribution[email].total_commits,
      0
    );

    const mostActiveUser = users.reduce(
      (max, email) =>
        userCommitDistribution[email].total_commits >
        userCommitDistribution[max]?.total_commits
          ? email
          : max,
      users[0]
    );

    // Calculate team-wide working patterns
    const teamPatterns = {
      early_bird: 0,
      traditional: 0,
      evening: 0,
      night_owl: 0,
    };

    users.forEach((email) => {
      const patterns = userCommitDistribution[email].summary.working_patterns;
      Object.keys(teamPatterns).forEach((pattern) => {
        teamPatterns[pattern] += patterns[pattern].commits;
      });
    });

    const totalPatternCommits = Object.values(teamPatterns).reduce(
      (sum, count) => sum + count,
      0
    );

    const teamWorkingPatterns = Object.entries(teamPatterns).reduce(
      (result, [pattern, count]) => {
        result[pattern] = {
          commits: count,
          percentage:
            totalPatternCommits > 0
              ? Math.round((count / totalPatternCommits) * 100)
              : 0,
        };
        return result;
      },
      {}
    );

    return {
      total_users: users.length,
      total_commits: totalCommits,
      average_commits_per_user:
        users.length > 0 ? Math.round(totalCommits / users.length) : 0,
      most_active_user: mostActiveUser,
      team_working_patterns: teamWorkingPatterns,
    };
  }

  async exportToJson(data, filename) {
    try {
      await fs.writeFile(filename, JSON.stringify(data, null, 2), "utf8");
      this.log(`JSON report exported to: ${filename}`, "info");
    } catch (error) {
      this.log(`Error exporting JSON: ${error.message}`, "error");
      throw error;
    }
  }

  async exportToCsv(data, filename) {
    try {
      const csvRows = [
        "User_Email,Day,Day_Name,Hour,Hour_Label,Commits,Business_Hours,Weekend",
      ];

      Object.entries(data.commit_time_distribution_by_user).forEach(
        ([email, userData]) => {
          userData.punch_card_data.forEach((item) => {
            csvRows.push(
              [
                email,
                item.day_of_week,
                item.day_name,
                item.hour,
                item.hour_label,
                item.commits,
                item.is_business_hours,
                item.is_weekend,
              ].join(",")
            );
          });
        }
      );

      await fs.writeFile(filename, csvRows.join("\n"), "utf8");
      this.log(`CSV report exported to: ${filename}`, "info");
    } catch (error) {
      this.log(`Error exporting CSV: ${error.message}`, "error");
      throw error;
    }
  }
}

// CLI Implementation
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
    token: null,
    help: false,
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
          nextArg === "infinite"
            ? Number.MAX_SAFE_INTEGER
            : parseInt(nextArg) || 200;
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
GitHub Commit Time Distribution Analyzer by User

Usage: node main.mjs [options]

Options:
  -r, --repo <owner/repo>           Repository to analyze (required)
  -f, --format <format>             Output format: json (default) or csv
  -o, --output <filename>           Output filename (auto-generated if not provided)
  -s, --start <date>                Start date (ISO format: YYYY-MM-DD) default -30Days
  -e, --end <date>                  End date (ISO format: YYYY-MM-DD) default: now
  -v, --verbose                     Enable verbose logging
  -d, --debug                       Enable debug logging
  -t, --token                       GitHub Token
  -l, --fetchLimit                  Set fetch limit (default: 200, use 'infinite' for no limit)
  -h, --help                        Show help message

Environment Variables:
  GITHUB_TOKEN                      GitHub personal access token

Examples:
  node main.mjs -r facebook/react -f json -v
  node main.mjs -r microsoft/vscode -f csv -o vscode-analysis.csv
  node main.mjs -r owner/repo -s 2024-01-01 -e 2024-12-31 -d
  node main.mjs -r owner/repo -l infinite -v

Features:
- Retry Logic: Automatic retry for failed API requests
- Rate Limiting: Respects GitHub API rate limits  
- Date Filtering: Filter results by date ranges
- Multiple Formats: Export to JSON or CSV
- Verbose Logging: Debug and verbose output modes
- Error Handling: Comprehensive error handling and reporting
- User-based Analysis: Groups commits by user email for team insights

Reports:
- Team Productivity Analysis: Track commit frequency and patterns
- Code Quality Assessment: Monitor additions/deletions trends  
- Collaboration Metrics: Analyze contributor participation
- Development Patterns: Identify working time distributions
- Process Improvements: Compare before/after periods for process changes
`);
}

function generateFilename(repo, format, dateRange) {
  const repoName = repo.replace("/", "-");
  const timestamp = new Date().toISOString().split("T")[0];
  const rangeStr = `${dateRange.start}_to_${dateRange.end}`;
  return `commit-time-distribution-by-user_${repoName}_${rangeStr}_${timestamp}.${format}`;
}

async function main() {
  try {
    const options = parseArguments();

    if (options.help) {
      showHelp();
      process.exit(0);
    }

    // Validate required arguments
    if (!options.repo) {
      console.error("❌ Error: Repository (-r, --repo) is required");
      console.error("Use -h or --help for usage information");
      process.exit(1);
    }

    if (!options.repo.includes("/")) {
      console.error('❌ Error: Repository must be in format "owner/repo"');
      process.exit(1);
    }

    const [owner, repo] = options.repo.split("/");

    // Get GitHub token
    const token = options.token || process.env.GITHUB_TOKEN;
    if (!token) {
      console.error("❌ Error: GitHub token is required");
      console.error(
        "Provide via -t/--token argument or GITHUB_TOKEN environment variable"
      );
      console.error("Get a token at: https://github.com/settings/tokens");
      process.exit(1);
    }

    // Validate format
    if (!["json", "csv"].includes(options.format)) {
      console.error('❌ Error: Format must be "json" or "csv"');
      process.exit(1);
    }

    // Validate dates if provided
    if (options.start && isNaN(Date.parse(options.start))) {
      console.error("❌ Error: Invalid start date format. Use YYYY-MM-DD");
      process.exit(1);
    }

    if (options.end && isNaN(Date.parse(options.end))) {
      console.error("❌ Error: Invalid end date format. Use YYYY-MM-DD");
      process.exit(1);
    }

    // Create analyzer instance
    const analyzer = new GitHubCommitAnalyzer({
      verbose: options.verbose,
      debug: options.debug,
      fetchLimit: options.fetchLimit,
    });

    // Fetch and analyze data
    const report = await analyzer.fetchCommitTimeDistributionByUser(
      repo,
      owner,
      options.start,
      options.end,
      token
    );

    // Generate output filename if not provided
    const filename =
      options.output ||
      generateFilename(options.repo, options.format, report.date_range);

    // Export data
    if (options.format === "json") {
      await analyzer.exportToJson(report, filename);
    } else {
      await analyzer.exportToCsv(report, filename);
    }

    // Display summary
    console.log("\n📊 Analysis Summary:");
    console.log(`Repository: ${report.repository}`);
    console.log(
      `Date Range: ${report.date_range.start} to ${report.date_range.end}`
    );
    console.log(`Total Users: ${report.overall_summary.total_users}`);
    console.log(
      `Total Commits: ${report.overall_summary.total_commits.toLocaleString()}`
    );
    console.log(
      `Average Commits per User: ${report.overall_summary.average_commits_per_user}`
    );
    console.log(`Most Active User: ${report.overall_summary.most_active_user}`);

    console.log("\n👥 Team Working Patterns:");
    Object.entries(report.overall_summary.team_working_patterns).forEach(
      ([pattern, data]) => {
        console.log(
          `  ${pattern.replace("_", " ")}: ${data.percentage}% (${
            data.commits
          } commits)`
        );
      }
    );

    console.log("\n🔍 Top Contributors:");
    const sortedUsers = Object.entries(report.commit_time_distribution_by_user)
      .sort(([, a], [, b]) => b.total_commits - a.total_commits)
      .slice(0, 5);

    sortedUsers.forEach(([email, userData]) => {
      console.log(`  ${email}: ${userData.total_commits} commits`);
      console.log(
        `    Business Hours: ${userData.summary.business_hours_percentage}%`
      );
      console.log(
        `    Weekend Activity: ${userData.summary.weekend_percentage}%`
      );
    });

    console.log(`\n✅ Report saved to: ${filename}`);
    console.log(
      `📈 Fetch limit: ${
        options.fetchLimit === Number.MAX_SAFE_INTEGER
          ? "Infinite"
          : options.fetchLimit
      }`
    );
    console.log(
      `⚡ API Rate Limit Remaining: ${report.metadata.api_rate_limit_remaining}`
    );
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    if (error.stack && (process.env.DEBUG || options?.debug)) {
      console.error("Stack trace:", error.stack);
    }
    process.exit(1);
  }
}

// Run CLI if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { GitHubCommitAnalyzer };
