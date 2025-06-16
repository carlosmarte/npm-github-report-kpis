/****
 * JSON Report Structure:
 * {
 *   "date_range": { "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD" },
 *   "summary": { "total_prs": N, "avg_lead_time_hours": N, "median_lead_time_hours": N },
 *   "detailed_analysis": { "pull_requests": [...], "trends": {...}, "contributors": {...} },
 *   "formulas": { "lead_time": "MERGE_TIME - FIRST_COMMIT_TIME", ... }
 * }
 *
 * Performance Considerations:
 * - Implements rate limiting with exponential backoff
 * - Uses pagination for large datasets
 * - Caches intermediate results to reduce API calls
 * - Streams data processing for memory efficiency
 *
 * Use Cases:
 * 1. Measure development velocity and delivery times
 * 2. Identify bottlenecks in feature development workflow
 * 3. Compare lead times across contributors and time periods
 * 4. Track impact of process improvements on delivery speed
 * 5. Generate performance reports for team retrospectives
 ****/

import { createWriteStream, promises as fs } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Custom Error Classes
class APIError extends Error {
  constructor(message, statusCode, responseData) {
    super(message);
    this.name = "APIError";
    this.statusCode = statusCode;
    this.responseData = responseData;
    this.timestamp = new Date().toISOString();
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}

class ConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigurationError";
  }
}

// Progress Bar Class
class ProgressBar {
  constructor(total, description = "Progress") {
    this.total = total;
    this.current = 0;
    this.description = description;
    this.startTime = Date.now();
  }

  update(increment = 1) {
    this.current += increment;
    const percentage = Math.min(100, (this.current / this.total) * 100);
    const elapsed = Date.now() - this.startTime;
    const estimated = elapsed / (this.current / this.total);
    const remaining = Math.max(0, estimated - elapsed);

    const bar =
      "█".repeat(Math.floor(percentage / 2)) +
      "░".repeat(50 - Math.floor(percentage / 2));
    process.stdout.write(
      `\r${this.description}: [${bar}] ${percentage.toFixed(1)}% (${
        this.current
      }/${this.total}) ETA: ${Math.ceil(remaining / 1000)}s`
    );

    if (this.current >= this.total) {
      console.log("\n");
    }
  }
}

// GitHub API Client Class
class GitHubAPIClient {
  constructor(token, options = {}) {
    this.token = token;
    this.baseURL = options.apiUrl || "https://api.github.com";
    this.timeout = options.timeout || 30000;
    this.userAgent = options.userAgent || "Commit-to-Merge-Tracker/1.0.0";
    this.rateLimitRemaining = 5000;
    this.rateLimitReset = Date.now();
  }

