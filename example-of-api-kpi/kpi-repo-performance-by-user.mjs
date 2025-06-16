#!/usr/bin/env node

/*
 * GitHub Analytics Platform - Consolidated Developer and Repository Performance Analysis
 *
 * JSON Report Structure:
 * {
 *   "User": {
 *     // User-specific analytics when --user flag is provided
 *     "identity": { "email", "username", "name" },
 *     "commitActivityAndCodeContribution": { user-focused metrics },
 *     "pullRequestLifecycleAndReviewEfficiency": { user-focused metrics },
 *     "developerProductivityAndParticipation": { user-focused metrics },
 *     "collaborationAndEngagementMetrics": { user-focused metrics },
 *     "anomalyDetectionAndPerformanceOutliers": { user-focused metrics },
 *     "codeVelocityAndChurnAnalysis": { user-focused metrics }
 *   },
 *   "Generic": {
 *     // General repository analytics
 *     "githubAnalyticsFramework": { ... }
 *   }
 * }
 *
 * Use Cases:
 * - Performance reviews: Objective contribution metrics
 * - Team capacity planning: Understand team throughput capabilities
 * - Process optimization: Bottleneck identification and workflow optimization
 * - Developer health and morale tracking: Work-life balance monitoring
 * - Technical architecture and refactoring strategy: Code quality trends
 */

/*
## ✨ Key Enhancements Added

### 🎯 **User-Specific Focus**
- **`--user` flag**: Target analysis on specific user email
- **Filtered data collection**: Only fetch data relevant to target user
- **Dual report structure**: Separate User and Generic sections

### 👤 **Comprehensive User Analytics**
- **Personal productivity scoring** with detailed breakdown
- **Work-life balance assessment** with well-being recommendations
- **Individual collaboration analysis** and team role identification
- **Risk assessment** for burnout and sustainability
- **Growth recommendations** tailored to individual patterns

### 🔍 **Enhanced Insights**
- **Personal strengths identification** based on contribution patterns
- **Individual anomaly detection** for work patterns and performance
- **Mentorship potential scoring** and leadership assessment
- **Career development opportunities** and skill gap analysis

### 📊 **Improved Data Organization**
When using `--user` flag, the report structure becomes:

### 🛠️ **Technical Enhancements**
- **Smart data filtering** reduces API calls for user-focused analysis
- **Enhanced error handling** for user-specific data collection
- **Improved progress tracking** shows user-focused data fetching
- **Better filename generation** includes user identifier

*/

import { parseArgs } from "util";
import { writeFileSync } from "fs";

// CLI argument parsing
const { values: args } = parseArgs({
  args: process.argv.slice(2),
  options: {
    repo: { type: "string", short: "r" },
    format: { type: "string", short: "f", default: "json" },
    output: { type: "string", short: "o" },
    start: { type: "string", short: "s" },
    end: { type: "string", short: "e" },
    verbose: { type: "boolean", short: "v", default: false },
    debug: { type: "boolean", short: "d", default: false },
    token: { type: "string", short: "t" },
    help: { type: "boolean", short: "h", default: false },
    fetchLimit: { type: "string", short: "l", default: "200" },
    user: { type: "string", short: "u" }, // NEW: User-specific analysis
  },
  allowPositionals: true,
});

// Show help
if (args.help) {
  console.log(`
GitHub Analytics Platform - Comprehensive Repository Analysis

Usage: node main.mjs [options]

Options:
  -r, --repo <owner/repo>         Repository to analyze (required)
  -f, --format <format>           Output format: json (default) or csv
  -o, --output <filename>         Output filename (auto-generated if not provided)
  -s, --start <date>              Start date (ISO format: YYYY-MM-DD) default -30Days
  -e, --end <date>                End date (ISO format: YYYY-MM-DD) default: now
  -v, --verbose                   Enable verbose logging
  -d, --debug                     Enable debug logging
  -t, --token                     Github Token
  -u, --user <email>              Focus analysis on specific user email
  -h, --help                      Show help message
  -l, --fetchLimit                Set a fetch limit of 200, but user can change to infinite

Environment Variables:
  GITHUB_TOKEN                    GitHub authentication token
  
Examples:
  node main.mjs -r "facebook/react" -f json -v
  node main.mjs -r "microsoft/vscode" -s "2024-01-01" -e "2024-01-31" -f csv
  node main.mjs -r "nodejs/node" -l infinite -d -f json --user "developer@example.com"
  node main.mjs -r "vuejs/vue" -o "vue-analysis-2024.json" -v --user "maintainer@vue.org"
  node main.mjs -r "rails/rails" -s "2024-01-01" -v -f csv --user "contributor@rails.org"
  `);
  process.exit(0);
}

// Validate required arguments
if (!args.repo) {
  console.error("❌ Error: Repository (-r, --repo) is required");
  process.exit(1);
}

// Configuration
const config = {
  repo: args.repo,
  format: args.format,
  output: args.output,
  startDate: args.start
    ? new Date(args.start)
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
  endDate: args.end ? new Date(args.end) : new Date(),
  verbose: args.verbose,
  debug: args.debug,
  token: args.token || process.env.GITHUB_TOKEN,
  fetchLimit:
    args.fetchLimit === "infinite" ? Infinity : parseInt(args.fetchLimit),
  targetUser: args.user, // NEW: Target user for focused analysis
};

// GitHub API client
class GitHubClient {
  constructor(token) {
    this.token = token;
    this.baseUrl = "https://api.github.com";
    this.graphqlUrl = "https://api.github.com/graphql";
    this.rateLimitRemaining = 5000;
    this.rateLimitReset = Date.now();
    this.requestCount = 0;
  }

  async makeRequest(url, options = {}) {
    if (!this.token) {
      throw new Error(
        "❌ GitHub token is required. Set GITHUB_TOKEN environment variable or use -t flag.\nGet a token at: https://github.com/settings/tokens"
      );
    }

    const headers = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "GitHub-Analytics-Platform",
      ...options.headers,
    };

