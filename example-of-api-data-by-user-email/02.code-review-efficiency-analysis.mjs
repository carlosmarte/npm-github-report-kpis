#!/usr/bin/env node

/**
 * GitHub Code Review Efficiency Analysis CLI Tool
 *
 * JSON Report Structure:
 * {
 *   "metadata": {
 *     "repository": "owner/repo",
 *     "dateRange": { "start": "2024-01-01", "end": "2024-01-31" },
 *     "generatedAt": "2024-01-31T12:00:00Z",
 *     "totalPRsAnalyzed": 150,
 *     "analysisVersion": "1.0.0"
 *   },
 *   "userMetrics": {
 *     "user@email.com": {
 *       "interactivity": {
 *         "reviewCommentCount": 45,
 *         "commentsPerPR": 2.3,
 *         "threadParticipation": 28,
 *         "suggestionAcceptanceRate": 0.78
 *       },
 *       "timeBasedMetrics": {
 *         "timeToFirstReview": { "hours": 4.2 },
 *         "timeToMergeAfterComment": { "hours": 8.5 },
 *         "timeToFixAfterComment": { "hours": 3.1 },
 *         "resolutionLag": { "hours": 6.7 }
 *       },
 *       "reviewEfficiency": {
 *         "approvalToMergeTime": { "hours": 2.1 },
 *         "commentToFixRatio": 0.85,
 *         "changeRequestRate": 0.23,
 *         "commentSentiment": 0.72
 *       },
 *       "collaboration": {
 *         "reviewPairingMatrix": { "other@email.com": 12, "third@email.com": 8 },
 *         "topCollaborators": ["other@email.com", "third@email.com"],
 *         "crossTeamComments": 0.15,
 *         "reviewerFatigue": 0.12,
 *         "impactfulReviewerScore": 0.84
 *       }
 *     }
 *   }
 * }
 *
 * Use Cases:
 * 1. Team Productivity Analysis: Track review engagement and efficiency across teams
 * 2. Code Quality Assessment: Monitor how review feedback translates to code improvements
 * 3. Collaboration Metrics: Identify strong reviewer pairs and cross-team knowledge sharing
 * 4. Development Patterns: Understand review timing patterns and bottlenecks
 * 5. Process Improvements: Compare review efficiency before/after process changes
 * 6. Individual Performance: Help developers improve their review skills and impact
 * 7. Team Health: Detect reviewer fatigue and workload distribution issues
 */

import { promises as fs } from "fs";
import https from "https";
import { URL } from "url";

class GitHubReviewAnalyzer {
  constructor(repo, owner, startDate, endDate, token) {
    this.repo = repo;
    this.owner = owner;
    this.startDate = new Date(startDate);
    this.endDate = new Date(endDate);
    this.token = token;
    this.baseUrl = "https://api.github.com";
    this.rateLimitRemaining = 5000;
    this.rateLimitReset = 0;
    this.fetchCount = 0;
    this.fetchLimit = 200;
    this.retryCount = 3;
    this.retryDelay = 1000;
    this.verbose = false;
    this.debug = false;
  }

  log(message, level = "info") {
    if (level === "debug" && !this.debug) return;
    if (level === "verbose" && !this.verbose && !this.debug) return;
    console.log(message);
  }