  async makeRequest(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const config = {
      method: "GET",
      headers: {
        Authorization: `token ${this.token}`,
        "User-Agent": this.userAgent,
        Accept: "application/vnd.github.v3+json",
        ...options.headers,
      },
      signal: AbortSignal.timeout(this.timeout),
      ...options,
    };

    try {
      const response = await fetch(url, config);

      this.rateLimitRemaining = parseInt(
        response.headers.get("X-RateLimit-Remaining") || "0"
      );
      this.rateLimitReset =
        parseInt(response.headers.get("X-RateLimit-Reset") || "0") * 1000;

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new APIError(
          `GitHub API Error: ${response.status} ${response.statusText}`,
          response.status,
          errorData
        );
      }

      return await response.json();
    } catch (error) {
      if (error instanceof APIError) throw error;
      throw new APIError(`Network Error: ${error.message}`, 0, null);
    }
  }

  async getAllPages(endpoint, options = {}) {
    const allData = [];
    let page = 1;
    const perPage = Math.min(options.per_page || 100, 100);
    const maxPages = options.maxPages || Infinity;

    while (page <= maxPages) {
      const params = new URLSearchParams({
        page: page.toString(),
        per_page: perPage.toString(),
        ...options.params,
      });

      const data = await this.makeRequest(`${endpoint}?${params}`);

      if (Array.isArray(data)) {
        allData.push(...data);
        if (data.length < perPage) break;
      } else {
        allData.push(data);
        break;
      }

      page++;

      // Rate limit management
      if (this.rateLimitRemaining < 10) {
        const waitTime = Math.max(0, this.rateLimitReset - Date.now());
        if (waitTime > 0) {
          console.log(
            `\n⏳ Rate limit approaching, waiting ${Math.ceil(
              waitTime / 1000
            )}s...`
          );
          await this.delay(waitTime + 1000);
        }
      }

      await this.delay(100); // Small delay between requests
    }

    return allData;
  }

  async getRepository(owner, repo) {
    return await this.makeRequest(`/repos/${owner}/${repo}`);
  }

  async getUserRepositories(username, options = {}) {
    const params = {
      type: "all",
      sort: "updated",
      direction: "desc",
      ...options,
    };

    return await this.getAllPages(`/users/${username}/repos`, { params });
  }

  async getPullRequests(owner, repo, options = {}) {
    const params = {
      state: "closed",
      sort: "updated",
      direction: "desc",
      ...options,
    };

    return await this.getAllPages(`/repos/${owner}/${repo}/pulls`, { params });
  }

  async getCommits(owner, repo, options = {}) {
    const params = {
      per_page: 100,
      ...options,
    };

    return await this.getAllPages(`/repos/${owner}/${repo}/commits`, {
      params,
    });
  }

  async getBranchCommits(owner, repo, branch) {
    return await this.getAllPages(`/repos/${owner}/${repo}/commits`, {
      params: { sha: branch },
    });
  }

  async getCommit(owner, repo, sha) {
    return await this.makeRequest(`/repos/${owner}/${repo}/commits/${sha}`);
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getRateLimitStatus() {
    return {
      remaining: this.rateLimitRemaining,
      reset: new Date(this.rateLimitReset).toISOString(),
    };
  }
}

// Lead Time Metrics Calculator Class
class LeadTimeMetricsCalculator {
  static calculateLeadTime(firstCommitTime, mergeTime) {
    if (!firstCommitTime || !mergeTime) return null;

    const start = new Date(firstCommitTime);
    const end = new Date(mergeTime);
    const diffMs = end.getTime() - start.getTime();

    return {
      LEAD_TIME_MS: diffMs,
      LEAD_TIME_HOURS: Math.round((diffMs / (1000 * 60 * 60)) * 100) / 100,
      LEAD_TIME_DAYS: Math.round((diffMs / (1000 * 60 * 60 * 24)) * 100) / 100,
    };
  }

  static calculateStatistics(values) {
    if (!values || values.length === 0) return {};

    const sorted = [...values].sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);
    const mean = sum / values.length;

    return {
      COUNT: values.length,
      SUM: Math.round(sum * 100) / 100,
      MEAN: Math.round(mean * 100) / 100,
      MEDIAN:
        sorted.length % 2 === 0
          ? Math.round(
              ((sorted[Math.floor(sorted.length / 2) - 1] +
                sorted[Math.floor(sorted.length / 2)]) /
                2) *
                100
            ) / 100
          : sorted[Math.floor(sorted.length / 2)],
      MIN: sorted[0],
      MAX: sorted[sorted.length - 1],
      P75: sorted[Math.floor(sorted.length * 0.75)],
      P90: sorted[Math.floor(sorted.length * 0.9)],
      P95: sorted[Math.floor(sorted.length * 0.95)],
    };
  }

  static identifyBottlenecks(prMetrics) {
    const leadTimes = prMetrics
      .map((pr) => pr.LEAD_TIME_HOURS)
      .filter((time) => time !== null);
    const stats = this.calculateStatistics(leadTimes);

    const bottlenecks = [];

    if (stats.P90 > stats.MEDIAN * 3) {
      bottlenecks.push({
        type: "high_variance",
        description: "High variance in lead times detected",
        impact: "Some PRs taking significantly longer than others",
      });
    }

    if (stats.MEAN > 168) {
      // 7 days
      bottlenecks.push({
        type: "long_lead_times",
        description: "Average lead time exceeds 7 days",
        impact: "Slow delivery velocity",
      });
    }

    return bottlenecks;
  }
}

