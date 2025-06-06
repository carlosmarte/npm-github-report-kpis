#!/usr/bin/env node

/*
## 🚀 Features

- **User-Specific Analysis**: Analyze activity for any GitHub user (by username or email)
- **Comprehensive Activity Tracking**: Tracks commits, issues, pull requests, and comments
- **Date Range Filtering**: Filter results by specific date ranges
- **Multiple Output Formats**: Export to JSON or CSV
- **Rate Limiting & Retry Logic**: Handles GitHub API rate limits gracefully
- **Progress Tracking**: Shows real-time progress during analysis
- **Detailed Reporting**: Includes summary statistics and metadata

JSON Report Structure:
{
  "metadata": {
    "targetUser": {
      "login": "username",
      "name": "User Name",
      "email": "user@example.com"
    },
    "authenticatedUser": {
      "login": "auth_user",
      "name": "Auth User Name"
    },
    "dateRange": {
      "start": "2024-01-01",
      "end": "2024-01-31"
    },
    "generatedAt": "2024-01-31T12:00:00Z",
    "totalRecords": 150
  },
  "repositories": [
    {
      "id": 123456,
      "name": "repo-name",
      "fullName": "owner/repo-name",
      "private": false,
      "permissions": {
        "admin": true,
        "push": true,
        "pull": true
      },
      "userActivity": {
        "commits": 15,
        "issues": 3,
        "pullRequests": 2,
        "comments": 8,
        "lastCommitDate": "2024-01-30T10:00:00Z",
        "lastInteractionDate": "2024-01-30T15:30:00Z"
      },
      "language": "JavaScript",
      "starCount": 42,
      "forkCount": 7,
      "size": 1024
    }
  ],
  "summary": {
    "totalRepositories": 25,
    "privateRepos": 10,
    "publicRepos": 15,
    "totalCommits": 145,
    "totalIssues": 23,
    "totalPullRequests": 15,
    "totalComments": 87,
    "languages": {
      "JavaScript": 8,
      "Python": 5,
      "TypeScript": 7
    },
    "permissionLevels": {
      "admin": 12,
      "push": 8,
      "pull": 5
    }
  }
}

Use Cases:
1. Team Productivity Analysis: Track commit frequency and patterns across repositories for specific team members
2. Code Quality Assessment: Monitor repository activity and engagement metrics for individual contributors
3. Collaboration Metrics: Analyze contributor participation across projects for specific users
4. Development Patterns: Identify working patterns and repository usage for team members
5. Access Audit: Review repository permissions and access levels for specific users
6. Portfolio Analysis: Generate reports for personal or organizational repository portfolios
7. Activity Monitoring: Track actual user engagement and contributions for performance reviews
8. Time-based Analysis: Measure productivity within specific date ranges for project reporting

node main.mjs --user <username|email> [options]
node main.mjs --user octocat --start 2024-01-01 --end 2024-01-31 --format csv
node main.mjs --user user@example.com --verbose
node main.mjs --user johnsmith --fetchLimit infinite --output detailed-report.json
node main.mjs --user octocat --token ghp_xxxxxxxxxxxx --debug
*/

import { createWriteStream } from "fs";
import { writeFile } from "fs/promises";
import { parseArgs } from "util";
import https from "https";

class GitHubRepoAnalyzer {
  constructor(options = {}) {
    this.token = options.token || process.env.GITHUB_TOKEN;
    this.targetUser = options.targetUser;
    this.verbose = options.verbose || false;
    this.debug = options.debug || false;
    this.fetchLimit = options.fetchLimit || 200;
    this.baseURL = "api.github.com";
    this.rateLimitRemaining = 5000;
    this.rateLimitReset = Date.now();
    this.retryCount = 3;
    this.retryDelay = 1000;
    this.authenticatedUser = null;
    this.targetUserInfo = null;
    this.processedRepos = 0;
    this.totalReposToProcess = 0;
  }

  log(message, level = "info") {
    const timestamp = new Date().toISOString();
    const levels = {
      debug: this.debug,
      verbose: this.verbose || this.debug,
      info: true,
      warn: true,
      error: true,
    };

    if (levels[level]) {
      console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
    }
  }

  validateToken() {
    if (!this.token) {
      throw new Error(
        "GitHub token is required. Set GITHUB_TOKEN environment variable or use --token option."
      );
    }

    if (this.token.length < 20) {
      throw new Error(
        "Invalid token format. GitHub tokens should be longer than 20 characters."
      );
    }

    const validPrefixes = ["ghp_", "gho_", "ghu_", "ghs_", "ghr_"];
    const hasValidPrefix = validPrefixes.some((prefix) =>
      this.token.startsWith(prefix)
    );

    if (!hasValidPrefix && this.token.length !== 40) {
      this.log(
        "Warning: Token format may be incorrect. Expected format: ghp_xxxx... or 40-character classic token",
        "warn"
      );
    }
  }