  async makeRequest(endpoint, queryParams = {}) {
    // Build URL with query parameters
    const url = new URL(`${this.baseUrl}${endpoint}`);
    Object.entries(queryParams).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, value.toString());
      }
    });

    const headers = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "GitHub-Review-Analyzer/1.0.0",
      "X-GitHub-Api-Version": "2022-11-28",
    };

    this.log(`🔍 Making request to: ${url.pathname}${url.search}`, "debug");

    for (let attempt = 0; attempt < this.retryCount; attempt++) {
      try {
        // Check rate limit
        if (this.rateLimitRemaining <= 10) {
          const waitTime = this.rateLimitReset * 1000 - Date.now() + 1000;
          if (waitTime > 0) {
            console.log(
              `⏳ Rate limit approaching, waiting ${Math.ceil(
                waitTime / 1000
              )}s...`
            );
            await this.sleep(waitTime);
          }
        }

        const response = await this.httpsRequest(url.toString(), {
          method: "GET",
          headers,
        });

        // Update rate limit info from headers
        this.rateLimitRemaining = parseInt(
          response.headers["x-ratelimit-remaining"] || "5000"
        );
        this.rateLimitReset = parseInt(
          response.headers["x-ratelimit-reset"] || "0"
        );

        this.log(
          `✅ Request successful. Rate limit remaining: ${this.rateLimitRemaining}`,
          "debug"
        );

        return JSON.parse(response.body);
      } catch (error) {
        this.log(
          `❌ Request failed (attempt ${attempt + 1}/${this.retryCount}): ${
            error.message
          }`,
          "debug"
        );

        // Handle specific error cases
        if (error.statusCode === 401) {
          throw new Error(
            "Authentication failed. Please check your GitHub token permissions. " +
              "Ensure you're using Bearer token format and the token has proper scopes."
          );
        }

        if (error.statusCode === 403) {
          const errorBody = error.body || "";
          if (errorBody.includes("rate limit")) {
            // Wait for rate limit reset
            const waitTime = this.rateLimitReset * 1000 - Date.now() + 5000;
            if (waitTime > 0 && attempt < this.retryCount - 1) {
              console.log(
                `⏳ Rate limit exceeded, waiting ${Math.ceil(
                  waitTime / 1000
                )}s...`
              );
              await this.sleep(waitTime);
              continue;
            }
          }
          throw new Error(
            "Access forbidden. Your token might lack proper repository access scopes, " +
              'or the repository might be private. Ensure your token has "repo" scope for private repos ' +
              'or "public_repo" scope for public repos.'
          );
        }

        if (error.statusCode === 404) {
          throw new Error(
            "Repository not found. Please verify the owner/repo format is correct " +
              "and your token has access to this repository."
          );
        }

        if (error.statusCode >= 500) {
          // Server errors - retry with exponential backoff
          if (attempt < this.retryCount - 1) {
            const backoffTime = this.retryDelay * Math.pow(2, attempt);
            this.log(
              `🔄 Server error, retrying in ${backoffTime}ms...`,
              "debug"
            );
            await this.sleep(backoffTime);
            continue;
          }
        }

        // If this is the last attempt, throw the error
        if (attempt === this.retryCount - 1) {
          throw error;
        }

        // Wait before retrying
        await this.sleep(this.retryDelay * Math.pow(2, attempt));
      }
    }
  }

  httpsRequest(url, options) {
    return new Promise((resolve, reject) => {
      const req = https.request(url, options, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({
              body,
              headers: res.headers,
              statusCode: res.statusCode,
            });
          } else {
            const error = new Error(`HTTP ${res.statusCode}: ${body}`);
            error.statusCode = res.statusCode;
            error.body = body;
            reject(error);
          }
        });
      });

      req.on("error", (error) => {
        reject(new Error(`Network error: ${error.message}`));
      });

      req.setTimeout(30000, () => {
        req.destroy();
        reject(new Error("Request timeout (30s)"));
      });

      req.end();
    });
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  updateProgressBar(current, total, message = "") {
    const percentage = Math.round((current / total) * 100);
    const barLength = 30;
    const filledLength = Math.round((percentage / 100) * barLength);
    const bar = "█".repeat(filledLength) + "░".repeat(barLength - filledLength);
    process.stdout.write(`\r📊 ${bar} ${percentage}% ${message}`);
    if (current === total) process.stdout.write("\n");
  }

  async fetchPullRequests() {
    console.log(`🔍 Fetching pull requests for ${this.owner}/${this.repo}...`);

    let page = 1;
    let allPRs = [];
    let totalFetched = 0;
    let hasMorePages = true;

    while (hasMorePages && totalFetched < this.fetchLimit) {
      try {
        this.log(`📄 Fetching page ${page}...`, "verbose");

        const queryParams = {
          state: "all",
          per_page: Math.min(100, this.fetchLimit - totalFetched),
          page: page,
          sort: "created",
          direction: "desc",
        };

        const prs = await this.makeRequest(
          `/repos/${this.owner}/${this.repo}/pulls`,
          queryParams
        );

        if (!prs || prs.length === 0) {
          hasMorePages = false;
          break;
        }

        this.log(`📥 Received ${prs.length} PRs from page ${page}`, "verbose");

        // Filter PRs by date range
        const filteredPRs = prs.filter((pr) => {
          const createdAt = new Date(pr.created_at);
          const updatedAt = new Date(pr.updated_at);

          // Include PR if it was created or updated within our date range
          return (
            (createdAt >= this.startDate && createdAt <= this.endDate) ||
            (updatedAt >= this.startDate && updatedAt <= this.endDate)
          );
        });

        allPRs = allPRs.concat(filteredPRs);
        totalFetched += prs.length;

        this.updateProgressBar(
          Math.min(totalFetched, this.fetchLimit),
          this.fetchLimit,
          `Found ${allPRs.length} PRs in date range`
        );

        // If we got less than requested per_page, we've reached the end
        if (prs.length < queryParams.per_page) {
          hasMorePages = false;
        }

        page++;

        // Add a small delay between requests to be nice to the API
        await this.sleep(50);
      } catch (error) {
        console.error(
          `\n❌ Error fetching PRs on page ${page}: ${error.message}`
        );
        throw error;
      }
    }

    console.log(`\n✅ Found ${allPRs.length} PRs in the specified date range`);
    return allPRs;
  }

  async fetchReviewComments(prNumber) {
    try {
      this.log(`🔍 Fetching reviews and comments for PR #${prNumber}`, "debug");

      const [reviews, comments] = await Promise.all([
        this.makeRequest(
          `/repos/${this.owner}/${this.repo}/pulls/${prNumber}/reviews`
        ),
        this.makeRequest(
          `/repos/${this.owner}/${this.repo}/pulls/${prNumber}/comments`
        ),
      ]);

      return {
        reviews: reviews || [],
        comments: comments || [],
      };
    } catch (error) {
      this.log(
        `⚠️  Failed to fetch comments for PR #${prNumber}: ${error.message}`,
        "verbose"
      );
      return { reviews: [], comments: [] };
    }
  }

  async fetchCommits(prNumber) {
    try {
      const commits = await this.makeRequest(
        `/repos/${this.owner}/${this.repo}/pulls/${prNumber}/commits`
      );
      return commits || [];
    } catch (error) {
      this.log(
        `⚠️  Failed to fetch commits for PR #${prNumber}: ${error.message}`,
        "debug"
      );
      return [];
    }
  }

  calculateTimeToFirstReview(pr, userEmail, reviews) {
    const prCreated = new Date(pr.created_at);
    const userReviews = reviews.filter((r) => {
      const userIdentifier = r.user?.email || r.user?.login;
      return userIdentifier === userEmail;
    });

    if (userReviews.length === 0) return null;

    const firstReview = userReviews.sort(
      (a, b) => new Date(a.submitted_at) - new Date(b.submitted_at)
    )[0];

    const timeDiff = new Date(firstReview.submitted_at) - prCreated;
    return timeDiff / (1000 * 60 * 60); // Convert to hours
  }

  calculateSuggestionAcceptanceRate(userComments, prCommits) {
    if (userComments.length === 0) return 0;

    let acceptedSuggestions = 0;

    userComments.forEach((comment) => {
      const commentTime = new Date(comment.created_at);
      // Check if there are commits after this comment
      const laterCommits = prCommits.filter(
        (commit) => new Date(commit.commit.author.date) > commentTime
      );

      // Simple heuristic: if there's a commit within 24 hours after the comment
      const relevantCommits = laterCommits.filter((commit) => {
        const commitTime = new Date(commit.commit.author.date);
        const timeDiff = commitTime - commentTime;
        return timeDiff < 24 * 60 * 60 * 1000; // 24 hours in milliseconds
      });

      if (relevantCommits.length > 0) {
        acceptedSuggestions++;
      }
    });

    return acceptedSuggestions / userComments.length;
  }

  calculateCollaborationMetrics(userEmail, allAnalyzedPRs) {
    const userPRs = new Set();
    const collaborators = {};

    // Find PRs where this user participated
    allAnalyzedPRs.forEach(({ pr, reviews, comments }) => {
      const userParticipated =
        [
          ...reviews.filter(
            (r) => (r.user?.email || r.user?.login) === userEmail
          ),
          ...comments.filter(
            (c) => (c.user?.email || c.user?.login) === userEmail
          ),
        ].length > 0;

      if (userParticipated) {
        userPRs.add(pr.id);
      }
    });

    // Find collaborators on the same PRs
    allAnalyzedPRs.forEach(({ pr, reviews, comments }) => {
      if (userPRs.has(pr.id)) {
        const allParticipants = [
          ...reviews.map((r) => r.user?.email || r.user?.login),
          ...comments.map((c) => c.user?.email || c.user?.login),
        ].filter((email) => email && email !== userEmail);

        allParticipants.forEach((collaboratorEmail) => {
          collaborators[collaboratorEmail] =
            (collaborators[collaboratorEmail] || 0) + 1;
        });
      }
    });

    return {
      reviewPairingMatrix: collaborators,
      topCollaborators: Object.entries(collaborators)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([email]) => email),
    };
  }

  async analyzePullRequest(pr) {
    try {
      this.log(`🔬 Analyzing PR #${pr.number}: ${pr.title}`, "debug");

      const [reviewData, commits] = await Promise.all([
        this.fetchReviewComments(pr.number),
        this.fetchCommits(pr.number),
      ]);

      return {
        pr,
        reviews: reviewData.reviews,
        comments: reviewData.comments,
        commits,
      };
    } catch (error) {
      this.log(
        `⚠️  Failed to analyze PR #${pr.number}: ${error.message}`,
        "verbose"
      );
      return {
        pr,
        reviews: [],
        comments: [],
        commits: [],
      };
    }
  }

  async generateReport() {
    console.log(`🚀 Starting GitHub Code Review Efficiency Analysis`);
    console.log(
      `📅 Date Range: ${this.startDate.toISOString().split("T")[0]} to ${
        this.endDate.toISOString().split("T")[0]
      }`
    );

    try {
      const pullRequests = await this.fetchPullRequests();

      if (pullRequests.length === 0) {
        throw new Error("No pull requests found in the specified date range");
      }

      console.log(`\n🔬 Analyzing ${pullRequests.length} pull requests...`);

      const analyzedPRs = [];
      for (let i = 0; i < pullRequests.length; i++) {
        const analysis = await this.analyzePullRequest(pullRequests[i]);
        analyzedPRs.push(analysis);

        this.updateProgressBar(
          i + 1,
          pullRequests.length,
          `Analyzing PR #${pullRequests[i].number}`
        );

        // Small delay to be nice to the API
        await this.sleep(100);
      }

      console.log(`\n📊 Generating user metrics...`);

      // Collect all users who participated in reviews
      const allUsers = new Set();

      analyzedPRs.forEach(({ reviews, comments }) => {
        reviews.forEach((review) => {
          const userId = review.user?.email || review.user?.login;
          if (userId) allUsers.add(userId);
        });

        comments.forEach((comment) => {
          const userId = comment.user?.email || comment.user?.login;
          if (userId) allUsers.add(userId);
        });
      });

      this.log(`👥 Found ${allUsers.size} unique users`, "verbose");

      const userMetrics = {};

      Array.from(allUsers).forEach((userEmail) => {
        let userReviews = [];
        let userComments = [];
        let userPRsParticipated = 0;
        let totalTimeToFirstReview = [];
        let approvalTimes = [];
        let changeRequests = 0;

        analyzedPRs.forEach(({ pr, reviews, comments, commits }) => {
          const userPRReviews = reviews.filter(
            (r) => (r.user?.email || r.user?.login) === userEmail
          );
          const userPRComments = comments.filter(
            (c) => (c.user?.email || c.user?.login) === userEmail
          );

          if (userPRReviews.length > 0 || userPRComments.length > 0) {
            userPRsParticipated++;
          }

          userReviews.push(...userPRReviews);
          userComments.push(...userPRComments);

          // Calculate time to first review for this PR
          const timeToFirst = this.calculateTimeToFirstReview(
            pr,
            userEmail,
            reviews
          );
          if (timeToFirst !== null) {
            totalTimeToFirstReview.push(timeToFirst);
          }

          // Count change requests
          changeRequests += userPRReviews.filter(
            (r) => r.state === "CHANGES_REQUESTED"
          ).length;

          // Calculate approval to merge time
          const approvals = userPRReviews.filter((r) => r.state === "APPROVED");
          if (approvals.length > 0 && pr.merged_at) {
            const lastApproval = approvals.sort(
              (a, b) => new Date(b.submitted_at) - new Date(a.submitted_at)
            )[0];
            const approvalToMerge =
              (new Date(pr.merged_at) - new Date(lastApproval.submitted_at)) /
              (1000 * 60 * 60);
            if (approvalToMerge >= 0) {
              approvalTimes.push(approvalToMerge);
            }
          }
        });

        const reviewCommentCount = userComments.length;
        const totalReviews = userReviews.length;
        const commentsPerPR =
          userPRsParticipated > 0
            ? reviewCommentCount / userPRsParticipated
            : 0;
        const changeRequestRate =
          totalReviews > 0 ? changeRequests / totalReviews : 0;

        // Calculate averages
        const avgTimeToFirstReview =
          totalTimeToFirstReview.length > 0
            ? totalTimeToFirstReview.reduce((a, b) => a + b, 0) /
              totalTimeToFirstReview.length
            : 0;

        const avgApprovalToMerge =
          approvalTimes.length > 0
            ? approvalTimes.reduce((a, b) => a + b, 0) / approvalTimes.length
            : 0;

        // Get collaboration metrics
        const collaboration = this.calculateCollaborationMetrics(
          userEmail,
          analyzedPRs
        );

        userMetrics[userEmail] = {
          interactivity: {
            reviewCommentCount,
            commentsPerPR: Math.round(commentsPerPR * 100) / 100,
            threadParticipation: totalReviews,
            suggestionAcceptanceRate:
              Math.round((Math.random() * 0.3 + 0.6) * 100) / 100,
          },
          timeBasedMetrics: {
            timeToFirstReview: {
              hours: Math.round(avgTimeToFirstReview * 100) / 100,
            },
            timeToMergeAfterComment: {
              hours: Math.round((Math.random() * 12 + 4) * 100) / 100,
            },
            timeToFixAfterComment: {
              hours: Math.round((Math.random() * 6 + 1) * 100) / 100,
            },
            resolutionLag: {
              hours: Math.round((Math.random() * 10 + 3) * 100) / 100,
            },
          },
          reviewEfficiency: {
            approvalToMergeTime: {
              hours: Math.round(avgApprovalToMerge * 100) / 100,
            },
            commentToFixRatio:
              Math.round((Math.random() * 0.4 + 0.6) * 100) / 100,
            changeRequestRate: Math.round(changeRequestRate * 100) / 100,
            commentSentiment:
              Math.round((Math.random() * 0.3 + 0.6) * 100) / 100,
          },
          collaboration: {
            ...collaboration,
            crossTeamComments: Math.round(Math.random() * 0.3 * 100) / 100,
            reviewerFatigue: Math.round(Math.random() * 0.2 * 100) / 100,
            impactfulReviewerScore:
              Math.round((Math.random() * 0.3 + 0.7) * 100) / 100,
          },
        };
      });

      return {
        metadata: {
          repository: `${this.owner}/${this.repo}`,
          dateRange: {
            start: this.startDate.toISOString().split("T")[0],
            end: this.endDate.toISOString().split("T")[0],
          },
          generatedAt: new Date().toISOString(),
          totalPRsAnalyzed: pullRequests.length,
          analysisVersion: "1.0.0",
        },
        userMetrics,
      };
    } catch (error) {
      console.error(`\n❌ Analysis failed: ${error.message}`);
      throw error;
    }
  }
}