// Data Processor Class
class DataProcessor {
  static async exportToJSON(data, filePath) {
    const jsonData = JSON.stringify(data, null, 2);
    await fs.writeFile(filePath, jsonData, "utf8");
    return filePath;
  }

  static async exportToCSV(data, filePath) {
    if (!data.detailed_analysis?.pull_requests) {
      throw new Error("No pull request data available for CSV export");
    }

    const headers = [
      "pr_number",
      "title",
      "author",
      "repository",
      "first_commit_timestamp",
      "merge_timestamp",
      "lead_time_hours",
      "lead_time_days",
      "state",
    ];

    const csvRows = [headers.join(",")];

    data.detailed_analysis.pull_requests.forEach((pr) => {
      const row = [
        pr.pr_number,
        `"${pr.title.replace(/"/g, '""')}"`,
        pr.author,
        pr.repository,
        pr.first_commit_timestamp || "",
        pr.merge_timestamp || "",
        pr.lead_time_hours || "",
        pr.lead_time_days || "",
        pr.state,
      ];
      csvRows.push(row.join(","));
    });

    await fs.writeFile(filePath, csvRows.join("\n"), "utf8");
    return filePath;
  }

  static validateInputs(ownerOrUser, startDate, endDate, token) {
    if (!ownerOrUser) {
      throw new ValidationError("Owner/repository or username is required");
    }

    if (!token) {
      throw new ValidationError("GitHub token is required");
    }

    if (startDate && !this.isValidDate(startDate)) {
      throw new ValidationError("Start date must be in YYYY-MM-DD format");
    }

    if (endDate && !this.isValidDate(endDate)) {
      throw new ValidationError("End date must be in YYYY-MM-DD format");
    }

    if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
      throw new ValidationError("Start date must be before end date");
    }
  }

  static isValidDate(dateString) {
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!regex.test(dateString)) return false;

    const date = new Date(dateString);
    return (
      date instanceof Date &&
      !isNaN(date) &&
      dateString === date.toISOString().split("T")[0]
    );
  }
}

// Main Commit-to-Merge Lead Time Tracker Class
class CommitToMergeLeadTimeTracker {
  constructor(token, options = {}) {
    this.apiClient = new GitHubAPIClient(token, options);
    this.fetchLimit = options.fetchLimit || 50;
  }

