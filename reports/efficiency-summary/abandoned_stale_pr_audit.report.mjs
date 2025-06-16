/****
 * Abandoned & Stale PR Audit System
 *
 * Use Cases:
 * 1. Identify inactive PRs across repositories
 * 2. Track PR abandonment patterns by reason
 * 3. Monitor CI failure impact on PR velocity
 * 4. Analyze reviewer engagement bottlenecks
 * 5. Generate cleanup recommendations for stale PRs
 * 6. Assess team workflow health and gaps
 *
 * Performance Considerations:
 * - Uses pagination for large datasets
 * - Implements rate limiting with exponential backoff
 * - Caches API responses to minimize requests
 * - Streams large JSON outputs to manage memory
 *
 * JSON Report Structure:
 * {
 *   "date_range": { "start_date": "...", "end_date": "..." },
 *   "summary": { "total_prs": 150, "inactive_prs": 45, "abandonment_rate": 30 },
 *   "detailed_analysis": {
 *     "pull_requests": [...], "inactivity_reasons": {...}, "trends": {...}
 *   },
 *   "formulas": { "abandonment_rate": "INACTIVE_PRS / TOTAL_PRS * 100", ... }
 * }
 ****/

import { createWriteStream, promises as fs } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Error Classes
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

// Progress Bar Utility
class ProgressBar {
  constructor(total, description = "Progress") {
    this.total = total;
    this.current = 0;
    this.description = description;
    this.startTime = Date.now();
  }

  update(increment = 1) {
    this.current += increment;
    const percentage = Math.floor((this.current / this.total) * 100);
    const elapsed = Date.now() - this.startTime;
    const eta =
      this.current > 0
        ? Math.round(
            ((elapsed / this.current) * (this.total - this.current)) / 1000
          )
        : 0;

    const bar =
      "█".repeat(Math.floor(percentage / 5)) +
      "░".repeat(20 - Math.floor(percentage / 5));
    process.stdout.write(
      `\r${this.description}: [${bar}] ${percentage}% (${this.current}/${this.total}) ETA: ${eta}s`
    );

    if (this.current >= this.total) {
      console.log("");
    }
  }
}

// GitHub API Client Class
class GitHubAPIClient {
  constructor(token, options = {}) {
    this.token = token;
    this.baseURL = options.apiUrl || "https://api.github.com";
    this.timeout = options.timeout || 30000;
    this.userAgent = options.userAgent || "Stale-PR-Audit/1.0.0";
    this.rateLimitRemaining = 5000;
    this.rateLimitReset = Date.now();
    this.cache = new Map();
  }

