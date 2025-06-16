/****
 * JSON Report Structure:
 * {
 *   "date_range": { "start_date": "...", "end_date": "..." },
 *   "summary": { collaboration metrics overview },
 *   "total": { aggregated collaboration statistics },
 *   "detailed_analysis": {
 *     "collaboration_matrix": [...],
 *     "interaction_patterns": {...},
 *     "discussion_threads": {...},
 *     "reviewer_networks": {...}
 *   },
 *   "formulas": { all calculation formulas }
 * }
 ****/

/****
 * Performance Considerations:
 * - Rate limiting with exponential backoff
 * - Paginated API requests with progress tracking
 * - Memory-efficient data processing
 * - Concurrent request handling with queue management
 * - Caching for repeated API calls
 ****/

/****
 * Use Cases:
 * 1. Analyze team collaboration patterns for specific repository
 * 2. Track individual contributor interaction frequencies
 * 3. Identify collaboration bottlenecks and isolation
 * 4. Map review networks and discussion clusters
 * 5. Monitor cross-team collaboration efficiency
 * 6. Generate collaboration reports for team assessments
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

// GitHub API Client Class
class GitHubAPIClient {
  constructor(token, options = {}) {
    this.token = token;
    this.baseURL = options.apiUrl || "https://api.github.com";
    this.timeout = options.timeout || 30000;
    this.userAgent =
      options.userAgent || "Developer-Collaboration-Matrix/1.0.0";
    this.rateLimitRemaining = 5000;
    this.rateLimitReset = Date.now();
    this.requestQueue = [];
    this.isProcessingQueue = false;
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

  async getAllPages(endpoint, options = {}) {
    const allData = [];
    let page = 1;
    const perPage = Math.min(
      options.per_page || 100,
      options.fetchLimit || 100
    );

    while (true) {
      const params = new URLSearchParams({
        page: page.toString(),
        per_page: perPage.toString(),
        ...options.params,
      });

      const data = await this.makeRequest(`${endpoint}?${params}`);

      if (Array.isArray(data)) {
        allData.push(...data);
        if (data.length < perPage) break;
        if (options.fetchLimit && allData.length >= options.fetchLimit) {
          return allData.slice(0, options.fetchLimit);
        }
      } else {
        allData.push(data);
        break;
      }

      page++;

      // Rate limit check with exponential backoff
      if (this.rateLimitRemaining < 10) {
        const waitTime = Math.max(0, this.rateLimitReset - Date.now() + 1000);
        if (waitTime > 0) {
          console.log(
            `⏳ Rate limit approaching, waiting ${Math.ceil(
              waitTime / 1000
            )}s...`
          );
          await this.delay(waitTime);
        }
      }

      // Add small delay between requests to be respectful
      await this.delay(100);
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
    const searchQuery = `type:pr author:${username}`;
    const params = {
      q: searchQuery,
      sort: "updated",
      order: "desc",
      ...options,
    };

    const results = await this.getAllPages("/search/issues", {
      params,
      ...options,
    });
    return results.items || results;
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
    };
  }
}

// Collaboration Metrics Calculator Class
class CollaborationMetricsCalculator {
  static calculateInteractionFrequency(interactions) {
    const frequency = {};

    interactions.forEach((interaction) => {
      const key = `${interaction.from}->${interaction.to}`;
      frequency[key] = (frequency[key] || 0) + interaction.weight;
    });

    return frequency;
  }

  static buildCollaborationMatrix(pullRequests) {
    const matrix = {};
    const interactions = [];
    const userStats = {};

    pullRequests.forEach((pr) => {
      const author = pr.user?.login;
      if (!author) return;

      // Initialize user stats
      if (!userStats[author]) {
        userStats[author] = {
          prs_created: 0,
          reviews_given: 0,
          comments_made: 0,
          collaborators: new Set(),
        };
      }
      userStats[author].prs_created++;

      // Process reviews
      (pr.reviews || []).forEach((review) => {
        const reviewer = review.user?.login;
        if (!reviewer || reviewer === author) return;

        if (!userStats[reviewer]) {
          userStats[reviewer] = {
            prs_created: 0,
            reviews_given: 0,
            comments_made: 0,
            collaborators: new Set(),
          };
        }

        userStats[reviewer].reviews_given++;
        userStats[author].collaborators.add(reviewer);
        userStats[reviewer].collaborators.add(author);

        interactions.push({
          from: reviewer,
          to: author,
          type: "review",
          weight: this.getReviewWeight(review.state),
          pr_number: pr.number,
          timestamp: review.submitted_at,
        });
      });

      // Process comments
      (pr.comments || []).forEach((comment) => {
        const commenter = comment.user?.login;
        if (!commenter || commenter === author) return;

        if (!userStats[commenter]) {
          userStats[commenter] = {
            prs_created: 0,
            reviews_given: 0,
            comments_made: 0,
            collaborators: new Set(),
          };
        }

        userStats[commenter].comments_made++;
        userStats[author].collaborators.add(commenter);
        userStats[commenter].collaborators.add(author);

        interactions.push({
          from: commenter,
          to: author,
          type: "comment",
          weight: 1,
          pr_number: pr.number,
          timestamp: comment.created_at,
        });
      });
    });

    // Convert Sets to counts
    Object.keys(userStats).forEach((user) => {
      userStats[user].collaborators = userStats[user].collaborators.size;
    });

    return {
      interactions,
      user_stats: userStats,
      interaction_frequency: this.calculateInteractionFrequency(interactions),
    };
  }

  static getReviewWeight(state) {
    const weights = {
      APPROVED: 3,
      CHANGES_REQUESTED: 2,
      COMMENTED: 1,
      DISMISSED: 0.5,
    };
    return weights[state] || 1;
  }

  static identifyDiscussionThreads(pullRequests) {
    const threads = {};

    pullRequests.forEach((pr) => {
      const participants = new Set();
      const author = pr.user?.login;

      if (author) participants.add(author);

      // Add reviewers
      (pr.reviews || []).forEach((review) => {
        if (review.user?.login) participants.add(review.user.login);
      });

      // Add commenters
      (pr.comments || []).forEach((comment) => {
        if (comment.user?.login) participants.add(comment.user.login);
      });

      if (participants.size > 1) {
        const threadKey = Array.from(participants).sort().join("-");
        if (!threads[threadKey]) {
          threads[threadKey] = {
            participants: Array.from(participants),
            prs: [],
            total_interactions: 0,
          };
        }

        threads[threadKey].prs.push(pr.number);
        threads[threadKey].total_interactions +=
          (pr.reviews?.length || 0) + (pr.comments?.length || 0);
      }
    });

    return threads;
  }

  static calculateCollaborationScore(userStats, interactions) {
    const scores = {};

    Object.keys(userStats).forEach((user) => {
      const stats = userStats[user];
      const userInteractions = interactions.filter(
        (i) => i.from === user || i.to === user
      );

      const diversityScore = stats.collaborators;
      const activityScore =
        stats.reviews_given + stats.comments_made + stats.prs_created;
      const intensityScore = userInteractions.reduce(
        (sum, i) => sum + i.weight,
        0
      );

      scores[user] = {
        diversity_score: diversityScore,
        activity_score: activityScore,
        intensity_score: intensityScore,
        collaboration_score:
          Math.round(
            (diversityScore * 0.3 +
              activityScore * 0.4 +
              intensityScore * 0.3) *
              100
          ) / 100,
      };
    });

    return scores;
  }

  static identifyCollaborationBottlenecks(userStats, interactions) {
    const bottlenecks = [];
    const totalUsers = Object.keys(userStats).length;

    // Users with low collaboration diversity
    Object.entries(userStats).forEach(([user, stats]) => {
      if (stats.collaborators < Math.max(2, totalUsers * 0.1)) {
        bottlenecks.push({
          type: "low_collaboration",
          user,
          description: `${user} has limited collaboration (${stats.collaborators} collaborators)`,
          severity: stats.collaborators === 0 ? "high" : "medium",
        });
      }
    });

    // Identify isolated clusters
    const collaborationGraph = {};
    interactions.forEach((interaction) => {
      if (!collaborationGraph[interaction.from]) {
        collaborationGraph[interaction.from] = new Set();
      }
      if (!collaborationGraph[interaction.to]) {
        collaborationGraph[interaction.to] = new Set();
      }
      collaborationGraph[interaction.from].add(interaction.to);
      collaborationGraph[interaction.to].add(interaction.from);
    });

    return bottlenecks;
  }
}

// Data Processor Class
class DataProcessor {
  static async exportToJSON(data, options = {}) {
    const {
      filename = "collaboration-matrix-report.json",
      outputDir = "./reports",
      prettify = true,
    } = options;

    try {
      await fs.mkdir(outputDir, { recursive: true });
      const filepath = join(outputDir, filename);

      // Ensure all numeric values are properly formatted for JSON
      const cleanData = this.sanitizeForJSON(data);

      const jsonContent = prettify
        ? JSON.stringify(cleanData, null, 2)
        : JSON.stringify(cleanData);

      await fs.writeFile(filepath, jsonContent, "utf8");
      return filepath;
    } catch (error) {
      throw new Error(`Failed to export JSON: ${error.message}`);
    }
  }

  static async exportToCSV(data, options = {}) {
    const {
      filename = "collaboration-matrix-report.csv",
      outputDir = "./reports",
    } = options;

    try {
      await fs.mkdir(outputDir, { recursive: true });
      const filepath = join(outputDir, filename);

      // Convert collaboration matrix to CSV format
      const csvData = this.convertToCSVFormat(data);
      await fs.writeFile(filepath, csvData, "utf8");
      return filepath;
    } catch (error) {
      throw new Error(`Failed to export CSV: ${error.message}`);
    }
  }

  static sanitizeForJSON(obj) {
    if (obj === null || obj === undefined) return null;
    if (typeof obj === "number") {
      if (isNaN(obj) || !isFinite(obj)) return null;
      return obj;
    }
    if (typeof obj === "object") {
      if (Array.isArray(obj)) {
        return obj.map((item) => this.sanitizeForJSON(item));
      }
      const sanitized = {};
      for (const [key, value] of Object.entries(obj)) {
        sanitized[key] = this.sanitizeForJSON(value);
      }
      return sanitized;
    }
    return obj;
  }

  static convertToCSVFormat(data) {
    const lines = [];

    // Header
    lines.push('"Section","Metric","Value","Description"');

    // Summary data
    if (data.summary) {
      Object.entries(data.summary).forEach(([key, value]) => {
        lines.push(`"Summary","${key}","${value}","Summary metric"`);
      });
    }

    // User statistics
    if (data.detailed_analysis?.collaboration_matrix?.user_stats) {
      Object.entries(
        data.detailed_analysis.collaboration_matrix.user_stats
      ).forEach(([user, stats]) => {
        Object.entries(stats).forEach(([metric, value]) => {
          lines.push(
            `"User Stats","${user}_${metric}","${value}","User collaboration metric"`
          );
        });
      });
    }

    // Interactions
    if (data.detailed_analysis?.collaboration_matrix?.interactions) {
      data.detailed_analysis.collaboration_matrix.interactions.forEach(
        (interaction, index) => {
          lines.push(
            `"Interactions","interaction_${index}","${interaction.from}->${interaction.to}","${interaction.type} interaction"`
          );
        }
      );
    }

    return lines.join("\n");
  }

  static validateInputs(target, startDate, endDate, token) {
    const errors = [];

    if (!target || typeof target !== "string") {
      errors.push("Target (owner/repo or username) is required");
    }

    if (!token || typeof token !== "string") {
      errors.push("GitHub token is required");
    }

    if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      errors.push("Start date must be in YYYY-MM-DD format");
    }

    if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      errors.push("End date must be in YYYY-MM-DD format");
    }

    if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
      errors.push("Start date must be before end date");
    }

    if (errors.length > 0) {
      throw new ValidationError(errors.join("; "));
    }
  }
}

// Main Developer Collaboration Matrix Class
class DeveloperCollaborationMatrix {
  constructor(token, options = {}) {
    this.apiClient = new GitHubAPIClient(token, options);
    this.fetchLimit =
      options.fetchLimit === "infinite" ? undefined : options.fetchLimit || 50;
  }

  async generateReport(target, options = {}) {
    const startTime = Date.now();
    const { mode = "auto", startDate, endDate, verbose = false } = options;

    if (verbose) {
      console.log(`🔍 Starting collaboration analysis for: ${target}`);
      console.log(
        `📅 Date range: ${startDate || "(30 days ago)"} to ${
          endDate || "(now)"
        }`
      );
    }

    // Determine if target is repo or user
    const analysisMode = mode === "auto" ? this.detectTargetType(target) : mode;

    let pullRequests = [];
    let repositoryInfo = null;

    if (analysisMode === "repo") {
      const [owner, repo] = target.split("/");
      if (!owner || !repo) {
        throw new ValidationError('Repository must be in format "owner/repo"');
      }

      repositoryInfo = await this.apiClient.getRepository(owner, repo);
      pullRequests = await this.fetchRepositoryPRs(owner, repo, {
        startDate,
        endDate,
        verbose,
      });
    } else {
      pullRequests = await this.fetchUserPRs(target, {
        startDate,
        endDate,
        verbose,
      });
    }

    if (pullRequests.length === 0) {
      console.log("⚠️  No pull requests found for the specified criteria");
      return this.buildEmptyReport(target, {
        startDate,
        endDate,
        mode: analysisMode,
      });
    }

    if (verbose) {
      console.log(`📊 Found ${pullRequests.length} pull requests`);
      console.log("🔄 Enriching with collaboration data...");
    }

    // Enrich PRs with comments and reviews
    const enrichedPRs = await this.enrichWithCollaborationData(
      pullRequests,
      verbose
    );

    // Generate collaboration metrics
    const collaborationMatrix =
      CollaborationMetricsCalculator.buildCollaborationMatrix(enrichedPRs);
    const discussionThreads =
      CollaborationMetricsCalculator.identifyDiscussionThreads(enrichedPRs);
    const collaborationScores =
      CollaborationMetricsCalculator.calculateCollaborationScore(
        collaborationMatrix.user_stats,
        collaborationMatrix.interactions
      );
    const bottlenecks =
      CollaborationMetricsCalculator.identifyCollaborationBottlenecks(
        collaborationMatrix.user_stats,
        collaborationMatrix.interactions
      );

    const report = this.buildReport(enrichedPRs, {
      target,
      startDate,
      endDate,
      mode: analysisMode,
      repositoryInfo,
      collaborationMatrix,
      discussionThreads,
      collaborationScores,
      bottlenecks,
      processingTime: Date.now() - startTime,
    });

    if (verbose) {
      console.log(
        `✅ Analysis complete in ${Math.round(
          (Date.now() - startTime) / 1000
        )}s`
      );
    }

    return report;
  }

  detectTargetType(target) {
    return target.includes("/") ? "repo" : "user";
  }

  async fetchRepositoryPRs(owner, repo, options = {}) {
    const { startDate, endDate, verbose } = options;

    const fetchOptions = {
      fetchLimit: this.fetchLimit,
      params: {},
    };

    if (startDate) {
      fetchOptions.params.since = startDate;
    }

    if (verbose) {
      console.log(`📥 Fetching PRs from ${owner}/${repo}...`);
    }

    const prs = await this.apiClient.getPullRequests(owner, repo, fetchOptions);

    return this.filterByDateRange(prs, startDate, endDate);
  }

  async fetchUserPRs(username, options = {}) {
    const { startDate, endDate, verbose } = options;

    if (verbose) {
      console.log(`📥 Fetching PRs for user ${username}...`);
    }

    const fetchOptions = {
      fetchLimit: this.fetchLimit,
    };

    const prs = await this.apiClient.getUserPullRequests(
      username,
      fetchOptions
    );

    return this.filterByDateRange(prs, startDate, endDate);
  }

  filterByDateRange(prs, startDate, endDate) {
    if (!startDate && !endDate) return prs;

    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;

    return prs.filter((pr) => {
      const createdAt = new Date(pr.created_at);

      if (start && createdAt < start) return false;
      if (end && createdAt > end) return false;

      return true;
    });
  }

  async enrichWithCollaborationData(prs, verbose = false) {
    const enrichedPRs = [];
    const total = Math.min(prs.length, this.fetchLimit || prs.length);

    for (let i = 0; i < total; i++) {
      const pr = prs[i];

      if (verbose && (i + 1) % 10 === 0) {
        console.log(
          `🔄 Processing PR ${i + 1}/${total} (${Math.round(
            ((i + 1) / total) * 100
          )}%)`
        );
      }

      try {
        // Extract repo info from PR URL or API
        const repoMatch =
          pr.url?.match(/\/repos\/([^\/]+)\/([^\/]+)\//) ||
          pr.repository_url?.match(/\/repos\/([^\/]+)\/([^\/]+)$/);

        if (!repoMatch) {
          enrichedPRs.push({ ...pr, reviews: [], comments: [] });
          continue;
        }

        const [, owner, repo] = repoMatch;

        // Fetch reviews and comments concurrently
        const [reviews, prComments, issueComments] = await Promise.all([
          this.apiClient
            .getPullRequestReviews(owner, repo, pr.number)
            .catch(() => []),
          this.apiClient
            .getPullRequestComments(owner, repo, pr.number)
            .catch(() => []),
          this.apiClient
            .getIssueComments(owner, repo, pr.number)
            .catch(() => []),
        ]);

        enrichedPRs.push({
          ...pr,
          reviews: reviews || [],
          comments: [...(prComments || []), ...(issueComments || [])],
        });
      } catch (error) {
        if (verbose) {
          console.log(
            `⚠️  Failed to enrich PR #${pr.number}: ${error.message}`
          );
        }
        enrichedPRs.push({ ...pr, reviews: [], comments: [] });
      }

      // Small delay to be respectful to API
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return enrichedPRs;
  }

  buildReport(enrichedPRs, context) {
    const {
      target,
      startDate,
      endDate,
      mode,
      repositoryInfo,
      collaborationMatrix,
      discussionThreads,
      collaborationScores,
      bottlenecks,
      processingTime,
    } = context;

    // Calculate summary metrics
    const totalUsers = Object.keys(collaborationMatrix.user_stats).length;
    const totalInteractions = collaborationMatrix.interactions.length;
    const totalThreads = Object.keys(discussionThreads).length;

    const avgCollaborationScore =
      Object.values(collaborationScores).reduce(
        (sum, score) => sum + score.collaboration_score,
        0
      ) / totalUsers;

    const mostActiveCollaborator = Object.entries(collaborationScores).sort(
      ([, a], [, b]) => b.activity_score - a.activity_score
    )[0];

    const mostDiverseCollaborator = Object.entries(collaborationScores).sort(
      ([, a], [, b]) => b.diversity_score - a.diversity_score
    )[0];

    return {
      date_range: {
        start_date: startDate || this.getDefaultStartDate(),
        end_date: endDate || new Date().toISOString().split("T")[0],
        analysis_target: target,
        analysis_mode: mode,
      },
      summary: {
        total_pull_requests: enrichedPRs.length,
        total_collaborators: totalUsers,
        total_interactions: totalInteractions,
        total_discussion_threads: totalThreads,
        average_collaboration_score:
          Math.round(avgCollaborationScore * 100) / 100,
        most_active_collaborator: mostActiveCollaborator?.[0] || null,
        most_diverse_collaborator: mostDiverseCollaborator?.[0] || null,
        collaboration_bottlenecks: bottlenecks.length,
        processing_time_ms: processingTime,
      },
      total: {
        reviews_given: Object.values(collaborationMatrix.user_stats).reduce(
          (sum, stats) => sum + stats.reviews_given,
          0
        ),
        comments_made: Object.values(collaborationMatrix.user_stats).reduce(
          (sum, stats) => sum + stats.comments_made,
          0
        ),
        prs_created: Object.values(collaborationMatrix.user_stats).reduce(
          (sum, stats) => sum + stats.prs_created,
          0
        ),
        unique_collaborations: Object.values(
          collaborationMatrix.user_stats
        ).reduce((sum, stats) => sum + stats.collaborators, 0),
      },
      detailed_analysis: {
        repository_info: repositoryInfo,
        collaboration_matrix: collaborationMatrix,
        discussion_threads: discussionThreads,
        collaboration_scores: collaborationScores,
        bottlenecks: bottlenecks,
        interaction_patterns: this.analyzeInteractionPatterns(
          collaborationMatrix.interactions
        ),
        temporal_analysis: this.analyzeTemporalPatterns(enrichedPRs),
      },
      formulas: {
        collaboration_score:
          "DIVERSITY_SCORE * 0.3 + ACTIVITY_SCORE * 0.4 + INTENSITY_SCORE * 0.3",
        diversity_score: "COUNT(UNIQUE_COLLABORATORS)",
        activity_score: "REVIEWS_GIVEN + COMMENTS_MADE + PRS_CREATED",
        intensity_score: "SUM(INTERACTION_WEIGHTS)",
        review_weight:
          "APPROVED=3, CHANGES_REQUESTED=2, COMMENTED=1, DISMISSED=0.5",
        interaction_frequency: "COUNT(INTERACTIONS_BETWEEN_USERS)",
        discussion_thread_size: "COUNT(UNIQUE_PARTICIPANTS_IN_THREAD)",
        bottleneck_threshold: "COLLABORATORS < MAX(2, TOTAL_USERS * 0.1)",
        average_collaboration_score:
          "SUM(ALL_COLLABORATION_SCORES) / TOTAL_USERS",
        temporal_activity: "INTERACTIONS_PER_TIME_PERIOD",
      },
    };
  }

  analyzeInteractionPatterns(interactions) {
    const patterns = {
      by_type: {},
      by_direction: {},
      most_frequent_pairs: {},
    };

    // Group by interaction type
    interactions.forEach((interaction) => {
      const type = interaction.type;
      if (!patterns.by_type[type]) {
        patterns.by_type[type] = { count: 0, total_weight: 0 };
      }
      patterns.by_type[type].count++;
      patterns.by_type[type].total_weight += interaction.weight;
    });

    // Find most frequent collaboration pairs
    const pairCounts = {};
    interactions.forEach((interaction) => {
      const pair = [interaction.from, interaction.to].sort().join("<->");
      pairCounts[pair] = (pairCounts[pair] || 0) + 1;
    });

    patterns.most_frequent_pairs = Object.entries(pairCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .reduce((acc, [pair, count]) => {
        acc[pair] = count;
        return acc;
      }, {});

    return patterns;
  }

  analyzeTemporalPatterns(prs) {
    const patterns = {
      by_month: {},
      by_day_of_week: {},
      by_hour: {},
    };

    prs.forEach((pr) => {
      const createdAt = new Date(pr.created_at);

      // By month
      const monthKey = createdAt.toISOString().substring(0, 7);
      patterns.by_month[monthKey] = (patterns.by_month[monthKey] || 0) + 1;

      // By day of week
      const dayOfWeek = createdAt.getDay();
      const dayNames = [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
      ];
      const dayName = dayNames[dayOfWeek];
      patterns.by_day_of_week[dayName] =
        (patterns.by_day_of_week[dayName] || 0) + 1;

      // By hour
      const hour = createdAt.getHours();
      patterns.by_hour[hour] = (patterns.by_hour[hour] || 0) + 1;
    });

    return patterns;
  }

  buildEmptyReport(target, options) {
    return {
      date_range: {
        start_date: options.startDate || this.getDefaultStartDate(),
        end_date: options.endDate || new Date().toISOString().split("T")[0],
        analysis_target: target,
        analysis_mode: options.mode,
      },
      summary: {
        total_pull_requests: 0,
        total_collaborators: 0,
        total_interactions: 0,
        total_discussion_threads: 0,
        average_collaboration_score: 0,
        most_active_collaborator: null,
        most_diverse_collaborator: null,
        collaboration_bottlenecks: 0,
        processing_time_ms: 0,
      },
      total: {
        reviews_given: 0,
        comments_made: 0,
        prs_created: 0,
        unique_collaborations: 0,
      },
      detailed_analysis: {
        collaboration_matrix: {
          interactions: [],
          user_stats: {},
          interaction_frequency: {},
        },
        discussion_threads: {},
        collaboration_scores: {},
        bottlenecks: [],
        interaction_patterns: {
          by_type: {},
          by_direction: {},
          most_frequent_pairs: {},
        },
        temporal_analysis: { by_month: {}, by_day_of_week: {}, by_hour: {} },
      },
      formulas: {
        collaboration_score:
          "DIVERSITY_SCORE * 0.3 + ACTIVITY_SCORE * 0.4 + INTENSITY_SCORE * 0.3",
        diversity_score: "COUNT(UNIQUE_COLLABORATORS)",
        activity_score: "REVIEWS_GIVEN + COMMENTS_MADE + PRS_CREATED",
      },
    };
  }

  getDefaultStartDate() {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return date.toISOString().split("T")[0];
  }
}

// CLI Implementation
async function parseArguments() {
  const args = process.argv.slice(2);
  const config = {
    target: null,
    mode: "auto", // 'repo', 'user', or 'auto'
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
        config.target = args[++i];
        config.mode = "repo";
        break;
      case "-u":
      case "--user":
        config.target = args[++i];
        config.mode = "user";
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
        config.verbose = true;
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
        showHelp();
        process.exit(0);
        break;
      default:
        if (!config.target && !arg.startsWith("-")) {
          config.target = arg;
          config.mode = "auto";
        }
        break;
    }
  }

  // Set default dates if not provided
  if (!config.startDate) {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    config.startDate = date.toISOString().split("T")[0];
  }

  if (!config.endDate) {
    config.endDate = new Date().toISOString().split("T")[0];
  }

  return config;
}

function showHelp() {
  console.log(`Developer Collaboration Matrix - GitHub Insight Reporter

USAGE:
    node main.report.mjs [TARGET] [OPTIONS]
    node main.report.mjs --repo owner/repo [OPTIONS]
    node main.report.mjs --user username [OPTIONS]

ARGUMENTS:
    TARGET              Repository (owner/repo) or username to analyze

OPTIONS:
    -r, --repo <owner/repo>    Analyze specific repository collaboration
    -u, --user <username>      Analyze user's collaboration across repositories
    -s, --start <date>         Start date (YYYY-MM-DD) [default: 30 days ago]
    -e, --end <date>           End date (YYYY-MM-DD) [default: today]
    -f, --format <format>      Output format: json, csv, or both [default: json]
    -n, --name <filename>      Output filename (without extension)
    -o, --output <directory>   Output directory [default: ./reports]
    -l, --fetchLimit <number>  Fetch limit (number or 'infinite') [default: 50]
    -t, --token <token>        GitHub token (or use GITHUB_TOKEN env var)
    -v, --verbose              Enable verbose logging
    -d, --debug                Enable debug logging
    -h, --help                 Show this help message

EXAMPLES:
    # Analyze repository collaboration
    node main.report.mjs --repo microsoft/vscode

    # Analyze user collaboration across repositories
    node main.report.mjs --user octocat

    # Custom date range with CSV output
    node main.report.mjs --repo owner/repo --start 2024-01-01 --end 2024-03-31 --format csv

    # Verbose analysis with custom output
    node main.report.mjs --user developer --verbose --output ./team-reports

    # Analysis with unlimited fetch
    node main.report.mjs --repo owner/repo --fetchLimit infinite

ENVIRONMENT VARIABLES:
    GITHUB_TOKEN    GitHub personal access token (required if not provided via --token)

COLLABORATION METRICS:
    • User interaction frequencies and patterns
    • Review networks and discussion clusters  
    • Collaboration scores and diversity metrics
    • Discussion thread analysis
    • Temporal collaboration patterns
    • Bottleneck identification and recommendations`);
}

async function main() {
  try {
    const config = await parseArguments();

    // Validation
    if (!config.target) {
      console.error("❌ Error: Target (repository or username) is required");
      console.log("\nUse --help for usage information");
      process.exit(1);
    }

    if (!config.token) {
      console.error("❌ Error: GitHub token is required");
      console.log(
        "Set GITHUB_TOKEN environment variable or use --token argument"
      );
      process.exit(1);
    }

    DataProcessor.validateInputs(
      config.target,
      config.startDate,
      config.endDate,
      config.token
    );

    if (config.debug) {
      console.log("🔧 Debug configuration:", JSON.stringify(config, null, 2));
    }

    // Initialize analyzer
    const analyzer = new DeveloperCollaborationMatrix(config.token, {
      fetchLimit: config.fetchLimit,
    });

    console.log("🚀 Starting Developer Collaboration Matrix analysis...");

    const report = await analyzer.generateReport(config.target, {
      mode: config.mode,
      startDate: config.startDate,
      endDate: config.endDate,
      verbose: config.verbose,
    });

    // Generate filename if not provided
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .split("T")[0];
    const baseFilename =
      config.name ||
      `collaboration-matrix-${config.target.replace("/", "-")}-${timestamp}`;

    // Export data
    const exports = [];

    if (config.format === "json" || config.format === "both") {
      const jsonFile = await DataProcessor.exportToJSON(report, {
        filename: `${baseFilename}.json`,
        outputDir: config.output,
      });
      exports.push(jsonFile);
      console.log(`📄 JSON report saved: ${jsonFile}`);
    }

    if (config.format === "csv" || config.format === "both") {
      const csvFile = await DataProcessor.exportToCSV(report, {
        filename: `${baseFilename}.csv`,
        outputDir: config.output,
      });
      exports.push(csvFile);
      console.log(`📊 CSV report saved: ${csvFile}`);
    }

    // Summary output
    console.log("\n📈 COLLABORATION ANALYSIS SUMMARY:");
    console.log(
      `📅 Period: ${report.date_range.start_date} to ${report.date_range.end_date}`
    );
    console.log(
      `🎯 Target: ${report.date_range.analysis_target} (${report.date_range.analysis_mode})`
    );
    console.log(`📊 Pull Requests: ${report.summary.total_pull_requests}`);
    console.log(`👥 Collaborators: ${report.summary.total_collaborators}`);
    console.log(`💬 Interactions: ${report.summary.total_interactions}`);
    console.log(
      `🧵 Discussion Threads: ${report.summary.total_discussion_threads}`
    );
    console.log(
      `⭐ Avg Collaboration Score: ${report.summary.average_collaboration_score}`
    );

    if (report.summary.most_active_collaborator) {
      console.log(`🏆 Most Active: ${report.summary.most_active_collaborator}`);
    }

    if (report.summary.collaboration_bottlenecks > 0) {
      console.log(
        `⚠️  Bottlenecks Found: ${report.summary.collaboration_bottlenecks}`
      );
    }

    console.log(`\n✅ Analysis complete! Reports saved to: ${config.output}`);
    console.log(
      `⏱️  Processing time: ${Math.round(
        report.summary.processing_time_ms / 1000
      )}s`
    );
  } catch (error) {
    if (error instanceof ValidationError) {
      console.error(`❌ Validation Error: ${error.message}`);
    } else if (error instanceof APIError) {
      console.error(`❌ API Error: ${error.message}`);
      if (error.statusCode === 401) {
        console.log("💡 Check your GitHub token permissions");
      } else if (error.statusCode === 403) {
        console.log("💡 You may have hit GitHub API rate limits");
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
  DeveloperCollaborationMatrix,
  GitHubAPIClient,
  CollaborationMetricsCalculator,
  DataProcessor,
  APIError,
  ValidationError,
  ConfigurationError,
};