  validateTargetUser() {
    if (!this.targetUser) {
      throw new Error(
        "Target user is required. Use --user option to specify the GitHub username or email."
      );
    }
  }

  updateProgress() {
    if (this.totalReposToProcess > 0) {
      const percentage = Math.round(
        (this.processedRepos / this.totalReposToProcess) * 100
      );
      const progressBar =
        "=".repeat(Math.floor(percentage / 2)) +
        " ".repeat(50 - Math.floor(percentage / 2));
      process.stdout.write(
        `\r[${progressBar}] ${percentage}% (${this.processedRepos}/${this.totalReposToProcess})`
      );
    }
  }

  async makeRequest(path, options = {}) {
    return new Promise((resolve, reject) => {
      const requestOptions = {
        hostname: this.baseURL,
        path: path,
        method: options.method || "GET",
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "GitHub-Repo-Analyzer/1.0.0",
          "X-GitHub-Api-Version": "2022-11-28",
          ...options.headers,
        },
      };

      if (this.token) {
        requestOptions.headers["Authorization"] = `Bearer ${this.token}`;
      }

      this.log(`Making request to: https://${this.baseURL}${path}`, "debug");

      const req = https.request(requestOptions, (res) => {
        let data = "";

        if (res.headers["x-ratelimit-remaining"]) {
          this.rateLimitRemaining = parseInt(
            res.headers["x-ratelimit-remaining"]
          );
          this.rateLimitReset =
            parseInt(res.headers["x-ratelimit-reset"]) * 1000;
        }

        this.log(`Response status: ${res.statusCode}`, "debug");

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          try {
            const result = {
              statusCode: res.statusCode,
              headers: res.headers,
              data: data ? JSON.parse(data) : null,
            };
            resolve(result);
          } catch (error) {
            this.log(`JSON parse error: ${error.message}`, "error");
            reject(new Error(`Failed to parse response: ${error.message}`));
          }
        });
      });

      req.on("error", (error) => {
        this.log(`Request error: ${error.message}`, "error");
        reject(error);
      });

      req.on("timeout", () => {
        this.log("Request timeout", "error");
        req.destroy();
        reject(new Error("Request timeout"));
      });