    // Retry logic with exponential backoff
    let retries = 3;
    while (retries > 0) {
      try {
        this.requestCount++;

        const response = await fetch(url, {
          ...options,
          headers,
        });

        // Update rate limit info
        this.rateLimitRemaining = parseInt(
          response.headers.get("x-ratelimit-remaining") || "0"
        );
        this.rateLimitReset =
          parseInt(response.headers.get("x-ratelimit-reset") || "0") * 1000;

        if (config.debug) {
          console.log(`🔍 API Request #${this.requestCount}: ${url}`);
          console.log(`📊 Rate Limit: ${this.rateLimitRemaining} remaining`);
        }

        if (
          response.status === 403 &&
          response.headers.get("x-ratelimit-remaining") === "0"
        ) {
          const resetTime = new Date(this.rateLimitReset);
          const waitTime = Math.max(0, this.rateLimitReset - Date.now() + 1000);
          console.log(
            `⏳ Rate limit exceeded. Waiting until ${resetTime.toLocaleTimeString()}...`
          );
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          continue;
        }

        if (!response.ok) {
          const errorText = await response.text();

          if (response.status === 401) {
            throw new Error(
              '❌ Authentication failed. GitHub API requires Bearer token format.\nSolution: Check your token permissions - it needs "repo" scope for private repos or "public_repo" for public repos.'
            );
          } else if (response.status === 403) {
            throw new Error(
              "❌ Access forbidden. Token might lack repository access or API endpoint restrictions.\nSolution: Ensure your token has proper repository access scopes."
            );
          } else if (response.status === 404) {
            throw new Error(
              "❌ Repository not found. Please check the repository name and your access permissions.\nSolution: Verify repository exists and token has access."
            );
          } else if (response.status === 422) {
            throw new Error(
              "❌ Request validation failed. Check your parameters.\nSolution: Verify date formats and repository name."
            );
          }

          if (retries > 1) {
            console.log(
              `⚠️ Request failed (${response.status}), retrying... (${
                retries - 1
              } attempts left)`
            );
            await new Promise((resolve) =>
              setTimeout(resolve, 1000 * (4 - retries))
            );
            retries--;
            continue;
          }

          throw new Error(
            `GitHub API error (${response.status}): ${errorText}`
          );
        }

        return await response.json();
      } catch (error) {
        if (error.name === "TypeError" && error.message.includes("fetch")) {
          if (retries > 1) {
            console.log(
              `🌐 Network error, retrying... (${retries - 1} attempts left)`
            );
            await new Promise((resolve) => setTimeout(resolve, 2000));
            retries--;
            continue;
          }
          throw new Error(
            "❌ Network error. Please check your internet connection."
          );
        }

        if (retries === 1) {
          throw error;
        }

        retries--;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  async graphqlRequest(query, variables = {}) {
    const response = await this.makeRequest(this.graphqlUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });

    if (response.errors) {
      throw new Error(
        `GraphQL Error: ${response.errors.map((e) => e.message).join(", ")}`
      );
    }

    return response.data;
  }

  async waitForRateLimit() {
    if (this.rateLimitRemaining < 10) {
      const waitTime = Math.max(0, this.rateLimitReset - Date.now() + 1000);
      if (waitTime > 0) {
        console.log(
          `⏳ Rate limit low (${
            this.rateLimitRemaining
          } remaining), waiting ${Math.ceil(waitTime / 1000)}s...`
        );
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }
  }
}

// Simple progress tracker
class ProgressTracker {
  constructor(label, total = 100) {
    this.label = label;
    this.current = 0;
    this.total = total;
    this.startTime = Date.now();
    this.lastUpdate = 0;
  }

  update(increment = 1, currentDesc = "") {
    this.current += increment;
    const now = Date.now();

    // Throttle updates to avoid spam
    if (now - this.lastUpdate < 100 && this.current < this.total) return;
    this.lastUpdate = now;

    const percentage = Math.min(100, (this.current / this.total) * 100);
    const elapsed = (now - this.startTime) / 1000;
    const rate = this.current / elapsed;
    const eta =
      this.total > this.current
        ? Math.ceil((this.total - this.current) / rate)
        : 0;

    const barLength = 20;
    const filled = Math.floor(percentage / 5);
    const bar = "█".repeat(filled) + "░".repeat(barLength - filled);

    const status = currentDesc ? ` - ${currentDesc}` : "";
    process.stdout.write(
      `\r${this.label}: [${bar}] ${percentage.toFixed(1)}% (${this.current}/${
        this.total
      })${eta > 0 ? ` ETA: ${eta}s` : ""}${status}`
    );

    if (this.current >= this.total) {
      process.stdout.write("\n");
    }
  }

  finish() {
    this.current = this.total;
    this.update(0);
  }
}

// Data analyzer
class GitHubAnalyzer {
  constructor(client, repo, targetUser = null) {
    this.client = client;
    this.repo = repo;
    this.targetUser = targetUser; // NEW: Target user for focused analysis
    this.data = {
      commits: [],
      pullRequests: [],
      reviews: [],
      contributors: new Map(),
      issues: [],
    };
  }

  async fetchCommits() {
    const [owner, repoName] = this.repo.split("/");
    const commits = [];
    let page = 1;
    let hasMore = true;

    console.log(
      `\n📝 Fetching commits from ${
        config.startDate.toISOString().split("T")[0]
      } to ${config.endDate.toISOString().split("T")[0]}...`
    );
    if (this.targetUser) {
      console.log(`🎯 Focusing on user: ${this.targetUser}`);
    }

    const progress = new ProgressTracker(
      "Commits",
      config.fetchLimit === Infinity ? 1000 : config.fetchLimit
    );

    while (hasMore && commits.length < config.fetchLimit) {
      await this.client.waitForRateLimit();

      const perPage = Math.min(100, config.fetchLimit - commits.length);
      let url = `${
        this.client.baseUrl
      }/repos/${owner}/${repoName}/commits?per_page=${perPage}&page=${page}&since=${config.startDate.toISOString()}&until=${config.endDate.toISOString()}`;

      // NEW: Add author filter if targeting specific user
      if (this.targetUser) {
        url += `&author=${encodeURIComponent(this.targetUser)}`;
      }

      try {
        const pageCommits = await this.client.makeRequest(url);

        if (pageCommits.length === 0) {
          hasMore = false;
          break;
        }

        // Fetch detailed stats for each commit
        for (const commit of pageCommits) {
          if (commits.length >= config.fetchLimit) break;

          try {
            const detailedCommit = await this.client.makeRequest(
              `${this.client.baseUrl}/repos/${owner}/${repoName}/commits/${commit.sha}`
            );

            // NEW: Filter by target user if specified
            const commitEmail =
              detailedCommit.commit?.author?.email || "unknown@unknown.com";
            if (
              !this.targetUser ||
              commitEmail === this.targetUser ||
              commit.author?.login === this.targetUser
            ) {
              commits.push(detailedCommit);
              progress.update(1, `${commit.sha.substring(0, 7)}`);
            }
          } catch (error) {
            if (config.debug) {
              console.log(
                `⚠️ Could not fetch details for commit ${commit.sha}: ${error.message}`
              );
            }
            commits.push(commit);
            progress.update(1);
          }
        }

        if (config.verbose) {
          console.log(
            `\n📝 Fetched ${commits.length} commits (page ${page})...`
          );
        }

        page++;
      } catch (error) {
        console.error(
          `\n❌ Error fetching commits page ${page}: ${error.message}`
        );
        break;
      }
    }

    progress.finish();
    this.data.commits = commits;
    return commits;
  }

  async fetchPullRequests() {
    const [owner, repoName] = this.repo.split("/");
    const pullRequests = [];
    let page = 1;
    let hasMore = true;

    console.log(`\n🔀 Fetching pull requests...`);
    const progress = new ProgressTracker(
      "Pull Requests",
      Math.min(config.fetchLimit, 500)
    );

    while (hasMore && pullRequests.length < config.fetchLimit) {
      await this.client.waitForRateLimit();

      const perPage = Math.min(100, config.fetchLimit - pullRequests.length);
      const url = `${this.client.baseUrl}/repos/${owner}/${repoName}/pulls?state=all&per_page=${perPage}&page=${page}&sort=created&direction=desc`;

      try {
        const pagePRs = await this.client.makeRequest(url);

        if (pagePRs.length === 0) {
          hasMore = false;
          break;
        }

        // Filter by date range and optionally by target user
        for (const pr of pagePRs) {
          const createdAt = new Date(pr.created_at);
          const authorLogin = pr.user?.login;
          const matchesUser =
            !this.targetUser || authorLogin === this.targetUser;

          if (
            createdAt >= config.startDate &&
            createdAt <= config.endDate &&
            matchesUser &&
            pullRequests.length < config.fetchLimit
          ) {
            pullRequests.push(pr);
            progress.update(1, `#${pr.number}`);
          }
        }

        if (config.verbose) {
          console.log(
            `\n🔀 Fetched ${pullRequests.length} pull requests (page ${page})...`
          );
        }

        page++;

        // If we're getting PRs outside our date range, we can stop
        const lastPR = pagePRs[pagePRs.length - 1];
        if (lastPR && new Date(lastPR.created_at) < config.startDate) {
          hasMore = false;
        }
      } catch (error) {
        console.error(
          `\n❌ Error fetching pull requests page ${page}: ${error.message}`
        );
        break;
      }
    }

    progress.finish();
    this.data.pullRequests = pullRequests;
    return pullRequests;
  }

  async fetchReviews() {
    if (this.data.pullRequests.length === 0) {
      console.log("\n📋 No pull requests to fetch reviews for");
      return [];
    }

    const reviews = [];
    console.log(
      `\n📋 Fetching reviews for ${this.data.pullRequests.length} pull requests...`
    );
    const progress = new ProgressTracker(
      "Reviews",
      this.data.pullRequests.length
    );

    for (const pr of this.data.pullRequests) {
      await this.client.waitForRateLimit();

      const [owner, repoName] = this.repo.split("/");
      const url = `${this.client.baseUrl}/repos/${owner}/${repoName}/pulls/${pr.number}/reviews`;

      try {
        const prReviews = await this.client.makeRequest(url);

        // Filter reviews by target user if specified
        const filteredReviews = this.targetUser
          ? prReviews.filter((review) => review.user?.login === this.targetUser)
          : prReviews;

        const enrichedReviews = filteredReviews.map((review) => ({
          ...review,
          pr_number: pr.number,
          pr_title: pr.title,
          pr_author: pr.user?.login,
        }));
        reviews.push(...enrichedReviews);
        progress.update(1, `PR #${pr.number}`);
      } catch (error) {
        if (config.debug) {
          console.log(
            `⚠️ Could not fetch reviews for PR #${pr.number}: ${error.message}`
          );
        }
        progress.update(1);
      }
    }

    progress.finish();
    this.data.reviews = reviews;
    return reviews;
  }

  async analyzeCommitActivity() {
    const userCommits = new Map();

    for (const commit of this.data.commits) {
      const authorEmail = commit.commit?.author?.email || "unknown@unknown.com";
      const authorLogin =
        commit.author?.login || commit.commit?.author?.name || "unknown";
      const authorKey = authorEmail; // Use email as primary key
      const date = new Date(commit.commit.author.date);
      const stats = commit.stats || { additions: 0, deletions: 0, total: 0 };

      if (!userCommits.has(authorKey)) {
        userCommits.set(authorKey, {
          email: authorEmail,
          login: authorLogin,
          name: commit.commit?.author?.name || authorLogin,
          totalCommits: 0,
          totalAdditions: 0,
          totalDeletions: 0,
          commitsByDay: new Map(),
          commitsByHour: new Array(24).fill(0),
          commitsByWeekday: new Array(7).fill(0),
          commitSizes: [],
          commitMessages: [],
          firstCommit: date,
          lastCommit: date,
        });
      }

      const userData = userCommits.get(authorKey);
      userData.totalCommits++;
      userData.totalAdditions += stats.additions;
      userData.totalDeletions += stats.deletions;
      userData.commitSizes.push(stats.total);
      userData.commitMessages.push(commit.commit.message);

      // Update date range
      if (date < userData.firstCommit) userData.firstCommit = date;
      if (date > userData.lastCommit) userData.lastCommit = date;

      // Time analysis
      const day = date.toISOString().split("T")[0];
      userData.commitsByDay.set(day, (userData.commitsByDay.get(day) || 0) + 1);
      userData.commitsByHour[date.getHours()]++;
      userData.commitsByWeekday[date.getDay()]++;
    }

    // Convert Maps to Objects for JSON serialization
    const result = {};
    for (const [email, userData] of userCommits) {
      result[email] = {
        ...userData,
        commitsByDay: Object.fromEntries(userData.commitsByDay),
        averageCommitSize:
          userData.commitSizes.length > 0
            ? userData.commitSizes.reduce((a, b) => a + b, 0) /
              userData.commitSizes.length
            : 0,
        conventionalCommits: this.analyzeConventionalCommits(
          userData.commitMessages
        ),
        workPatterns: this.analyzeWorkPatterns(
          userData.commitsByHour,
          userData.commitsByWeekday
        ),
      };
    }

    return result;
  }

  analyzeConventionalCommits(messages) {
    const conventionalPattern =
      /^(feat|fix|docs|style|refactor|perf|test|chore|build|ci)(\(.+\))?: .+/;
    const conventional = messages.filter((msg) =>
      conventionalPattern.test(msg)
    ).length;
    return {
      total: messages.length,
      conventional: conventional,
      percentage:
        messages.length > 0
          ? ((conventional / messages.length) * 100).toFixed(2)
          : 0,
    };
  }

  analyzeWorkPatterns(hourlyCommits, weekdayCommits) {
    const businessHours = hourlyCommits.slice(9, 17).reduce((a, b) => a + b, 0);
    const totalCommits = hourlyCommits.reduce((a, b) => a + b, 0);
    const weekendCommits = weekdayCommits[0] + weekdayCommits[6]; // Sunday + Saturday

    return {
      businessHoursPercentage:
        totalCommits > 0
          ? ((businessHours / totalCommits) * 100).toFixed(2)
          : 0,
      weekendPercentage:
        totalCommits > 0
          ? ((weekendCommits / totalCommits) * 100).toFixed(2)
          : 0,
      peakHour: hourlyCommits.indexOf(Math.max(...hourlyCommits)),
      peakDay: [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
      ][weekdayCommits.indexOf(Math.max(...weekdayCommits))],
    };
  }

  async analyzePullRequests() {
    const userPRs = new Map();

    for (const pr of this.data.pullRequests) {
      const authorLogin = pr.user?.login || "unknown";
      const createdAt = new Date(pr.created_at);
      const mergedAt = pr.merged_at ? new Date(pr.merged_at) : null;
      const closedAt = pr.closed_at ? new Date(pr.closed_at) : null;
      const timeToMerge = mergedAt
        ? (mergedAt - createdAt) / (1000 * 60 * 60 * 24)
        : null; // days
      const timeToClose = closedAt
        ? (closedAt - createdAt) / (1000 * 60 * 60 * 24)
        : null;

      if (!userPRs.has(authorLogin)) {
        userPRs.set(authorLogin, {
          login: authorLogin,
          totalPRs: 0,
          mergedPRs: 0,
          closedPRs: 0,
          openPRs: 0,
          mergeTimes: [],
          closeTimes: [],
          prSizes: [],
          reviewCounts: [],
          labels: [],
          prTitles: [],
        });
      }

      const userData = userPRs.get(authorLogin);
      userData.totalPRs++;
      userData.prTitles.push(pr.title);

      if (pr.state === "open") {
        userData.openPRs++;
      } else if (pr.merged_at) {
        userData.mergedPRs++;
        if (timeToMerge !== null) {
          userData.mergeTimes.push(timeToMerge);
        }
      } else if (pr.closed_at) {
        userData.closedPRs++;
        if (timeToClose !== null) {
          userData.closeTimes.push(timeToClose);
        }
      }

      userData.prSizes.push((pr.additions || 0) + (pr.deletions || 0));
      userData.labels.push(...(pr.labels || []).map((label) => label.name));

      // Count reviews for this PR
      const prReviews = this.data.reviews.filter(
        (review) => review.pr_number === pr.number
      );
      userData.reviewCounts.push(prReviews.length);
    }

    // Convert Map to Object and calculate statistics
    const result = {};
    for (const [login, userData] of userPRs) {
      result[login] = {
        ...userData,
        averageTimeToMerge:
          userData.mergeTimes.length > 0
            ? (
                userData.mergeTimes.reduce((a, b) => a + b, 0) /
                userData.mergeTimes.length
              ).toFixed(2)
            : 0,
        averagePRSize:
          userData.prSizes.length > 0
            ? Math.round(
                userData.prSizes.reduce((a, b) => a + b, 0) /
                  userData.prSizes.length
              )
            : 0,
        mergeRate:
          userData.totalPRs > 0
            ? ((userData.mergedPRs / userData.totalPRs) * 100).toFixed(2)
            : 0,
        averageReviewsPerPR:
          userData.reviewCounts.length > 0
            ? (
                userData.reviewCounts.reduce((a, b) => a + b, 0) /
                userData.reviewCounts.length
              ).toFixed(2)
            : 0,
        topLabels: this.getTopItems(userData.labels, 5),
      };
    }

    return result;
  }

  async analyzeReviews() {
    const userReviews = new Map();

    for (const review of this.data.reviews) {
      const reviewer = review.user?.login || "unknown";
      const submittedAt = new Date(review.submitted_at);

      if (!userReviews.has(reviewer)) {
        userReviews.set(reviewer, {
          login: reviewer,
          totalReviews: 0,
          approvals: 0,
          changesRequested: 0,
          comments: 0,
          reviewedAuthors: new Set(),
          reviewTimes: [],
          prNumbers: [],
        });
      }

      const userData = userReviews.get(reviewer);
      userData.totalReviews++;
      userData.reviewedAuthors.add(review.pr_author);
      userData.prNumbers.push(review.pr_number);

      switch (review.state) {
        case "APPROVED":
          userData.approvals++;
          break;
        case "CHANGES_REQUESTED":
          userData.changesRequested++;
          break;
        case "COMMENTED":
          userData.comments++;
          break;
      }
    }

    // Convert Map to Object and calculate statistics
    const result = {};
    for (const [login, userData] of userReviews) {
      result[login] = {
        ...userData,
        reviewedAuthors: Array.from(userData.reviewedAuthors),
        authorDiversity: userData.reviewedAuthors.size,
        approvalRate:
          userData.totalReviews > 0
            ? ((userData.approvals / userData.totalReviews) * 100).toFixed(2)
            : 0,
        changesRequestedRate:
          userData.totalReviews > 0
            ? (
                (userData.changesRequested / userData.totalReviews) *
                100
              ).toFixed(2)
            : 0,
      };
    }

    return result;
  }

  getTopItems(items, count = 5) {
    const frequency = {};
    items.forEach((item) => {
      frequency[item] = (frequency[item] || 0) + 1;
    });

    return Object.entries(frequency)
      .sort(([, a], [, b]) => b - a)
      .slice(0, count)
      .map(([item, count]) => ({ item, count }));
  }

  calculateStatistics(values) {
    if (values.length === 0)
      return { mean: 0, median: 0, p90: 0, min: 0, max: 0, std: 0 };

    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const median = sorted[Math.floor(sorted.length / 2)];
    const p90 = sorted[Math.floor(sorted.length * 0.9)];

    // Calculate standard deviation
    const variance =
      values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
      values.length;
    const std = Math.sqrt(variance);

    return {
      mean: parseFloat(mean.toFixed(2)),
      median: parseFloat(median.toFixed(2)),
      p90: parseFloat(p90.toFixed(2)),
      min: sorted[0],
      max: sorted[sorted.length - 1],
      std: parseFloat(std.toFixed(2)),
    };
  }

  // NEW: Generate user-specific report section
  async generateUserReport(commitAnalysis, prAnalysis, reviewAnalysis) {
    if (!this.targetUser) return null;

    const userCommitData = commitAnalysis[this.targetUser];
    const userPRData =
      Object.values(prAnalysis).find((pr) => pr.login === this.targetUser) ||
      {};
    const userReviewData =
      Object.values(reviewAnalysis).find(
        (review) => review.login === this.targetUser
      ) || {};

    if (
      !userCommitData &&
      !Object.keys(userPRData).length &&
      !Object.keys(userReviewData).length
    ) {
      throw new Error(`❌ No data found for user: ${this.targetUser}`);
    }

    return {
      identity: {
        email: this.targetUser,
        username:
          userCommitData?.login ||
          userPRData.login ||
          userReviewData.login ||
          "unknown",
        name: userCommitData?.name || "unknown",
        analysisDate: new Date().toISOString(),
        dateRange: `${config.startDate.toISOString().split("T")[0]} to ${
          config.endDate.toISOString().split("T")[0]
        }`,
      },

      commitActivityAndCodeContribution: {
        category: "User Commit Activity & Code Contribution Patterns",
        description: `Detailed commit analysis for ${this.targetUser}`,
        metrics: userCommitData
          ? {
              totalCommits: userCommitData.totalCommits,
              totalAdditions: userCommitData.totalAdditions,
              totalDeletions: userCommitData.totalDeletions,
              netContribution:
                userCommitData.totalAdditions - userCommitData.totalDeletions,
              averageCommitSize: userCommitData.averageCommitSize,
              commitsByDay: userCommitData.commitsByDay,
              timePatterns: {
                hourlyDistribution: userCommitData.commitsByHour,
                weekdayDistribution: userCommitData.commitsByWeekday,
                workPatterns: userCommitData.workPatterns,
              },
              qualityMetrics: {
                conventionalCommits: userCommitData.conventionalCommits,
                commitSizeDistribution: this.categorizeCommitSizes(
                  userCommitData.commitSizes
                ),
              },
            }
          : {
              message:
                "No commit data found for this user in the specified time range",
            },
        insights: {
          productivity: userCommitData
            ? this.generateUserProductivityInsights(userCommitData)
            : "No insights available",
          workLifeBalance: userCommitData
            ? this.assessUserWorkLifeBalance(userCommitData.workPatterns)
            : "No data",
          codeQuality: userCommitData
            ? this.assessUserCodeQuality(userCommitData)
            : "No data",
        },
      },

      pullRequestLifecycleAndReviewEfficiency: {
        category: "User Pull Request & Review Performance",
        description: `PR and review analysis for ${this.targetUser}`,
        metrics: {
          pullRequestMetrics: Object.keys(userPRData).length
            ? {
                totalPRs: userPRData.totalPRs,
                mergedPRs: userPRData.mergedPRs,
                mergeRate: userPRData.mergeRate,
                averageTimeToMerge: userPRData.averageTimeToMerge,
                averagePRSize: userPRData.averagePRSize,
                averageReviewsPerPR: userPRData.averageReviewsPerPR,
                topLabels: userPRData.topLabels,
              }
            : { message: "No PR data found for this user" },
          reviewMetrics: Object.keys(userReviewData).length
            ? {
                totalReviews: userReviewData.totalReviews,
                approvals: userReviewData.approvals,
                changesRequested: userReviewData.changesRequested,
                approvalRate: userReviewData.approvalRate,
                authorDiversity: userReviewData.authorDiversity,
                reviewedAuthors: userReviewData.reviewedAuthors,
              }
            : { message: "No review data found for this user" },
        },
        insights: {
          prEfficiency: Object.keys(userPRData).length
            ? this.assessUserPREfficiency(userPRData)
            : "No data",
          reviewContribution: Object.keys(userReviewData).length
            ? this.assessUserReviewContribution(userReviewData)
            : "No data",
          collaborationStyle: this.assessUserCollaborationStyle(
            userPRData,
            userReviewData
          ),
        },
      },

      developerProductivityAndParticipation: {
        category: "Individual Developer Productivity Analysis",
        description: `Comprehensive productivity analysis for ${this.targetUser}`,
        metrics: {
          productivityScore: this.calculateUserProductivityScore(
            userCommitData,
            userPRData,
            userReviewData
          ),
          participationLevel: this.calculateUserParticipation(
            userCommitData,
            userPRData,
            userReviewData
          ),
          impactAssessment: this.calculateUserImpact(
            userCommitData,
            userPRData,
            userReviewData
          ),
        },
        insights: {
          strengths: this.identifyUserStrengths(
            userCommitData,
            userPRData,
            userReviewData
          ),
          growthAreas: this.identifyUserGrowthAreas(
            userCommitData,
            userPRData,
            userReviewData
          ),
          recommendations: this.generateUserRecommendations(
            userCommitData,
            userPRData,
            userReviewData
          ),
        },
      },

      collaborationAndEngagementMetrics: {
        category: "User Collaboration & Team Engagement",
        description: `Collaboration patterns and team engagement for ${this.targetUser}`,
        metrics: {
          collaborationBreadth: Object.keys(userReviewData).length
            ? userReviewData.authorDiversity
            : 0,
          mentorshipIndicators:
            this.calculateUserMentorshipScore(userReviewData),
          crossTeamEngagement:
            this.assessUserCrossTeamEngagement(userReviewData),
          knowledgeSharing: this.assessUserKnowledgeSharing(
            userCommitData,
            userReviewData
          ),
        },
        insights: {
          teamRole: this.identifyUserTeamRole(
            userCommitData,
            userPRData,
            userReviewData
          ),
          collaborationHealth:
            this.assessUserCollaborationHealth(userReviewData),
          leadershipPotential: this.assessUserLeadershipPotential(
            userCommitData,
            userPRData,
            userReviewData
          ),
        },
      },

      anomalyDetectionAndPerformanceOutliers: {
        category: "User Performance Analysis & Risk Assessment",
        description: `Performance patterns and risk indicators for ${this.targetUser}`,
        metrics: {
          workPatternAnalysis: userCommitData
            ? this.analyzeUserWorkPatterns(userCommitData)
            : "No data",
          performanceConsistency: this.assessUserPerformanceConsistency(
            userCommitData,
            userPRData
          ),
          riskIndicators: this.identifyUserRiskIndicators(
            userCommitData,
            userPRData,
            userReviewData
          ),
        },
        insights: {
          wellBeingAssessment: userCommitData
            ? this.assessUserWellBeing(userCommitData.workPatterns)
            : "No data",
          sustainabilityCheck: this.assessUserSustainability(
            userCommitData,
            userPRData
          ),
          performanceAlerts: this.generateUserPerformanceAlerts(
            userCommitData,
            userPRData,
            userReviewData
          ),
        },
      },

      codeVelocityAndChurnAnalysis: {
        category: "User Code Velocity & Quality Analysis",
        description: `Code velocity, churn, and quality metrics for ${this.targetUser}`,
        metrics: {
          velocityMetrics: userCommitData
            ? this.calculateUserVelocity(userCommitData)
            : "No data",
          churnAnalysis: userCommitData
            ? this.calculateUserChurn(userCommitData)
            : "No data",
          qualityIndicators: this.calculateUserQualityIndicators(
            userCommitData,
            userPRData
          ),
        },
        insights: {
          efficiencyAssessment: this.assessUserEfficiency(
            userCommitData,
            userPRData
          ),
          codeStability: userCommitData
            ? this.assessUserCodeStability(userCommitData)
            : "No data",
          improvementOpportunities: this.identifyUserImprovementOpportunities(
            userCommitData,
            userPRData,
            userReviewData
          ),
        },
      },
    };
  }

  // User-specific helper methods
  generateUserProductivityInsights(commitData) {
    const daysActive = Math.max(
      1,
      Math.floor(
        (commitData.lastCommit - commitData.firstCommit) / (1000 * 60 * 60 * 24)
      )
    );
    const commitsPerDay = commitData.totalCommits / daysActive;
    const linesPerDay =
      (commitData.totalAdditions + commitData.totalDeletions) / daysActive;

    return {
      averageCommitsPerDay: commitsPerDay.toFixed(2),
      averageLinesPerDay: linesPerDay.toFixed(0),
      productivityLevel:
        commitsPerDay > 2 ? "High" : commitsPerDay > 1 ? "Medium" : "Low",
      consistencyScore: this.calculateConsistencyScore(commitData.commitsByDay),
    };
  }

  assessUserWorkLifeBalance(workPatterns) {
    const businessHours = parseFloat(workPatterns.businessHoursPercentage);
    const weekendWork = parseFloat(workPatterns.weekendPercentage);

    let assessment = "Good";
    const concerns = [];

    if (businessHours < 60) concerns.push("Low business hours activity");
    if (weekendWork > 25) concerns.push("High weekend activity");
    if (weekendWork > 40) assessment = "Concerning";
    else if (concerns.length > 0) assessment = "Needs attention";

    return {
      assessment,
      businessHoursPercentage: businessHours,
      weekendPercentage: weekendWork,
      concerns: concerns.length > 0 ? concerns : ["No significant concerns"],
      recommendation: this.generateWorkLifeBalanceRecommendation(
        businessHours,
        weekendWork
      ),
    };
  }

  assessUserCodeQuality(commitData) {
    const conventionalRate = parseFloat(
      commitData.conventionalCommits.percentage
    );
    const avgSize = commitData.averageCommitSize;

    let qualityScore = 0;
    if (conventionalRate > 80) qualityScore += 3;
    else if (conventionalRate > 60) qualityScore += 2;
    else if (conventionalRate > 40) qualityScore += 1;

    if (avgSize < 200) qualityScore += 2;
    else if (avgSize < 500) qualityScore += 1;

    return {
      overallScore: qualityScore,
      rating:
        qualityScore >= 4
          ? "Excellent"
          : qualityScore >= 3
          ? "Good"
          : qualityScore >= 2
          ? "Fair"
          : "Needs Improvement",
      conventionalCommitAdoption: conventionalRate,
      averageCommitSize: avgSize,
      recommendations: this.generateQualityRecommendations(
        conventionalRate,
        avgSize
      ),
    };
  }

  calculateUserProductivityScore(commitData, prData, reviewData) {
    let score = 0;
    let maxScore = 0;

    if (commitData) {
      score += Math.min(commitData.totalCommits / 10, 5); // Up to 5 points for commits
      maxScore += 5;
    }

    if (Object.keys(prData).length) {
      score += Math.min(prData.totalPRs / 5, 3); // Up to 3 points for PRs
      score += (parseFloat(prData.mergeRate) / 100) * 2; // Up to 2 points for merge rate
      maxScore += 5;
    }

    if (Object.keys(reviewData).length) {
      score += Math.min(reviewData.totalReviews / 10, 2); // Up to 2 points for reviews
      maxScore += 2;
    }

    return {
      score: parseFloat(score.toFixed(2)),
      maxScore,
      percentage:
        maxScore > 0 ? parseFloat(((score / maxScore) * 100).toFixed(2)) : 0,
      rating: this.getProductivityRating(score, maxScore),
    };
  }

  getProductivityRating(score, maxScore) {
    if (maxScore === 0) return "No data";
    const percentage = (score / maxScore) * 100;
    if (percentage >= 80) return "Exceptional";
    if (percentage >= 60) return "High";
    if (percentage >= 40) return "Moderate";
    if (percentage >= 20) return "Low";
    return "Very Low";
  }

  calculateUserParticipation(commitData, prData, reviewData) {
    return {
      codeContribution: commitData ? commitData.totalCommits : 0,
      prContribution: Object.keys(prData).length ? prData.totalPRs : 0,
      reviewContribution: Object.keys(reviewData).length
        ? reviewData.totalReviews
        : 0,
      overallParticipation: this.getParticipationLevel(
        commitData,
        prData,
        reviewData
      ),
    };
  }

  getParticipationLevel(commitData, prData, reviewData) {
    let level = 0;
    if (commitData && commitData.totalCommits > 0) level++;
    if (Object.keys(prData).length && prData.totalPRs > 0) level++;
    if (Object.keys(reviewData).length && reviewData.totalReviews > 0) level++;

    switch (level) {
      case 3:
        return "Full Participant";
      case 2:
        return "Active Contributor";
      case 1:
        return "Limited Participation";
      default:
        return "Minimal Participation";
    }
  }

  calculateUserImpact(commitData, prData, reviewData) {
    const codeImpact = commitData
      ? commitData.totalAdditions + commitData.totalDeletions
      : 0;
    const prImpact = Object.keys(prData).length ? prData.mergedPRs : 0;
    const reviewImpact = Object.keys(reviewData).length
      ? reviewData.totalReviews
      : 0;

    return {
      codeVolumeImpact: codeImpact,
      deliveryImpact: prImpact,
      qualityImpact: reviewImpact,
      overallImpact: this.calculateOverallImpact(
        codeImpact,
        prImpact,
        reviewImpact
      ),
    };
  }

  calculateOverallImpact(codeImpact, prImpact, reviewImpact) {
    const normalizedCode = Math.min(codeImpact / 10000, 1) * 40;
    const normalizedPR = Math.min(prImpact / 20, 1) * 35;
    const normalizedReview = Math.min(reviewImpact / 30, 1) * 25;

    const totalImpact = normalizedCode + normalizedPR + normalizedReview;

    if (totalImpact >= 80) return "High Impact";
    if (totalImpact >= 60) return "Moderate Impact";
    if (totalImpact >= 40) return "Some Impact";
    return "Limited Impact";
  }

  identifyUserStrengths(commitData, prData, reviewData) {
    const strengths = [];

    if (commitData) {
      if (commitData.totalCommits > 50) strengths.push("High commit volume");
      if (commitData.averageCommitSize < 300)
        strengths.push("Well-sized commits");
      if (parseFloat(commitData.conventionalCommits.percentage) > 70)
        strengths.push("Excellent commit message quality");
      if (parseFloat(commitData.workPatterns.businessHoursPercentage) > 80)
        strengths.push("Good work-life balance");
    }

    if (Object.keys(prData).length) {
      if (parseFloat(prData.mergeRate) > 80)
        strengths.push("High PR success rate");
      if (prData.totalPRs > 20) strengths.push("Active PR contributor");
    }

    if (Object.keys(reviewData).length) {
      if (reviewData.totalReviews > 20) strengths.push("Active code reviewer");
      if (reviewData.authorDiversity > 5)
        strengths.push("Diverse collaboration");
    }

    return strengths.length > 0 ? strengths : ["Consistent contributor"];
  }

  identifyUserGrowthAreas(commitData, prData, reviewData) {
    const areas = [];

    if (commitData) {
      if (parseFloat(commitData.conventionalCommits.percentage) < 50)
        areas.push("Improve commit message consistency");
      if (commitData.averageCommitSize > 500)
        areas.push("Consider smaller, more focused commits");
      if (parseFloat(commitData.workPatterns.weekendPercentage) > 25)
        areas.push("Better work-life balance needed");
    }

    if (Object.keys(prData).length) {
      if (parseFloat(prData.mergeRate) < 70)
        areas.push("Improve PR quality before submission");
    } else {
      areas.push("Increase PR contributions");
    }

    if (!Object.keys(reviewData).length || reviewData.totalReviews < 10) {
      areas.push("Increase participation in code reviews");
    }

    return areas.length > 0 ? areas : ["Continue current excellent practices"];
  }

  generateUserRecommendations(commitData, prData, reviewData) {
    const recommendations = [];

    if (
      commitData &&
      parseFloat(commitData.conventionalCommits.percentage) < 60
    ) {
      recommendations.push(
        "Adopt conventional commit format (feat:, fix:, etc.) for better project tracking"
      );
    }

    if (commitData && commitData.averageCommitSize > 500) {
      recommendations.push(
        "Break large changes into smaller, logical commits for easier review"
      );
    }

    if (!Object.keys(reviewData).length || reviewData.totalReviews < 15) {
      recommendations.push(
        "Increase participation in code reviews to share knowledge and learn from others"
      );
    }

    if (Object.keys(prData).length && parseFloat(prData.mergeRate) < 75) {
      recommendations.push(
        "Self-review PRs before submission and ensure comprehensive testing"
      );
    }

    if (
      commitData &&
      parseFloat(commitData.workPatterns.weekendPercentage) > 30
    ) {
      recommendations.push(
        "Consider establishing better work-life boundaries to prevent burnout"
      );
    }

    return recommendations.length > 0
      ? recommendations
      : [
          "Keep up the excellent work! Your contribution patterns are exemplary.",
        ];
  }

  // Additional helper methods for user analysis...
  calculateConsistencyScore(commitsByDay) {
    const days = Object.keys(commitsByDay);
    if (days.length < 7) return "Insufficient data";

    const commits = Object.values(commitsByDay);
    const avg = commits.reduce((a, b) => a + b, 0) / commits.length;
    const variance =
      commits.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) /
      commits.length;
    const coefficient = avg > 0 ? Math.sqrt(variance) / avg : 0;

    if (coefficient < 0.5) return "Very consistent";
    if (coefficient < 1.0) return "Moderately consistent";
    return "Variable";
  }

  generateWorkLifeBalanceRecommendation(businessHours, weekendWork) {
    if (weekendWork > 30)
      return "Consider establishing clearer work-life boundaries";
    if (businessHours < 50)
      return "Consider more structured work hours for better collaboration";
    return "Work pattern appears healthy";
  }

  generateQualityRecommendations(conventionalRate, avgSize) {
    const recommendations = [];
    if (conventionalRate < 60)
      recommendations.push("Adopt conventional commit messages");
    if (avgSize > 500)
      recommendations.push("Make smaller, more focused commits");
    return recommendations.length > 0
      ? recommendations
      : ["Maintain current quality practices"];
  }

  assessUserPREfficiency(prData) {
    const mergeRate = parseFloat(prData.mergeRate);
    const avgTime = parseFloat(prData.averageTimeToMerge);

    let efficiency = "Good";
    if (mergeRate > 85 && avgTime < 3) efficiency = "Excellent";
    else if (mergeRate < 70 || avgTime > 7) efficiency = "Needs improvement";

    return {
      rating: efficiency,
      mergeRate: mergeRate,
      averageTimeToMerge: avgTime,
      suggestion: this.getPREfficiencySuggestion(mergeRate, avgTime),
    };
  }

  getPREfficiencySuggestion(mergeRate, avgTime) {
    if (mergeRate < 70)
      return "Focus on improving PR quality before submission";
    if (avgTime > 7)
      return "Consider smaller PRs or improved communication with reviewers";
    return "Maintain current excellent PR practices";
  }

  assessUserReviewContribution(reviewData) {
    const totalReviews = reviewData.totalReviews;
    const approvalRate = parseFloat(reviewData.approvalRate);
    const diversity = reviewData.authorDiversity;

    return {
      volume:
        totalReviews > 20 ? "High" : totalReviews > 10 ? "Moderate" : "Low",
      quality:
        approvalRate > 60
          ? "Balanced"
          : approvalRate > 80
          ? "Maybe too lenient"
          : "Very thorough",
      breadth: diversity > 5 ? "Excellent" : diversity > 2 ? "Good" : "Limited",
      overallContribution: this.calculateReviewContributionScore(
        totalReviews,
        approvalRate,
        diversity
      ),
    };
  }

  calculateReviewContributionScore(totalReviews, approvalRate, diversity) {
    let score = 0;
    if (totalReviews > 20) score += 3;
    else if (totalReviews > 10) score += 2;
    else if (totalReviews > 5) score += 1;

    if (approvalRate >= 60 && approvalRate <= 80) score += 2;
    else if (approvalRate >= 50 && approvalRate <= 85) score += 1;

    if (diversity > 5) score += 2;
    else if (diversity > 2) score += 1;

    if (score >= 6) return "Excellent reviewer";
    if (score >= 4) return "Good reviewer";
    if (score >= 2) return "Developing reviewer";
    return "Minimal reviewer";
  }

  assessUserCollaborationStyle(prData, reviewData) {
    const prCount = Object.keys(prData).length ? prData.totalPRs : 0;
    const reviewCount = Object.keys(reviewData).length
      ? reviewData.totalReviews
      : 0;

    if (prCount > reviewCount * 2)
      return "Producer - focuses more on creating than reviewing";
    if (reviewCount > prCount * 2)
      return "Reviewer - focuses more on reviewing than creating";
    if (prCount > 0 && reviewCount > 0)
      return "Balanced collaborator - good mix of creating and reviewing";
    return "Limited collaboration data available";
  }

  calculateUserMentorshipScore(reviewData) {
    if (!Object.keys(reviewData).length)
      return { score: 0, rating: "No mentorship data" };

    const diversityScore = Math.min(reviewData.authorDiversity / 10, 1) * 40;
    const volumeScore = Math.min(reviewData.totalReviews / 50, 1) * 40;
    const qualityScore = (parseFloat(reviewData.approvalRate) / 100) * 20;

    const totalScore = diversityScore + volumeScore + qualityScore;

    return {
      score: parseFloat(totalScore.toFixed(2)),
      rating:
        totalScore >= 80
          ? "Excellent mentor"
          : totalScore >= 60
          ? "Good mentor"
          : totalScore >= 40
          ? "Developing mentor"
          : "Limited mentorship",
      breakdown: {
        diversity: diversityScore,
        volume: volumeScore,
        quality: qualityScore,
      },
    };
  }

  assessUserCrossTeamEngagement(reviewData) {
    if (!Object.keys(reviewData).length) return "No cross-team data available";

    const authorDiversity = reviewData.authorDiversity;
    if (authorDiversity > 10) return "High cross-team engagement";
    if (authorDiversity > 5) return "Moderate cross-team engagement";
    if (authorDiversity > 2) return "Some cross-team engagement";
    return "Limited cross-team engagement";
  }

  assessUserKnowledgeSharing(commitData, reviewData) {
    const commitScore = commitData
      ? Math.min(commitData.totalCommits / 50, 1) * 50
      : 0;
    const reviewScore = Object.keys(reviewData).length
      ? Math.min(reviewData.totalReviews / 30, 1) * 50
      : 0;

    const totalScore = commitScore + reviewScore;

    return {
      score: parseFloat(totalScore.toFixed(2)),
      rating:
        totalScore >= 80
          ? "Excellent knowledge sharer"
          : totalScore >= 60
          ? "Good knowledge sharer"
          : totalScore >= 40
          ? "Moderate knowledge sharer"
          : "Limited knowledge sharing",
      areas: {
        codeContribution: commitScore,
        reviewContribution: reviewScore,
      },
    };
  }

  identifyUserTeamRole(commitData, prData, reviewData) {
    const commits = commitData ? commitData.totalCommits : 0;
    const prs = Object.keys(prData).length ? prData.totalPRs : 0;
    const reviews = Object.keys(reviewData).length
      ? reviewData.totalReviews
      : 0;

    if (commits > 100 && prs > 30 && reviews > 40)
      return "Senior contributor and mentor";
    if (commits > 50 && prs > 15) return "Core contributor";
    if (reviews > 30 && reviews > prs * 2)
      return "Code reviewer and quality gatekeeper";
    if (prs > 20) return "Active feature developer";
    if (commits > 20) return "Regular contributor";
    return "Occasional contributor";
  }

  assessUserCollaborationHealth(reviewData) {
    if (!Object.keys(reviewData).length) return "No collaboration data";

    const diversity = reviewData.authorDiversity;
    const volume = reviewData.totalReviews;

    if (diversity > 5 && volume > 20) return "Excellent collaboration";
    if (diversity > 3 && volume > 10) return "Good collaboration";
    if (diversity > 1 || volume > 5) return "Some collaboration";
    return "Limited collaboration";
  }

  assessUserLeadershipPotential(commitData, prData, reviewData) {
    let score = 0;
    let maxScore = 0;

    if (commitData) {
      score += Math.min(commitData.totalCommits / 100, 1) * 25;
      score +=
        Math.min(
          parseFloat(commitData.conventionalCommits.percentage) / 100,
          1
        ) * 15;
      maxScore += 40;
    }

    if (Object.keys(prData).length) {
      score += Math.min(prData.totalPRs / 50, 1) * 20;
      score += Math.min(parseFloat(prData.mergeRate) / 100, 1) * 10;
      maxScore += 30;
    }

    if (Object.keys(reviewData).length) {
      score += Math.min(reviewData.totalReviews / 50, 1) * 20;
      score += Math.min(reviewData.authorDiversity / 10, 1) * 10;
      maxScore += 30;
    }

    const percentage = maxScore > 0 ? (score / maxScore) * 100 : 0;

    return {
      score: parseFloat(score.toFixed(2)),
      percentage: parseFloat(percentage.toFixed(2)),
      rating:
        percentage >= 80
          ? "High leadership potential"
          : percentage >= 60
          ? "Moderate leadership potential"
          : percentage >= 40
          ? "Developing leadership skills"
          : "Early career stage",
    };
  }

  analyzeUserWorkPatterns(commitData) {
    const patterns = commitData.workPatterns;
    const hourlyDistribution = commitData.commitsByHour;
    const weekdayDistribution = commitData.commitsByWeekday;

    return {
      primaryWorkHours: this.identifyPrimaryWorkHours(hourlyDistribution),
      workDaysPreference: this.identifyWorkDaysPreference(weekdayDistribution),
      consistency: this.calculateWorkPatternConsistency(
        commitData.commitsByDay
      ),
      workLifeBalance: patterns,
      recommendations: this.generateWorkPatternRecommendations(patterns),
    };
  }

  identifyPrimaryWorkHours(hourlyDistribution) {
    const maxHour = hourlyDistribution.indexOf(Math.max(...hourlyDistribution));
    const morningWork = hourlyDistribution
      .slice(6, 12)
      .reduce((a, b) => a + b, 0);
    const afternoonWork = hourlyDistribution
      .slice(12, 18)
      .reduce((a, b) => a + b, 0);
    const eveningWork = hourlyDistribution
      .slice(18, 24)
      .reduce((a, b) => a + b, 0);

    const total = morningWork + afternoonWork + eveningWork;

    return {
      peakHour: `${maxHour}:00`,
      distribution: {
        morning: total > 0 ? ((morningWork / total) * 100).toFixed(1) : 0,
        afternoon: total > 0 ? ((afternoonWork / total) * 100).toFixed(1) : 0,
        evening: total > 0 ? ((eveningWork / total) * 100).toFixed(1) : 0,
      },
      pattern:
        afternoonWork > morningWork && afternoonWork > eveningWork
          ? "Afternoon worker"
          : morningWork > afternoonWork && morningWork > eveningWork
          ? "Morning worker"
          : eveningWork > morningWork && eveningWork > afternoonWork
          ? "Evening worker"
          : "Flexible schedule",
    };
  }

  identifyWorkDaysPreference(weekdayDistribution) {
    const weekdays = weekdayDistribution.slice(1, 6).reduce((a, b) => a + b, 0);
    const weekend = weekdayDistribution[0] + weekdayDistribution[6];
    const total = weekdays + weekend;

    const weekdayPercentage =
      total > 0 ? ((weekdays / total) * 100).toFixed(1) : 0;

    return {
      weekdayPercentage,
      weekendPercentage: total > 0 ? ((weekend / total) * 100).toFixed(1) : 0,
      pattern:
        weekdayPercentage > 90
          ? "Strict weekday worker"
          : weekdayPercentage > 80
          ? "Primarily weekday worker"
          : weekdayPercentage > 70
          ? "Mostly weekday worker"
          : "Flexible schedule",
    };
  }

  calculateWorkPatternConsistency(commitsByDay) {
    const commitCounts = Object.values(commitsByDay);
    if (commitCounts.length < 5) return "Insufficient data";

    const stats = this.calculateStatistics(commitCounts);
    const coefficient = stats.mean > 0 ? stats.std / stats.mean : 0;

    return {
      coefficient: parseFloat(coefficient.toFixed(2)),
      rating:
        coefficient < 0.5
          ? "Very consistent"
          : coefficient < 1.0
          ? "Moderately consistent"
          : coefficient < 1.5
          ? "Variable"
          : "Highly variable",
    };
  }

  generateWorkPatternRecommendations(patterns) {
    const recommendations = [];
    const businessHours = parseFloat(patterns.businessHoursPercentage);
    const weekendWork = parseFloat(patterns.weekendPercentage);

    if (businessHours < 60) {
      recommendations.push(
        "Consider aligning more work with business hours for better team collaboration"
      );
    }

    if (weekendWork > 25) {
      recommendations.push(
        "Consider reducing weekend work to maintain work-life balance"
      );
    }

    if (businessHours > 90 && weekendWork < 5) {
      recommendations.push(
        "Excellent work-life balance - maintain current patterns"
      );
    }

    return recommendations.length > 0
      ? recommendations
      : ["Work patterns appear balanced"];
  }

  assessUserPerformanceConsistency(commitData, prData) {
    let consistencyFactors = [];

    if (commitData) {
      const commitConsistency = this.calculateConsistencyScore(
        commitData.commitsByDay
      );
      consistencyFactors.push(`Commit consistency: ${commitConsistency}`);
    }

    if (Object.keys(prData).length && prData.totalPRs > 5) {
      const mergeRate = parseFloat(prData.mergeRate);
      const prConsistency =
        mergeRate > 80
          ? "Very consistent"
          : mergeRate > 60
          ? "Moderately consistent"
          : "Inconsistent";
      consistencyFactors.push(`PR success consistency: ${prConsistency}`);
    }

    return {
      factors: consistencyFactors,
      overallRating: this.calculateOverallConsistency(consistencyFactors),
    };
  }

  calculateOverallConsistency(factors) {
    const veryConsistent = factors.filter((f) =>
      f.includes("Very consistent")
    ).length;
    const moderatelyConsistent = factors.filter((f) =>
      f.includes("Moderately consistent")
    ).length;

    if (veryConsistent === factors.length) return "Very consistent performer";
    if (veryConsistent + moderatelyConsistent === factors.length)
      return "Consistent performer";
    return "Variable performance";
  }

  identifyUserRiskIndicators(commitData, prData, reviewData) {
    const risks = [];

    if (commitData) {
      const weekendWork = parseFloat(commitData.workPatterns.weekendPercentage);
      if (weekendWork > 30)
        risks.push("High weekend work - potential burnout risk");

      if (commitData.totalCommits < 5)
        risks.push("Very low activity - possible disengagement");
    }

    if (Object.keys(prData).length) {
      const mergeRate = parseFloat(prData.mergeRate);
      if (mergeRate < 50) risks.push("Low PR success rate - may need support");
    }

    if (
      !Object.keys(reviewData).length &&
      commitData &&
      commitData.totalCommits > 20
    ) {
      risks.push(
        "High code contribution but no reviews - missing collaboration"
      );
    }

    return risks.length > 0
      ? risks
      : ["No significant risk indicators identified"];
  }

  assessUserWellBeing(workPatterns) {
    const businessHours = parseFloat(workPatterns.businessHoursPercentage);
    const weekendWork = parseFloat(workPatterns.weekendPercentage);

    let wellBeingScore = 100;
    const concerns = [];

    if (businessHours < 40) {
      wellBeingScore -= 20;
      concerns.push("Very low business hours activity");
    } else if (businessHours < 60) {
      wellBeingScore -= 10;
      concerns.push("Low business hours activity");
    }

    if (weekendWork > 40) {
      wellBeingScore -= 30;
      concerns.push("Excessive weekend work");
    } else if (weekendWork > 25) {
      wellBeingScore -= 15;
      concerns.push("High weekend work");
    }

    return {
      score: Math.max(0, wellBeingScore),
      rating:
        wellBeingScore >= 90
          ? "Excellent"
          : wellBeingScore >= 70
          ? "Good"
          : wellBeingScore >= 50
          ? "Concerning"
          : "Critical",
      concerns: concerns.length > 0 ? concerns : ["No significant concerns"],
      recommendations: this.generateWellBeingRecommendations(
        wellBeingScore,
        concerns
      ),
    };
  }

  generateWellBeingRecommendations(score, concerns) {
    const recommendations = [];

    if (score < 70) {
      recommendations.push("Consider establishing better work-life boundaries");
      recommendations.push(
        "Discuss workload and schedule flexibility with manager"
      );
    }

    if (concerns.some((c) => c.includes("weekend"))) {
      recommendations.push("Implement weekend work restrictions");
    }

    if (concerns.some((c) => c.includes("business hours"))) {
      recommendations.push(
        "Align work schedule with team for better collaboration"
      );
    }

    return recommendations.length > 0
      ? recommendations
      : ["Maintain current healthy work patterns"];
  }

  assessUserSustainability(commitData, prData) {
    const factors = [];
    let sustainabilityScore = 100;

    if (commitData) {
      const weekendWork = parseFloat(commitData.workPatterns.weekendPercentage);
      if (weekendWork > 30) {
        sustainabilityScore -= 30;
        factors.push("High weekend work is unsustainable long-term");
      }

      const avgCommitSize = commitData.averageCommitSize;
      if (avgCommitSize > 1000) {
        sustainabilityScore -= 20;
        factors.push("Very large commits may indicate rushed work");
      }
    }

    if (Object.keys(prData).length) {
      const avgTime = parseFloat(prData.averageTimeToMerge);
      if (avgTime > 14) {
        sustainabilityScore -= 15;
        factors.push("Long PR cycle times may indicate process issues");
      }
    }

    return {
      score: Math.max(0, sustainabilityScore),
      rating:
        sustainabilityScore >= 90
          ? "Highly sustainable"
          : sustainabilityScore >= 70
          ? "Sustainable"
          : sustainabilityScore >= 50
          ? "At risk"
          : "Unsustainable",
      factors:
        factors.length > 0 ? factors : ["Work patterns appear sustainable"],
    };
  }

  generateUserPerformanceAlerts(commitData, prData, reviewData) {
    const alerts = [];

    if (commitData) {
      if (parseFloat(commitData.workPatterns.weekendPercentage) > 35) {
        alerts.push({
          level: "Warning",
          message: "High weekend work detected - monitor for burnout",
        });
      }

      if (commitData.totalCommits < 3) {
        alerts.push({
          level: "Info",
          message: "Low activity period - check if this is expected",
        });
      }
    }

    if (Object.keys(prData).length && parseFloat(prData.mergeRate) < 60) {
      alerts.push({
        level: "Warning",
        message: "Low PR success rate - may need additional support",
      });
    }

    if (
      !Object.keys(reviewData).length &&
      commitData &&
      commitData.totalCommits > 30
    ) {
      alerts.push({
        level: "Info",
        message:
          "High contribution but no reviews - encourage review participation",
      });
    }

    return alerts.length > 0
      ? alerts
      : [{ level: "Success", message: "No performance concerns detected" }];
  }

  calculateUserVelocity(commitData) {
    const daysActive = Math.max(
      1,
      Math.floor(
        (commitData.lastCommit - commitData.firstCommit) / (1000 * 60 * 60 * 24)
      )
    );
    const linesPerDay =
      (commitData.totalAdditions + commitData.totalDeletions) / daysActive;
    const commitsPerDay = commitData.totalCommits / daysActive;

    return {
      linesPerDay: parseFloat(linesPerDay.toFixed(2)),
      commitsPerDay: parseFloat(commitsPerDay.toFixed(2)),
      averageLinesPerCommit: commitData.averageCommitSize,
      velocityRating: this.getVelocityRating(linesPerDay, commitsPerDay),
      consistencyScore: this.calculateConsistencyScore(commitData.commitsByDay),
    };
  }

  getVelocityRating(linesPerDay, commitsPerDay) {
    if (linesPerDay > 500 && commitsPerDay > 2) return "Very high velocity";
    if (linesPerDay > 200 && commitsPerDay > 1) return "High velocity";
    if (linesPerDay > 100 || commitsPerDay > 0.5) return "Moderate velocity";
    return "Low velocity";
  }

  calculateUserChurn(commitData) {
    const churnRate =
      commitData.totalAdditions > 0
        ? commitData.totalDeletions / commitData.totalAdditions
        : 0;

    return {
      additions: commitData.totalAdditions,
      deletions: commitData.totalDeletions,
      churnRate: parseFloat(churnRate.toFixed(2)),
      netContribution: commitData.totalAdditions - commitData.totalDeletions,
      stability: this.getStabilityRating(churnRate),
      efficiency: this.getChurnEfficiency(churnRate),
    };
  }

  getStabilityRating(churnRate) {
    if (churnRate < 0.2) return "Very stable code";
    if (churnRate < 0.4) return "Stable code";
    if (churnRate < 0.6) return "Moderate churn";
    return "High churn";
  }

  getChurnEfficiency(churnRate) {
    if (churnRate < 0.3) return "Highly efficient";
    if (churnRate < 0.5) return "Efficient";
    if (churnRate < 0.7) return "Moderately efficient";
    return "Inefficient";
  }

  calculateUserQualityIndicators(commitData, prData) {
    const indicators = {};

    if (commitData) {
      indicators.commitQuality = {
        conventionalCommitRate: parseFloat(
          commitData.conventionalCommits.percentage
        ),
        averageCommitSize: commitData.averageCommitSize,
        qualityRating: this.assessUserCodeQuality(commitData).rating,
      };
    }

    if (Object.keys(prData).length) {
      indicators.prQuality = {
        mergeRate: parseFloat(prData.mergeRate),
        averageReviewsPerPR: parseFloat(prData.averageReviewsPerPR),
        averagePRSize: prData.averagePRSize,
      };
    }

    indicators.overallQuality = this.calculateOverallQualityScore(
      commitData,
      prData
    );

    return indicators;
  }

  calculateOverallQualityScore(commitData, prData) {
    let score = 0;
    let maxScore = 0;

    if (commitData) {
      const conventionalRate = parseFloat(
        commitData.conventionalCommits.percentage
      );
      score += (conventionalRate / 100) * 30;

      const sizeScore =
        commitData.averageCommitSize < 300
          ? 20
          : commitData.averageCommitSize < 500
          ? 15
          : 10;
      score += sizeScore;

      maxScore += 50;
    }

    if (Object.keys(prData).length) {
      const mergeScore = (parseFloat(prData.mergeRate) / 100) * 30;
      score += mergeScore;

      const reviewScore = parseFloat(prData.averageReviewsPerPR) > 2 ? 20 : 15;
      score += reviewScore;

      maxScore += 50;
    }

    const percentage = maxScore > 0 ? (score / maxScore) * 100 : 0;

    return {
      score: parseFloat(score.toFixed(2)),
      percentage: parseFloat(percentage.toFixed(2)),
      rating:
        percentage >= 85
          ? "Excellent"
          : percentage >= 70
          ? "Good"
          : percentage >= 55
          ? "Fair"
          : "Needs improvement",
    };
  }

  assessUserEfficiency(commitData, prData) {
    let efficiencyFactors = [];
    let score = 0;
    let maxScore = 0;

    if (commitData) {
      const commitEfficiency = commitData.averageCommitSize < 500 ? 1 : 0.5;
      score += commitEfficiency * 30;
      maxScore += 30;
      efficiencyFactors.push(
        `Commit size efficiency: ${
          commitEfficiency === 1 ? "Good" : "Could improve"
        }`
      );
    }

    if (Object.keys(prData).length) {
      const mergeEfficiency =
        parseFloat(prData.mergeRate) > 80
          ? 1
          : parseFloat(prData.mergeRate) / 100;
      score += mergeEfficiency * 40;
      maxScore += 40;
      efficiencyFactors.push(
        `PR merge efficiency: ${
          mergeEfficiency > 0.8 ? "Good" : "Could improve"
        }`
      );

      const timeEfficiency =
        parseFloat(prData.averageTimeToMerge) < 5 ? 1 : 0.5;
      score += timeEfficiency * 30;
      maxScore += 30;
      efficiencyFactors.push(
        `Time to merge efficiency: ${
          timeEfficiency === 1 ? "Good" : "Could improve"
        }`
      );
    }

    const percentage = maxScore > 0 ? (score / maxScore) * 100 : 0;

    return {
      score: parseFloat(score.toFixed(2)),
      percentage: parseFloat(percentage.toFixed(2)),
      rating:
        percentage >= 85
          ? "Highly efficient"
          : percentage >= 70
          ? "Efficient"
          : percentage >= 55
          ? "Moderately efficient"
          : "Inefficient",
      factors: efficiencyFactors,
    };
  }

  assessUserCodeStability(commitData) {
    const churnRate =
      commitData.totalAdditions > 0
        ? commitData.totalDeletions / commitData.totalAdditions
        : 0;

    const stabilityScore = Math.max(0, 100 - churnRate * 100);

    return {
      churnRate: parseFloat(churnRate.toFixed(2)),
      stabilityScore: parseFloat(stabilityScore.toFixed(2)),
      rating:
        stabilityScore >= 80
          ? "Very stable"
          : stabilityScore >= 60
          ? "Stable"
          : stabilityScore >= 40
          ? "Moderately stable"
          : "Unstable",
      netContribution: commitData.totalAdditions - commitData.totalDeletions,
    };
  }

  identifyUserImprovementOpportunities(commitData, prData, reviewData) {
    const opportunities = [];

    if (commitData) {
      if (parseFloat(commitData.conventionalCommits.percentage) < 70) {
        opportunities.push({
          area: "Commit Quality",
          opportunity:
            "Adopt conventional commit messages for better project tracking",
          impact: "Medium",
          effort: "Low",
        });
      }

      if (commitData.averageCommitSize > 500) {
        opportunities.push({
          area: "Code Organization",
          opportunity: "Break large commits into smaller, focused changes",
          impact: "High",
          effort: "Medium",
        });
      }

      if (parseFloat(commitData.workPatterns.weekendPercentage) > 25) {
        opportunities.push({
          area: "Work-Life Balance",
          opportunity: "Establish better work-life boundaries",
          impact: "High",
          effort: "Medium",
        });
      }
    }

    if (Object.keys(prData).length && parseFloat(prData.mergeRate) < 75) {
      opportunities.push({
        area: "PR Quality",
        opportunity: "Improve PR quality through self-review and testing",
        impact: "High",
        effort: "Medium",
      });
    }

    if (!Object.keys(reviewData).length || reviewData.totalReviews < 10) {
      opportunities.push({
        area: "Collaboration",
        opportunity: "Increase participation in code reviews",
        impact: "Medium",
        effort: "Low",
      });
    }

    return opportunities.length > 0
      ? opportunities
      : [
          {
            area: "Maintenance",
            opportunity: "Continue current excellent practices",
            impact: "High",
            effort: "Low",
          },
        ];
  }

  categorizeCommitSizes(commitSizes) {
    if (!commitSizes || commitSizes.length === 0) return "No data";

    const categories = {
      micro: commitSizes.filter((size) => size < 10).length,
      small: commitSizes.filter((size) => size >= 10 && size < 100).length,
      medium: commitSizes.filter((size) => size >= 100 && size < 500).length,
      large: commitSizes.filter((size) => size >= 500 && size < 1000).length,
      massive: commitSizes.filter((size) => size >= 1000).length,
    };

    return categories;
  }

  async generateReport() {
    console.log("\n📊 Analyzing data and generating insights...");

    const commitAnalysis = await this.analyzeCommitActivity();
    const prAnalysis = await this.analyzePullRequests();
    const reviewAnalysis = await this.analyzeReviews();

    const dateRange = `${config.startDate.toISOString().split("T")[0]} to ${
      config.endDate.toISOString().split("T")[0]
    }`;

    // Calculate global statistics
    const allCommitSizes = Object.values(commitAnalysis).flatMap(
      (user) => user.commitSizes
    );
    const allMergeTimes = Object.values(prAnalysis)
      .flatMap((user) => user.mergeTimes)
      .filter((time) => time);
    const allPRSizes = Object.values(prAnalysis).flatMap(
      (user) => user.prSizes
    );

    // NEW: Generate user-specific report if target user is specified
    const userReport = await this.generateUserReport(
      commitAnalysis,
      prAnalysis,
      reviewAnalysis
    );

    // Generate the main framework report (always included as "Generic")
    const genericReport = {
      githubAnalyticsFramework: {
        metadata: {
          version: "1.0",
          description: "Consolidated GitHub repository analytics framework",
          repository: config.repo,
          dateRange: dateRange,
          analysisDate: new Date().toISOString(),
          categories: 6,
          totalMetrics: 45,
          analysisScope: config.targetUser
            ? `Focused on user: ${config.targetUser}`
            : "per-user-email",
          exportFormats: ["JSON", "CSV"],
          apiIntegration: "GitHub REST API v4",
          dataPoints: {
            commits: this.data.commits.length,
            pullRequests: this.data.pullRequests.length,
            reviews: this.data.reviews.length,
            contributors: Object.keys(commitAnalysis).length,
          },
        },

        commitActivityAndCodeContribution: {
          category: "Commit Activity & Code Contribution Patterns",
          description:
            "Tracks developer activity via commits and their characteristics",
          summary: {
            totalCommits: this.data.commits.length,
            totalContributors: Object.keys(commitAnalysis).length,
            averageCommitsPerContributor:
              Object.keys(commitAnalysis).length > 0
                ? Math.round(
                    this.data.commits.length /
                      Object.keys(commitAnalysis).length
                  )
                : 0,
            totalLinesChanged: Object.values(commitAnalysis).reduce(
              (sum, user) => sum + user.totalAdditions + user.totalDeletions,
              0
            ),
          },
          metrics: {
            commitAnalysisByUser: commitAnalysis,
            globalStats: {
              totalAdditions: Object.values(commitAnalysis).reduce(
                (sum, user) => sum + user.totalAdditions,
                0
              ),
              totalDeletions: Object.values(commitAnalysis).reduce(
                (sum, user) => sum + user.totalDeletions,
                0
              ),
              commitSizeStats: this.calculateStatistics(allCommitSizes),
              conventionalCommitAdoption:
                this.calculateGlobalConventionalCommits(commitAnalysis),
            },
            timeAnalysis: {
              mostActiveHour: this.findMostActiveHour(commitAnalysis),
              mostActiveDay: this.findMostActiveDay(commitAnalysis),
              workPatternSummary:
                this.analyzeGlobalWorkPatterns(commitAnalysis),
            },
          },
          insights: {
            topContributors: Object.entries(commitAnalysis)
              .sort(([, a], [, b]) => b.totalCommits - a.totalCommits)
              .slice(0, 5)
              .map(([email, data]) => ({
                email,
                name: data.name,
                login: data.login,
                commits: data.totalCommits,
                linesChanged: data.totalAdditions + data.totalDeletions,
              })),
            productivityPatterns:
              "Peak productivity hours and consistency patterns identified",
            codeContributionTrends:
              "Individual and team velocity patterns analyzed",
            commitQualityIndicators:
              "Message quality and conventional commit adoption assessed",
          },
        },

        pullRequestLifecycleAndReviewEfficiency: {
          category: "Pull Request Lifecycle & Review Efficiency",
          description:
            "Monitors PR flow from creation to merge and review cycles",
          summary: {
            totalPRs: this.data.pullRequests.length,
            mergedPRs: this.data.pullRequests.filter((pr) => pr.merged_at)
              .length,
            openPRs: this.data.pullRequests.filter((pr) => pr.state === "open")
              .length,
            totalReviews: this.data.reviews.length,
            mergeRate:
              this.data.pullRequests.length > 0
                ? (
                    (this.data.pullRequests.filter((pr) => pr.merged_at)
                      .length /
                      this.data.pullRequests.length) *
                    100
                  ).toFixed(2)
                : 0,
          },
          metrics: {
            timeToMergePerUser: prAnalysis,
            reviewEfficiency: reviewAnalysis,
            globalStats: {
              mergeTimeStats: this.calculateStatistics(allMergeTimes),
              prSizeStats: this.calculateStatistics(allPRSizes),
              averageReviewsPerPR:
                this.data.pullRequests.length > 0
                  ? (
                      this.data.reviews.length / this.data.pullRequests.length
                    ).toFixed(2)
                  : 0,
            },
          },
          insights: {
            bottleneckIdentification:
              "Pull request pipeline bottlenecks analyzed",
            reviewerWorkloadBalance:
              "Review responsibility distribution assessed",
            processOptimization:
              "Workflow improvement opportunities identified",
            qualityVsSpeed:
              "Balance between thorough review and delivery velocity",
          },
        },

        developerProductivityAndParticipation: {
          category: "Developer Productivity & Participation",
          description:
            "Highlights throughput, participation, and delivery patterns",
          metrics: {
            productivityByUser: this.calculateProductivityScores(
              commitAnalysis,
              prAnalysis,
              reviewAnalysis
            ),
            participationRates: this.calculateParticipationRates(
              commitAnalysis,
              prAnalysis,
              reviewAnalysis
            ),
            deliveryMetrics: this.analyzeDeliveryPatterns(prAnalysis),
          },
          insights: {
            individualGrowthTracking:
              "Developer progress and skill development monitored",
            teamCapacityPlanning: "Team throughput capabilities understood",
            workloadDistribution: "Balanced work distribution ensured",
            engagementMonitoring: "Team member engagement levels tracked",
          },
        },

        collaborationAndEngagementMetrics: {
          category: "Collaboration & Engagement Metrics",
          description: "Analyzes interpersonal and team-level review dynamics",
          metrics: {
            reviewerNetworks: this.analyzeReviewerNetworks(),
            collaborationHealth: this.assessCollaborationHealth(
              commitAnalysis,
              prAnalysis,
              reviewAnalysis
            ),
            knowledgeSharing: this.analyzeKnowledgeSharing(reviewAnalysis),
          },
          insights: {
            knowledgeSiloIdentification:
              "Areas of concentrated knowledge identified",
            collaborationHealth:
              "Overall team collaboration effectiveness measured",
            mentorshipOpportunities:
              "Potential mentoring relationships discovered",
            processAdherence: "Team adherence to established processes",
          },
        },

        anomalyDetectionAndPerformanceOutliers: {
          category: "Anomaly Detection & Performance Outliers",
          description:
            "Identifies extreme cases, outliers, and unusual patterns",
          metrics: {
            outliers: this.detectOutliers(commitAnalysis, prAnalysis),
            anomalies: this.detectAnomalies(commitAnalysis, prAnalysis),
            riskFactors: this.assessRiskFactors(commitAnalysis, prAnalysis),
          },
          insights: {
            outlierDetection:
              "Users and patterns requiring attention identified",
            riskIdentification: "Potential burnout or disengagement indicators",
            capacityAlerts: "Unsustainable work pattern warnings",
            processDeviations: "Deviations from normal processes detected",
          },
        },

        codeVelocityAndChurnAnalysis: {
          category: "Code Velocity & Churn Analysis",
          description: "Captures speed and cost of code changes",
          metrics: {
            velocityAnalysis: this.analyzeCodeVelocity(commitAnalysis),
            churnAnalysis: this.analyzeCodeChurn(commitAnalysis),
            efficiencyMetrics: this.calculateEfficiencyMetrics(
              commitAnalysis,
              prAnalysis
            ),
          },
          insights: {
            efficiencyOptimization:
              "Development efficiency improvement opportunities",
            technicalDebtTracking: "Technical debt accumulation monitoring",
            refactoringPlanning: "Refactoring needs identification",
            developmentForecast:
              "Future development capacity and needs prediction",
          },
        },

        consolidatedUserProfile: this.generateUserProfiles(
          commitAnalysis,
          prAnalysis,
          reviewAnalysis
        ),

        actionableInsights: {
          teamLevel: {
            productivityTrends: this.generateTeamProductivityInsights(
              commitAnalysis,
              prAnalysis
            ),
            collaborationHealth:
              this.generateCollaborationInsights(reviewAnalysis),
            processOptimization: this.generateProcessInsights(prAnalysis),
          },
          individualLevel: this.generateIndividualInsights(
            commitAnalysis,
            prAnalysis,
            reviewAnalysis
          ),
        },

        implementationStrategy: {
          dataCollection: {
            orchestrator: "Unified metrics collection system implemented",
            apiIntegration:
              "GitHub REST API with rate limiting and retry logic",
            dataProcessing: "Statistical analysis and normalization completed",
          },
          insightGeneration: {
            patternRecognition: "Automated insight discovery implemented",
            recommendations: "Actionable improvement suggestions generated",
            alerting: "Anomaly and risk detection system active",
          },
          reportingAndVisualization: {
            dashboards: "Structured data for dashboard visualization",
            reports: "Comprehensive JSON and CSV export capability",
            apis: "Programmatic access to all analytics data",
          },
        },

        useCases: {
          performanceReviews:
            "Objective contribution metrics for fair evaluation",
          teamPlanning: "Capacity analysis and skill gap identification",
          processImprovement:
            "Bottleneck identification and workflow optimization",
          cultureAndHealth: "Work-life balance and team morale monitoring",
          technicalStrategy:
            "Code quality trends and architecture evolution tracking",
        },
      },
    };

    // NEW: Structure the response based on whether user filtering is applied
    if (config.targetUser && userReport) {
      return {
        User: userReport,
        Generic: genericReport,
      };
    } else {
      return genericReport;
    }
  }

  // Helper methods for general analysis (existing methods from previous version...)
  calculateGlobalConventionalCommits(commitAnalysis) {
    const totals = Object.values(commitAnalysis).reduce(
      (acc, user) => {
        acc.total += user.conventionalCommits.total;
        acc.conventional += user.conventionalCommits.conventional;
        return acc;
      },
      { total: 0, conventional: 0 }
    );

    return {
      ...totals,
      percentage:
        totals.total > 0
          ? ((totals.conventional / totals.total) * 100).toFixed(2)
          : 0,
    };
  }

  findMostActiveHour(commitAnalysis) {
    const hourlyTotals = new Array(24).fill(0);
    Object.values(commitAnalysis).forEach((user) => {
      user.commitsByHour.forEach((count, hour) => {
        hourlyTotals[hour] += count;
      });
    });
    const maxHour = hourlyTotals.indexOf(Math.max(...hourlyTotals));
    return `${maxHour}:00-${(maxHour + 1) % 24}:00`;
  }

  findMostActiveDay(commitAnalysis) {
    const days = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    const dailyTotals = new Array(7).fill(0);
    Object.values(commitAnalysis).forEach((user) => {
      user.commitsByWeekday.forEach((count, day) => {
        dailyTotals[day] += count;
      });
    });
    const maxDay = dailyTotals.indexOf(Math.max(...dailyTotals));
    return days[maxDay];
  }

  analyzeGlobalWorkPatterns(commitAnalysis) {
    const users = Object.values(commitAnalysis);
    const avgBusinessHours =
      users.reduce(
        (sum, user) =>
          sum + parseFloat(user.workPatterns.businessHoursPercentage),
        0
      ) / users.length;
    const avgWeekend =
      users.reduce(
        (sum, user) => sum + parseFloat(user.workPatterns.weekendPercentage),
        0
      ) / users.length;

    return {
      averageBusinessHoursPercentage: avgBusinessHours.toFixed(2),
      averageWeekendPercentage: avgWeekend.toFixed(2),
      workLifeBalance:
        avgWeekend > 20
          ? "Concerning"
          : avgWeekend > 10
          ? "Moderate"
          : "Healthy",
    };
  }

  calculateProductivityScores(commitAnalysis, prAnalysis, reviewAnalysis) {
    const scores = {};
    const allUsers = new Set([
      ...Object.keys(commitAnalysis),
      ...Object.keys(prAnalysis),
      ...Object.keys(reviewAnalysis),
    ]);

    for (const user of allUsers) {
      const commits = commitAnalysis[user] || {
        totalCommits: 0,
        totalAdditions: 0,
        totalDeletions: 0,
      };
      const prs = prAnalysis[commits.login] ||
        prAnalysis[user] || { totalPRs: 0, mergedPRs: 0, mergeRate: 0 };
      const reviews = reviewAnalysis[commits.login] ||
        reviewAnalysis[user] || { totalReviews: 0, approvalRate: 0 };

      // Calculate composite productivity score
      const commitScore = commits.totalCommits * 1;
      const prScore = prs.totalPRs * 2;
      const reviewScore = reviews.totalReviews * 1.5;
      const qualityBonus = (parseFloat(prs.mergeRate) / 100) * 10;

      scores[user] = {
        commitScore,
        prScore,
        reviewScore,
        qualityBonus: parseFloat(qualityBonus.toFixed(2)),
        codeVolume: commits.totalAdditions + commits.totalDeletions,
        compositeScore: parseFloat(
          (commitScore + prScore + reviewScore + qualityBonus).toFixed(2)
        ),
        efficiency:
          prs.totalPRs > 0
            ? parseFloat(
                (
                  (commits.totalCommits / prs.totalPRs) *
                  (parseFloat(prs.mergeRate) / 100)
                ).toFixed(2)
              )
            : 0,
      };
    }

    return scores;
  }

  calculateParticipationRates(commitAnalysis, prAnalysis, reviewAnalysis) {
    const totalCommits = Object.values(commitAnalysis).reduce(
      (sum, user) => sum + user.totalCommits,
      0
    );
    const totalPRs = Object.values(prAnalysis).reduce(
      (sum, user) => sum + user.totalPRs,
      0
    );
    const totalReviews = Object.values(reviewAnalysis).reduce(
      (sum, user) => sum + user.totalReviews,
      0
    );

    const participation = {};
    const allUsers = new Set([
      ...Object.keys(commitAnalysis),
      ...Object.keys(prAnalysis),
      ...Object.keys(reviewAnalysis),
    ]);

    for (const user of allUsers) {
      const commits = commitAnalysis[user]?.totalCommits || 0;
      const prs = prAnalysis[commitAnalysis[user]?.login] || prAnalysis[user];
      const reviews =
        reviewAnalysis[commitAnalysis[user]?.login] || reviewAnalysis[user];

      participation[user] = {
        commitParticipation:
          totalCommits > 0
            ? parseFloat(((commits / totalCommits) * 100).toFixed(2))
            : 0,
        prParticipation:
          totalPRs > 0
            ? parseFloat((((prs?.totalPRs || 0) / totalPRs) * 100).toFixed(2))
            : 0,
        reviewParticipation:
          totalReviews > 0
            ? parseFloat(
                (((reviews?.totalReviews || 0) / totalReviews) * 100).toFixed(2)
              )
            : 0,
        overallEngagement: parseFloat(
          (
            ((commits +
              (prs?.totalPRs || 0) * 2 +
              (reviews?.totalReviews || 0)) /
              (totalCommits + totalPRs * 2 + totalReviews)) *
            100
          ).toFixed(2)
        ),
      };
    }

    return participation;
  }

  analyzeDeliveryPatterns(prAnalysis) {
    const patterns = {};

    Object.entries(prAnalysis).forEach(([user, data]) => {
      patterns[user] = {
        deliveryConsistency: this.calculateDeliveryConsistency(data),
        throughputTrend: data.totalPRs > 0 ? "Active" : "Inactive",
        qualityIndicator:
          parseFloat(data.mergeRate) > 80
            ? "High"
            : parseFloat(data.mergeRate) > 60
            ? "Medium"
            : "Low",
      };
    });

    return patterns;
  }

  calculateDeliveryConsistency(prData) {
    if (prData.totalPRs < 2) return "Insufficient data";

    const mergeRate = parseFloat(prData.mergeRate);
    const avgSize = prData.averagePRSize;

    if (mergeRate > 80 && avgSize < 500) return "Highly consistent";
    if (mergeRate > 60 && avgSize < 1000) return "Moderately consistent";
    return "Needs improvement";
  }

  analyzeReviewerNetworks() {
    const networks = {};
    const collaborationMatrix = {};

    for (const review of this.data.reviews) {
      const reviewer = review.user?.login || "unknown";
      const author = review.pr_author || "unknown";

      if (!networks[reviewer]) {
        networks[reviewer] = {
          reviewsGiven: 0,
          authorsReviewed: new Set(),
          approvalRate: 0,
          responsiveness: "Unknown",
        };
      }

      networks[reviewer].reviewsGiven++;
      networks[reviewer].authorsReviewed.add(author);

      // Build collaboration matrix
      if (!collaborationMatrix[reviewer]) collaborationMatrix[reviewer] = {};
      collaborationMatrix[reviewer][author] =
        (collaborationMatrix[reviewer][author] || 0) + 1;
    }

    // Convert Sets to arrays and calculate metrics
    Object.values(networks).forEach((network) => {
      network.authorsReviewed = Array.from(network.authorsReviewed);
      network.collaborationBreadth = network.authorsReviewed.length;
    });

    return {
      individualNetworks: networks,
      collaborationMatrix: collaborationMatrix,
      networkAnalysis: this.analyzeNetworkHealth(networks),
    };
  }

  analyzeNetworkHealth(networks) {
    const reviewers = Object.keys(networks);
    const totalReviews = Object.values(networks).reduce(
      (sum, n) => sum + n.reviewsGiven,
      0
    );
    const avgReviewsPerReviewer =
      reviewers.length > 0 ? totalReviews / reviewers.length : 0;

    return {
      totalReviewers: reviewers.length,
      averageReviewsPerReviewer: avgReviewsPerReviewer.toFixed(2),
      collaborationDiversity:
        reviewers.length > 0
          ? (
              Object.values(networks).reduce(
                (sum, n) => sum + n.collaborationBreadth,
                0
              ) / reviewers.length
            ).toFixed(2)
          : 0,
    };
  }

  assessCollaborationHealth(commitAnalysis, prAnalysis, reviewAnalysis) {
    const collaborators = new Set([
      ...Object.keys(commitAnalysis),
      ...Object.keys(prAnalysis),
      ...Object.keys(reviewAnalysis),
    ]);

    const crossTeamCollaboration =
      this.calculateCrossTeamMetrics(reviewAnalysis);

    return {
      totalCollaborators: collaborators.size,
      codeContributors: Object.keys(commitAnalysis).length,
      prContributors: Object.keys(prAnalysis).length,
      reviewParticipants: Object.keys(reviewAnalysis).length,
      collaborationDiversity: collaborators.size > 1 ? "High" : "Low",
      knowledgeSharing:
        crossTeamCollaboration.diversity > 2
          ? "Excellent"
          : crossTeamCollaboration.diversity > 1
          ? "Good"
          : "Limited",
      teamCohesion: this.assessTeamCohesion(
        collaborators.size,
        Object.keys(reviewAnalysis).length
      ),
    };
  }

  calculateCrossTeamMetrics(reviewAnalysis) {
    const reviewerAuthorPairs = new Set();

    Object.entries(reviewAnalysis).forEach(([reviewer, data]) => {
      data.reviewedAuthors.forEach((author) => {
        if (reviewer !== author) {
          reviewerAuthorPairs.add(`${reviewer}-${author}`);
        }
      });
    });

    return {
      uniquePairs: reviewerAuthorPairs.size,
      diversity:
        Object.keys(reviewAnalysis).length > 0
          ? reviewerAuthorPairs.size / Object.keys(reviewAnalysis).length
          : 0,
    };
  }

  assessTeamCohesion(totalCollaborators, activeReviewers) {
    if (totalCollaborators === 0) return "No data";

    const reviewParticipationRate = activeReviewers / totalCollaborators;

    if (reviewParticipationRate > 0.8) return "Excellent";
    if (reviewParticipationRate > 0.6) return "Good";
    if (reviewParticipationRate > 0.4) return "Moderate";
    return "Needs improvement";
  }

  analyzeKnowledgeSharing(reviewAnalysis) {
    const knowledgeMetrics = {
      mentorshipIndicators: [],
      knowledgeConcentration: {},
      sharingPatterns: {},
    };

    Object.entries(reviewAnalysis).forEach(([reviewer, data]) => {
      // Identify potential mentors (high review count with good approval rate)
      if (data.totalReviews > 10 && parseFloat(data.approvalRate) > 70) {
        knowledgeMetrics.mentorshipIndicators.push({
          mentor: reviewer,
          reviews: data.totalReviews,
          approvalRate: data.approvalRate,
          mentees: data.authorDiversity,
        });
      }

      knowledgeMetrics.sharingPatterns[reviewer] = {
        breadth: data.authorDiversity,
        depth: data.totalReviews,
        ratio:
          data.authorDiversity > 0
            ? (data.totalReviews / data.authorDiversity).toFixed(2)
            : 0,
      };
    });

    return knowledgeMetrics;
  }

  detectOutliers(commitAnalysis, prAnalysis) {
    const commitCounts = Object.values(commitAnalysis).map(
      (user) => user.totalCommits
    );
    const prCounts = Object.values(prAnalysis).map((user) => user.totalPRs);
    const codeVolumes = Object.values(commitAnalysis).map(
      (user) => user.totalAdditions + user.totalDeletions
    );

    const commitStats = this.calculateStatistics(commitCounts);
    const prStats = this.calculateStatistics(prCounts);
    const volumeStats = this.calculateStatistics(codeVolumes);

    const outliers = {
      highCommitVolume: [],
      highPRVolume: [],
      highCodeVolume: [],
      lowActivity: [],
      unusualPatterns: [],
    };

    Object.entries(commitAnalysis).forEach(([user, data]) => {
      if (data.totalCommits > commitStats.p90) {
        outliers.highCommitVolume.push({
          user: data.name || data.login,
          commits: data.totalCommits,
          email: user,
        });
      }

      const codeVolume = data.totalAdditions + data.totalDeletions;
      if (codeVolume > volumeStats.p90) {
        outliers.highCodeVolume.push({
          user: data.name || data.login,
          volume: codeVolume,
          email: user,
        });
      }

      // Detect unusual work patterns
      const weekendWork = parseFloat(data.workPatterns.weekendPercentage);
      if (weekendWork > 30) {
        outliers.unusualPatterns.push({
          user: data.name || data.login,
          pattern: "High weekend activity",
          percentage: weekendWork,
          email: user,
        });
      }
    });

    Object.entries(prAnalysis).forEach(([user, data]) => {
      if (data.totalPRs > prStats.p90) {
        outliers.highPRVolume.push({
          user,
          prs: data.totalPRs,
        });
      }
    });

    return outliers;
  }

  detectAnomalies(commitAnalysis, prAnalysis) {
    const anomalies = {
      workPatternAnomalies: [],
      velocityAnomalies: [],
      qualityAnomalies: [],
      timeAnomalies: [],
    };

    Object.entries(commitAnalysis).forEach(([user, data]) => {
      // Work pattern anomalies
      const businessHours = parseFloat(
        data.workPatterns.businessHoursPercentage
      );
      const weekendWork = parseFloat(data.workPatterns.weekendPercentage);

      if (businessHours < 40) {
        anomalies.workPatternAnomalies.push({
          user: data.name || data.login,
          issue: "Low business hours activity",
          value: businessHours,
          email: user,
        });
      }

      if (weekendWork > 25) {
        anomalies.workPatternAnomalies.push({
          user: data.name || data.login,
          issue: "High weekend activity",
          value: weekendWork,
          email: user,
        });
      }

      // Velocity anomalies
      if (data.totalCommits > 0) {
        const avgCommitSize = data.averageCommitSize;
        if (avgCommitSize > 1000) {
          anomalies.velocityAnomalies.push({
            user: data.name || data.login,
            issue: "Very large commits",
            value: avgCommitSize,
            email: user,
          });
        }
      }

      // Quality anomalies
      const conventionalRate = parseFloat(data.conventionalCommits.percentage);
      if (conventionalRate < 20 && data.totalCommits > 5) {
        anomalies.qualityAnomalies.push({
          user: data.name || data.login,
          issue: "Low conventional commit usage",
          value: conventionalRate,
          email: user,
        });
      }
    });

    return anomalies;
  }

  assessRiskFactors(commitAnalysis, prAnalysis) {
    const risks = {
      burnoutIndicators: [],
      disengagementSigns: [],
      processDeviations: [],
    };

    Object.entries(commitAnalysis).forEach(([user, data]) => {
      // Burnout indicators
      const weekendWork = parseFloat(data.workPatterns.weekendPercentage);
      const businessHours = parseFloat(
        data.workPatterns.businessHoursPercentage
      );

      if (weekendWork > 30 || businessHours < 30) {
        risks.burnoutIndicators.push({
          user: data.name || data.login,
          factors: [
            weekendWork > 30 ? `High weekend work (${weekendWork}%)` : null,
            businessHours < 30
              ? `Low business hours (${businessHours}%)`
              : null,
          ].filter(Boolean),
          email: user,
        });
      }

      // Disengagement signs
      if (data.totalCommits < 5 && Object.keys(commitAnalysis).length > 1) {
        const userPRs = prAnalysis[data.login] || prAnalysis[user];
        if (!userPRs || userPRs.totalPRs < 2) {
          risks.disengagementSigns.push({
            user: data.name || data.login,
            reason: "Low activity across commits and PRs",
            email: user,
          });
        }
      }
    });

    return risks;
  }

  analyzeCodeVelocity(commitAnalysis) {
    const velocityData = {};

    Object.entries(commitAnalysis).forEach(([user, data]) => {
      const avgLinesPerCommit =
        data.totalCommits > 0
          ? (data.totalAdditions + data.totalDeletions) / data.totalCommits
          : 0;

      const daysActive = Math.max(
        1,
        Math.floor((data.lastCommit - data.firstCommit) / (1000 * 60 * 60 * 24))
      );
      const linesPerDay =
        (data.totalAdditions + data.totalDeletions) / daysActive;

      velocityData[user] = {
        totalLines: data.totalAdditions + data.totalDeletions,
        averageLinesPerCommit: parseFloat(avgLinesPerCommit.toFixed(2)),
        linesPerDay: parseFloat(linesPerDay.toFixed(2)),
        commitsPerDay: parseFloat((data.totalCommits / daysActive).toFixed(2)),
        velocity: parseFloat(avgLinesPerCommit.toFixed(2)),
        consistency: this.calculateVelocityConsistency(data.commitSizes),
      };
    });

    return velocityData;
  }

  calculateVelocityConsistency(commitSizes) {
    if (commitSizes.length < 2) return "Insufficient data";

    const stats = this.calculateStatistics(commitSizes);
    const coefficient = stats.mean > 0 ? stats.std / stats.mean : 0;

    if (coefficient < 0.5) return "Very consistent";
    if (coefficient < 1.0) return "Moderately consistent";
    if (coefficient < 1.5) return "Variable";
    return "Highly variable";
  }

  analyzeCodeChurn(commitAnalysis) {
    const churnData = {};

    Object.entries(commitAnalysis).forEach(([user, data]) => {
      const churnRate =
        data.totalAdditions > 0 ? data.totalDeletions / data.totalAdditions : 0;

      churnData[user] = {
        additions: data.totalAdditions,
        deletions: data.totalDeletions,
        churnRate: parseFloat(churnRate.toFixed(2)),
        netContribution: data.totalAdditions - data.totalDeletions,
        efficiency: this.calculateChurnEfficiency(churnRate),
        stabilityScore: this.calculateStabilityScore(
          data.totalAdditions,
          data.totalDeletions,
          data.totalCommits
        ),
      };
    });

    return churnData;
  }

  calculateChurnEfficiency(churnRate) {
    if (churnRate < 0.2) return "Excellent";
    if (churnRate < 0.4) return "Good";
    if (churnRate < 0.6) return "Moderate";
    return "Needs improvement";
  }

  calculateStabilityScore(additions, deletions, commits) {
    if (commits === 0) return 0;

    const avgChange = (additions + deletions) / commits;
    const netRatio = additions > 0 ? (additions - deletions) / additions : 0;

    return parseFloat(
      (netRatio * (1 - Math.min(avgChange / 1000, 1))).toFixed(2)
    );
  }

  calculateEfficiencyMetrics(commitAnalysis, prAnalysis) {
    const efficiency = {};

    Object.keys(commitAnalysis).forEach((user) => {
      const commits = commitAnalysis[user];
      const prs = prAnalysis[commits.login] ||
        prAnalysis[user] || { totalPRs: 0, mergeRate: 0 };

      efficiency[user] = {
        commitToPRRatio:
          prs.totalPRs > 0
            ? (commits.totalCommits / prs.totalPRs).toFixed(2)
            : 0,
        successRate: parseFloat(prs.mergeRate) || 0,
        codeReviewEfficiency: this.calculateCodeReviewEfficiency(commits, prs),
        overallEfficiency: this.calculateOverallEfficiency(commits, prs),
      };
    });

    return efficiency;
  }

  calculateCodeReviewEfficiency(commits, prs) {
    const codeVolume = commits.totalAdditions + commits.totalDeletions;
    const mergeRate = parseFloat(prs.mergeRate) || 0;

    if (codeVolume === 0) return 0;
    return parseFloat(
      ((mergeRate / 100) * Math.min(codeVolume / 10000, 1)).toFixed(2)
    );
  }

  calculateOverallEfficiency(commits, prs) {
    const factors = [
      commits.totalCommits > 0 ? 1 : 0,
      prs.totalPRs > 0 ? 1 : 0,
      parseFloat(prs.mergeRate) > 70 ? 1 : 0,
      commits.averageCommitSize < 500 ? 1 : 0,
    ];

    return parseFloat(
      (factors.reduce((a, b) => a + b, 0) / factors.length).toFixed(2)
    );
  }

  generateUserProfiles(commitAnalysis, prAnalysis, reviewAnalysis) {
    const profiles = {};

    const allUsers = new Set([
      ...Object.keys(commitAnalysis),
      ...Object.keys(prAnalysis),
      ...Object.keys(reviewAnalysis),
    ]);

    allUsers.forEach((user) => {
      const commits = commitAnalysis[user];
      const prs = prAnalysis[commits?.login] || prAnalysis[user];
      const reviews = reviewAnalysis[commits?.login] || reviewAnalysis[user];

      profiles[user] = {
        identity: {
          email: user,
          username: commits?.login || "unknown",
          name: commits?.name || "unknown",
          authorId: user,
        },
        contributionMetrics: {
          commits: {
            total: commits?.totalCommits || 0,
            frequency: commits
              ? this.calculateCommitFrequency(commits)
              : "No data",
            sizeDistribution: commits
              ? this.categorizeCommitSizes(commits.commitSizes)
              : "No data",
          },
          codeChanges: {
            additions: commits?.totalAdditions || 0,
            deletions: commits?.totalDeletions || 0,
            netChanges: commits
              ? commits.totalAdditions - commits.totalDeletions
              : 0,
            churnRate:
              commits && commits.totalAdditions > 0
                ? (commits.totalDeletions / commits.totalAdditions).toFixed(2)
                : 0,
          },
          pullRequests: {
            created: prs?.totalPRs || 0,
            merged: prs?.mergedPRs || 0,
            mergeRate: prs?.mergeRate || 0,
            averageTimeToMerge: prs?.averageTimeToMerge || 0,
          },
          reviews: {
            totalReviews: reviews?.totalReviews || 0,
            approvals: reviews?.approvals || 0,
            acceptanceRate: reviews?.approvalRate || 0,
          },
        },
        workPatterns: commits
          ? {
              timeDistribution: commits.workPatterns,
              peakActivity: `${commits.workPatterns.peakHour}:00 on ${commits.workPatterns.peakDay}`,
              consistency: this.assessWorkConsistency(commits),
            }
          : "No data",
        qualityIndicators: commits
          ? {
              conventionalCommits: commits.conventionalCommits,
              commitQuality: this.assessCommitQuality(commits),
              codeStability: this.assessCodeStability(commits),
            }
          : "No data",
        collaboration: {
          reviewParticipation: reviews?.totalReviews || 0,
          crossTeamInteraction: reviews?.authorDiversity || 0,
          mentorshipScore: this.calculateMentorshipScore(reviews),
        },
      };
    });

    return profiles;
  }

  calculateCommitFrequency(commits) {
    const daysActive = Math.max(
      1,
      Math.floor(
        (commits.lastCommit - commits.firstCommit) / (1000 * 60 * 60 * 24)
      )
    );
    const frequency = commits.totalCommits / daysActive;

    if (frequency > 2) return "Very high";
    if (frequency > 1) return "High";
    if (frequency > 0.5) return "Moderate";
    if (frequency > 0.2) return "Low";
    return "Very low";
  }

  assessWorkConsistency(commits) {
    const workdays = commits.commitsByWeekday
      .slice(1, 6)
      .reduce((a, b) => a + b, 0);
    const total = commits.commitsByWeekday.reduce((a, b) => a + b, 0);
    const workdayRatio = total > 0 ? workdays / total : 0;

    if (workdayRatio > 0.8) return "Very consistent";
    if (workdayRatio > 0.6) return "Moderately consistent";
    return "Variable";
  }

  assessCommitQuality(commits) {
    const conventionalRate = parseFloat(commits.conventionalCommits.percentage);
    const avgSize = commits.averageCommitSize;

    let score = 0;
    if (conventionalRate > 80) score += 3;
    else if (conventionalRate > 60) score += 2;
    else if (conventionalRate > 40) score += 1;

    if (avgSize < 200) score += 2;
    else if (avgSize < 500) score += 1;

    if (score >= 4) return "Excellent";
    if (score >= 3) return "Good";
    if (score >= 2) return "Moderate";
    return "Needs improvement";
  }

  assessCodeStability(commits) {
    const churnRate =
      commits.totalAdditions > 0
        ? commits.totalDeletions / commits.totalAdditions
        : 0;

    if (churnRate < 0.2) return "Very stable";
    if (churnRate < 0.4) return "Stable";
    if (churnRate < 0.6) return "Moderately stable";
    return "Unstable";
  }

  calculateMentorshipScore(reviews) {
    if (!reviews) return 0;

    const diversityScore = Math.min(reviews.authorDiversity / 5, 1) * 3;
    const volumeScore = Math.min(reviews.totalReviews / 20, 1) * 2;
    const qualityScore = parseFloat(reviews.approvalRate) / 100;

    return parseFloat((diversityScore + volumeScore + qualityScore).toFixed(2));
  }

  generateTeamProductivityInsights(commitAnalysis, prAnalysis) {
    const teamSize = Object.keys(commitAnalysis).length;
    const totalCommits = Object.values(commitAnalysis).reduce(
      (sum, user) => sum + user.totalCommits,
      0
    );
    const totalPRs = Object.values(prAnalysis).reduce(
      (sum, user) => sum + user.totalPRs,
      0
    );

    return {
      teamSize,
      averageCommitsPerDeveloper:
        teamSize > 0 ? (totalCommits / teamSize).toFixed(2) : 0,
      averagePRsPerDeveloper:
        teamSize > 0 ? (totalPRs / teamSize).toFixed(2) : 0,
      topPerformers: Object.entries(commitAnalysis)
        .sort(
          ([, a], [, b]) =>
            b.totalCommits +
            b.totalAdditions / 100 -
            (a.totalCommits + a.totalAdditions / 100)
        )
        .slice(0, 3)
        .map(([email, data]) => ({
          email,
          name: data.name,
          score: data.totalCommits + Math.floor(data.totalAdditions / 100),
        })),
      productivityTrend:
        totalCommits > teamSize * 10
          ? "High"
          : totalCommits > teamSize * 5
          ? "Moderate"
          : "Low",
    };
  }

  generateCollaborationInsights(reviewAnalysis) {
    const reviewers = Object.keys(reviewAnalysis);
    const totalReviews = Object.values(reviewAnalysis).reduce(
      (sum, user) => sum + user.totalReviews,
      0
    );

    return {
      activeReviewers: reviewers.length,
      averageReviewsPerReviewer:
        reviewers.length > 0 ? (totalReviews / reviewers.length).toFixed(2) : 0,
      collaborationHealth:
        reviewers.length > 2
          ? "Good"
          : reviewers.length > 1
          ? "Moderate"
          : "Limited",
      knowledgeDistribution: this.assessKnowledgeDistribution(reviewAnalysis),
    };
  }

  assessKnowledgeDistribution(reviewAnalysis) {
    const reviewCounts = Object.values(reviewAnalysis).map(
      (user) => user.totalReviews
    );
    const stats = this.calculateStatistics(reviewCounts);

    if (stats.std < stats.mean * 0.5) return "Well distributed";
    if (stats.std < stats.mean) return "Moderately distributed";
    return "Concentrated";
  }

  generateProcessInsights(prAnalysis) {
    const allMergeTimes = Object.values(prAnalysis)
      .flatMap((user) => user.mergeTimes)
      .filter((time) => time);
    const allMergeRates = Object.values(prAnalysis)
      .map((user) => parseFloat(user.mergeRate))
      .filter((rate) => rate > 0);

    const avgMergeTime =
      allMergeTimes.length > 0
        ? (
            allMergeTimes.reduce((a, b) => a + b, 0) / allMergeTimes.length
          ).toFixed(2)
        : 0;
    const avgMergeRate =
      allMergeRates.length > 0
        ? (
            allMergeRates.reduce((a, b) => a + b, 0) / allMergeRates.length
          ).toFixed(2)
        : 0;

    return {
      averageMergeTime: `${avgMergeTime} days`,
      averageMergeRate: `${avgMergeRate}%`,
      processEfficiency:
        avgMergeTime < 3 && avgMergeRate > 80
          ? "Excellent"
          : avgMergeTime < 7 && avgMergeRate > 70
          ? "Good"
          : "Needs improvement",
      recommendations: this.generateProcessRecommendations(
        avgMergeTime,
        avgMergeRate
      ),
    };
  }

  generateProcessRecommendations(avgMergeTime, avgMergeRate) {
    const recommendations = [];

    if (avgMergeTime > 7) {
      recommendations.push(
        "Consider implementing automated testing to reduce review time"
      );
    }
    if (avgMergeRate < 70) {
      recommendations.push("Review PR quality guidelines and provide training");
    }
    if (avgMergeTime > 14) {
      recommendations.push("Implement PR size limits to improve review speed");
    }

    return recommendations.length > 0
      ? recommendations
      : ["Current process is performing well"];
  }

  generateIndividualInsights(commitAnalysis, prAnalysis, reviewAnalysis) {
    const insights = {};

    Object.keys(commitAnalysis).forEach((user) => {
      const commits = commitAnalysis[user];
      const prs = prAnalysis[commits.login] || prAnalysis[user];
      const reviews = reviewAnalysis[commits.login] || reviewAnalysis[user];

      insights[user] = {
        strengths: this.identifyStrengths(commits, prs, reviews),
        growthAreas: this.identifyGrowthAreas(commits, prs, reviews),
        recommendations: this.generatePersonalRecommendations(
          commits,
          prs,
          reviews
        ),
      };
    });

    return insights;
  }

  identifyStrengths(commits, prs, reviews) {
    const strengths = [];

    if (commits.totalCommits > 50) strengths.push("High commit volume");
    if (commits.averageCommitSize < 300) strengths.push("Well-sized commits");
    if (parseFloat(commits.conventionalCommits.percentage) > 70)
      strengths.push("Good commit message quality");
    if (prs && parseFloat(prs.mergeRate) > 80)
      strengths.push("High PR success rate");
    if (reviews && reviews.totalReviews > 20)
      strengths.push("Active code reviewer");
    if (parseFloat(commits.workPatterns.businessHoursPercentage) > 80)
      strengths.push("Good work-life balance");

    return strengths.length > 0 ? strengths : ["Consistent contributor"];
  }

  identifyGrowthAreas(commits, prs, reviews) {
    const areas = [];

    if (parseFloat(commits.conventionalCommits.percentage) < 50)
      areas.push("Improve commit message consistency");
    if (commits.averageCommitSize > 500)
      areas.push("Consider smaller, more focused commits");
    if (prs && parseFloat(prs.mergeRate) < 70)
      areas.push("Improve PR quality before submission");
    if (!reviews || reviews.totalReviews < 5)
      areas.push("Increase participation in code reviews");
    if (parseFloat(commits.workPatterns.weekendPercentage) > 25)
      areas.push("Consider better work-life balance");

    return areas.length > 0 ? areas : ["Continue current practices"];
  }

  generatePersonalRecommendations(commits, prs, reviews) {
    const recommendations = [];

    if (parseFloat(commits.conventionalCommits.percentage) < 50) {
      recommendations.push(
        "Use conventional commit format (feat:, fix:, etc.)"
      );
    }
    if (commits.averageCommitSize > 500) {
      recommendations.push("Break large changes into smaller, logical commits");
    }
    if (!reviews || reviews.totalReviews < 10) {
      recommendations.push(
        "Participate more in code reviews to share knowledge"
      );
    }
    if (prs && parseFloat(prs.mergeRate) < 70) {
      recommendations.push("Self-review PRs before submission and add tests");
    }

    return recommendations.length > 0
      ? recommendations
      : ["Keep up the excellent work!"];
  }
}

// CSV export functionality
function generateCSV(report) {
  const csvData = [];

  // Check if this is a user-focused report or generic report
  const isUserFocused = report.User && report.Generic;
  const targetReport = isUserFocused
    ? report.Generic.githubAnalyticsFramework
    : report.githubAnalyticsFramework;

  // Header
  csvData.push([
    "User Email",
    "User Name",
    "Total Commits",
    "Total Additions",
    "Total Deletions",
    "Total PRs",
    "Merged PRs",
    "Merge Rate %",
    "Total Reviews",
    "Approval Rate %",
    "Productivity Score",
    "Business Hours %",
    "Weekend Work %",
    "Conventional Commits %",
  ]);

  // Get data from different sections
  const commitData =
    targetReport.commitActivityAndCodeContribution.metrics.commitAnalysisByUser;
  const prData =
    targetReport.pullRequestLifecycleAndReviewEfficiency.metrics
      .timeToMergePerUser;
  const reviewData =
    targetReport.pullRequestLifecycleAndReviewEfficiency.metrics
      .reviewEfficiency;
  const productivityData =
    targetReport.developerProductivityAndParticipation.metrics
      .productivityByUser;

  // Get all users
  const allUsers = new Set([
    ...Object.keys(commitData),
    ...Object.keys(prData),
    ...Object.keys(reviewData),
    ...Object.keys(productivityData),
  ]);

  for (const userEmail of allUsers) {
    const commits = commitData[userEmail] || {};
    const prs = prData[commits.login] || prData[userEmail] || {};
    const reviews = reviewData[commits.login] || reviewData[userEmail] || {};
    const productivity = productivityData[userEmail] || {};

    csvData.push([
      userEmail,
      commits.name || commits.login || "Unknown",
      commits.totalCommits || 0,
      commits.totalAdditions || 0,
      commits.totalDeletions || 0,
      prs.totalPRs || 0,
      prs.mergedPRs || 0,
      prs.mergeRate || 0,
      reviews.totalReviews || 0,
      reviews.approvalRate || 0,
      productivity.compositeScore || 0,
      commits.workPatterns?.businessHoursPercentage || 0,
      commits.workPatterns?.weekendPercentage || 0,
      commits.conventionalCommits?.percentage || 0,
    ]);
  }

  return csvData.map((row) => row.join(",")).join("\n");
}

// Main execution
async function main() {
  try {
    console.log(`🚀 GitHub Analytics Platform v1.0`);
    console.log(`📊 Analyzing repository: ${config.repo}`);
    console.log(
      `📅 Date range: ${config.startDate.toISOString().split("T")[0]} to ${
        config.endDate.toISOString().split("T")[0]
      }`
    );
    console.log(
      `🔢 Fetch limit: ${
        config.fetchLimit === Infinity ? "unlimited" : config.fetchLimit
      }`
    );
    console.log(`📊 Output format: ${config.format.toUpperCase()}`);

    // NEW: Show user focus if specified
    if (config.targetUser) {
      console.log(`🎯 Focusing on user: ${config.targetUser}`);
    }

    if (!config.token) {
      console.error("\n❌ GitHub token is required");
      console.error("💡 Set GITHUB_TOKEN environment variable or use -t flag");
      console.error("🔗 Get a token at: https://github.com/settings/tokens");
      process.exit(1);
    }

    const client = new GitHubClient(config.token);
    const analyzer = new GitHubAnalyzer(client, config.repo, config.targetUser); // NEW: Pass target user

    // Test API connection
    console.log("\n🔐 Testing GitHub API connection...");
    try {
      await client.makeRequest(`${client.baseUrl}/user`);
      console.log("✅ API connection successful");
    } catch (error) {
      console.error(`❌ API connection failed: ${error.message}`);
      process.exit(1);
    }

    // Fetch data with progress tracking
    console.log("\n📥 Starting data collection...");
    await analyzer.fetchCommits();
    await analyzer.fetchPullRequests();
    await analyzer.fetchReviews();

    // Generate comprehensive report
    const report = await analyzer.generateReport();

    // Generate output filename if not provided
    const timestamp = new Date().toISOString().split("T")[0];
    const repoName = config.repo.replace("/", "-");
    const userSuffix = config.targetUser
      ? `-${config.targetUser.replace("@", "-at-").replace(".", "-")}`
      : "";
    const filename =
      config.output ||
      `github-analytics-${repoName}${userSuffix}-${timestamp}.${config.format}`;

    // Export report
    console.log(`\n💾 Exporting ${config.format.toUpperCase()} report...`);
    if (config.format === "csv") {
      const csvContent = generateCSV(report);
      writeFileSync(filename, csvContent);
    } else {
      writeFileSync(filename, JSON.stringify(report, null, 2));
    }

    // Summary output
    const metadata =
      config.targetUser && report.User
        ? report.Generic.githubAnalyticsFramework.metadata
        : report.githubAnalyticsFramework.metadata;

    console.log(`\n✅ Analysis complete!`);
    console.log(`📄 Report saved to: ${filename}`);
    console.log(`📊 Analysis summary:`);
    console.log(`   🔍 Contributors: ${metadata.dataPoints.contributors}`);
    console.log(`   📝 Commits: ${metadata.dataPoints.commits}`);
    console.log(`   🔀 Pull Requests: ${metadata.dataPoints.pullRequests}`);
    console.log(`   📋 Reviews: ${metadata.dataPoints.reviews}`);
    console.log(`   📅 Date range: ${metadata.dateRange}`);

    // NEW: Show user-specific summary if applicable
    if (config.targetUser && report.User) {
      console.log(`\n🎯 User-specific analysis for ${config.targetUser}:`);
      const userCommits =
        report.User.commitActivityAndCodeContribution.metrics.totalCommits || 0;
      const userPRs =
        report.User.pullRequestLifecycleAndReviewEfficiency.metrics
          .pullRequestMetrics.totalPRs || 0;
      const userReviews =
        report.User.pullRequestLifecycleAndReviewEfficiency.metrics
          .reviewMetrics.totalReviews || 0;
      const productivityScore =
        report.User.developerProductivityAndParticipation.metrics
          .productivityScore.percentage || 0;

      console.log(`   📝 User Commits: ${userCommits}`);
      console.log(`   🔀 User PRs: ${userPRs}`);
      console.log(`   📋 User Reviews: ${userReviews}`);
      console.log(`   📊 Productivity Score: ${productivityScore}%`);

      if (
        report.User.anomalyDetectionAndPerformanceOutliers.insights
          .wellBeingAssessment !== "No data"
      ) {
        const wellBeing =
          report.User.anomalyDetectionAndPerformanceOutliers.insights
            .wellBeingAssessment;
        console.log(`   💚 Well-being Assessment: ${wellBeing}`);
      }
    }

    if (config.verbose) {
      const analysisSource =
        config.targetUser && report.User
          ? report.Generic.githubAnalyticsFramework
          : report.githubAnalyticsFramework;

      const insights =
        analysisSource.commitActivityAndCodeContribution.insights;
      console.log("\n📈 Key Insights:");
      console.log(`🏆 Top contributors:`);
      insights.topContributors.slice(0, 3).forEach((contributor, index) => {
        console.log(
          `   ${index + 1}. ${contributor.name} (${
            contributor.commits
          } commits, ${contributor.linesChanged} lines)`
        );
      });

      const timeAnalysis =
        analysisSource.commitActivityAndCodeContribution.metrics.timeAnalysis;
      console.log(
        `⏰ Most active: ${timeAnalysis.mostActiveHour} on ${timeAnalysis.mostActiveDay}`
      );
      console.log(
        `🏢 Work-life balance: ${timeAnalysis.workPatternSummary.workLifeBalance}`
      );
    }

    console.log(`\n🎯 Use this data for:`);
    console.log(`   📊 Performance reviews and team planning`);
    console.log(`   🔧 Process optimization and workflow improvements`);
    console.log(`   👥 Team health and collaboration analysis`);
    console.log(`   📈 Development capacity and forecasting`);

    if (config.targetUser) {
      console.log(`   👤 Individual developer assessment and growth planning`);
      console.log(`   💚 Personal well-being and work-life balance monitoring`);
    }
  } catch (error) {
    console.error("\n❌ Error:", error.message);

    if (config.debug) {
      console.error("\n🔍 Full error details:");
      console.error(error);
    }

    // Provide helpful error guidance based on common issues
    if (error.message.includes("Authentication failed")) {
      console.error("\n💡 Authentication Error Solutions:");
      console.error(
        "   1. Ensure your token uses Bearer format (modern GitHub tokens)"
      );
      console.error(
        '   2. Check token has proper scopes: "repo" for private repos, "public_repo" for public'
      );
      console.error("   3. Verify token is not expired");
      console.error(
        "   4. Try regenerating your token at: https://github.com/settings/tokens"
      );
    } else if (error.message.includes("API endpoint")) {
      console.error("\n💡 API Endpoint Error Solutions:");
      console.error("   1. Check repository name format (owner/repo)");
      console.error("   2. Verify you have access to the repository");
      console.error("   3. Ensure token has appropriate permissions");
    } else if (error.message.includes("Token Permissions")) {
      console.error("\n💡 Permission Error Solutions:");
      console.error('   1. Token needs "repo" scope for private repositories');
      console.error(
        '   2. Token needs "public_repo" scope for public repositories'
      );
      console.error(
        "   3. Organization repos may require additional permissions"
      );
    } else if (error.message.includes("rate limit")) {
      console.error("\n💡 Rate Limit Solutions:");
      console.error("   1. Wait for rate limit reset");
      console.error("   2. Use a different token or GitHub App");
      console.error("   3. Reduce fetch limit with -l flag");
    } else if (error.message.includes("Repository not found")) {
      console.error("\n💡 Repository Access Solutions:");
      console.error("   1. Verify repository exists and name is correct");
      console.error(
        "   2. Check if repository is private and token has access"
      );
      console.error(
        "   3. Ensure proper organization permissions if applicable"
      );
    } else if (error.message.includes("No data found for user")) {
      console.error("\n💡 User Data Solutions:");
      console.error("   1. Verify the user email is correct");
      console.error(
        "   2. Check if the user has activity in the specified date range"
      );
      console.error("   3. Ensure the user has contributed to this repository");
      console.error("   4. Try expanding the date range with -s and -e flags");
    }

    process.exit(1);
  }
}

// Run the CLI
main();

/*
#Basic Analysis
```
# Analyze a public repository
node main.mjs -r "facebook/react" -f json -v

# Analyze with date range
node main.mjs -r "microsoft/vscode" -s "2024-01-01" -e "2024-01-31" -f csv

# Analyze with custom token
node main.mjs -r "your-org/your-repo" -t "your_token_here" -v
```

# User Analysis
```
# Focus analysis on specific user
node main.mjs -r "nodejs/node" -l infinite -d -f json --user "developer@example.com"

# Custom output file with user focus
node main.mjs -r "vuejs/vue" -o "vue-analysis-2024.json" -v --user "maintainer@vue.org"

# Weekend work analysis for specific user
node main.mjs -r "rails/rails" -s "2024-01-01" -v -f csv --user "contributor@rails.org"

# Comprehensive user assessment
node main.mjs -r "facebook/react" --user "developer@fb.com" -s "2024-01-01" -e "2024-03-31" -v

node main.mjs -r "repo/name" --user "email@domain.com" --debug

# Reduce fetch limit for user analysis
node main.mjs -r "large/repo" --user "email@domain.com" -l 100 -v

#   Individual Performance Reviews
# Generate comprehensive individual assessment
node main.mjs -r "team/project" --user "employee@company.com" -s "2024-01-01" -e "2024-03-31" -f json

# Focus on specific performance period
node main.mjs -r "org/service" --user "developer@org.com" -s "2024-Q1-start" -e "2024-Q1-end" -v

# Personal Well-being Monitoring
# Analyze work-life balance patterns
node main.mjs -r "company/product" --user "engineer@company.com" -v -f csv

# Check for burnout indicators
node main.mjs -r "startup/app" --user "founder@startup.com" -l infinite -d

#  Career Development Planning

# Identify growth opportunities
node main.mjs -r "team/project" --user "junior@company.com" -s "2024-01-01" -v

# Leadership potential assessment
node main.mjs -r "org/platform" --user "senior@org.com" -l 500 -f json

Team Health Monitoring
# General team analysis
node main.mjs -r "company/product" -v -f csv

# Focus on specific team member
node main.mjs -r "company/product" --user "member@company.com" -v
```

# Advanced Options
```
# Unlimited data fetch with debug mode
node main.mjs -r "nodejs/node" -l infinite -d -f json


# Team analysis with specific user deep-dive
node main.mjs -r "expressjs/express" --user "31365353+kgarg1@users.noreply.github.com" -l 50 -v

# Performance review preparation
node main.mjs -r "expressjs/express" --user "31365353+kgarg1@users.noreply.github.com" -s "2024-01-01" -e "2024-06-30" -f json -l 50 -v

``
*/