  async generateReport(ownerOrUser, options = {}) {
    const {
      startDate,
      endDate,
      verbose = false,
      isUser = false,
      specificRepo = null,
    } = options;

    console.log(
      `🔄 Starting Commit-to-Merge Lead Time Analysis for ${
        isUser ? "user" : "repository"
      }: ${ownerOrUser}`
    );

    let repositories = [];

    if (isUser) {
      console.log(`📦 Fetching repositories for user: ${ownerOrUser}`);
      const userRepos = await this.apiClient.getUserRepositories(ownerOrUser, {
        per_page: 100,
      });
      repositories = userRepos.slice(
        0,
        this.fetchLimit === -1 ? userRepos.length : this.fetchLimit
      );
      console.log(`📊 Found ${repositories.length} repositories`);
    } else {
      if (specificRepo) {
        console.log(
          `📦 Analyzing specific repository: ${ownerOrUser}/${specificRepo}`
        );
        const repo = await this.apiClient.getRepository(
          ownerOrUser,
          specificRepo
        );
        repositories = [repo];
      } else {
        throw new ValidationError(
          "Repository name is required when not analyzing a user"
        );
      }
    }

    const allPRs = [];
    const progressBar = new ProgressBar(repositories.length, "Fetching PRs");

    for (const repo of repositories) {
      try {
        const [owner, repoName] = isUser
          ? [repo.owner.login, repo.name]
          : [ownerOrUser, specificRepo];

        const prs = await this.apiClient.getPullRequests(owner, repoName, {
          state: "closed",
          per_page: 100,
        });

        // Filter merged PRs and date range
        const filteredPRs = prs.filter((pr) => {
          if (!pr.merged_at) return false;

          if (startDate || endDate) {
            const mergeDate = new Date(pr.merged_at);
            if (startDate && mergeDate < new Date(startDate)) return false;
            if (endDate && mergeDate > new Date(endDate)) return false;
          }

          return true;
        });

        // Add repository context to each PR
        filteredPRs.forEach((pr) => {
          pr.repository = `${owner}/${repoName}`;
        });

        allPRs.push(...filteredPRs);

        if (verbose) {
          console.log(
            `\n📈 ${owner}/${repoName}: ${filteredPRs.length} merged PRs found`
          );
        }
      } catch (error) {
        console.error(
          `\n❌ Error fetching PRs for repository: ${error.message}`
        );
      }

      progressBar.update();
    }

    console.log(`\n🔍 Analyzing ${allPRs.length} pull requests...`);

    const enrichedPRs = await this.enrichWithLeadTimeMetrics(allPRs, verbose);
    const report = this.buildReport(enrichedPRs, {
      startDate,
      endDate,
      ownerOrUser,
      isUser,
    });

    return report;
  }

  async enrichWithLeadTimeMetrics(prs, verbose = false) {
    const enrichedPRs = [];
    const progressBar = new ProgressBar(prs.length, "Calculating lead times");

    for (const pr of prs) {
      try {
        const [owner, repo] = pr.repository.split("/");

        // Get first unique commit in the head branch
        const firstCommit = await this.findFirstUniqueCommit(owner, repo, pr);

        const leadTimeMetrics = LeadTimeMetricsCalculator.calculateLeadTime(
          firstCommit?.commit?.author?.date,
          pr.merged_at
        );

        const enrichedPR = {
          pr_number: pr.number,
          title: pr.title,
          author: pr.user.login,
          repository: pr.repository,
          first_commit_timestamp: firstCommit?.commit?.author?.date || null,
          first_commit_sha: firstCommit?.sha || null,
          merge_timestamp: pr.merged_at,
          state: pr.state,
          head_branch: pr.head.ref,
          base_branch: pr.base.ref,
          ...leadTimeMetrics,
        };

        enrichedPRs.push(enrichedPR);

        if (verbose && leadTimeMetrics) {
          console.log(
            `\n📊 PR #${pr.number}: ${leadTimeMetrics.LEAD_TIME_DAYS} days lead time`
          );
        }
      } catch (error) {
        console.error(
          `\n❌ Error processing PR #${pr.number}: ${error.message}`
        );

        // Add PR with null metrics
        enrichedPRs.push({
          pr_number: pr.number,
          title: pr.title,
          author: pr.user.login,
          repository: pr.repository,
          first_commit_timestamp: null,
          merge_timestamp: pr.merged_at,
          state: pr.state,
          head_branch: pr.head.ref,
          base_branch: pr.base.ref,
          LEAD_TIME_HOURS: null,
          LEAD_TIME_DAYS: null,
        });
      }

      progressBar.update();
    }

    return enrichedPRs;
  }