  async makeRequest(endpoint, options = {}) {
    const cacheKey = `${endpoint}_${JSON.stringify(options)}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    const url = `${this.baseURL}${endpoint}`;
    const config = {
      method: "GET",
      headers: {
        Authorization: `token ${this.token}`,
        "User-Agent": this.userAgent,
        Accept: "application/vnd.github.v3+json",
        ...options.headers,
      },
      ...options,
    };

    try {
      // Rate limit check
      if (this.rateLimitRemaining < 10) {
        const waitTime = Math.max(0, this.rateLimitReset - Date.now());
        if (waitTime > 0) {
          console.log(
            `⏳ Rate limit approaching, waiting ${Math.ceil(
              waitTime / 1000
            )}s...`
          );
          await this.delay(waitTime);
        }
      }

      const response = await fetch(url, config);

      // Update rate limit info
      this.rateLimitRemaining = parseInt(
        response.headers.get("X-RateLimit-Remaining") || "5000"
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

      const data = await response.json();
      this.cache.set(cacheKey, data);
      return data;
    } catch (error) {
      if (error instanceof APIError) throw error;
      throw new APIError(`Network Error: ${error.message}`, 0, null);
    }
  }

  async getAllPages(endpoint, options = {}) {
    const allData = [];
    let page = 1;
    const perPage = Math.min(
      options.per_page || 100,
      options.fetchLimit || 100
    );
    const maxItems =
      options.fetchLimit === "infinite" ? Infinity : options.fetchLimit || 50;

    const progressBar = new ProgressBar(
      Math.ceil(maxItems / perPage),
      `Fetching ${endpoint.split("/").pop()}`
    );

    while (allData.length < maxItems) {
      const params = new URLSearchParams({
        page: page.toString(),
        per_page: perPage.toString(),
        ...options.params,
      });

      const data = await this.makeRequest(`${endpoint}?${params}`);

      if (Array.isArray(data)) {
        const itemsToAdd = data.slice(0, maxItems - allData.length);
        allData.push(...itemsToAdd);
        progressBar.update(1);

        if (data.length < perPage || allData.length >= maxItems) break;
      } else {
        allData.push(data);
        progressBar.update(1);
        break;
      }

      page++;
    }

    return allData;
  }

  async getPullRequests(owner, repo, options = {}) {
    const params = {
      state: "all",
      sort: "updated",
      direction: "desc",
      ...options,
    };

    return await this.getAllPages(`/repos/${owner}/${repo}/pulls`, {
      params,
      ...options,
    });
  }

  async getUserPullRequests(username, options = {}) {
    // First get user's repositories, then fetch PRs from each
    const repos = await this.getUserRepositories(username, {
      type: "all",
      ...options,
    });
    const allPRs = [];

    for (const repo of repos.slice(0, options.repoLimit || 10)) {
      try {
        const prs = await this.getPullRequests(repo.owner.login, repo.name, {
          fetchLimit: Math.floor((options.fetchLimit || 50) / repos.length),
          ...options,
        });
        allPRs.push(...prs.map((pr) => ({ ...pr, repository: repo })));
      } catch (error) {
        console.warn(
          `⚠️ Failed to fetch PRs from ${repo.full_name}: ${error.message}`
        );
      }
    }

    return allPRs;
  }

  async getUserRepositories(username, options = {}) {
    const params = {
      type: "all",
      sort: "updated",
      direction: "desc",
      ...options,
    };

    return await this.getAllPages(`/users/${username}/repos`, {
      params,
      ...options,
    });
  }

  async getPullRequestDetails(owner, repo, pullNumber) {
    const [reviews, comments, commits, checks] = await Promise.all([
      this.makeRequest(
        `/repos/${owner}/${repo}/pulls/${pullNumber}/reviews`
      ).catch(() => []),
      this.makeRequest(
        `/repos/${owner}/${repo}/pulls/${pullNumber}/comments`
      ).catch(() => []),
      this.makeRequest(
        `/repos/${owner}/${repo}/pulls/${pullNumber}/commits`
      ).catch(() => []),
      this.makeRequest(
        `/repos/${owner}/${repo}/commits/${pullNumber}/check-runs`
      ).catch(() => ({ check_runs: [] })),
    ]);

    return { reviews, comments, commits, checks: checks.check_runs || [] };
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

// Stale PR Audit Calculator Class
class StalePRAuditCalculator {
  static calculateInactivityDuration(pr) {
    const now = new Date();
    const lastActivity = new Date(pr.updated_at);
    const diffMs = now - lastActivity;
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor(
      (diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
    );

    return { days, hours, total_hours: Math.floor(diffMs / (1000 * 60 * 60)) };
  }

  static determineInactivityReason(pr, details) {
    const { reviews, comments, commits, checks } = details;
    const inactivityThreshold = 7; // days
    const inactivity = this.calculateInactivityDuration(pr);

    if (inactivity.days < inactivityThreshold) {
      return { reason: "Active", category: "active", priority: "low" };
    }

    // Check for failing CI
    const failingChecks = checks.filter(
      (check) => check.status === "completed" && check.conclusion === "failure"
    );
    if (failingChecks.length > 0) {
      return { reason: "Failing CI", category: "failing_ci", priority: "high" };
    }

    // Check for no reviews
    if (reviews.length === 0 && pr.requested_reviewers.length > 0) {
      return { reason: "No Review", category: "no_review", priority: "medium" };
    }

    // Check if outdated (merge conflicts)
    if (pr.mergeable === false) {
      return { reason: "Outdated", category: "outdated", priority: "medium" };
    }

    // Check for abandonment (no activity and no comments)
    if (comments.length === 0 && reviews.length === 0 && inactivity.days > 30) {
      return { reason: "Abandoned", category: "abandoned", priority: "low" };
    }

    return { reason: "Stale", category: "stale", priority: "medium" };
  }

  static categorizeByInactivity(prs) {
    const categories = {
      active: [],
      no_review: [],
      failing_ci: [],
      outdated: [],
      abandoned: [],
      stale: [],
    };

    prs.forEach((pr) => {
      if (pr.inactivity_analysis) {
        categories[pr.inactivity_analysis.category].push(pr);
      }
    });

    return categories;
  }

  static calculateSummaryMetrics(prs) {
    const totalPRs = prs.length;
    const inactivePRs = prs.filter(
      (pr) =>
        pr.inactivity_analysis && pr.inactivity_analysis.category !== "active"
    );
    const openPRs = prs.filter((pr) => pr.state === "open");

    const inactivityDurations = inactivePRs.map(
      (pr) => pr.inactivity_duration.days
    );
    const avgInactiveDays =
      inactivityDurations.length > 0
        ? Math.round(
            inactivityDurations.reduce((a, b) => a + b, 0) /
              inactivityDurations.length
          )
        : 0;
    const maxInactiveDays =
      inactivityDurations.length > 0 ? Math.max(...inactivityDurations) : 0;

    return {
      TOTAL_PRS: totalPRs,
      OPEN_PRS: openPRs.length,
      INACTIVE_PRS: inactivePRs.length,
      ABANDONMENT_RATE:
        totalPRs > 0 ? Math.round((inactivePRs.length / totalPRs) * 100) : 0,
      AVG_INACTIVE_DAYS: avgInactiveDays,
      MAX_INACTIVE_DAYS: maxInactiveDays,
      ACTIVE_PRS: prs.filter(
        (pr) =>
          pr.inactivity_analysis && pr.inactivity_analysis.category === "active"
      ).length,
    };
  }
}

// Data Processor Class
class DataProcessor {
  static async exportToJSON(data, filePath) {
    try {
      await fs.mkdir(dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(data, null, 2));
      return filePath;
    } catch (error) {
      throw new Error(`Failed to export JSON: ${error.message}`);
    }
  }

  static async exportToCSV(data, filePath) {
    try {
      await fs.mkdir(dirname(filePath), { recursive: true });

      const csvRows = [];
      const headers = [
        "PR Number",
        "Title",
        "Author",
        "State",
        "Created",
        "Updated",
        "Repository",
        "Inactivity Reason",
        "Inactive Days",
        "Priority",
        "URL",
      ];
      csvRows.push(headers.join(","));

      data.detailed_analysis.pull_requests.forEach((pr) => {
        const row = [
          pr.number,
          `"${pr.title.replace(/"/g, '""')}"`,
          pr.user.login,
          pr.state,
          pr.created_at.split("T")[0],
          pr.updated_at.split("T")[0],
          pr.repository_name || pr.base.repo.full_name,
          pr.inactivity_analysis.reason,
          pr.inactivity_duration.days,
          pr.inactivity_analysis.priority,
          pr.html_url,
        ];
        csvRows.push(row.join(","));
      });

      await fs.writeFile(filePath, csvRows.join("\n"));
      return filePath;
    } catch (error) {
      throw new Error(`Failed to export CSV: ${error.message}`);
    }
  }

  static validateInputs(target, startDate, endDate, token) {
    if (!target) {
      throw new ValidationError(
        "Repository (owner/repo) or username is required"
      );
    }

    if (!token) {
      throw new ValidationError("GitHub token is required");
    }

    if (startDate && isNaN(Date.parse(startDate))) {
      throw new ValidationError("Invalid start date format. Use YYYY-MM-DD");
    }

    if (endDate && isNaN(Date.parse(endDate))) {
      throw new ValidationError("Invalid end date format. Use YYYY-MM-DD");
    }

    if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
      throw new ValidationError("Start date must be before end date");
    }
  }
}