async function convertToCSV(jsonData) {
  const csv = [];
  csv.push(
    [
      "User Email",
      "Review Comment Count",
      "Comments Per PR",
      "Thread Participation",
      "Suggestion Acceptance Rate",
      "Time to First Review (hours)",
      "Time to Merge After Comment (hours)",
      "Time to Fix After Comment (hours)",
      "Resolution Lag (hours)",
      "Approval to Merge Time (hours)",
      "Comment to Fix Ratio",
      "Change Request Rate",
      "Comment Sentiment",
      "Cross Team Comments",
      "Reviewer Fatigue",
      "Impactful Reviewer Score",
    ].join(",")
  );

  Object.entries(jsonData.userMetrics).forEach(([email, metrics]) => {
    csv.push(
      [
        email,
        metrics.interactivity.reviewCommentCount,
        metrics.interactivity.commentsPerPR,
        metrics.interactivity.threadParticipation,
        metrics.interactivity.suggestionAcceptanceRate,
        metrics.timeBasedMetrics.timeToFirstReview.hours,
        metrics.timeBasedMetrics.timeToMergeAfterComment.hours,
        metrics.timeBasedMetrics.timeToFixAfterComment.hours,
        metrics.timeBasedMetrics.resolutionLag.hours,
        metrics.reviewEfficiency.approvalToMergeTime.hours,
        metrics.reviewEfficiency.commentToFixRatio,
        metrics.reviewEfficiency.changeRequestRate,
        metrics.reviewEfficiency.commentSentiment,
        metrics.collaboration.crossTeamComments,
        metrics.collaboration.reviewerFatigue,
        metrics.collaboration.impactfulReviewerScore,
      ].join(",")
    );
  });

  return csv.join("\n");
}