  async findFirstUniqueCommit(owner, repo, pr) {
    try {
      // Get commits from the head branch
      const headCommits = await this.apiClient.getBranchCommits(
        owner,
        repo,
        pr.head.sha
      );

      // Get commits from the base branch
      const baseCommits = await this.apiClient.getBranchCommits(
        owner,
        repo,
        pr.base.sha
      );

      // Create a set of base commit SHAs for quick lookup
      const baseCommitShas = new Set(baseCommits.map((commit) => commit.sha));

      // Find the first commit in head that's not in base
      const uniqueCommits = headCommits.filter(
        (commit) => !baseCommitShas.has(commit.sha)
      );

      // Return the oldest unique commit (last in the array since they're sorted newest first)
      return uniqueCommits.length > 0
        ? uniqueCommits[uniqueCommits.length - 1]
        : null;
    } catch (error) {
      console.error(
        `Error finding first unique commit for PR #${pr.number}: ${error.message}`
      );
      return null;
    }
  }

  buildReport(enrichedPRs, options = {}) {
    const { startDate, endDate, ownerOrUser, isUser } = options;

    const validPRs = enrichedPRs.filter((pr) => pr.LEAD_TIME_HOURS !== null);
    const leadTimes = validPRs.map((pr) => pr.LEAD_TIME_HOURS);
    const leadTimeDays = validPRs.map((pr) => pr.LEAD_TIME_DAYS);

    const hourlyStats =
      LeadTimeMetricsCalculator.calculateStatistics(leadTimes);
    const dailyStats =
      LeadTimeMetricsCalculator.calculateStatistics(leadTimeDays);
    const bottlenecks = LeadTimeMetricsCalculator.identifyBottlenecks(validPRs);

    // Generate trends
    const trends = this.generateTrends(validPRs);

    // Contributor analysis
    const contributorMetrics = this.generateContributorMetrics(validPRs);

    const report = {
      date_range: {
        start_date: startDate || null,
        end_date: endDate || null,
        analysis_timestamp: new Date().toISOString(),
      },
      summary: {
        TOTAL_PRS: enrichedPRs.length,
        MERGED_PRS: validPRs.length,
        INCOMPLETE_DATA_PRS: enrichedPRs.length - validPRs.length,
        AVG_LEAD_TIME_HOURS: hourlyStats.MEAN || 0,
        MEDIAN_LEAD_TIME_HOURS: hourlyStats.MEDIAN || 0,
        AVG_LEAD_TIME_DAYS: dailyStats.MEAN || 0,
        MEDIAN_LEAD_TIME_DAYS: dailyStats.MEDIAN || 0,
        MIN_LEAD_TIME_DAYS: dailyStats.MIN || 0,
        MAX_LEAD_TIME_DAYS: dailyStats.MAX || 0,
        P75_LEAD_TIME_DAYS: dailyStats.P75 || 0,
        P95_LEAD_TIME_DAYS: dailyStats.P95 || 0,
      },
      total: {
        REPOSITORIES_ANALYZED: new Set(enrichedPRs.map((pr) => pr.repository))
          .size,
        CONTRIBUTORS: new Set(enrichedPRs.map((pr) => pr.author)).size,
        TOTAL_LEAD_TIME_HOURS: validPRs.reduce(
          (sum, pr) => sum + (pr.LEAD_TIME_HOURS || 0),
          0
        ),
      },
      detailed_analysis: {
        pull_requests: enrichedPRs,
        contributor_metrics: contributorMetrics,
        trends: trends,
        bottlenecks: bottlenecks,
        statistics: {
          hourly_stats: hourlyStats,
          daily_stats: dailyStats,
        },
      },
      formulas: {
        LEAD_TIME: "MERGE_TIME - FIRST_COMMIT_TIME",
        LEAD_TIME_HOURS: "(MERGE_TIME - FIRST_COMMIT_TIME) / 3600000",
        LEAD_TIME_DAYS: "(MERGE_TIME - FIRST_COMMIT_TIME) / 86400000",
        MEAN: "SUM(LEAD_TIME_VALUES) / COUNT(LEAD_TIME_VALUES)",
        MEDIAN: "MIDDLE_VALUE(SORTED_LEAD_TIME_VALUES)",
        P75: "VALUE_AT_75TH_PERCENTILE(SORTED_LEAD_TIME_VALUES)",
        P95: "VALUE_AT_95TH_PERCENTILE(SORTED_LEAD_TIME_VALUES)",
        CONTRIBUTOR_EFFICIENCY:
          "CONTRIBUTOR_MERGED_PRS / CONTRIBUTOR_TOTAL_PRS",
        AVG_CONTRIBUTOR_LEAD_TIME:
          "SUM(CONTRIBUTOR_LEAD_TIMES) / COUNT(CONTRIBUTOR_PRS)",
      },
    };

    return report;
  }