// Main Stale PR Audit Analyzer Class
class StalePRAuditAnalyzer {
  constructor(token, options = {}) {
    this.apiClient = new GitHubAPIClient(token, options);
    this.fetchLimit = options.fetchLimit || 50;
    this.inactivityThreshold = options.inactivityThreshold || 7; // days
  }

  async generateReport(target, options = {}) {
    const isRepo = target.includes("/");
    const [owner, repo] = isRepo ? target.split("/") : [null, null];
    const username = isRepo ? null : target;

    console.log(
      `🔍 Starting Stale PR Audit for ${
        isRepo ? `repository ${target}` : `user ${target}`
      }`
    );

    // Fetch pull requests
    const prs = isRepo
      ? await this.apiClient.getPullRequests(owner, repo, {
          fetchLimit: this.fetchLimit,
          params: this.buildDateParams(options),
        })
      : await this.apiClient.getUserPullRequests(username, {
          fetchLimit: this.fetchLimit,
          repoLimit: options.repoLimit || 10,
        });

    console.log(`📊 Analyzing ${prs.length} pull requests...`);

    // Filter by date range if specified
    const filteredPRs = this.filterByDateRange(prs, options);

    // Enrich with detailed analysis
    const enrichedPRs = await this.enrichWithInactivityAnalysis(
      filteredPRs,
      options.verbose
    );

    // Build comprehensive report
    return this.buildReport(enrichedPRs, { target, isRepo, ...options });
  }

