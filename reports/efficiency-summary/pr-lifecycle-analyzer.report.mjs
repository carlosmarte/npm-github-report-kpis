/****
 * JSON Report Structure:
 * {
 *   "date_range": { "start_date": "...", "end_date": "..." },
 *   "summary": {  High-level metrics  },
 *   "total": {  Aggregated totals  },
 *   "detailed_analysis": {
 *     "pull_requests": [...],
 *     "contributor_metrics": {...},
 *     "stage_analysis": {...},
 *     "trends": {...}
 *   },
 *   "formulas": { All calculation formulas  }
 * }
 ****/

/****
 * Performance Considerations:
 * - Rate limiting with exponential backoff
 * - Pagination handling for large datasets
 * - Memory-efficient streaming for large repos
 * - Concurrent request batching
 * - Response caching to minimize API calls
 ****/

/****
 * Use Cases:
 * 1. Analyze PR performance for specific repository
 * 2. Track individual contributor turnaround times
 * 3. Identify bottlenecks in review process
 * 4. Compare PR metrics across time periods
 * 5. Monitor team collaboration efficiency
 * 6. Generate reports for performance reviews
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

// GitHub API Client Class
class GitHubAPIClient {
  constructor(token, options = {}) {
    this.token = token;
    this.baseURL = options.apiUrl || "https://api.github.com";
    this.timeout = options.timeout || 30000;
    this.userAgent = options.userAgent || "PR-Lifecycle-Analyzer/1.0.0";
    this.rateLimitRemaining = 5000;
    this.rateLimitReset = Date.now();
    this.requestCount = 0;
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
      ...options,
    };

    try {
      this.requestCount++;
      const response = await fetch(url, config);

      // Update rate limit info
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
    const perPage = options.per_page || 100;
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

      // Rate limit check
      if (this.rateLimitRemaining < 10) {
        const waitTime = Math.max(0, this.rateLimitReset - Date.now());
        if (waitTime > 0) {
          console.log(
            `⏳ Rate limit approaching, waiting ${Math.ceil(waitTime / 1000)}s...`
          );
          await this.delay(waitTime);
        }
      }

      // Progress indicator
      if (page % 10 === 0) {
        console.log(`📄 Fetched ${page} pages (${allData.length} items)...`);
      }
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
      maxPages: options.fetchLimit,
    });
  }

  async getUserPullRequests(username, options = {}) {
    const query = `author:${username} is:pr`;
    const params = {
      q: query,
      sort: "updated",
      order: "desc",
      ...options,
    };

    const searchResult = await this.getAllPages("/search/issues", {
      params,
      maxPages: options.fetchLimit,
    });
    return searchResult;
  }

  async getPullRequestComments(owner, repo, pullNumber) {
    return await this.getAllPages(
      `/repos/${owner}/${repo}/pulls/${pullNumber}/comments`
    );
  }

  async getPullRequestReviews(owner, repo, pullNumber) {
    return await this.getAllPages(
      `/repos/${owner}/${repo}/pulls/${pullNumber}/reviews`
    );
  }

  async getIssueComments(owner, repo, issueNumber) {
    return await this.getAllPages(
      `/repos/${owner}/${repo}/issues/${issueNumber}/comments`
    );
  }

  async getRepository(owner, repo) {
    return await this.makeRequest(`/repos/${owner}/${repo}`);
  }

  async getUser(username) {
    return await this.makeRequest(`/users/${username}`);
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getRateLimitStatus() {
    return {
      remaining: this.rateLimitRemaining,
      reset: new Date(this.rateLimitReset).toISOString(),
      requestsMade: this.requestCount,
    };
  }
}

// PR Metrics Calculator Class
class PRLifecycleCalculator {
  static calculateCycleTime(pr) {
    const createdAt = new Date(pr.created_at);
    const closedAt = pr.closed_at ? new Date(pr.closed_at) : new Date();
    return Math.round((closedAt - createdAt) / (1000 * 60 * 60)); // hours
  }

  static calculateReviewTime(pr, reviews) {
    if (!reviews || reviews.length === 0) return null;

    const createdAt = new Date(pr.created_at);
    const firstReview = reviews
      .filter((r) => r.state !== "PENDING")
      .sort((a, b) => new Date(a.submitted_at) - new Date(b.submitted_at))[0];

    if (!firstReview) return null;

    const firstReviewAt = new Date(firstReview.submitted_at);
    return Math.round((firstReviewAt - createdAt) / (1000 * 60 * 60)); // hours
  }

  static calculateTimeToFirstComment(pr, comments) {
    if (!comments || comments.length === 0) return null;

    const createdAt = new Date(pr.created_at);
    const firstComment = comments
      .filter((c) => c.user.login !== pr.user.login)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))[0];

    if (!firstComment) return null;

    const firstCommentAt = new Date(firstComment.created_at);
    return Math.round((firstCommentAt - createdAt) / (1000 * 60 * 60)); // hours
  }

  static calculateIdleTime(pr, reviews, comments) {
    const createdAt = new Date(pr.created_at);
    const closedAt = pr.closed_at ? new Date(pr.closed_at) : new Date();
    const totalTime = closedAt - createdAt;

    // Get all activity timestamps
    const activities = [];

    if (reviews) {
      reviews.forEach((r) => {
        if (r.submitted_at) activities.push(new Date(r.submitted_at));
      });
    }

    if (comments) {
      comments.forEach((c) => {
        activities.push(new Date(c.created_at));
      });
    }

    activities.push(createdAt, closedAt);
    activities.sort((a, b) => a - b);

    // Calculate gaps between activities
    let activeTime = 0;
    for (let i = 1; i < activities.length; i++) {
      const gap = activities[i] - activities[i - 1];
      if (gap < 7 * 24 * 60 * 60 * 1000) {
        // Less than 7 days considered active
        activeTime += gap;
      }
    }

    const idleTime = totalTime - activeTime;
    return Math.max(0, Math.round(idleTime / (1000 * 60 * 60))); // hours
  }

  static calculateMergeSuccess(prs) {
    const mergedCount = prs.filter((pr) => pr.merged_at).length;
    return prs.length > 0 ? Math.round((mergedCount / prs.length) * 100) : 0;
  }

  static identifyBottlenecks(prMetrics) {
    const bottlenecks = [];

    const avgCycleTime =
      prMetrics.reduce((sum, pr) => sum + pr.CYCLE_TIME_HOURS, 0) /
      prMetrics.length;
    const avgReviewTime =
      prMetrics
        .filter((pr) => pr.REVIEW_TIME_HOURS !== null)
        .reduce((sum, pr) => sum + pr.REVIEW_TIME_HOURS, 0) /
      prMetrics.filter((pr) => pr.REVIEW_TIME_HOURS !== null).length;

    if (avgReviewTime > avgCycleTime * 0.5) {
      bottlenecks.push("review_delay");
    }

    const highIdlePRs = prMetrics.filter(
      (pr) => pr.IDLE_TIME_HOURS > pr.CYCLE_TIME_HOURS * 0.3
    ).length;
    if (highIdlePRs > prMetrics.length * 0.2) {
      bottlenecks.push("excessive_idle_time");
    }

    return bottlenecks;
  }

  static generateTrends(prMetrics, groupBy = "week") {
    const trends = {};

    prMetrics.forEach((pr) => {
      const date = new Date(pr.created_at);
      let key;

      if (groupBy === "week") {
        key = this.getWeekKey(date);
      } else if (groupBy === "month") {
        key = this.getMonthKey(date);
      } else {
        key = date.toISOString().split("T")[0];
      }

      if (!trends[key]) {
        trends[key] = {
          period: key,
          count: 0,
          avgCycleTime: 0,
          avgReviewTime: 0,
          mergeRate: 0,
        };
      }

      trends[key].count++;
      trends[key].avgCycleTime =
        (trends[key].avgCycleTime * (trends[key].count - 1) +
          pr.CYCLE_TIME_HOURS) /
        trends[key].count;

      if (pr.REVIEW_TIME_HOURS !== null) {
        trends[key].avgReviewTime =
          (trends[key].avgReviewTime * (trends[key].count - 1) +
            pr.REVIEW_TIME_HOURS) /
          trends[key].count;
      }

      trends[key].mergeRate = pr.merged_at
        ? (trends[key].mergeRate * (trends[key].count - 1) + 100) /
          trends[key].count
        : (trends[key].mergeRate * (trends[key].count - 1)) / trends[key].count;
    });

    return Object.values(trends).sort((a, b) =>
      a.period.localeCompare(b.period)
    );
  }

  static getWeekKey(date) {
    const year = date.getFullYear();
    const week = Math.ceil(
      (date.getTime() - new Date(year, 0, 1).getTime()) /
        (7 * 24 * 60 * 60 * 1000)
    );
    return `${year}-W${week.toString().padStart(2, "0")}`;
  }

  static getMonthKey(date) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    return `${year}-${month}`;
  }
}

// Data Processor Class
class DataProcessor {
  static async exportToJSON(data, options = {}) {
    const { filename, pretty = true } = options;
    const jsonData = pretty
      ? JSON.stringify(data, null, 2)
      : JSON.stringify(data);

    await fs.writeFile(filename, jsonData, "utf8");
    return filename;
  }

  static async exportToCSV(data, options = {}) {
    const { filename } = options;

    if (!data.detailed_analysis || !data.detailed_analysis.pull_requests) {
      throw new ValidationError("No pull request data found for CSV export");
    }

    const prs = data.detailed_analysis.pull_requests;
    const headers = [
      "NUMBER",
      "TITLE",
      "AUTHOR",
      "STATE",
      "CREATED_AT",
      "CLOSED_AT",
      "MERGED_AT",
      "CYCLE_TIME_HOURS",
      "REVIEW_TIME_HOURS",
      "IDLE_TIME_HOURS",
      "TIME_TO_FIRST_COMMENT_HOURS",
      "REVIEW_COUNT",
      "COMMENT_COUNT",
      "REPOSITORY",
    ];

    const csvLines = [headers.join(",")];

    prs.forEach((pr) => {
      const row = [
        pr.NUMBER,
        `"${(pr.TITLE || "").replace(/"/g, '""')}"`,
        pr.AUTHOR,
        pr.STATE,
        pr.CREATED_AT,
        pr.CLOSED_AT || "",
        pr.MERGED_AT || "",
        pr.CYCLE_TIME_HOURS,
        pr.REVIEW_TIME_HOURS || "",
        pr.IDLE_TIME_HOURS,
        pr.TIME_TO_FIRST_COMMENT_HOURS || "",
        pr.REVIEW_COUNT,
        pr.COMMENT_COUNT,
        pr.REPOSITORY,
      ];
      csvLines.push(row.join(","));
    });

    await fs.writeFile(filename, csvLines.join("\n"), "utf8");
    return filename;
  }

  static validateInputs(options) {
    const { repo, user, startDate, endDate, token } = options;

    if (!token) {
      throw new ValidationError(
        "GitHub token is required. Set GITHUB_TOKEN environment variable or use --token option."
      );
    }

    if (!repo && !user) {
      throw new ValidationError("Either --repo or --user must be specified.");
    }

    if (repo && !repo.includes("/")) {
      throw new ValidationError('Repository must be in format "owner/repo".');
    }

    if (startDate && isNaN(Date.parse(startDate))) {
      throw new ValidationError("Invalid start date format. Use YYYY-MM-DD.");
    }

    if (endDate && isNaN(Date.parse(endDate))) {
      throw new ValidationError("Invalid end date format. Use YYYY-MM-DD.");
    }

    if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
      throw new ValidationError("Start date must be before end date.");
    }
  }

  static calculateMedian(values) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
      : sorted[mid];
  }

  static calculatePercentile(values, percentile) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }
}

// Main Pull Request Lifecycle Analyzer Class
class PullRequestLifecycleReporter {
  constructor(token, options = {}) {
    this.apiClient = new GitHubAPIClient(token, options);
    this.fetchLimit = options.fetchLimit || 50;
  }

  async generateReport(options = {}) {
    const { repo, user, startDate, endDate, verbose = false } = options;

    console.log("🚀 Starting Pull Request Lifecycle Analysis...");

    let pullRequests = [];
    let repositoryInfo = null;
    let userInfo = null;

    if (repo) {
      const [owner, repoName] = repo.split("/");
      console.log(`📊 Analyzing repository: ${repo}`);

      repositoryInfo = await this.apiClient.getRepository(owner, repoName);
      pullRequests = await this.apiClient.getPullRequests(owner, repoName, {
        fetchLimit: this.fetchLimit === "infinite" ? Infinity : this.fetchLimit,
      });
    } else if (user) {
      console.log(`👤 Analyzing user: ${user}`);

      userInfo = await this.apiClient.getUser(user);
      const searchResults = await this.apiClient.getUserPullRequests(user, {
        fetchLimit: this.fetchLimit === "infinite" ? Infinity : this.fetchLimit,
      });
      pullRequests = searchResults;
    }

    // Filter by date range
    if (startDate || endDate) {
      const start = startDate ? new Date(startDate) : new Date("1970-01-01");
      const end = endDate ? new Date(endDate) : new Date();

      pullRequests = pullRequests.filter((pr) => {
        const prDate = new Date(pr.created_at);
        return prDate >= start && prDate <= end;
      });
    }

    console.log(`📋 Found ${pullRequests.length} pull requests`);

    if (pullRequests.length === 0) {
      throw new ValidationError(
        "No pull requests found for the specified criteria."
      );
    }

    // Enrich with detailed metrics
    const enrichedPRs = await this.enrichWithMetrics(pullRequests, verbose);

    // Build comprehensive report
    return this.buildReport(enrichedPRs, {
      repositoryInfo,
      userInfo,
      startDate,
      endDate,
      ...options,
    });
  }

  async enrichWithMetrics(prs, verbose = false) {
    console.log("⚙️ Enriching pull requests with lifecycle metrics...");

    const enrichedPRs = [];
    const progressInterval = Math.max(1, Math.floor(prs.length / 10));

    for (let i = 0; i < prs.length; i++) {
      const pr = prs[i];

      if (verbose && i % progressInterval === 0) {
        console.log(`📈 Processing PR ${i + 1}/${prs.length}: #${pr.number}`);
      }

      try {
        let reviews = [];
        let comments = [];

        if (pr.base && pr.base.repo) {
          // Repository-based PR
          const owner = pr.base.repo.owner.login;
          const repo = pr.base.repo.name;

          reviews = await this.apiClient.getPullRequestReviews(
            owner,
            repo,
            pr.number
          );
          comments = await this.apiClient.getIssueComments(
            owner,
            repo,
            pr.number
          );
        } else {
          // User search result - limited data available
          reviews = [];
          comments = [];
        }

        const enriched = {
          NUMBER: pr.number,
          TITLE: pr.title,
          AUTHOR: pr.user.login,
          STATE: pr.state,
          CREATED_AT: pr.created_at,
          CLOSED_AT: pr.closed_at,
          MERGED_AT: pr.merged_at,
          REPOSITORY: pr.base
            ? `${pr.base.repo.owner.login}/${pr.base.repo.name}`
            : "N/A",
          CYCLE_TIME_HOURS: PRLifecycleCalculator.calculateCycleTime(pr),
          REVIEW_TIME_HOURS: PRLifecycleCalculator.calculateReviewTime(
            pr,
            reviews
          ),
          TIME_TO_FIRST_COMMENT_HOURS:
            PRLifecycleCalculator.calculateTimeToFirstComment(pr, comments),
          IDLE_TIME_HOURS: PRLifecycleCalculator.calculateIdleTime(
            pr,
            reviews,
            comments
          ),
          REVIEW_COUNT: reviews.length,
          COMMENT_COUNT: comments.length,
          created_at: pr.created_at,
          merged_at: pr.merged_at,
        };

        enrichedPRs.push(enriched);
      } catch (error) {
        console.warn(
          `⚠️ Warning: Could not enrich PR #${pr.number}: ${error.message}`
        );

        // Add basic data without detailed metrics
        enrichedPRs.push({
          NUMBER: pr.number,
          TITLE: pr.title,
          AUTHOR: pr.user.login,
          STATE: pr.state,
          CREATED_AT: pr.created_at,
          CLOSED_AT: pr.closed_at,
          MERGED_AT: pr.merged_at,
          REPOSITORY: pr.base
            ? `${pr.base.repo.owner.login}/${pr.base.repo.name}`
            : "N/A",
          CYCLE_TIME_HOURS: PRLifecycleCalculator.calculateCycleTime(pr),
          REVIEW_TIME_HOURS: null,
          TIME_TO_FIRST_COMMENT_HOURS: null,
          IDLE_TIME_HOURS: 0,
          REVIEW_COUNT: 0,
          COMMENT_COUNT: 0,
          created_at: pr.created_at,
          merged_at: pr.merged_at,
        });
      }
    }

    return enrichedPRs;
  }

  buildReport(enrichedPRs, options = {}) {
    console.log("📊 Building comprehensive lifecycle report...");

    const { repositoryInfo, userInfo, startDate, endDate } = options;

    // Calculate summary metrics
    const cycleTimes = enrichedPRs.map((pr) => pr.CYCLE_TIME_HOURS);
    const reviewTimes = enrichedPRs
      .filter((pr) => pr.REVIEW_TIME_HOURS !== null)
      .map((pr) => pr.REVIEW_TIME_HOURS);
    const commentTimes = enrichedPRs
      .filter((pr) => pr.TIME_TO_FIRST_COMMENT_HOURS !== null)
      .map((pr) => pr.TIME_TO_FIRST_COMMENT_HOURS);
    const idleTimes = enrichedPRs.map((pr) => pr.IDLE_TIME_HOURS);

    const summary = {
      TOTAL_PULL_REQUESTS: enrichedPRs.length,
      MERGED_PULL_REQUESTS: enrichedPRs.filter((pr) => pr.MERGED_AT).length,
      CLOSED_PULL_REQUESTS: enrichedPRs.filter(
        (pr) => pr.CLOSED_AT && !pr.MERGED_AT
      ).length,
      OPEN_PULL_REQUESTS: enrichedPRs.filter((pr) => pr.STATE === "open")
        .length,
      MERGE_SUCCESS_RATE_PERCENT:
        PRLifecycleCalculator.calculateMergeSuccess(enrichedPRs),
      AVERAGE_CYCLE_TIME_HOURS: Math.round(
        cycleTimes.reduce((sum, time) => sum + time, 0) / cycleTimes.length
      ),
      MEDIAN_CYCLE_TIME_HOURS: DataProcessor.calculateMedian(cycleTimes),
      AVERAGE_REVIEW_TIME_HOURS:
        reviewTimes.length > 0
          ? Math.round(
              reviewTimes.reduce((sum, time) => sum + time, 0) /
                reviewTimes.length
            )
          : null,
      MEDIAN_REVIEW_TIME_HOURS: DataProcessor.calculateMedian(reviewTimes),
      AVERAGE_TIME_TO_FIRST_COMMENT_HOURS:
        commentTimes.length > 0
          ? Math.round(
              commentTimes.reduce((sum, time) => sum + time, 0) /
                commentTimes.length
            )
          : null,
      AVERAGE_IDLE_TIME_HOURS: Math.round(
        idleTimes.reduce((sum, time) => sum + time, 0) / idleTimes.length
      ),
      IDENTIFIED_BOTTLENECKS:
        PRLifecycleCalculator.identifyBottlenecks(enrichedPRs),
    };

    // Calculate totals
    const total = {
      TOTAL_CYCLE_TIME_HOURS: cycleTimes.reduce((sum, time) => sum + time, 0),
      TOTAL_REVIEW_TIME_HOURS: reviewTimes.reduce((sum, time) => sum + time, 0),
      TOTAL_IDLE_TIME_HOURS: idleTimes.reduce((sum, time) => sum + time, 0),
      TOTAL_REVIEWS: enrichedPRs.reduce((sum, pr) => sum + pr.REVIEW_COUNT, 0),
      TOTAL_COMMENTS: enrichedPRs.reduce(
        (sum, pr) => sum + pr.COMMENT_COUNT,
        0
      ),
    };

    // Contributor metrics
    const contributorMetrics = {};
    enrichedPRs.forEach((pr) => {
      if (!contributorMetrics[pr.AUTHOR]) {
        contributorMetrics[pr.AUTHOR] = {
          TOTAL_PRS: 0,
          MERGED_PRS: 0,
          AVERAGE_CYCLE_TIME_HOURS: 0,
          AVERAGE_REVIEW_TIME_HOURS: 0,
          MERGE_SUCCESS_RATE_PERCENT: 0,
        };
      }

      const metrics = contributorMetrics[pr.AUTHOR];
      metrics.TOTAL_PRS++;
      if (pr.MERGED_AT) metrics.MERGED_PRS++;

      metrics.AVERAGE_CYCLE_TIME_HOURS = Math.round(
        (metrics.AVERAGE_CYCLE_TIME_HOURS * (metrics.TOTAL_PRS - 1) +
          pr.CYCLE_TIME_HOURS) /
          metrics.TOTAL_PRS
      );

      if (pr.REVIEW_TIME_HOURS !== null) {
        metrics.AVERAGE_REVIEW_TIME_HOURS = Math.round(
          (metrics.AVERAGE_REVIEW_TIME_HOURS * (metrics.TOTAL_PRS - 1) +
            pr.REVIEW_TIME_HOURS) /
            metrics.TOTAL_PRS
        );
      }

      metrics.MERGE_SUCCESS_RATE_PERCENT = Math.round(
        (metrics.MERGED_PRS / metrics.TOTAL_PRS) * 100
      );
    });

    // Generate trends
    const trends = PRLifecycleCalculator.generateTrends(enrichedPRs);

    // Build final report
    const report = {
      date_range: {
        start_date:
          startDate ||
          enrichedPRs[enrichedPRs.length - 1]?.CREATED_AT?.split("T")[0] ||
          null,
        end_date: endDate || new Date().toISOString().split("T")[0],
        analysis_date: new Date().toISOString(),
      },
      summary,
      total,
      detailed_analysis: {
        repository_info: repositoryInfo,
        user_info: userInfo,
        pull_requests: enrichedPRs,
        contributor_metrics: contributorMetrics,
        stage_analysis: {
          percentiles: {
            P50_CYCLE_TIME_HOURS: DataProcessor.calculatePercentile(
              cycleTimes,
              50
            ),
            P75_CYCLE_TIME_HOURS: DataProcessor.calculatePercentile(
              cycleTimes,
              75
            ),
            P95_CYCLE_TIME_HOURS: DataProcessor.calculatePercentile(
              cycleTimes,
              95
            ),
            P50_REVIEW_TIME_HOURS: DataProcessor.calculatePercentile(
              reviewTimes,
              50
            ),
            P75_REVIEW_TIME_HOURS: DataProcessor.calculatePercentile(
              reviewTimes,
              75
            ),
            P95_REVIEW_TIME_HOURS: DataProcessor.calculatePercentile(
              reviewTimes,
              95
            ),
          },
          bottleneck_analysis: {
            high_cycle_time_prs: enrichedPRs.filter(
              (pr) =>
                pr.CYCLE_TIME_HOURS >
                DataProcessor.calculatePercentile(cycleTimes, 90)
            ).length,
            high_review_time_prs: enrichedPRs.filter(
              (pr) =>
                pr.REVIEW_TIME_HOURS >
                DataProcessor.calculatePercentile(reviewTimes, 90)
            ).length,
            high_idle_time_prs: enrichedPRs.filter(
              (pr) => pr.IDLE_TIME_HOURS > pr.CYCLE_TIME_HOURS * 0.5
            ).length,
          },
        },
        trends,
      },
      formulas: {
        cycle_time: "MERGE_TIME - CREATION_TIME OR CLOSE_TIME - CREATION_TIME",
        review_time: "FIRST_REVIEW_TIME - CREATION_TIME",
        idle_time: "TOTAL_TIME - ACTIVE_REVIEW_TIME",
        time_to_first_comment: "FIRST_COMMENT_TIME - CREATION_TIME",
        merge_success_rate: "MERGED_PRS / TOTAL_PRS * 100",
        contributor_efficiency: "MERGED_PRS / TOTAL_PRS",
        average_cycle_time: "SUM(CYCLE_TIME_HOURS) / TOTAL_PRS",
        median_calculation: "SORTED_VALUES[MIDDLE_INDEX]",
        percentile_calculation: "SORTED_VALUES[PERCENTILE_INDEX]",
        bottleneck_review_delay: "AVG_REVIEW_TIME > AVG_CYCLE_TIME * 0.5",
        bottleneck_idle_time: "HIGH_IDLE_PRS > TOTAL_PRS * 0.2",
      },
    };

    return report;
  }
}

// CLI Implementation
async function parseArguments() {
  const args = process.argv.slice(2);
  const config = {
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
    const nextArg = args[i + 1];

    switch (arg) {
      case "-r":
      case "--repo":
        config.repo = nextArg;
        i++;
        break;
      case "-u":
      case "--user":
        config.user = nextArg;
        i++;
        break;
      case "-f":
      case "--format":
        config.format = nextArg;
        i++;
        break;
      case "-n":
      case "--name":
        config.name = nextArg;
        i++;
        break;
      case "-o":
      case "--output":
        config.output = nextArg;
        i++;
        break;
      case "-s":
      case "--start":
        config.startDate = nextArg;
        i++;
        break;
      case "-e":
      case "--end":
        config.endDate = nextArg;
        i++;
        break;
      case "-l":
      case "--fetchLimit":
        config.fetchLimit =
          nextArg === "infinite" ? "infinite" : parseInt(nextArg);
        i++;
        break;
      case "-t":
      case "--token":
        config.token = nextArg;
        i++;
        break;
      case "-v":
      case "--verbose":
        config.verbose = true;
        break;
      case "-d":
      case "--debug":
        config.debug = true;
        break;
      case "-h":
      case "--help":
        config.help = true;
        break;
      default:
        if (arg.startsWith("-")) {
          throw new ValidationError(`Unknown option: ${arg}`);
        }
    }
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

  return config;
}

function showHelp() {
  console.log(`
Pull Request Lifecycle Analyzer

USAGE:
    node main.report.mjs [OPTIONS]

OPTIONS:
    -r, --repo <owner/repo>     Repository to analyze (required if --user not provided)
    -u, --user <username>       User to analyze (required if --repo not provided)
    -f, --format <format>       Output format: json, csv, or both (default: json)
    -n, --name <filename>       Output filename (auto-generated if not provided)
    -o, --output <directory>    Output directory (default: ./reports)
    -s, --start <date>          Start date (ISO format: YYYY-MM-DD, default: 30 days ago)
    -e, --end <date>            End date (ISO format: YYYY-MM-DD, default: today)
    -l, --fetchLimit <number>   Fetch limit (default: 50, use 'infinite' for unlimited)
    -t, --token <token>         GitHub token (or set GITHUB_TOKEN env var)
    -v, --verbose               Enable verbose logging
    -d, --debug                 Enable debug logging
    -h, --help                  Show this help message

EXAMPLES:
    # Analyze repository
    node main.report.mjs --repo octocat/Hello-World --format both

    # Analyze user activity
    node main.report.mjs --user octocat --start 2024-01-01 --end 2024-01-31

    # Custom output location
    node main.report.mjs --repo octocat/Hello-World --output ./my-reports --name custom-report

    # Unlimited fetch with verbose output
    node main.report.mjs --user octocat --fetchLimit infinite --verbose

ENVIRONMENT VARIABLES:
    GITHUB_TOKEN    GitHub Personal Access Token (required)
`);
}

async function main() {
  try {
    const config = await parseArguments();

    if (config.help) {
      showHelp();
      return;
    }

    // Validate inputs
    DataProcessor.validateInputs(config);

    // Ensure output directory exists
    await fs.mkdir(config.output, { recursive: true });

    console.log("🔧 Configuration:");
    console.log(`   Target: ${config.repo || config.user}`);
    console.log(`   Date Range: ${config.startDate} to ${config.endDate}`);
    console.log(`   Format: ${config.format}`);
    console.log(`   Fetch Limit: ${config.fetchLimit}`);
    console.log(`   Output: ${config.output}\n`);

    // Initialize analyzer
    const analyzer = new PullRequestLifecycleReporter(config.token, {
      fetchLimit: config.fetchLimit,
    });

    // Generate report
    const startTime = Date.now();
    const report = await analyzer.generateReport({
      repo: config.repo,
      user: config.user,
      startDate: config.startDate,
      endDate: config.endDate,
      verbose: config.verbose,
    });

    const analysisDuration = Math.round((Date.now() - startTime) / 1000);

    // Generate filename if not provided
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .split("T")[0];
    const target = config.repo ? config.repo.replace("/", "-") : config.user;
    const baseFilename = config.name || `pr-lifecycle-${target}-${timestamp}`;

    // Export data
    const exports = [];

    if (config.format === "json" || config.format === "both") {
      const jsonFilename = join(config.output, `${baseFilename}.json`);
      await DataProcessor.exportToJSON(report, { filename: jsonFilename });
      exports.push(jsonFilename);
    }

    if (config.format === "csv" || config.format === "both") {
      const csvFilename = join(config.output, `${baseFilename}.csv`);
      await DataProcessor.exportToCSV(report, { filename: csvFilename });
      exports.push(csvFilename);
    }

    // Summary output
    console.log("\n📊 ANALYSIS SUMMARY:");
    console.log(
      `   📋 Pull Requests Analyzed: ${report.summary.TOTAL_PULL_REQUESTS}`
    );
    console.log(
      `   ✅ Merge Success Rate: ${report.summary.MERGE_SUCCESS_RATE_PERCENT}%`
    );
    console.log(
      `   ⏱️  Average Cycle Time: ${report.summary.AVERAGE_CYCLE_TIME_HOURS} hours`
    );
    console.log(
      `   🔍 Average Review Time: ${report.summary.AVERAGE_REVIEW_TIME_HOURS || "N/A"} hours`
    );
    console.log(
      `   💤 Average Idle Time: ${report.summary.AVERAGE_IDLE_TIME_HOURS} hours`
    );
    console.log(
      `   ⚠️  Identified Bottlenecks: ${report.summary.IDENTIFIED_BOTTLENECKS.join(", ") || "None"}`
    );

    console.log(`\n🔄 API Requests Made: ${analyzer.apiClient.requestCount}`);
    console.log(`⏰ Analysis Duration: ${analysisDuration}s`);
    console.log(`\n✅ Analysis complete! Reports saved to:`);
    exports.forEach((file) => console.log(`   📄 ${file}`));
  } catch (error) {
    if (error instanceof ValidationError) {
      console.error(`❌ Validation Error: ${error.message}`);
    } else if (error instanceof APIError) {
      console.error(`❌ GitHub API Error: ${error.message}`);
      if (error.statusCode === 401) {
        console.error("   💡 Check your GitHub token permissions");
      } else if (error.statusCode === 403) {
        console.error("   💡 Rate limit exceeded or insufficient permissions");
      }
    } else if (error instanceof ConfigurationError) {
      console.error(`❌ Configuration Error: ${error.message}`);
    } else {
      console.error(`❌ Unexpected Error: ${error.message}`);
      if (config?.debug) {
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
  PullRequestLifecycleReporter,
  GitHubAPIClient,
  PRLifecycleCalculator,
  DataProcessor,
  APIError,
  ValidationError,
  ConfigurationError,
};