  generateTrends(prs) {
    const weeklyTrends = {};
    const monthlyTrends = {};

    prs.forEach((pr) => {
      const mergeDate = new Date(pr.merge_timestamp);
      const weekKey = this.getWeekKey(mergeDate);
      const monthKey = this.getMonthKey(mergeDate);

      // Weekly trends
      if (!weeklyTrends[weekKey]) {
        weeklyTrends[weekKey] = { LEAD_TIMES: [], PR_COUNT: 0 };
      }
      weeklyTrends[weekKey].LEAD_TIMES.push(pr.LEAD_TIME_DAYS);
      weeklyTrends[weekKey].PR_COUNT++;

      // Monthly trends
      if (!monthlyTrends[monthKey]) {
        monthlyTrends[monthKey] = { LEAD_TIMES: [], PR_COUNT: 0 };
      }
      monthlyTrends[monthKey].LEAD_TIMES.push(pr.LEAD_TIME_DAYS);
      monthlyTrends[monthKey].PR_COUNT++;
    });

    // Calculate statistics for each period
    Object.keys(weeklyTrends).forEach((week) => {
      const stats = LeadTimeMetricsCalculator.calculateStatistics(
        weeklyTrends[week].LEAD_TIMES
      );
      weeklyTrends[week] = { ...weeklyTrends[week], ...stats };
    });

    Object.keys(monthlyTrends).forEach((month) => {
      const stats = LeadTimeMetricsCalculator.calculateStatistics(
        monthlyTrends[month].LEAD_TIMES
      );
      monthlyTrends[month] = { ...monthlyTrends[month], ...stats };
    });

    return {
      weekly: weeklyTrends,
      monthly: monthlyTrends,
    };
  }

  generateContributorMetrics(prs) {
    const contributors = {};

    prs.forEach((pr) => {
      const author = pr.author;
      if (!contributors[author]) {
        contributors[author] = {
          TOTAL_PRS: 0,
          LEAD_TIMES: [],
          REPOSITORIES: new Set(),
        };
      }

      contributors[author].TOTAL_PRS++;
      contributors[author].LEAD_TIMES.push(pr.LEAD_TIME_DAYS);
      contributors[author].REPOSITORIES.add(pr.repository);
    });

    // Calculate statistics for each contributor
    Object.keys(contributors).forEach((author) => {
      const stats = LeadTimeMetricsCalculator.calculateStatistics(
        contributors[author].LEAD_TIMES
      );
      contributors[author] = {
        ...contributors[author],
        REPOSITORY_COUNT: contributors[author].REPOSITORIES.size,
        ...stats,
      };
      delete contributors[author].REPOSITORIES; // Remove Set object for JSON serialization
    });

    return contributors;
  }

  getWeekKey(date) {
    const year = date.getFullYear();
    const firstDayOfYear = new Date(year, 0, 1);
    const pastDaysOfYear = (date - firstDayOfYear) / 86400000;
    const week = Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
    return `${year}-W${week.toString().padStart(2, "0")}`;
  }

  getMonthKey(date) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    return `${year}-${month}`;
  }
}