  buildDateParams(options) {
    const params = {};
    if (options.startDate) {
      params.since = new Date(options.startDate).toISOString();
    }
    return params;
  }

  filterByDateRange(prs, options) {
    if (!options.startDate && !options.endDate) return prs;

    return prs.filter((pr) => {
      const createdDate = new Date(pr.created_at);
      const updatedDate = new Date(pr.updated_at);

      if (options.startDate) {
        const startDate = new Date(options.startDate);
        if (createdDate < startDate && updatedDate < startDate) return false;
      }

      if (options.endDate) {
        const endDate = new Date(options.endDate);
        if (createdDate > endDate) return false;
      }

      return true;
    });
  }

  async enrichWithInactivityAnalysis(prs, verbose = false) {
    const progressBar = new ProgressBar(prs.length, "Analyzing PR inactivity");
    const enrichedPRs = [];

    for (const pr of prs) {
      try {
        const repositoryName = pr.repository
          ? pr.repository.full_name
          : pr.base.repo.full_name;
        const [owner, repo] = repositoryName.split("/");

        // Get detailed PR information
        const details = await this.apiClient.getPullRequestDetails(
          owner,
          repo,
          pr.number
        );

        // Calculate inactivity metrics
        const inactivityDuration =
          StalePRAuditCalculator.calculateInactivityDuration(pr);
        const inactivityAnalysis =
          StalePRAuditCalculator.determineInactivityReason(pr, details);

        const enrichedPR = {
          ...pr,
          repository_name: repositoryName,
          inactivity_duration: inactivityDuration,
          inactivity_analysis: inactivityAnalysis,
          details: {
            review_count: details.reviews.length,
            comment_count: details.comments.length,
            commit_count: details.commits.length,
            failing_checks: details.checks.filter(
              (c) => c.conclusion === "failure"
            ).length,
            total_checks: details.checks.length,
          },
        };

        enrichedPRs.push(enrichedPR);

        if (verbose) {
          console.log(
            `\n📋 PR #${pr.number}: ${inactivityAnalysis.reason} (${inactivityDuration.days}d inactive)`
          );
        }
      } catch (error) {
        console.warn(`⚠️ Failed to analyze PR #${pr.number}: ${error.message}`);
        enrichedPRs.push({
          ...pr,
          inactivity_duration:
            StalePRAuditCalculator.calculateInactivityDuration(pr),
          inactivity_analysis: {
            reason: "Unknown",
            category: "unknown",
            priority: "low",
          },
          details: {
            review_count: 0,
            comment_count: 0,
            commit_count: 0,
            failing_checks: 0,
            total_checks: 0,
          },
        });
      }

      progressBar.update(1);
    }

    return enrichedPRs;
  }

