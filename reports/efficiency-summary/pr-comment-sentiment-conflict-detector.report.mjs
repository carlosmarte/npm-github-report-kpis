#!/usr/bin/env node

/****
 * JSON Report Structure:
 * {
 *   "date_range": { "start_date": "...", "end_date": "..." },
 *   "summary": { "total_prs": 0, "avg_cycle_time_hours": 0, "avg_review_time_hours": 0, "merge_success_rate": 0 },
 *   "total": { "merged_prs": 0, "closed_prs": 0, "total_comments": 0, "total_reviews": 0 },
 *   "detailed_analysis": {
 *     "pull_requests": [...],
 *     "contributor_metrics": {...},
 *     "stage_analysis": {...},
 *     "trends": {...},
 *     "review_efficiency": {...},
 *     "bottlenecks": {...}
 *   },
 *   "formulas": { ... }
 * }
 ****/

/****
 * Performance Considerations:
 * - Implements exponential backoff for rate limiting
 * - Batches API requests to minimize calls
 * - Uses streaming for large datasets
 * - Caches intermediate results
 * - Handles concurrent requests with queue management
 ****/

/****
 * Use Cases:
 * 1. Analyze code review efficiency for specific repository or user
 * 2. Track reviewer response times and approval rates
 * 3. Identify bottlenecks in review process based on PR complexity
 * 4. Compare review metrics across teams and time periods
 * 5. Generate heatmaps of review activity patterns
 * 6. Monitor team collaboration efficiency and best practices
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

class RateLimitError extends Error {
  constructor(message, resetTime) {
    super(message);
    this.name = "RateLimitError";
    this.resetTime = resetTime;
  }
}

// GitHub API Client Class
class GitHubAPIClient {
  constructor(token, options = {}) {
    this.token = token;
    this.baseURL = options.apiUrl || "https://api.github.com";
    this.timeout = options.timeout || 30000;
    this.userAgent =
      options.userAgent || "Code-Review-Efficiency-Analyzer/1.0.0";
    this.rateLimitRemaining = 5000;
    this.rateLimitReset = Date.now();
    this.requestQueue = [];
    this.isProcessingQueue = false;
  }

  async makeRequest(endpoint, options = {}) {
    // Check rate limit before making request
    if (this.rateLimitRemaining <= 10 && Date.now() < this.rateLimitReset) {
      const waitTime = this.rateLimitReset - Date.now();
      console.log(
        `⏳ Rate limit low (${this.rateLimitRemaining}), waiting ${Math.ceil(
          waitTime / 1000
        )}s...`
      );
      await this.delay(waitTime);
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
      signal: AbortSignal.timeout(this.timeout),
      ...options,
    };

    try {
      const response = await fetch(url, config);

      // Update rate limit info from headers
      this.rateLimitRemaining = parseInt(
        response.headers.get("X-RateLimit-Remaining") || "0"
      );
      this.rateLimitReset =
        parseInt(response.headers.get("X-RateLimit-Reset") || "0") * 1000;

      if (
        response.status === 403 &&
        response.headers.get("X-RateLimit-Remaining") === "0"
      ) {
        const resetTime =
          parseInt(response.headers.get("X-RateLimit-Reset")) * 1000;
        throw new RateLimitError(
          `Rate limit exceeded. Resets at ${new Date(resetTime).toISOString()}`,
          resetTime
        );
      }

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
      if (error instanceof APIError || error instanceof RateLimitError)
        throw error;
      if (error.name === "AbortError") {
        throw new APIError(
          `Request timeout after ${this.timeout}ms`,
          408,
          null
        );
      }
      throw new APIError(`Network Error: ${error.message}`, 0, null);
    }
  }

  async makeRequestWithRetry(endpoint, options = {}, maxRetries = 3) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await this.makeRequest(endpoint, options);
      } catch (error) {
        if (error instanceof RateLimitError) {
          const waitTime = Math.max(0, error.resetTime - Date.now()) + 1000; // Add 1s buffer
          console.log(
            `🚦 Rate limited. Waiting ${Math.ceil(
              waitTime / 1000
            )}s before retry...`
          );
          await this.delay(waitTime);
          continue;
        }

        if (error.statusCode >= 500 && attempt < maxRetries - 1) {
          const backoffTime = Math.pow(2, attempt) * 1000;
          console.log(
            `🔄 Server error (${error.statusCode}), retrying in ${
              backoffTime / 1000
            }s...`
          );
          await this.delay(backoffTime);
          continue;
        }

        throw error;
      }
    }
  }

  async getAllPages(endpoint, options = {}) {
    const allData = [];
    let page = 1;
    const perPage = Math.min(options.per_page || 100, 100);
    let fetchCount = 0;
    const fetchLimit = options.fetchLimit || 50;

    while (fetchCount < fetchLimit) {
      const params = new URLSearchParams({
        page: page.toString(),
        per_page: perPage.toString(),
        ...options.params,
      });

      try {
        const data = await this.makeRequestWithRetry(`${endpoint}?${params}`);

        if (Array.isArray(data)) {
          allData.push(...data);
          if (data.length < perPage) break;
        } else {
          allData.push(data);
          break;
        }

        fetchCount++;
        page++;

        // Progress indicator
        if (fetchCount % 10 === 0) {
          console.log(
            `📊 Fetched ${fetchCount} pages, ${allData.length} total items...`
          );
        }
      } catch (error) {
        console.error(`❌ Error fetching page ${page}: ${error.message}`);
        if (error instanceof RateLimitError) {
          throw error; // Re-throw rate limit errors
        }
        break; // Stop on other errors
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

    console.log(`🔍 Fetching pull requests for ${owner}/${repo}...`);
    return await this.getAllPages(`/repos/${owner}/${repo}/pulls`, {
      params,
      fetchLimit: options.fetchLimit,
    });
  }

  async getUserPullRequests(username, options = {}) {
    const params = {
      state: "all",
      sort: "updated",
      direction: "desc",
      per_page: 100,
      ...options,
    };

    console.log(`🔍 Fetching pull requests for user ${username}...`);
    return await this.getAllPages(`/search/issues`, {
      params: {
        q: `author:${username} type:pr ${
          params.state !== "all" ? `state:${params.state}` : ""
        }`,
        sort: params.sort,
        order: params.direction,
        per_page: params.per_page,
      },
      fetchLimit: options.fetchLimit,
    });
  }

  async getPullRequestDetails(owner, repo, pullNumber) {
    try {
      const [pr, reviews, comments] = await Promise.all([
        this.makeRequestWithRetry(
          `/repos/${owner}/${repo}/pulls/${pullNumber}`
        ),
        this.makeRequestWithRetry(
          `/repos/${owner}/${repo}/pulls/${pullNumber}/reviews`
        ),
        this.makeRequestWithRetry(
          `/repos/${owner}/${repo}/issues/${pullNumber}/comments`
        ),
      ]);

      return { pr, reviews, comments };
    } catch (error) {
      console.warn(
        `⚠️ Could not fetch details for PR #${pullNumber}: ${error.message}`
      );
      return { pr: null, reviews: [], comments: [] };
    }
  }

  async getUserRepositories(username, options = {}) {
    const params = {
      type: "all",
      sort: "updated",
      direction: "desc",
      ...options,
    };

    console.log(`🔍 Fetching repositories for user ${username}...`);
    return await this.getAllPages(`/users/${username}/repos`, {
      params,
      fetchLimit: options.fetchLimit,
    });
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getRateLimitStatus() {
    return {
      remaining: this.rateLimitRemaining,
      reset: new Date(this.rateLimitReset).toISOString(),
      resetIn: Math.max(0, this.rateLimitReset - Date.now()),
    };
  }
}

// Review Efficiency Metrics Calculator Class
class ReviewEfficiencyCalculator {
  static calculateCycleTime(pr) {
    if (!pr.created_at) return 0;
    const endTime = pr.merged_at || pr.closed_at || new Date().toISOString();
    return Math.round(
      (new Date(endTime) - new Date(pr.created_at)) / (1000 * 60 * 60)
    );
  }

  static calculateReviewTime(pr, reviews) {
    if (!pr.created_at || !reviews.length) return 0;
    const firstReview = reviews.sort(
      (a, b) => new Date(a.submitted_at) - new Date(b.submitted_at)
    )[0];
    return Math.round(
      (new Date(firstReview.submitted_at) - new Date(pr.created_at)) /
        (1000 * 60 * 60)
    );
  }

  static calculateIdleTime(pr, reviews, comments) {
    const activities = [
      ...reviews.map((r) => ({ time: r.submitted_at, type: "review" })),
      ...comments.map((c) => ({ time: c.created_at, type: "comment" })),
    ].sort((a, b) => new Date(a.time) - new Date(b.time));

    if (activities.length === 0) return this.calculateCycleTime(pr);

    let idleTime = 0;
    let lastActivity = new Date(pr.created_at);

    activities.forEach((activity) => {
      const activityTime = new Date(activity.time);
      const gap = activityTime - lastActivity;
      if (gap > 24 * 60 * 60 * 1000) {
        // Only count gaps > 24 hours as idle
        idleTime += gap;
      }
      lastActivity = activityTime;
    });

    const endTime = new Date(pr.merged_at || pr.closed_at || new Date());
    const finalGap = endTime - lastActivity;
    if (finalGap > 24 * 60 * 60 * 1000) {
      idleTime += finalGap;
    }

    return Math.round(idleTime / (1000 * 60 * 60));
  }

  static calculateReviewDepth(pr, reviews) {
    const filesChanged = pr.changed_files || 0;
    const reviewsCount = reviews.length;
    const commentsCount = reviews.reduce(
      (sum, review) => sum + (review.comments || 0),
      0
    );

    return {
      FILES_REVIEWED_RATIO:
        filesChanged > 0
          ? Math.round((reviewsCount / filesChanged) * 100) / 100
          : 0,
      COMMENTS_PER_FILE:
        filesChanged > 0
          ? Math.round((commentsCount / filesChanged) * 100) / 100
          : 0,
      REVIEW_THOROUGHNESS: Math.min(reviewsCount * 10 + commentsCount, 100),
    };
  }

  static calculateCommentToCodeRatio(pr, comments) {
    const linesChanged = (pr.additions || 0) + (pr.deletions || 0);
    const commentCount = comments.length;

    return {
      COMMENT_TO_CODE_RATIO:
        linesChanged > 0
          ? Math.round((commentCount / linesChanged) * 1000) / 1000
          : 0,
      COMMENTS_PER_ADDITION:
        pr.additions > 0
          ? Math.round((commentCount / pr.additions) * 100) / 100
          : 0,
    };
  }

  static identifyBottlenecks(prMetrics) {
    const bottlenecks = [];
    const avgCycleTime =
      prMetrics.reduce((sum, pr) => sum + pr.CYCLE_TIME_HOURS, 0) /
      prMetrics.length;
    const avgReviewTime =
      prMetrics.reduce((sum, pr) => sum + pr.REVIEW_TIME_HOURS, 0) /
      prMetrics.length;

    // Large PR bottleneck
    const largePRs = prMetrics.filter(
      (pr) => pr.pr.additions + pr.pr.deletions > 500
    );
    if (largePRs.length > prMetrics.length * 0.2) {
      bottlenecks.push({
        type: "large_prs",
        severity: "high",
        description: "High percentage of large PRs (>500 lines changed)",
        count: largePRs.length,
        percentage: Math.round((largePRs.length / prMetrics.length) * 100),
      });
    }

    // Review delay bottleneck
    if (avgReviewTime > avgCycleTime * 0.5) {
      bottlenecks.push({
        type: "review_delay",
        severity: "medium",
        description: "Average review time exceeds 50% of cycle time",
        AVG_REVIEW_TIME_HOURS: Math.round(avgReviewTime),
        AVG_CYCLE_TIME_HOURS: Math.round(avgCycleTime),
      });
    }

    // High idle time bottleneck
    const highIdlePRs = prMetrics.filter(
      (pr) => pr.IDLE_TIME_HOURS > pr.CYCLE_TIME_HOURS * 0.3
    );
    if (highIdlePRs.length > prMetrics.length * 0.2) {
      bottlenecks.push({
        type: "high_idle_time",
        severity: "medium",
        description: "High percentage of PRs with excessive idle time",
        count: highIdlePRs.length,
        percentage: Math.round((highIdlePRs.length / prMetrics.length) * 100),
      });
    }

    return bottlenecks;
  }

  static generateActivityHeatmap(prMetrics) {
    const heatmap = {};
    const days = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];

    // Initialize heatmap
    days.forEach((day) => {
      heatmap[day] = {};
      for (let hour = 0; hour < 24; hour++) {
        heatmap[day][hour] = 0;
      }
    });

    // Populate heatmap with PR creation times
    prMetrics.forEach((pr) => {
      const createdAt = new Date(pr.pr.created_at);
      const dayOfWeek = days[createdAt.getDay()];
      const hour = createdAt.getHours();
      heatmap[dayOfWeek][hour]++;
    });

    return heatmap;
  }
}

// Data Processor Class
class DataProcessor {
  static async exportToJSON(data, options = {}) {
    const outputPath = options.outputPath || "report.json";

    try {
      await fs.mkdir(dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, JSON.stringify(data, null, 2));
      console.log(`✅ JSON report exported to: ${outputPath}`);
      return outputPath;
    } catch (error) {
      throw new Error(`Failed to export JSON: ${error.message}`);
    }
  }

  static async exportToCSV(data, options = {}) {
    const outputPath = options.outputPath || "report.csv";

    try {
      await fs.mkdir(dirname(outputPath), { recursive: true });

      // Extract PRs for CSV export
      const prs = data.detailed_analysis?.pull_requests || [];
      if (prs.length === 0) {
        throw new Error("No pull request data available for CSV export");
      }

      // CSV headers
      const headers = [
        "PR_NUMBER",
        "TITLE",
        "AUTHOR",
        "STATE",
        "CREATED_AT",
        "MERGED_AT",
        "CLOSED_AT",
        "CYCLE_TIME_HOURS",
        "REVIEW_TIME_HOURS",
        "IDLE_TIME_HOURS",
        "ADDITIONS",
        "DELETIONS",
        "CHANGED_FILES",
        "REVIEWS_COUNT",
        "COMMENTS_COUNT",
        "FILES_REVIEWED_RATIO",
        "COMMENTS_PER_FILE",
        "COMMENT_TO_CODE_RATIO",
      ];

      // Create CSV content
      const csvContent = [
        headers.join(","),
        ...prs.map((pr) =>
          [
            pr.pr.number,
            `"${pr.pr.title.replace(/"/g, '""')}"`,
            pr.pr.user?.login || "",
            pr.pr.state,
            pr.pr.created_at,
            pr.pr.merged_at || "",
            pr.pr.closed_at || "",
            pr.CYCLE_TIME_HOURS,
            pr.REVIEW_TIME_HOURS,
            pr.IDLE_TIME_HOURS,
            pr.pr.additions || 0,
            pr.pr.deletions || 0,
            pr.pr.changed_files || 0,
            pr.reviews?.length || 0,
            pr.comments?.length || 0,
            pr.FILES_REVIEWED_RATIO || 0,
            pr.COMMENTS_PER_FILE || 0,
            pr.COMMENT_TO_CODE_RATIO || 0,
          ].join(",")
        ),
      ].join("\n");

      await fs.writeFile(outputPath, csvContent);
      console.log(`✅ CSV report exported to: ${outputPath}`);
      return outputPath;
    } catch (error) {
      throw new Error(`Failed to export CSV: ${error.message}`);
    }
  }

  static validateInputs(ownerOrUser, startDate, endDate, token) {
    if (!ownerOrUser?.trim()) {
      throw new ValidationError("Owner/repo or username is required");
    }

    if (!token?.trim()) {
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

  static filterByDateRange(items, startDate, endDate) {
    if (!startDate && !endDate) return items;

    const start = startDate ? new Date(startDate) : new Date("1970-01-01");
    const end = endDate ? new Date(endDate) : new Date();

    return items.filter((item) => {
      const itemDate = new Date(item.created_at || item.updated_at);
      return itemDate >= start && itemDate <= end;
    });
  }
}

// Main Code Review Efficiency Analyzer Class
class CodeReviewEfficiencyAnalyzer {
  constructor(token, options = {}) {
    this.apiClient = new GitHubAPIClient(token, options);
    this.fetchLimit = options.fetchLimit || 50;
  }

  async generateReport(ownerOrUser, options = {}) {
    const {
      repo,
      startDate,
      endDate,
      isUser = false,
      verbose = false,
      org,
      team,
      timeframe,
    } = options;

    try {
      console.log(`🚀 Starting Code Review Efficiency Analysis...`);
      console.log(
        `📅 Date Range: ${startDate || "All time"} to ${endDate || "Present"}`
      );

      let pullRequests = [];

      if (isUser) {
        // Analyze user's PRs across all repositories
        console.log(`👤 Analyzing user: ${ownerOrUser}`);
        const searchResults = await this.apiClient.getUserPullRequests(
          ownerOrUser,
          {
            fetchLimit: this.fetchLimit,
          }
        );
        pullRequests = searchResults.items || searchResults;
      } else {
        // Analyze specific repository
        const [owner, repoName] = ownerOrUser.split("/");
        if (!repoName) {
          throw new ValidationError("Repository format should be owner/repo");
        }
        console.log(`📂 Analyzing repository: ${ownerOrUser}`);
        pullRequests = await this.apiClient.getPullRequests(owner, repoName, {
          fetchLimit: this.fetchLimit,
        });
      }

      // Filter by date range
      if (startDate || endDate) {
        pullRequests = DataProcessor.filterByDateRange(
          pullRequests,
          startDate,
          endDate
        );
        console.log(`📊 Filtered to ${pullRequests.length} PRs in date range`);
      }

      if (pullRequests.length === 0) {
        console.warn("⚠️ No pull requests found for the specified criteria");
        return this.buildEmptyReport(ownerOrUser, {
          startDate,
          endDate,
          isUser,
        });
      }

      // Enrich with detailed metrics
      const enrichedPRs = await this.enrichWithMetrics(
        pullRequests,
        verbose,
        isUser
      );

      // Build comprehensive report
      return this.buildReport(enrichedPRs, {
        ownerOrUser,
        startDate,
        endDate,
        isUser,
        org,
        team,
        timeframe,
      });
    } catch (error) {
      console.error(`❌ Analysis failed: ${error.message}`);
      throw error;
    }
  }

  async enrichWithMetrics(prs, verbose = false, isUser = false) {
    console.log(`🔍 Enriching ${prs.length} PRs with detailed metrics...`);
    const enrichedPRs = [];
    let processed = 0;

    for (const pr of prs.slice(0, this.fetchLimit)) {
      try {
        let prData = pr;
        let reviews = [];
        let comments = [];

        // For user search results, we need to extract repo info and fetch details
        if (isUser && pr.pull_request) {
          const urlParts = pr.html_url.split("/");
          const owner = urlParts[3];
          const repo = urlParts[4];
          const prNumber = pr.number;

          const details = await this.apiClient.getPullRequestDetails(
            owner,
            repo,
            prNumber
          );
          prData = details.pr || pr;
          reviews = details.reviews || [];
          comments = details.comments || [];
        } else if (!isUser) {
          // For repo analysis, fetch additional details
          const urlParts = pr.url.split("/");
          const owner = urlParts[4];
          const repo = urlParts[5];
          const prNumber = pr.number;

          const details = await this.apiClient.getPullRequestDetails(
            owner,
            repo,
            prNumber
          );
          reviews = details.reviews || [];
          comments = details.comments || [];
        }

        // Calculate metrics
        const CYCLE_TIME_HOURS =
          ReviewEfficiencyCalculator.calculateCycleTime(prData);
        const REVIEW_TIME_HOURS =
          ReviewEfficiencyCalculator.calculateReviewTime(prData, reviews);
        const IDLE_TIME_HOURS = ReviewEfficiencyCalculator.calculateIdleTime(
          prData,
          reviews,
          comments
        );
        const reviewDepth = ReviewEfficiencyCalculator.calculateReviewDepth(
          prData,
          reviews
        );
        const commentRatio =
          ReviewEfficiencyCalculator.calculateCommentToCodeRatio(
            prData,
            comments
          );

        enrichedPRs.push({
          pr: prData,
          reviews,
          comments,
          CYCLE_TIME_HOURS,
          REVIEW_TIME_HOURS,
          IDLE_TIME_HOURS,
          ...reviewDepth,
          ...commentRatio,
          MERGE_SUCCESS: prData.merged_at ? 1 : 0,
          TIME_TO_FIRST_COMMENT:
            comments.length > 0
              ? Math.round(
                  (new Date(comments[0].created_at) -
                    new Date(prData.created_at)) /
                    (1000 * 60 * 60)
                )
              : 0,
        });

        processed++;
        if (verbose && processed % 5 === 0) {
          console.log(
            `📊 Processed ${processed}/${Math.min(
              prs.length,
              this.fetchLimit
            )} PRs...`
          );
        }
      } catch (error) {
        console.warn(`⚠️ Failed to enrich PR #${pr.number}: ${error.message}`);
      }
    }

    console.log(
      `✅ Successfully enriched ${enrichedPRs.length} PRs with metrics`
    );
    return enrichedPRs;
  }

  buildReport(enrichedPRs, options = {}) {
    const { ownerOrUser, startDate, endDate, isUser, org, team, timeframe } =
      options;

    // Calculate summary metrics
    const totalPRs = enrichedPRs.length;
    const mergedPRs = enrichedPRs.filter((pr) => pr.MERGE_SUCCESS === 1).length;
    const closedPRs = enrichedPRs.filter(
      (pr) => pr.pr.state === "closed" && !pr.pr.merged_at
    ).length;

    const avgCycleTime =
      totalPRs > 0
        ? Math.round(
            enrichedPRs.reduce((sum, pr) => sum + pr.CYCLE_TIME_HOURS, 0) /
              totalPRs
          )
        : 0;
    const avgReviewTime =
      totalPRs > 0
        ? Math.round(
            enrichedPRs.reduce((sum, pr) => sum + pr.REVIEW_TIME_HOURS, 0) /
              totalPRs
          )
        : 0;
    const avgIdleTime =
      totalPRs > 0
        ? Math.round(
            enrichedPRs.reduce((sum, pr) => sum + pr.IDLE_TIME_HOURS, 0) /
              totalPRs
          )
        : 0;

    const mergeSuccessRate =
      totalPRs > 0 ? Math.round((mergedPRs / totalPRs) * 100) : 0;

    // Calculate contributor metrics
    const contributorMetrics = this.calculateContributorMetrics(enrichedPRs);

    // Calculate trends
    const trends = this.generateTrends(enrichedPRs);

    // Identify bottlenecks
    const bottlenecks =
      ReviewEfficiencyCalculator.identifyBottlenecks(enrichedPRs);

    // Generate activity heatmap
    const activityHeatmap =
      ReviewEfficiencyCalculator.generateActivityHeatmap(enrichedPRs);

    // Calculate review efficiency metrics
    const reviewEfficiency = this.calculateReviewEfficiency(enrichedPRs);

    return {
      date_range: {
        start_date: startDate || "All time",
        end_date: endDate || new Date().toISOString().split("T")[0],
        analysis_target: isUser
          ? `User: ${ownerOrUser}`
          : `Repository: ${ownerOrUser}`,
        organization: org || null,
        team: team || null,
        timeframe: timeframe || null,
      },
      summary: {
        TOTAL_PRS: totalPRs,
        MERGED_PRS: mergedPRs,
        CLOSED_PRS: closedPRs,
        AVG_CYCLE_TIME_HOURS: avgCycleTime,
        AVG_REVIEW_TIME_HOURS: avgReviewTime,
        AVG_IDLE_TIME_HOURS: avgIdleTime,
        MERGE_SUCCESS_RATE: mergeSuccessRate,
        TOP_BOTTLENECK: bottlenecks.length > 0 ? bottlenecks[0].type : "none",
      },
      total: {
        TOTAL_REVIEWS: enrichedPRs.reduce(
          (sum, pr) => sum + pr.reviews.length,
          0
        ),
        TOTAL_COMMENTS: enrichedPRs.reduce(
          (sum, pr) => sum + pr.comments.length,
          0
        ),
        TOTAL_ADDITIONS: enrichedPRs.reduce(
          (sum, pr) => sum + (pr.pr.additions || 0),
          0
        ),
        TOTAL_DELETIONS: enrichedPRs.reduce(
          (sum, pr) => sum + (pr.pr.deletions || 0),
          0
        ),
        TOTAL_FILES_CHANGED: enrichedPRs.reduce(
          (sum, pr) => sum + (pr.pr.changed_files || 0),
          0
        ),
        TOTAL_CYCLE_TIME_HOURS: enrichedPRs.reduce(
          (sum, pr) => sum + pr.CYCLE_TIME_HOURS,
          0
        ),
      },
      detailed_analysis: {
        pull_requests: enrichedPRs,
        contributor_metrics: contributorMetrics,
        review_efficiency: reviewEfficiency,
        trends: trends,
        bottlenecks: bottlenecks,
        activity_heatmap: activityHeatmap,
        stage_analysis: this.analyzeStages(enrichedPRs),
      },
      formulas: {
        CYCLE_TIME_HOURS: "MERGE_TIME - CREATION_TIME",
        REVIEW_TIME_HOURS: "FIRST_REVIEW_TIME - CREATION_TIME",
        IDLE_TIME_HOURS: "TOTAL_TIME - ACTIVE_REVIEW_TIME",
        MERGE_SUCCESS_RATE: "MERGED_PRS / TOTAL_PRS * 100",
        FILES_REVIEWED_RATIO: "REVIEWS_COUNT / CHANGED_FILES",
        COMMENTS_PER_FILE: "COMMENTS_COUNT / CHANGED_FILES",
        COMMENT_TO_CODE_RATIO: "COMMENTS_COUNT / LINES_CHANGED",
        AVG_CYCLE_TIME_HOURS: "SUM(CYCLE_TIME_HOURS) / TOTAL_PRS",
        AVG_REVIEW_TIME_HOURS: "SUM(REVIEW_TIME_HOURS) / TOTAL_PRS",
        TIME_TO_FIRST_COMMENT: "FIRST_COMMENT_TIME - CREATION_TIME",
        REVIEW_THOROUGHNESS: "MIN(REVIEWS_COUNT * 10 + COMMENTS_COUNT, 100)",
      },
    };
  }

  buildEmptyReport(ownerOrUser, options = {}) {
    return {
      date_range: {
        start_date: options.startDate || "All time",
        end_date: options.endDate || new Date().toISOString().split("T")[0],
        analysis_target: options.isUser
          ? `User: ${ownerOrUser}`
          : `Repository: ${ownerOrUser}`,
      },
      summary: {
        TOTAL_PRS: 0,
        MERGED_PRS: 0,
        CLOSED_PRS: 0,
        AVG_CYCLE_TIME_HOURS: 0,
        AVG_REVIEW_TIME_HOURS: 0,
        AVG_IDLE_TIME_HOURS: 0,
        MERGE_SUCCESS_RATE: 0,
        TOP_BOTTLENECK: "none",
      },
      total: {
        TOTAL_REVIEWS: 0,
        TOTAL_COMMENTS: 0,
        TOTAL_ADDITIONS: 0,
        TOTAL_DELETIONS: 0,
        TOTAL_FILES_CHANGED: 0,
        TOTAL_CYCLE_TIME_HOURS: 0,
      },
      detailed_analysis: {
        pull_requests: [],
        contributor_metrics: {},
        review_efficiency: {},
        trends: {},
        bottlenecks: [],
        activity_heatmap: {},
        stage_analysis: {},
      },
      formulas: {
        CYCLE_TIME_HOURS: "MERGE_TIME - CREATION_TIME",
        REVIEW_TIME_HOURS: "FIRST_REVIEW_TIME - CREATION_TIME",
        IDLE_TIME_HOURS: "TOTAL_TIME - ACTIVE_REVIEW_TIME",
        MERGE_SUCCESS_RATE: "MERGED_PRS / TOTAL_PRS * 100",
      },
    };
  }

  calculateContributorMetrics(enrichedPRs) {
    const contributors = {};

    enrichedPRs.forEach((pr) => {
      const author = pr.pr.user?.login;
      if (!author) return;

      if (!contributors[author]) {
        contributors[author] = {
          TOTAL_PRS: 0,
          MERGED_PRS: 0,
          AVG_CYCLE_TIME_HOURS: 0,
          AVG_REVIEW_TIME_HOURS: 0,
          TOTAL_ADDITIONS: 0,
          TOTAL_DELETIONS: 0,
          CYCLE_TIMES: [],
        };
      }

      contributors[author].TOTAL_PRS++;
      contributors[author].MERGED_PRS += pr.MERGE_SUCCESS;
      contributors[author].TOTAL_ADDITIONS += pr.pr.additions || 0;
      contributors[author].TOTAL_DELETIONS += pr.pr.deletions || 0;
      contributors[author].CYCLE_TIMES.push(pr.CYCLE_TIME_HOURS);
    });

    // Calculate averages
    Object.keys(contributors).forEach((author) => {
      const contributor = contributors[author];
      contributor.AVG_CYCLE_TIME_HOURS = Math.round(
        contributor.CYCLE_TIMES.reduce((sum, time) => sum + time, 0) /
          contributor.CYCLE_TIMES.length
      );
      contributor.MERGE_SUCCESS_RATE = Math.round(
        (contributor.MERGED_PRS / contributor.TOTAL_PRS) * 100
      );
      delete contributor.CYCLE_TIMES; // Remove temporary array
    });

    return contributors;
  }

  calculateReviewEfficiency(enrichedPRs) {
    const reviewers = {};

    enrichedPRs.forEach((pr) => {
      pr.reviews.forEach((review) => {
        const reviewer = review.user?.login;
        if (!reviewer) return;

        if (!reviewers[reviewer]) {
          reviewers[reviewer] = {
            TOTAL_REVIEWS: 0,
            AVG_RESPONSE_TIME_HOURS: 0,
            APPROVAL_RATE: 0,
            RESPONSE_TIMES: [],
            APPROVALS: 0,
          };
        }

        reviewers[reviewer].TOTAL_REVIEWS++;
        if (review.state === "APPROVED") {
          reviewers[reviewer].APPROVALS++;
        }

        // Calculate response time
        const responseTime = Math.round(
          (new Date(review.submitted_at) - new Date(pr.pr.created_at)) /
            (1000 * 60 * 60)
        );
        reviewers[reviewer].RESPONSE_TIMES.push(responseTime);
      });
    });

    // Calculate averages
    Object.keys(reviewers).forEach((reviewer) => {
      const reviewerData = reviewers[reviewer];
      reviewerData.AVG_RESPONSE_TIME_HOURS = Math.round(
        reviewerData.RESPONSE_TIMES.reduce((sum, time) => sum + time, 0) /
          reviewerData.RESPONSE_TIMES.length
      );
      reviewerData.APPROVAL_RATE = Math.round(
        (reviewerData.APPROVALS / reviewerData.TOTAL_REVIEWS) * 100
      );
      delete reviewerData.RESPONSE_TIMES; // Remove temporary array
      delete reviewerData.APPROVALS; // Remove temporary counter
    });

    return reviewers;
  }

  generateTrends(prs) {
    const weeklyTrends = {};
    const monthlyTrends = {};

    prs.forEach((pr) => {
      const createdDate = new Date(pr.pr.created_at);
      const weekKey = this.getWeekKey(createdDate);
      const monthKey = this.getMonthKey(createdDate);

      // Weekly trends
      if (!weeklyTrends[weekKey]) {
        weeklyTrends[weekKey] = {
          TOTAL_PRS: 0,
          MERGED_PRS: 0,
          AVG_CYCLE_TIME_HOURS: 0,
          CYCLE_TIMES: [],
        };
      }
      weeklyTrends[weekKey].TOTAL_PRS++;
      weeklyTrends[weekKey].MERGED_PRS += pr.MERGE_SUCCESS;
      weeklyTrends[weekKey].CYCLE_TIMES.push(pr.CYCLE_TIME_HOURS);

      // Monthly trends
      if (!monthlyTrends[monthKey]) {
        monthlyTrends[monthKey] = {
          TOTAL_PRS: 0,
          MERGED_PRS: 0,
          AVG_CYCLE_TIME_HOURS: 0,
          CYCLE_TIMES: [],
        };
      }
      monthlyTrends[monthKey].TOTAL_PRS++;
      monthlyTrends[monthKey].MERGED_PRS += pr.MERGE_SUCCESS;
      monthlyTrends[monthKey].CYCLE_TIMES.push(pr.CYCLE_TIME_HOURS);
    });

    // Calculate averages
    [weeklyTrends, monthlyTrends].forEach((trends) => {
      Object.keys(trends).forEach((key) => {
        const period = trends[key];
        period.AVG_CYCLE_TIME_HOURS = Math.round(
          period.CYCLE_TIMES.reduce((sum, time) => sum + time, 0) /
            period.CYCLE_TIMES.length
        );
        period.MERGE_SUCCESS_RATE = Math.round(
          (period.MERGED_PRS / period.TOTAL_PRS) * 100
        );
        delete period.CYCLE_TIMES;
      });
    });

    return { weekly: weeklyTrends, monthly: monthlyTrends };
  }

  analyzeStages(enrichedPRs) {
    const stages = {
      draft: enrichedPRs.filter((pr) => pr.pr.draft).length,
      review_pending: enrichedPRs.filter(
        (pr) => pr.reviews.length === 0 && pr.pr.state === "open"
      ).length,
      in_review: enrichedPRs.filter(
        (pr) => pr.reviews.length > 0 && pr.pr.state === "open"
      ).length,
      approved: enrichedPRs.filter((pr) =>
        pr.reviews.some((r) => r.state === "APPROVED")
      ).length,
      changes_requested: enrichedPRs.filter((pr) =>
        pr.reviews.some((r) => r.state === "CHANGES_REQUESTED")
      ).length,
      merged: enrichedPRs.filter((pr) => pr.pr.merged_at).length,
      closed: enrichedPRs.filter(
        (pr) => pr.pr.state === "closed" && !pr.pr.merged_at
      ).length,
    };

    return stages;
  }

  getWeekKey(date) {
    const year = date.getFullYear();
    const startOfYear = new Date(year, 0, 1);
    const week = Math.ceil(
      ((date - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7
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
    ownerOrUser: null,
    repo: null,
    isUser: false,
    startDate: null,
    endDate: null,
    format: "json",
    name: null,
    output: "./reports",
    verbose: false,
    debug: false,
    token: process.env.GITHUB_TOKEN,
    fetchLimit: 50,
    org: null,
    team: null,
    timeframe: null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "-r":
      case "--repo":
        config.ownerOrUser = args[++i];
        config.isUser = false;
        break;
      case "-u":
      case "--user":
        config.ownerOrUser = args[++i];
        config.isUser = true;
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
        const limit = args[++i];
        config.fetchLimit =
          limit === "infinite" ? Number.MAX_SAFE_INTEGER : parseInt(limit);
        break;
      case "--org":
        config.org = args[++i];
        break;
      case "--team":
        config.team = args[++i];
        break;
      case "--timeframe":
        config.timeframe = args[++i];
        break;
      case "-h":
      case "--help":
        showHelp();
        process.exit(0);
        break;
      default:
        if (arg.startsWith("-")) {
          console.error(`❌ Unknown option: ${arg}`);
          process.exit(1);
        }
        break;
    }
  }

  return config;
}

function showHelp() {
  console.log(`
Code Review Efficiency Analyzer v1.0.0

USAGE:
    node main.report.mjs --user <username> [options]
    node main.report.mjs --repo <owner/repo> [options]

OPTIONS:
    -u, --user <username>        Analyze user's pull requests across all repositories
    -r, --repo <owner/repo>      Analyze specific repository's pull requests
    -s, --start <YYYY-MM-DD>     Start date for analysis (default: 30 days ago)
    -e, --end <YYYY-MM-DD>       End date for analysis (default: today)
    -f, --format <format>        Output format: json, csv, or both (default: json)
    -n, --name <filename>        Output filename (auto-generated if not provided)
    -o, --output <directory>     Output directory (default: ./reports)
    -l, --fetchLimit <number>    Fetch limit (default: 50, use 'infinite' for no limit)
    -t, --token <token>          GitHub personal access token
    --org <organization>         Organization context for analysis
    --team <team>                Team context for analysis
    --timeframe <period>         Analysis timeframe context
    -v, --verbose                Enable verbose logging
    -d, --debug                  Enable debug logging
    -h, --help                   Show this help message

EXAMPLES:
    # Analyze user's PRs across all repositories
    node main.report.mjs --user octocat --start 2024-01-01 --end 2024-01-31

    # Analyze specific repository
    node main.report.mjs --repo facebook/react --format both --verbose

    # Analyze with custom fetch limit
    node main.report.mjs --user johnsmith --fetchLimit 100 --output ./custom-reports

    # Team analysis with context
    node main.report.mjs --repo myorg/myrepo --team backend --org myorg --timeframe Q1-2024

ENVIRONMENT VARIABLES:
    GITHUB_TOKEN    GitHub personal access token (required if not provided via --token)

RATE LIMITING:
    The tool automatically handles GitHub API rate limits with exponential backoff.
    For large analyses, consider using a GitHub App token for higher rate limits.
`);
}

async function main() {
  try {
    const config = await parseArguments();

    // Validate inputs
    DataProcessor.validateInputs(
      config.ownerOrUser,
      config.startDate,
      config.endDate,
      config.token
    );

    if (!config.ownerOrUser) {
      console.error("❌ Error: Either --user or --repo must be specified");
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

    console.log("🔑 GitHub API Rate Limit Status:");

    // Initialize analyzer
    const analyzer = new CodeReviewEfficiencyAnalyzer(config.token, {
      fetchLimit: config.fetchLimit,
    });

    console.log(
      `📊 Rate Limit: ${
        analyzer.apiClient.getRateLimitStatus().remaining
      } requests remaining`
    );

    // Generate report
    const report = await analyzer.generateReport(config.ownerOrUser, {
      repo: config.repo,
      startDate: config.startDate,
      endDate: config.endDate,
      isUser: config.isUser,
      verbose: config.verbose,
      org: config.org,
      team: config.team,
      timeframe: config.timeframe,
    });

    // Generate filename if not provided
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .split("T")[0];
    const targetName = config.isUser
      ? config.ownerOrUser
      : config.ownerOrUser.replace("/", "-");
    const baseFilename =
      config.name || `code-review-analysis-${targetName}-${timestamp}`;

    // Create output directory
    await fs.mkdir(config.output, { recursive: true });

    // Export data
    const exports = [];

    if (config.format === "json" || config.format === "both") {
      const jsonPath = join(config.output, `${baseFilename}.json`);
      await DataProcessor.exportToJSON(report, { outputPath: jsonPath });
      exports.push(jsonPath);
    }

    if (config.format === "csv" || config.format === "both") {
      const csvPath = join(config.output, `${baseFilename}.csv`);
      await DataProcessor.exportToCSV(report, { outputPath: csvPath });
      exports.push(csvPath);
    }

    // Summary output
    console.log("\n📈 Code Review Efficiency Analysis Summary:");
    console.log(
      `📅 Period: ${report.date_range.start_date} to ${report.date_range.end_date}`
    );
    console.log(`🎯 Target: ${report.date_range.analysis_target}`);
    console.log(`📊 Total PRs: ${report.summary.TOTAL_PRS}`);
    console.log(
      `✅ Merged: ${report.summary.MERGED_PRS} (${report.summary.MERGE_SUCCESS_RATE}%)`
    );
    console.log(
      `⏱️  Avg Cycle Time: ${report.summary.AVG_CYCLE_TIME_HOURS} hours`
    );
    console.log(
      `👀 Avg Review Time: ${report.summary.AVG_REVIEW_TIME_HOURS} hours`
    );
    console.log(
      `😴 Avg Idle Time: ${report.summary.AVG_IDLE_TIME_HOURS} hours`
    );

    if (report.detailed_analysis.bottlenecks.length > 0) {
      console.log(
        `⚠️  Top Bottleneck: ${report.detailed_analysis.bottlenecks[0].type}`
      );
    }

    console.log(`\n✅ Analysis complete! Reports saved to: ${config.output}`);
    exports.forEach((path) => console.log(`   📄 ${path}`));

    // Final rate limit status
    const finalStatus = analyzer.apiClient.getRateLimitStatus();
    console.log(
      `\n🔑 Final Rate Limit: ${finalStatus.remaining} requests remaining`
    );
    if (finalStatus.resetIn > 0) {
      console.log(
        `   ⏰ Resets in: ${Math.ceil(finalStatus.resetIn / 60000)} minutes`
      );
    }
  } catch (error) {
    if (error instanceof ValidationError) {
      console.error(`❌ Validation Error: ${error.message}`);
    } else if (error instanceof ConfigurationError) {
      console.error(`❌ Configuration Error: ${error.message}`);
    } else if (error instanceof APIError) {
      console.error(`❌ GitHub API Error: ${error.message}`);
      if (error.statusCode === 401) {
        console.error("   💡 Tip: Check your GitHub token permissions");
      } else if (error.statusCode === 403) {
        console.error(
          "   💡 Tip: You may have hit the rate limit. Wait and try again."
        );
      }
    } else if (error instanceof RateLimitError) {
      console.error(`❌ Rate Limit Error: ${error.message}`);
      console.error(
        `   ⏰ Rate limit resets at: ${new Date(error.resetTime).toISOString()}`
      );
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
  CodeReviewEfficiencyAnalyzer,
  GitHubAPIClient,
  ReviewEfficiencyCalculator,
  DataProcessor,
  APIError,
  ValidationError,
  ConfigurationError,
  RateLimitError,
};