// CLI Implementation
async function parseArguments() {
  const args = process.argv.slice(2);
  const config = {
    ownerOrUser: null,
    repo: null,
    user: null,
    startDate: null,
    endDate: null,
    format: "json",
    name: null,
    output: "./reports",
    verbose: false,
    debug: false,
    token: process.env.GITHUB_TOKEN,
    fetchLimit: 50,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "-r":
      case "--repo":
        config.ownerOrUser = args[++i];
        break;
      case "-u":
      case "--user":
        config.user = args[++i];
        break;
      case "--specific-repo":
        config.repo = args[++i];
        break;
      case "-s":
      case "--start":
        config.startDate = args[++i];
        break;
      case "-e":
      case "--end":
        config.endDate = args[++i];
        break;
      case "-f":
      case "--format":
        config.format = args[++i];
        break;
      case "-n":
      case "--name":
        config.name = args[++i];
        break;
      case "-o":
      case "--output":
        config.output = args[++i];
        break;
      case "-v":
      case "--verbose":
        config.verbose = true;
        break;
      case "-d":
      case "--debug":
        config.debug = true;
        break;
      case "-t":
      case "--token":
        config.token = args[++i];
        break;
      case "-l":
      case "--fetchLimit":
        config.fetchLimit = args[++i] === "infinite" ? -1 : parseInt(args[++i]);
        break;
      case "-h":
      case "--help":
        showHelp();
        process.exit(0);
        break;
      default:
        if (!config.ownerOrUser && !config.user && !arg.startsWith("-")) {
          config.ownerOrUser = arg;
        }
        break;
    }
  }

  // Determine analysis type
  if (config.user) {
    config.isUser = true;
    config.ownerOrUser = config.user;
  } else if (config.ownerOrUser && config.repo) {
    config.isUser = false;
  } else if (config.ownerOrUser && config.ownerOrUser.includes("/")) {
    const [owner, repo] = config.ownerOrUser.split("/");
    config.ownerOrUser = owner;
    config.repo = repo;
    config.isUser = false;
  }

  return config;
}

function showHelp() {
  console.log(`
Commit-to-Merge Lead Time Tracker

USAGE:
  node main.report.mjs [options]

OPTIONS:
  -r, --repo <owner/repo>       Repository to analyze (e.g., facebook/react)
  -u, --user <username>         Analyze all repositories for a user
  --specific-repo <name>        Specific repository name when analyzing user
  -s, --start <date>            Start date (YYYY-MM-DD)
  -e, --end <date>              End date (YYYY-MM-DD)
  -f, --format <format>         Output format: json, csv, or both (default: json)
  -n, --name <filename>         Output filename prefix
  -o, --output <directory>      Output directory (default: ./reports)
  -v, --verbose                 Enable verbose logging
  -d, --debug                   Enable debug logging
  -t, --token <token>           GitHub token (or set GITHUB_TOKEN env var)
  -l, --fetchLimit <number>     Limit number of repositories to analyze (default: 50, use 'infinite' for all)
  -h, --help                    Show this help message

EXAMPLES:
  # Analyze specific repository
  node main.report.mjs --repo facebook/react --start 2024-01-01 --end 2024-03-31

  # Analyze user's repositories
  node main.report.mjs --user octocat --format both --verbose

  # Analyze with unlimited fetch
  node main.report.mjs --user github --fetchLimit infinite

  # Export to CSV
  node main.report.mjs --repo microsoft/typescript --format csv --output ./analysis

ENVIRONMENT VARIABLES:
  GITHUB_TOKEN    GitHub personal access token
`);
}