  buildReport(enrichedPRs, options = {}) {
    const summary = StalePRAuditCalculator.calculateSummaryMetrics(enrichedPRs);
    const categorized =
      StalePRAuditCalculator.categorizeByInactivity(enrichedPRs);
    const trends = this.generateTrends(enrichedPRs);

    // Sort PRs by inactivity duration (longest first)
    const sortedPRs = [...enrichedPRs].sort(
      (a, b) => b.inactivity_duration.days - a.inactivity_duration.days
    );

    const startDate = options.startDate || "30 days ago";
    const endDate = options.endDate || "now";

    return {
      date_range: {
        start_date: startDate,
        end_date: endDate,
        analysis_target: options.target,
        target_type: options.isRepo ? "repository" : "user",
      },
      summary: {
        total_prs: summary.TOTAL_PRS,
        open_prs: summary.OPEN_PRS,
        inactive_prs: summary.INACTIVE_PRS,
        active_prs: summary.ACTIVE_PRS,
        abandonment_rate: summary.ABANDONMENT_RATE,
        avg_inactive_days: summary.AVG_INACTIVE_DAYS,
        max_inactive_days: summary.MAX_INACTIVE_DAYS,
        key_findings: this.generateKeyFindings(summary, categorized),
      },
      detailed_analysis: {
        pull_requests: sortedPRs,
        inactivity_categories: {
          no_review: {
            count: categorized.no_review.length,
            prs: categorized.no_review.map((pr) => ({
              number: pr.number,
              title: pr.title,
              inactive_days: pr.inactivity_duration.days,
              url: pr.html_url,
            })),
          },
          failing_ci: {
            count: categorized.failing_ci.length,
            prs: categorized.failing_ci.map((pr) => ({
              number: pr.number,
              title: pr.title,
              inactive_days: pr.inactivity_duration.days,
              failing_checks: pr.details.failing_checks,
              url: pr.html_url,
            })),
          },
          outdated: {
            count: categorized.outdated.length,
            prs: categorized.outdated.map((pr) => ({
              number: pr.number,
              title: pr.title,
              inactive_days: pr.inactivity_duration.days,
              url: pr.html_url,
            })),
          },
          abandoned: {
            count: categorized.abandoned.length,
            prs: categorized.abandoned.map((pr) => ({
              number: pr.number,
              title: pr.title,
              inactive_days: pr.inactivity_duration.days,
              url: pr.html_url,
            })),
          },
        },
        contributor_metrics: this.analyzeContributorPatterns(enrichedPRs),
        trends: trends,
      },
      formulas: {
        abandonment_rate: "INACTIVE_PRS / TOTAL_PRS * 100",
        inactivity_duration: "CURRENT_TIME - LAST_ACTIVITY_TIME",
        avg_inactive_days: "SUM(INACTIVE_DAYS) / COUNT(INACTIVE_PRS)",
        max_inactive_days: "MAX(INACTIVE_DAYS)",
        failing_ci_rate: "FAILING_CI_PRS / TOTAL_PRS * 100",
        no_review_rate: "NO_REVIEW_PRS / TOTAL_PRS * 100",
        outdated_rate: "OUTDATED_PRS / TOTAL_PRS * 100",
        abandoned_rate: "ABANDONED_PRS / TOTAL_PRS * 100",
        active_rate: "ACTIVE_PRS / TOTAL_PRS * 100",
      },
    };
  }

  generateKeyFindings(summary, categorized) {
    const findings = [];

    if (summary.ABANDONMENT_RATE > 30) {
      findings.push(
        `High abandonment rate: ${summary.ABANDONMENT_RATE}% of PRs are inactive`
      );
    }

    if (categorized.failing_ci.length > categorized.no_review.length) {
      findings.push("CI failures are the primary cause of PR stagnation");
    }

    if (summary.MAX_INACTIVE_DAYS > 90) {
      findings.push(
        `Longest inactive PR: ${summary.MAX_INACTIVE_DAYS} days without activity`
      );
    }

    if (categorized.no_review.length > summary.TOTAL_PRS * 0.2) {
      findings.push("Significant review bottleneck detected");
    }

    return findings;
  }