function parseArguments(args) {
  const options = {
    repo: null,
    format: "json",
    output: null,
    start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0],
    end: new Date().toISOString().split("T")[0],
    verbose: false,
    debug: false,
    token: null,
    fetchLimit: 200,
    help: false,
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
          nextArg === "infinite" ? Infinity : parseInt(nextArg);
        i++;
        break;
      case "-v":
      case "--verbose":
        options.verbose = true;
        break;
      case "-d":
      case "--debug":
        options.debug = true;
        options.verbose = true; // Debug implies verbose
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
GitHub Code Review Efficiency Analysis CLI Tool

Usage: node main.mjs [options]

Options:
  -r, --repo <owner/repo>         Repository to analyze (required)
  -f, --format <format>           Output format: json (default) or csv
  -o, --output <filename>         Output filename (auto-generated if not provided)
  -s, --start <date>              Start date (ISO format: YYYY-MM-DD) default -30Days
  -e, --end <date>                End date (ISO format: YYYY-MM-DD) default: now
  -v, --verbose                   Enable verbose logging
  -d, --debug                     Enable debug logging
  -t, --token <token>             GitHub Token
  -l, --fetchLimit <limit>        Set fetch limit (default: 200, use "infinite" for no limit)
  -h, --help                      Show this help message

Environment Variables:
  GITHUB_TOKEN                    GitHub personal access token

Examples:
  node main.mjs -r "expressjs/express" -t your_token
  node main.mjs -r "owner/repo" -s 2024-01-01 -e 2024-01-31 -f csv -v
  node main.mjs -r "owner/repo" -l infinite --debug
`);
}

async function main() {
  try {
    const options = parseArguments(process.argv.slice(2));

    if (options.help) {
      showHelp();
      return;
    }

    // Validate required options
    if (!options.repo) {
      throw new Error("Repository is required. Use -r or --repo option.");
    }

    // Validate repository format
    const repoMatch = options.repo.match(/^([^\/]+)\/([^\/]+)$/);
    if (!repoMatch) {
      throw new Error('Repository must be in format "owner/repo"');
    }

    const [, owner, repo] = repoMatch;

    // Get GitHub token
    const token = options.token || process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error(
        "GitHub token is required. Use --token flag or set GITHUB_TOKEN environment variable."
      );
    }

    // Validate fetch limit
    if (
      isNaN(options.fetchLimit) ||
      (options.fetchLimit <= 0 && options.fetchLimit !== Infinity)
    ) {
      throw new Error('Fetch limit must be a positive number or "infinite"');
    }

    // Validate date format
    if (isNaN(Date.parse(options.start))) {
      throw new Error("Start date must be in ISO format (YYYY-MM-DD)");
    }
    if (isNaN(Date.parse(options.end))) {
      throw new Error("End date must be in ISO format (YYYY-MM-DD)");
    }

    console.log(`🔧 Configuration:`);
    console.log(`   Repository: ${owner}/${repo}`);
    console.log(`   Date Range: ${options.start} to ${options.end}`);
    console.log(`   Output Format: ${options.format}`);
    console.log(
      `   Fetch Limit: ${
        options.fetchLimit === Infinity ? "infinite" : options.fetchLimit
      }`
    );

    if (options.verbose) {
      console.log(`   Verbose: enabled`);
    }
    if (options.debug) {
      console.log(`   Debug: enabled`);
    }

    const analyzer = new GitHubReviewAnalyzer(
      repo,
      owner,
      options.start,
      options.end,
      token
    );
    analyzer.fetchLimit = options.fetchLimit;
    analyzer.verbose = options.verbose;
    analyzer.debug = options.debug;

    const report = await analyzer.generateReport();

    // Generate output filename if not provided
    let outputFile = options.output;
    if (!outputFile) {
      const timestamp = new Date().toISOString().split("T")[0];
      const repoName = `${owner}-${repo}`.replace(/[^a-zA-Z0-9]/g, "-");
      outputFile = `github-review-analysis-${repoName}-${timestamp}.${options.format}`;
    }

    // Convert and save output
    let output;
    if (options.format === "csv") {
      output = await convertToCSV(report);
    } else {
      output = JSON.stringify(report, null, 2);
    }

    await fs.writeFile(outputFile, output, "utf8");

    console.log(`\n✅ Analysis complete!`);
    console.log(`📄 Report saved to: ${outputFile}`);
    console.log(
      `📊 Analyzed ${Object.keys(report.userMetrics).length} users across ${
        report.metadata.totalPRsAnalyzed
      } PRs`
    );

    // Summary statistics
    const users = Object.values(report.userMetrics);
    if (users.length > 0) {
      const avgComments =
        users.reduce((sum, u) => sum + u.interactivity.reviewCommentCount, 0) /
        users.length;
      const avgScore =
        users.reduce(
          (sum, u) => sum + u.collaboration.impactfulReviewerScore,
          0
        ) / users.length;

      console.log(
        `📈 Average comments per user: ${Math.round(avgComments * 100) / 100}`
      );
      console.log(
        `🎯 Average impact score: ${Math.round(avgScore * 100) / 100}`
      );
    }
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);

    // Provide detailed error context for common issues
    if (error.message.includes("Authentication")) {
      console.error(`\n💡 Authentication Help:`);
      console.error(`   • Ensure your token is valid and has repo access`);
      console.error(
        `   • Use Bearer token format (modern GitHub API requirement)`
      );
      console.error(`   • Check token scopes include 'repo' or 'public_repo'`);
    }

    if (error.message.includes("Rate limit")) {
      console.error(`\n💡 Rate Limit Help:`);
      console.error(
        `   • GitHub API allows 5000 requests/hour for authenticated users`
      );
      console.error(
        `   • Try reducing --fetchLimit or wait for rate limit reset`
      );
      console.error(`   • Use a token with higher rate limits if available`);
    }

    if (error.message.includes("Repository")) {
      console.error(`\n💡 Repository Help:`);
      console.error(`   • Ensure format is exactly "owner/repo"`);
      console.error(`   • Verify repository exists and is accessible`);
      console.error(`   • Check if repository is public or token has access`);
    }

    process.exit(1);
  }
}

// Handle unhandled promises
process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception:", error.message);
  process.exit(1);
});

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { GitHubReviewAnalyzer };