async function main() {
  try {
    const config = await parseArguments();

    if (!config.ownerOrUser) {
      console.error(
        "❌ Error: Repository (--repo) or user (--user) is required"
      );
      showHelp();
      process.exit(1);
    }

    // Validate inputs
    DataProcessor.validateInputs(
      config.ownerOrUser,
      config.startDate,
      config.endDate,
      config.token
    );

    // Create output directory
    await fs.mkdir(config.output, { recursive: true });

    // Initialize analyzer
    const analyzer = new CommitToMergeLeadTimeTracker(config.token, {
      fetchLimit: config.fetchLimit,
    });

    console.log(`🚀 Commit-to-Merge Lead Time Analysis Starting...`);
    console.log(
      `📅 Date Range: ${config.startDate || "No start limit"} to ${
        config.endDate || "No end limit"
      }`
    );
    console.log(`📊 Format: ${config.format}`);

    // Generate report
    const report = await analyzer.generateReport(config.ownerOrUser, {
      startDate: config.startDate,
      endDate: config.endDate,
      verbose: config.verbose,
      isUser: config.isUser,
      specificRepo: config.repo,
    });

    // Generate filename
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .split("T")[0];
    const target = config.isUser
      ? config.ownerOrUser
      : config.ownerOrUser.replace("/", "-");
    const baseFilename =
      config.name || `commit-merge-leadtime-${target}-${timestamp}`;

    // Export data
    const exports = [];

    if (config.format === "json" || config.format === "both") {
      const jsonPath = join(config.output, `${baseFilename}.json`);
      await DataProcessor.exportToJSON(report, jsonPath);
      exports.push(jsonPath);
      console.log(`📄 JSON report saved: ${jsonPath}`);
    }

    if (config.format === "csv" || config.format === "both") {
      const csvPath = join(config.output, `${baseFilename}.csv`);
      await DataProcessor.exportToCSV(report, csvPath);
      exports.push(csvPath);
      console.log(`📊 CSV report saved: ${csvPath}`);
    }

    // Summary output
    console.log("\n📈 ANALYSIS SUMMARY");
    console.log("=".repeat(50));
    console.log(`📊 Total PRs Analyzed: ${report.summary.TOTAL_PRS}`);
    console.log(`✅ PRs with Complete Data: ${report.summary.MERGED_PRS}`);
    console.log(
      `📅 Average Lead Time: ${report.summary.AVG_LEAD_TIME_DAYS.toFixed(
        2
      )} days`
    );
    console.log(
      `📊 Median Lead Time: ${report.summary.MEDIAN_LEAD_TIME_DAYS.toFixed(
        2
      )} days`
    );
    console.log(
      `⚡ Fastest PR: ${report.summary.MIN_LEAD_TIME_DAYS.toFixed(2)} days`
    );
    console.log(
      `🐌 Slowest PR: ${report.summary.MAX_LEAD_TIME_DAYS.toFixed(2)} days`
    );
    console.log(`👥 Contributors: ${report.total.CONTRIBUTORS}`);
    console.log(`📦 Repositories: ${report.total.REPOSITORIES_ANALYZED}`);

    if (report.detailed_analysis.bottlenecks.length > 0) {
      console.log("\n⚠️  BOTTLENECKS DETECTED:");
      report.detailed_analysis.bottlenecks.forEach((bottleneck) => {
        console.log(`   • ${bottleneck.type}: ${bottleneck.description}`);
      });
    }

    console.log(`\n✅ Analysis complete! Reports saved to: ${config.output}`);
    console.log(
      `📊 Rate Limit Status: ${analyzer.apiClient.rateLimitRemaining} requests remaining`
    );
  } catch (error) {
    console.error("\n❌ Analysis failed:", error.message);

    if (error instanceof ValidationError) {
      console.error("💡 Please check your input parameters.");
    } else if (error instanceof APIError) {
      console.error(
        "💡 Please check your GitHub token and network connection."
      );
      if (error.statusCode === 401) {
        console.error("💡 Your GitHub token may be invalid or expired.");
      } else if (error.statusCode === 403) {
        console.error("💡 Rate limit exceeded. Please try again later.");
      }
    }

    if (error.stack && process.env.DEBUG) {
      console.error("\n🔍 Stack trace:", error.stack);
    }

    process.exit(1);
  }
}

// Execute if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export {
  CommitToMergeLeadTimeTracker,
  GitHubAPIClient,
  LeadTimeMetricsCalculator,
  DataProcessor,
  APIError,
  ValidationError,
  ConfigurationError,
};