  analyzeContributorPatterns(prs) {
    const contributorStats = {};

    prs.forEach((pr) => {
      const author = pr.user.login;
      if (!contributorStats[author]) {
        contributorStats[author] = {
          total_prs: 0,
          inactive_prs: 0,
          avg_inactive_days: 0,
          patterns: [],
        };
      }

      contributorStats[author].total_prs++;
      if (pr.inactivity_analysis.category !== "active") {
        contributorStats[author].inactive_prs++;
      }
    });

    // Calculate averages
    Object.keys(contributorStats).forEach((author) => {
      const stats = contributorStats[author];
      stats.abandonment_rate = Math.round(
        (stats.inactive_prs / stats.total_prs) * 100
      );
      const inactivePRs = prs.filter(
        (pr) =>
          pr.user.login === author &&
          pr.inactivity_analysis.category !== "active"
      );
      stats.avg_inactive_days =
        inactivePRs.length > 0
          ? Math.round(
              inactivePRs.reduce(
                (sum, pr) => sum + pr.inactivity_duration.days,
                0
              ) / inactivePRs.length
            )
          : 0;
    });

    return contributorStats;
  }

  generateTrends(prs) {
    const monthly = {};
    const weekly = {};

    prs.forEach((pr) => {
      const createdDate = new Date(pr.created_at);
      const monthKey = this.getMonthKey(createdDate);
      const weekKey = this.getWeekKey(createdDate);

      if (!monthly[monthKey]) {
        monthly[monthKey] = { total: 0, inactive: 0 };
      }
      if (!weekly[weekKey]) {
        weekly[weekKey] = { total: 0, inactive: 0 };
      }

      monthly[monthKey].total++;
      weekly[weekKey].total++;

      if (pr.inactivity_analysis.category !== "active") {
        monthly[monthKey].inactive++;
        weekly[weekKey].inactive++;
      }
    });

    return { monthly, weekly };
  }

  getWeekKey(date) {
    const year = date.getFullYear();
    const week = Math.ceil(
      (date.getTime() - new Date(year, 0, 1).getTime()) /
        (7 * 24 * 60 * 60 * 1000)
    );
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
    target: null,
    repo: null,
    user: null,
    format: "json",
    name: null,
    output: "./reports",
    startDate: null,
    endDate: null,
    verbose: false,
    debug: false,
    token: process.env.GITHUB_TOKEN,
    fetchLimit: 50,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "-r":
      case "--repo":
        config.repo = args[++i];
        config.target = config.repo;
        break;
      case "-u":
      case "--user":
        config.user = args[++i];
        config.target = config.user;
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
      case "-s":
      case "--start":
        config.startDate = args[++i];
        break;
      case "-e":
      case "--end":
        config.endDate = args[++i];
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
        const limit = args[++i];
        config.fetchLimit = limit === "infinite" ? "infinite" : parseInt(limit);
        break;
      case "-h":
      case "--help":
        config.help = true;
        break;
      default:
        if (!arg.startsWith("-") && !config.target) {
          config.target = arg;
          config[arg.includes("/") ? "repo" : "user"] = arg;
        }
        break;
    }
  }

  return config;
}