      req.setTimeout(30000);
      req.end();
    });
  }

  async makeRequestWithRetry(path, options = {}, attempt = 1) {
    try {
      if (this.rateLimitRemaining < 10 && Date.now() < this.rateLimitReset) {
        const waitTime = this.rateLimitReset - Date.now() + 1000;
        this.log(
          `Rate limit low, waiting ${Math.ceil(waitTime / 1000)} seconds`,
          "warn"
        );
        await this.sleep(waitTime);
      }

      const response = await this.makeRequest(path, options);

      if (response.statusCode === 200) {
        return response;
      } else if (response.statusCode === 401) {
        const errorMsg = response.data?.message || "Authentication failed";
        this.log(
          `Full error response: ${JSON.stringify(response.data)}`,
          "debug"
        );
        throw new Error(
          `Authentication failed: ${errorMsg}. Please check your GitHub token format and permissions.`
        );
      } else if (response.statusCode === 403) {
        const errorMsg = response.data?.message || "Access forbidden";
        this.log(
          `Full error response: ${JSON.stringify(response.data)}`,
          "debug"
        );

        if (errorMsg.includes("rate limit")) {
          const waitTime = this.rateLimitReset - Date.now() + 1000;
          this.log(
            `Rate limit exceeded, waiting ${Math.ceil(
              waitTime / 1000
            )} seconds`,
            "warn"
          );
          await this.sleep(waitTime);
          return this.makeRequestWithRetry(path, options, attempt);
        }
        throw new Error(
          `Access forbidden: ${errorMsg}. Status: ${response.statusCode}`
        );
      } else if (response.statusCode === 404) {
        // For 404s, return empty result instead of throwing (user might not exist or no access)
        return { statusCode: 404, headers: response.headers, data: [] };
      } else if (response.statusCode === 422) {
        const errorMsg = response.data?.message || "Validation failed";
        this.log(
          `Full error response: ${JSON.stringify(response.data)}`,
          "debug"
        );
        throw new Error(
          `Validation error: ${errorMsg}. Status: ${response.statusCode}`
        );
      } else if (response.statusCode >= 500 && attempt < this.retryCount) {
        this.log(
          `Server error (${response.statusCode}), retrying attempt ${
            attempt + 1
          }`,
          "warn"
        );
        await this.sleep(this.retryDelay * attempt);
        return this.makeRequestWithRetry(path, options, attempt + 1);
      } else {
        this.log(
          `Full error response: ${JSON.stringify(response.data)}`,
          "debug"
        );
        throw new Error(
          `HTTP ${response.statusCode}: ${
            response.data?.message || "Unknown error"
          }`
        );
      }
    } catch (error) {
      if (
        attempt < this.retryCount &&
        !error.message.includes("Authentication") &&
        !error.message.includes("forbidden")
      ) {
        this.log(
          `Request failed, retrying attempt ${attempt + 1}: ${error.message}`,
          "warn"
        );
        await this.sleep(this.retryDelay * attempt);
        return this.makeRequestWithRetry(path, options, attempt + 1);
      }
      throw error;
    }
  }

  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async getAuthenticatedUser() {
    this.log("Fetching authenticated user information", "verbose");

    try {
      const response = await this.makeRequestWithRetry("/user");
      this.authenticatedUser = response.data;
      this.log(
        `Authenticated as: ${this.authenticatedUser.login} (${
          this.authenticatedUser.name || "No name"
        })`,
        "info"
      );
      return this.authenticatedUser;
    } catch (error) {
      if (error.message.includes("Authentication failed")) {
        throw new Error(
          "Authentication failed: The GitHub API requires proper user authentication. Please ensure your token has the correct scopes (user:email, repo)."
        );
      }
      throw error;
    }
  }

  async getTargetUserInfo() {
    this.log(
      `Fetching target user information for: ${this.targetUser}`,
      "verbose"
    );

    try {
      // Check if targetUser is an email or username
      let userEndpoint = `/users/${this.targetUser}`;

      // If it looks like an email, search for the user
      if (this.targetUser.includes("@")) {
        const searchResponse = await this.makeRequestWithRetry(
          `/search/users?q=${encodeURIComponent(this.targetUser)}+in:email`
        );
        if (
          searchResponse.statusCode === 200 &&
          searchResponse.data.items &&
          searchResponse.data.items.length > 0
        ) {
          this.targetUserInfo = searchResponse.data.items[0];
        } else {
          throw new Error(`User with email ${this.targetUser} not found`);
        }
      } else {
        const response = await this.makeRequestWithRetry(userEndpoint);
        if (response.statusCode === 404) {
          throw new Error(`User ${this.targetUser} not found`);
        }
        this.targetUserInfo = response.data;
      }

      this.log(
        `Target user found: ${this.targetUserInfo.login} (${
          this.targetUserInfo.name || "No name"
        })`,
        "info"
      );
      return this.targetUserInfo;
    } catch (error) {
      throw new Error(`Failed to fetch target user info: ${error.message}`);
    }
  }

  async checkUserActivityInRepo(repo, startDate, endDate, username) {
    this.log(`Checking activity in ${repo.full_name}`, "debug");

    const activity = {
      commits: 0,
      issues: 0,
      pullRequests: 0,
      comments: 0,
      lastCommitDate: null,
      lastInteractionDate: null,
    };

    try {
      // Check commits by the user
      const commitsData = await this.fetchUserCommitsInRepo(
        repo,
        startDate,
        endDate,
        username
      );
      activity.commits = commitsData.count;
      activity.lastCommitDate = commitsData.lastDate;

      // Check issues created by user
      const issuesData = await this.fetchUserIssuesInRepo(
        repo,
        startDate,
        endDate,
        username
      );
      activity.issues = issuesData.count;

      // Check pull requests created by user
      const prsData = await this.fetchUserPullRequestsInRepo(
        repo,
        startDate,
        endDate,
        username
      );
      activity.pullRequests = prsData.count;

      // Check comments by user
      const commentsData = await this.fetchUserCommentsInRepo(
        repo,
        startDate,
        endDate,
        username
      );
      activity.comments = commentsData.count;

      // Determine last interaction date
      const dates = [
        activity.lastCommitDate,
        issuesData.lastDate,
        prsData.lastDate,
        commentsData.lastDate,
      ].filter((date) => date !== null);

      if (dates.length > 0) {
        activity.lastInteractionDate = new Date(
          Math.max(...dates.map((d) => new Date(d)))
        ).toISOString();
      }

      this.log(
        `Activity in ${repo.full_name}: ${activity.commits} commits, ${activity.issues} issues, ${activity.pullRequests} PRs, ${activity.comments} comments`,
        "debug"
      );
    } catch (error) {
      this.log(
        `Error checking activity in ${repo.full_name}: ${error.message}`,
        "warn"
      );
    }

    return activity;
  }

  async fetchUserCommitsInRepo(repo, startDate, endDate, username) {
    const commits = [];
    let page = 1;
    let hasMore = true;
    let lastDate = null;

    try {
      while (hasMore && commits.length < 100) {
        // Limit to prevent excessive API calls
        const path = `/repos/${repo.full_name}/commits?author=${username}&since=${startDate}T00:00:00Z&until=${endDate}T23:59:59Z&per_page=100&page=${page}`;
        const response = await this.makeRequestWithRetry(path);

        if (response.statusCode === 404) break;

        const pageCommits = response.data || [];
        if (pageCommits.length === 0) break;

        commits.push(...pageCommits);

        // Get the most recent commit date
        if (pageCommits.length > 0 && pageCommits[0].commit?.author?.date) {
          lastDate = pageCommits[0].commit.author.date;
        }

        const linkHeader = response.headers.link;
        hasMore = linkHeader && linkHeader.includes('rel="next"');
        page++;

        await this.sleep(100); // Rate limiting
      }
    } catch (error) {
      this.log(
        `Error fetching commits for ${repo.full_name}: ${error.message}`,
        "debug"
      );
    }

    return { count: commits.length, lastDate };
  }

  async fetchUserIssuesInRepo(repo, startDate, endDate, username) {
    const issues = [];
    let page = 1;
    let hasMore = true;
    let lastDate = null;

    try {
      while (hasMore && issues.length < 50) {
        const path = `/repos/${repo.full_name}/issues?creator=${username}&since=${startDate}T00:00:00Z&state=all&per_page=100&page=${page}`;
        const response = await this.makeRequestWithRetry(path);

        if (response.statusCode === 404) break;

        const pageIssues = (response.data || []).filter((issue) => {
          const createdAt = new Date(issue.created_at);
          const start = new Date(startDate);
          const end = new Date(endDate + "T23:59:59Z");
          return createdAt >= start && createdAt <= end && !issue.pull_request;
        });

        issues.push(...pageIssues);

        if (pageIssues.length > 0 && pageIssues[0].created_at) {
          lastDate = pageIssues[0].created_at;
        }

        const linkHeader = response.headers.link;
        hasMore =
          linkHeader &&
          linkHeader.includes('rel="next"') &&
          pageIssues.length > 0;
        page++;

        await this.sleep(100);
      }
    } catch (error) {
      this.log(
        `Error fetching issues for ${repo.full_name}: ${error.message}`,
        "debug"
      );
    }

    return { count: issues.length, lastDate };
  }

  async fetchUserPullRequestsInRepo(repo, startDate, endDate, username) {
    const prs = [];
    let page = 1;
    let hasMore = true;
    let lastDate = null;

    try {
      while (hasMore && prs.length < 50) {
        const path = `/repos/${repo.full_name}/pulls?creator=${username}&state=all&per_page=100&page=${page}`;
        const response = await this.makeRequestWithRetry(path);

        if (response.statusCode === 404) break;

        const pagePRs = (response.data || []).filter((pr) => {
          const createdAt = new Date(pr.created_at);
          const start = new Date(startDate);
          const end = new Date(endDate + "T23:59:59Z");
          return createdAt >= start && createdAt <= end;
        });

        prs.push(...pagePRs);

        if (pagePRs.length > 0 && pagePRs[0].created_at) {
          lastDate = pagePRs[0].created_at;
        }

        const linkHeader = response.headers.link;
        hasMore =
          linkHeader && linkHeader.includes('rel="next"') && pagePRs.length > 0;
        page++;

        await this.sleep(100);
      }
    } catch (error) {
      this.log(
        `Error fetching pull requests for ${repo.full_name}: ${error.message}`,
        "debug"
      );
    }

    return { count: prs.length, lastDate };
  }

  async fetchUserCommentsInRepo(repo, startDate, endDate, username) {
    let totalComments = 0;
    let lastDate = null;

    try {
      // Fetch issue comments
      const issueComments = await this.fetchCommentsFromEndpoint(
        `/repos/${repo.full_name}/issues/comments`,
        startDate,
        endDate,
        username
      );
      totalComments += issueComments.count;
      if (issueComments.lastDate) lastDate = issueComments.lastDate;

      // Fetch PR review comments
      const reviewComments = await this.fetchCommentsFromEndpoint(
        `/repos/${repo.full_name}/pulls/comments`,
        startDate,
        endDate,
        username
      );
      totalComments += reviewComments.count;
      if (
        reviewComments.lastDate &&
        (!lastDate || new Date(reviewComments.lastDate) > new Date(lastDate))
      ) {
        lastDate = reviewComments.lastDate;
      }
    } catch (error) {
      this.log(
        `Error fetching comments for ${repo.full_name}: ${error.message}`,
        "debug"
      );
    }

    return { count: totalComments, lastDate };
  }

  async fetchCommentsFromEndpoint(endpoint, startDate, endDate, username) {
    const comments = [];
    let page = 1;
    let hasMore = true;
    let lastDate = null;

    try {
      while (hasMore && comments.length < 50) {
        const path = `${endpoint}?since=${startDate}T00:00:00Z&per_page=100&page=${page}`;
        const response = await this.makeRequestWithRetry(path);

        if (response.statusCode === 404) break;

        const pageComments = (response.data || []).filter((comment) => {
          const createdAt = new Date(comment.created_at);
          const start = new Date(startDate);
          const end = new Date(endDate + "T23:59:59Z");
          return (
            comment.user?.login === username &&
            createdAt >= start &&
            createdAt <= end
          );
        });

        comments.push(...pageComments);

        if (pageComments.length > 0 && pageComments[0].created_at) {
          lastDate = pageComments[0].created_at;
        }

        const linkHeader = response.headers.link;
        hasMore =
          linkHeader &&
          linkHeader.includes('rel="next"') &&
          (response.data || []).length > 0;
        page++;

        await this.sleep(100);
      }
    } catch (error) {
      this.log(
        `Error fetching comments from ${endpoint}: ${error.message}`,
        "debug"
      );
    }

    return { count: comments.length, lastDate };
  }

  async fetchRepositoriesForUser(targetUsername) {
    this.log(`Fetching repositories for user: ${targetUsername}`, "verbose");
    const repositories = [];
    let page = 1;
    let hasMore = true;

    // Fetch user's own repositories
    while (
      hasMore &&
      (this.fetchLimit === "infinite" || repositories.length < this.fetchLimit)
    ) {
      const perPage = Math.min(
        100,
        this.fetchLimit === "infinite"
          ? 100
          : this.fetchLimit - repositories.length
      );
      const path = `/users/${targetUsername}/repos?per_page=${perPage}&page=${page}&sort=updated&direction=desc&type=all`;

      this.log(
        `Fetching user repos page ${page} with ${perPage} items`,
        "debug"
      );

      try {
        const response = await this.makeRequestWithRetry(path);

        if (response.statusCode === 404) {
          this.log(
            `User ${targetUsername} not found or no public repositories`,
            "warn"
          );
          break;
        }

        const repos = response.data || [];

        if (repos.length === 0) {
          hasMore = false;
          break;
        }

        repositories.push(...repos);
        this.log(
          `User repos page ${page}: Found ${repos.length} repos`,
          "debug"
        );

        const linkHeader = response.headers.link;
        hasMore = linkHeader && linkHeader.includes('rel="next"');
        page++;

        await this.sleep(100);
      } catch (error) {
        this.log(`Error fetching user repositories: ${error.message}`, "warn");
        break;
      }
    }

    // If we have authenticated access and the target user is the same as authenticated user,
    // also fetch repositories from organizations
    if (
      this.authenticatedUser &&
      this.authenticatedUser.login === targetUsername
    ) {
      try {
        const orgsResponse = await this.makeRequestWithRetry("/user/orgs");
        const organizations = orgsResponse.data || [];

        for (const org of organizations) {
          this.log(
            `Fetching repositories for organization: ${org.login}`,
            "verbose"
          );

          let orgPage = 1;
          let hasOrgMore = true;

          while (
            hasOrgMore &&
            (this.fetchLimit === "infinite" ||
              repositories.length < this.fetchLimit)
          ) {
            const perPage = Math.min(
              100,
              this.fetchLimit === "infinite"
                ? 100
                : this.fetchLimit - repositories.length
            );
            const path = `/orgs/${org.login}/repos?per_page=${perPage}&page=${orgPage}&sort=updated&direction=desc`;

            try {
              const response = await this.makeRequestWithRetry(path);
              const repos = response.data || [];

              if (repos.length === 0) {
                hasOrgMore = false;
                break;
              }

              // Filter out duplicates
              const newRepos = repos.filter(
                (repo) =>
                  !repositories.some(
                    (existingRepo) => existingRepo.id === repo.id
                  )
              );
              repositories.push(...newRepos);

              this.log(
                `Org ${org.login} page ${orgPage}: Found ${repos.length} repos, ${newRepos.length} new`,
                "debug"
              );

              const linkHeader = response.headers.link;
              hasOrgMore = linkHeader && linkHeader.includes('rel="next"');
              orgPage++;
            } catch (error) {
              this.log(
                `Error fetching org ${org.login} repos: ${error.message}`,
                "warn"
              );
              break;
            }

            await this.sleep(100);
          }
        }
      } catch (error) {
        this.log(
          `Error fetching organization repositories: ${error.message}`,
          "warn"
        );
      }
    }

    return repositories;
  }

  async fetchRepositoriesWithActivity(startDate, endDate) {
    this.log("Starting repository analysis with activity checking", "verbose");

    try {
      this.validateToken();
      this.validateTargetUser();

      const authenticatedUser = await this.getAuthenticatedUser();
      const targetUser = await this.getTargetUserInfo();

      console.log("\n🔍 Fetching repositories for target user...");
      const allRepos = await this.fetchRepositoriesForUser(targetUser.login);

      console.log(
        `\n📊 Found ${allRepos.length} repositories. Checking for user activity...`
      );

      this.totalReposToProcess = allRepos.length;
      this.processedRepos = 0;

      const repositoriesWithActivity = [];

      for (const repo of allRepos) {
        this.updateProgress();

        const activity = await this.checkUserActivityInRepo(
          repo,
          startDate,
          endDate,
          targetUser.login
        );

        // Only include repositories where the user had actual activity
        const hasActivity =
          activity.commits > 0 ||
          activity.issues > 0 ||
          activity.pullRequests > 0 ||
          activity.comments > 0;

        if (hasActivity) {
          repositoriesWithActivity.push({
            ...repo,
            userActivity: activity,
          });

          this.log(
            `Added ${repo.full_name} with activity: ${activity.commits} commits, ${activity.issues} issues, ${activity.pullRequests} PRs, ${activity.comments} comments`,
            "verbose"
          );
        }

        this.processedRepos++;

        // Rate limiting
        await this.sleep(150);
      }

      process.stdout.write("\n\n");
      this.log(
        `Repository analysis completed. Found ${repositoriesWithActivity.length} repositories with user activity.`,
        "info"
      );

      return repositoriesWithActivity;
    } catch (error) {
      process.stdout.write("\n");
      this.log(`Error fetching repositories: ${error.message}`, "error");

      if (
        error.message.includes("Authentication") ||
        error.message.includes("UserEmail")
      ) {
        this.log("Authentication troubleshooting:", "error");
        this.log(
          "1. Ensure your GitHub token is valid and not expired",
          "error"
        );
        this.log(
          "2. Token should have these scopes: repo, user:email, read:org",
          "error"
        );
        this.log(
          "3. For fine-grained tokens, ensure repository access is granted",
          "error"
        );
        this.log(
          "4. Get a new token at: https://github.com/settings/tokens",
          "error"
        );
        this.log(
          "5. Set token via: export GITHUB_TOKEN=your_token_here",
          "error"
        );
      } else if (error.message.includes("rate limit")) {
        this.log(
          "Rate limit exceeded. Please wait and try again later.",
          "error"
        );
      } else if (error.message.includes("forbidden")) {
        this.log(
          "Access forbidden. Please ensure your token has sufficient permissions.",
          "error"
        );
      }

      throw error;
    }
  }

  generateSummary(repositories) {
    const summary = {
      totalRepositories: repositories.length,
      privateRepos: repositories.filter((r) => r.private).length,
      publicRepos: repositories.filter((r) => !r.private).length,
      totalCommits: 0,
      totalIssues: 0,
      totalPullRequests: 0,
      totalComments: 0,
      languages: {},
      permissionLevels: {
        admin: 0,
        push: 0,
        pull: 0,
      },
    };

    repositories.forEach((repo) => {
      // Count activity
      if (repo.userActivity) {
        summary.totalCommits += repo.userActivity.commits;
        summary.totalIssues += repo.userActivity.issues;
        summary.totalPullRequests += repo.userActivity.pullRequests;
        summary.totalComments += repo.userActivity.comments;
      }

      // Count languages
      if (repo.language) {
        summary.languages[repo.language] =
          (summary.languages[repo.language] || 0) + 1;
      }

      // Count permission levels
      if (repo.permissions) {
        if (repo.permissions.admin) summary.permissionLevels.admin++;
        else if (repo.permissions.push) summary.permissionLevels.push++;
        else if (repo.permissions.pull) summary.permissionLevels.pull++;
      }
    });

    return summary;
  }

  async generateReport(repositories, startDate, endDate, format, outputFile) {
    const metadata = {
      targetUser: this.targetUserInfo
        ? {
            login: this.targetUserInfo.login,
            name: this.targetUserInfo.name,
            email: this.targetUserInfo.email,
          }
        : null,
      authenticatedUser: this.authenticatedUser
        ? {
            login: this.authenticatedUser.login,
            name: this.authenticatedUser.name,
          }
        : null,
      dateRange: {
        start: startDate,
        end: endDate,
      },
      generatedAt: new Date().toISOString(),
      totalRecords: repositories.length,
    };

    const summary = this.generateSummary(repositories);

    const reportData = {
      metadata,
      repositories: repositories.map((repo) => ({
        id: repo.id,
        name: repo.name,
        fullName: repo.full_name,
        private: repo.private,
        permissions: repo.permissions,
        userActivity: repo.userActivity,
        language: repo.language,
        starCount: repo.stargazers_count,
        forkCount: repo.forks_count,
        size: repo.size,
        description: repo.description,
        htmlUrl: repo.html_url,
        createdAt: repo.created_at,
        updatedAt: repo.updated_at,
        owner: {
          login: repo.owner.login,
          type: repo.owner.type,
        },
      })),
      summary,
    };

    if (format === "json") {
      await writeFile(outputFile, JSON.stringify(reportData, null, 2));
    } else if (format === "csv") {
      await this.generateCSV(reportData, outputFile);
    }

    this.log(`Report generated: ${outputFile}`, "info");
    return reportData;
  }

  async generateCSV(reportData, outputFile) {
    const stream = createWriteStream(outputFile);

    const headers = [
      "Repository ID",
      "Name",
      "Full Name",
      "Private",
      "Owner",
      "Owner Type",
      "Admin Access",
      "Push Access",
      "Pull Access",
      "Commits",
      "Issues",
      "Pull Requests",
      "Comments",
      "Last Commit Date",
      "Last Interaction Date",
      "Language",
      "Stars",
      "Forks",
      "Size (KB)",
      "Description",
      "URL",
      "Created At",
      "Updated At",
    ];
    stream.write(headers.join(",") + "\n");

    for (const repo of reportData.repositories) {
      const row = [
        repo.id,
        `"${(repo.name || "").replace(/"/g, '""')}"`,
        `"${(repo.fullName || "").replace(/"/g, '""')}"`,
        repo.private,
        `"${(repo.owner?.login || "").replace(/"/g, '""')}"`,
        `"${(repo.owner?.type || "").replace(/"/g, '""')}"`,
        repo.permissions?.admin || false,
        repo.permissions?.push || false,
        repo.permissions?.pull || false,
        repo.userActivity?.commits || 0,
        repo.userActivity?.issues || 0,
        repo.userActivity?.pullRequests || 0,
        repo.userActivity?.comments || 0,
        repo.userActivity?.lastCommitDate || "",
        repo.userActivity?.lastInteractionDate || "",
        `"${(repo.language || "").replace(/"/g, '""')}"`,
        repo.starCount || 0,
        repo.forkCount || 0,
        repo.size || 0,
        `"${(repo.description || "").replace(/"/g, '""')}"`,
        `"${(repo.htmlUrl || "").replace(/"/g, '""')}"`,
        repo.createdAt,
        repo.updatedAt,
      ];
      stream.write(row.join(",") + "\n");
    }

    stream.end();
    return new Promise((resolve, reject) => {
      stream.on("finish", resolve);
      stream.on("error", reject);
    });
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      user: { type: "string", short: "u" },
      format: { type: "string", short: "f", default: "json" },
      output: { type: "string", short: "o" },
      start: { type: "string", short: "s" },
      end: { type: "string", short: "e" },
      verbose: { type: "boolean", short: "v", default: false },
      debug: { type: "boolean", short: "d", default: false },
      token: { type: "string", short: "t" },
      help: { type: "boolean", short: "h", default: false },
      fetchLimit: { type: "string", short: "l", default: "200" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
GitHub Repository Activity Analyzer CLI

Analyzes repositories where a specific user has committed, commented, or interacted within a date range.

Usage: node main.mjs --user <username|email> [options]

Required Arguments:
  -u, --user <username|email>    GitHub username or email to analyze (required)

Options:
  -f, --format <format>          Output format: json (default) or csv
  -o, --output <filename>        Output filename (auto-generated if not provided)
  -s, --start <date>             Start date (ISO format: YYYY-MM-DD) default -30 days
  -e, --end <date>               End date (ISO format: YYYY-MM-DD) default: now
  -v, --verbose                  Enable verbose logging
  -d, --debug                    Enable debug logging
  -t, --token <token>            GitHub Token (or use GITHUB_TOKEN env var)
  -l, --fetchLimit <limit>       Set fetch limit (default: 200, use 'infinite' for no limit)
  -h, --help                     Show help message

Required GitHub Token Scopes:
  - repo (for private repositories)
  - public_repo (for public repositories)  
  - user:email (for user information)
  - read:org (for organization repositories)

Examples:
  node main.mjs --user octocat --start 2024-01-01 --end 2024-01-31 --format csv
  node main.mjs -u user@example.com --verbose --fetchLimit infinite
  node main.mjs --user johnsmith --token YOUR_TOKEN --output my-activity.json

Environment Variables:
  GITHUB_TOKEN              GitHub personal access token

Get a token at: https://github.com/settings/tokens

This tool fetches repositories where the specified user has actual activity (commits, issues, PRs, comments)
within the specified date range, not just repositories that were updated.
        `);
    return;
  }

  try {
    if (!values.user) {
      console.error("Error: --user argument is required.");
      console.error("Specify the GitHub username or email to analyze.");
      console.error("Example: node main.mjs --user octocat");
      console.error("Use --help for more information.");
      process.exit(1);
    }

    const endDate = values.end || new Date().toISOString().split("T")[0];
    const startDate =
      values.start ||
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];

    const fetchLimit =
      values.fetchLimit === "infinite"
        ? "infinite"
        : parseInt(values.fetchLimit) || 200;

    const analyzer = new GitHubRepoAnalyzer({
      token: values.token,
      targetUser: values.user,
      verbose: values.verbose,
      debug: values.debug,
      fetchLimit: fetchLimit,
    });

    if (!analyzer.token) {
      console.error("Error: GitHub token is required.");
      console.error(
        "Set it via --token option or GITHUB_TOKEN environment variable."
      );
      console.error("Get a token at: https://github.com/settings/tokens");
      console.error("\nRequired scopes: repo, user:email, read:org");
      process.exit(1);
    }

    if (!["json", "csv"].includes(values.format)) {
      console.error('Error: Format must be either "json" or "csv"');
      process.exit(1);
    }

    console.log(`🚀 Starting GitHub repository activity analysis...`);
    console.log(`👤 Target user: ${values.user}`);
    console.log(`📅 Date range: ${startDate} to ${endDate}`);
    console.log(`📊 Fetch limit: ${fetchLimit}`);
    console.log(`📄 Output format: ${values.format}`);

    const repositories = await analyzer.fetchRepositoriesWithActivity(
      startDate,
      endDate
    );

    if (repositories.length === 0) {
      console.log(
        `\n❌ No repositories found with activity for user "${values.user}" in the specified date range.`
      );
      console.log(
        "💡 Try expanding your date range or checking if the username is correct."
      );
      return;
    }

    const outputFile =
      values.output ||
      `github-activity-${values.user}-${startDate}-to-${endDate}.${values.format}`;
    const report = await analyzer.generateReport(
      repositories,
      startDate,
      endDate,
      values.format,
      outputFile
    );

    console.log("\n📈 === Analysis Summary ===");
    if (analyzer.targetUserInfo) {
      console.log(
        `👤 Target user: ${analyzer.targetUserInfo.login} (${
          analyzer.targetUserInfo.name || "No name"
        })`
      );
    }
    if (analyzer.authenticatedUser) {
      console.log(`🔐 Authenticated as: ${analyzer.authenticatedUser.login}`);
    }
    console.log(
      `📚 Total repositories with activity: ${report.summary.totalRepositories}`
    );
    console.log(`🔒 Private repositories: ${report.summary.privateRepos}`);
    console.log(`🌐 Public repositories: ${report.summary.publicRepos}`);
    console.log(`💻 Total commits: ${report.summary.totalCommits}`);
    console.log(`🐛 Total issues: ${report.summary.totalIssues}`);
    console.log(`🔀 Total pull requests: ${report.summary.totalPullRequests}`);
    console.log(`💬 Total comments: ${report.summary.totalComments}`);
    console.log(`👑 Admin access: ${report.summary.permissionLevels.admin}`);
    console.log(`✍️  Push access: ${report.summary.permissionLevels.push}`);
    console.log(`📖 Pull access: ${report.summary.permissionLevels.pull}`);

    if (Object.keys(report.summary.languages).length > 0) {
      console.log("\n🔤 Top languages:");
      Object.entries(report.summary.languages)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .forEach(([lang, count]) => {
          console.log(`  ${lang}: ${count} repositories`);
        });
    }

    console.log(`\n💾 Report saved to: ${outputFile}`);
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);

    if (error.message.includes("Authentication failed")) {
      console.error("\n🔧 Error Analysis & Solution:");
      console.error(
        "This error occurs when the GitHub API cannot properly authenticate the user."
      );
      console.error("\n❓ Why it happens:");
      console.error("- Token format is incorrect (should use Bearer format)");
      console.error("- Token lacks required scopes (user:email, repo)");
      console.error("- Token has expired or is invalid");
      console.error("\n🛠️  How to fix:");
      console.error(
        "1. Generate a new token at: https://github.com/settings/tokens"
      );
      console.error("2. Select these scopes: repo, user:email, read:org");
      console.error(
        "3. Copy the token and set it as: export GITHUB_TOKEN=your_token"
      );
      console.error("4. Run the command again");
    } else if (
      error.message.includes("User") &&
      error.message.includes("not found")
    ) {
      console.error("\n🔧 Error Analysis & Solution:");
      console.error("The specified user could not be found.");
      console.error("\n❓ Why it happens:");
      console.error("- Username is misspelled");
      console.error("- User account does not exist or has been deleted");
      console.error(
        "- Email address is not publicly associated with a GitHub account"
      );
      console.error("\n🛠️  How to fix:");
      console.error("1. Double-check the username spelling");
      console.error(
        "2. Verify the user exists by visiting: https://github.com/USERNAME"
      );
      console.error(
        "3. If using email, ensure it's public in the user's GitHub profile"
      );
      console.error("4. Try using the GitHub username instead of email");
    }

    if (values.debug) {
      console.error("Stack trace:", error.stack);
    }
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("Unhandled error:", error);
    process.exit(1);
  });
}

export default GitHubRepoAnalyzer;