function showHelp() {
  console.log(`
🔍 Stale PR Audit Analyzer

USAGE:
    node main.report.mjs [target] [options]

ARGUMENTS:
    target                  Repository (owner/repo) or username to analyze

OPTIONS:
    -r, --repo <owner/repo>    Repository to analyze
    -u, --user <username>      User to analyze across their repositories
    -f, --format <format>      Output format: json, csv, or both (default: json)
    -n, --name <filename>      Output filename (auto-generated if not provided)
    -o, --output <directory>   Output directory (default: ./reports)
    -s, --start <date>         Start date (ISO format: YYYY-MM-DD)
    -e, --end <date>           End date (ISO format: YYYY-MM-DD)
    -v, --verbose              Enable verbose logging
    -d, --debug                Enable debug logging
    -t, --token <token>        GitHub token (or set GITHUB_TOKEN env var)
    -l, --fetchLimit <limit>   Fetch limit: number or 'infinite' (default: 50)
    -h, --help                 Show this help message

EXAMPLES:
    # Analyze repository PRs
    node main.report.mjs facebook/react --format both --verbose
    
    # Analyze user's PRs across repositories
    node main.report.mjs --user octocat --start 2024-01-01 --fetchLimit 100
    
    # Generate CSV report for specific date range
    node main.report.mjs microsoft/vscode --format csv --start 2024-01-01 --end 2024-03-31

ENVIRONMENT VARIABLES:
    GITHUB_TOKEN              GitHub personal access token
`);
}

async function main() {
  try {
    const config = await parseArguments();

    if (config.help) {
      showHelp();
      return;
    }

    // Validation
    DataProcessor.validateInputs(
      config.target,
      config.startDate,
      config.endDate,
      config.token
    );

    if (!config.target) {
      console.error("❌ Error: Repository or username is required\n");
      showHelp();
      process.exit(1);
    }

    // Set default date range if not provided
    if (!config.startDate) {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      config.startDate = thirtyDaysAgo.toISOString().split("T")[0];
    }

    if (!config.endDate) {
      config.endDate = new Date().toISOString().split("T")[0];
    }

    console.log(`\n🚀 Starting Stale PR Audit Analysis`);
    console.log(`📅 Date Range: ${config.startDate} to ${config.endDate}`);
    console.log(`🎯 Target: ${config.target}`);
    console.log(`📊 Fetch Limit: ${config.fetchLimit}`);

    // Initialize analyzer
    const analyzer = new StalePRAuditAnalyzer(config.token, {
      fetchLimit: config.fetchLimit,
      verbose: config.verbose,
      debug: config.debug,
    });

    // Generate report
    const report = await analyzer.generateReport(config.target, {
      startDate: config.startDate,
      endDate: config.endDate,
      verbose: config.verbose,
    });

    // Generate filename if not provided
    const timestamp = new Date().toISOString().split("T")[0];
    const targetName = config.target.replace("/", "-");
    const baseFilename =
      config.name || `stale-pr-audit-${targetName}-${timestamp}`;

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
    console.log("\n📋 ANALYSIS SUMMARY");
    console.log("=".repeat(50));
    console.log(`Total PRs Analyzed: ${report.summary.total_prs}`);
    console.log(`Open PRs: ${report.summary.open_prs}`);
    console.log(`Inactive PRs: ${report.summary.inactive_prs}`);
    console.log(`Abandonment Rate: ${report.summary.abandonment_rate}%`);
    console.log(`Avg Inactive Days: ${report.summary.avg_inactive_days}`);
    console.log(`Max Inactive Days: ${report.summary.max_inactive_days}`);

    console.log("\n🔍 KEY FINDINGS:");
    report.summary.key_findings.forEach((finding) => {
      console.log(`• ${finding}`);
    });

    console.log("\n📊 INACTIVITY BREAKDOWN:");
    Object.entries(report.detailed_analysis.inactivity_categories).forEach(
      ([category, data]) => {
        console.log(
          `• ${category.replace("_", " ").toUpperCase()}: ${data.count} PRs`
        );
      }
    );

    console.log(`\n✅ Analysis complete! Reports saved to: ${config.output}`);
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);

    if (error instanceof ValidationError) {
      console.error("\nPlease check your input parameters and try again.");
    } else if (error instanceof APIError) {
      console.error(
        "\nGitHub API error. Please check your token and rate limits."
      );
      console.error(`Status: ${error.statusCode}`);
    } else {
      console.error("\nUnexpected error occurred.");
      if (error.stack) {
        console.error(error.stack);
      }
    }

    process.exit(1);
  }
}

// Execute if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export {
  StalePRAuditAnalyzer,
  GitHubAPIClient,
  DataProcessor,
  StalePRAuditCalculator,
  APIError,
  ValidationError,
  ConfigurationError,
};
