#!/usr/bin/env node

/*
JSON Report Structure:
{
  "metadata": {
    "repository": "owner/repo",
    "analysisDate": "2024-01-15T10:30:00.000Z",
    "dateRange": { "start": "2024-01-01", "end": "2024-01-31" },
    "totalCommits": 156,
    "totalFiles": 89,
    "apiRequestsMade": 45,
    "requestLimit": 200
  },
  "commitTimeline": [
    {
      "sha": "abc123...",
      "date": "2024-01-15T14:30:00Z",
      "message": "Fix authentication bug",
      "author": { "name": "John Doe", "email": "john@example.com" },
      "files": [
        {
          "filename": "src/auth.js",
          "status": "modified",
          "additions": 15,
          "deletions": 8,
          "changes": 23
        }
      ],
      "stats": { "additions": 15, "deletions": 8, "total": 23 }
    }
  ],
  "fileMetadata": {
    "src/auth.js": {
      "totalChanges": 5,
      "totalAdditions": 45,
      "totalDeletions": 12,
      "firstChanged": "2024-01-01T09:00:00Z",
      "lastChanged": "2024-01-15T14:30:00Z",
      "commitHistory": [...],
      "fileExtension": "js",
      "filePath": "src"
    }
  }
}

Use Cases:
- Team Productivity Analysis: Track commit frequency and patterns
- Code Quality Assessment: Monitor additions/deletions trends  
- Collaboration Metrics: Analyze contributor participation
- Development Patterns: Identify working time distributions
- Process Improvements: Compare before/after periods for process changes
*/

import https from "https";
import fs from "fs";
import { URL } from "url";

/**
 * Simple progress bar implementation
 */
class ProgressBar {
  constructor(total, description = "") {
    this.total = total;
    this.current = 0;
    this.barLength = 30;
    this.description = description;
    this.startTime = Date.now();
  }

  update(current) {
    this.current = current;
    const progress = current / this.total;
    const filled = Math.round(this.barLength * progress);
    const bar = "█".repeat(filled) + "░".repeat(this.barLength - filled);
    const percentage = Math.round(progress * 100);

    const elapsed = Date.now() - this.startTime;
    const estimatedTotal = elapsed / progress;
    const remaining = estimatedTotal - elapsed;
    const eta = remaining > 0 ? `ETA: ${Math.round(remaining / 1000)}s` : "";

    process.stdout.write(
      `\r${this.description}[${bar}] ${percentage}% (${current}/${this.total}) ${eta}`
    );
  }

  complete() {
    process.stdout.write("\n");
  }
}

/**
 * GitHub Repository Analyzer - Analyzes commit patterns and file changes over time
 */
class GitHubAnalyzer {
  constructor(repo, owner, startDate, endDate, token, options = {}) {
    this.repo = repo;
    this.owner = owner;
    this.startDate = startDate;
    this.endDate = endDate;
    this.token = token || process.env.GITHUB_TOKEN;
    this.verbose = options.verbose || false;
    this.debug = options.debug || false;
    this.requestLimit = options.requestLimit || 200;
    this.baseUrl = "https://api.github.com";
    this.commits = [];
    this.fileMetadata = {};
    this.requestCount = 0;
    this.rateLimitRemaining = null;
    this.rateLimitReset = null;

    // Default date range (30 days ago to now) if not specified
    if (!this.startDate) {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      this.startDate = thirtyDaysAgo.toISOString().split("T")[0];
    }

    if (!this.endDate) {
      this.endDate = new Date().toISOString().split("T")[0];
    }
  }

  /**
   * Logging utility with levels
   */
  log(message, level = "info") {
    if (level === "debug" && !this.debug) return;
    if (level === "verbose" && !this.verbose && !this.debug) return;

    const timestamp = new Date().toISOString();
    const prefix =
      level === "debug"
        ? "[DEBUG]"
        : level === "verbose"
        ? "[VERBOSE]"
        : "[INFO]";
    console.log(`${timestamp} ${prefix} ${message}`);
  }

  /**
   * Validate GitHub token format and accessibility
   */
  async validateToken() {
    if (!this.token) {
      throw new Error(
        "GitHub token is required. Set GITHUB_TOKEN environment variable or use -t flag."
      );
    }

    // Enhanced token format validation
    if (
      !this.token.startsWith("ghp_") &&
      !this.token.startsWith("github_pat_") &&
      !this.token.startsWith("gho_") &&
      this.token.length < 20
    ) {
      this.log(
        "Warning: Token format may be invalid. Ensure it's a valid GitHub personal access token.",
        "verbose"
      );
    }

    try {
      const response = await this.makeRequest(`${this.baseUrl}/user`);
      this.log(`Authenticated as: ${response.data.login}`, "verbose");
      return true;
    } catch (error) {
      if (error.message.includes("401")) {
        throw new Error(
          "Authentication failed. GitHub API requires Bearer token format. Please check your token and try again."
        );
      }
      throw error;
    }
  }

  /**
   * Make HTTP request with improved error handling and retry logic
   */
  async makeRequest(url, retries = 3) {
    // Check request limit before making request
    if (this.requestLimit !== -1 && this.requestCount >= this.requestLimit) {
      throw new Error(
        `API request limit reached (${this.requestLimit}). Use --limit -1 for unlimited requests.`
      );
    }

    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const options = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "User-Agent": "GitHub-Repository-Analyzer-CLI/1.0",
          Accept: "application/vnd.github.v3+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      };

      const req = https.request(options, (res) => {
        let data = "";

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          this.requestCount++;
          this.rateLimitRemaining = res.headers["x-ratelimit-remaining"];
          this.rateLimitReset = res.headers["x-ratelimit-reset"];

          this.log(
            `API Request: ${this.requestCount}/${
              this.requestLimit === -1 ? "∞" : this.requestLimit
            } - Remaining: ${this.rateLimitRemaining}`,
            "debug"
          );

          if (res.statusCode === 200) {
            try {
              const parsed = JSON.parse(data);
              resolve({ data: parsed, headers: res.headers });
            } catch (err) {
              reject(
                new Error(`Failed to parse JSON response: ${err.message}`)
              );
            }
          } else if (res.statusCode === 401) {
            reject(
              new Error(
                "Authentication failed. GitHub API now requires Bearer token format instead of the legacy token format. Please check your token permissions and format."
              )
            );
          } else if (res.statusCode === 403) {
            if (res.headers["x-ratelimit-remaining"] === "0") {
              const resetTime =
                parseInt(res.headers["x-ratelimit-reset"]) * 1000;
              const waitTime = resetTime - Date.now() + 1000;
              this.log(
                `Rate limit exceeded. Waiting ${Math.ceil(
                  waitTime / 1000
                )} seconds...`,
                "verbose"
              );
              setTimeout(() => {
                this.makeRequest(url, retries).then(resolve).catch(reject);
              }, waitTime);
            } else {
              try {
                const errorData = JSON.parse(data);
                reject(
                  new Error(
                    `Access forbidden. The token might lack proper repository access scopes: ${
                      errorData.message || data
                    }`
                  )
                );
              } catch {
                reject(
                  new Error(
                    `Access forbidden. The token might lack proper repository access scopes: ${data}`
                  )
                );
              }
            }
          } else if (res.statusCode === 404) {
            try {
              const errorData = JSON.parse(data);
              reject(
                new Error(
                  `Repository not found: ${this.owner}/${this.repo}. ${
                    errorData.message ||
                    "Check repository name and token permissions."
                  }`
                )
              );
            } catch {
              reject(
                new Error(
                  `Repository not found: ${this.owner}/${this.repo}. Check repository name and token permissions.`
                )
              );
            }
          } else if (retries > 0) {
            this.log(
              `Request failed (${res.statusCode}), retrying... (${retries} attempts left)`,
              "verbose"
            );
            const backoffTime = (4 - retries) * 1000;
            setTimeout(() => {
              this.makeRequest(url, retries - 1)
                .then(resolve)
                .catch(reject);
            }, backoffTime);
          } else {
            try {
              const errorData = JSON.parse(data);
              reject(
                new Error(
                  `GitHub API error (${res.statusCode}): ${
                    errorData.message || data
                  }`
                )
              );
            } catch {
              reject(
                new Error(`GitHub API error (${res.statusCode}): ${data}`)
              );
            }
          }
        });
      });

      req.on("error", (err) => {
        if (retries > 0) {
          this.log(
            `Network error, retrying... (${retries} attempts left): ${err.message}`,
            "verbose"
          );
          setTimeout(() => {
            this.makeRequest(url, retries - 1)
              .then(resolve)
              .catch(reject);
          }, 1000);
        } else {
          reject(new Error(`Network error: ${err.message}`));
        }
      });

      req.setTimeout(30000, () => {
        req.destroy();
        reject(new Error("Request timeout after 30 seconds"));
      });

      req.end();
    });
  }

  /**
   * Check if repository exists and is accessible
   */
  async validateRepository() {
    try {
      const response = await this.makeRequest(
        `${this.baseUrl}/repos/${this.owner}/${this.repo}`
      );
      this.log(
        `Repository found: ${response.data.full_name} (${
          response.data.visibility || "public"
        })`,
        "verbose"
      );
      return response.data;
    } catch (error) {
      throw new Error(
        `Failed to access repository ${this.owner}/${this.repo}: ${error.message}`
      );
    }
  }

  /**
   * Fetch commits from main branch with API request limiting
   */
  async fetchCommits() {
    this.log("Fetching commits from GitHub API...");

    // Find the default branch
    const repoData = await this.validateRepository();
    const defaultBranch = repoData.default_branch || "main";
    this.log(`Using default branch: ${defaultBranch}`, "verbose");

    let url = `${this.baseUrl}/repos/${this.owner}/${this.repo}/commits?sha=${defaultBranch}&per_page=100`;

    if (this.startDate) {
      url += `&since=${this.startDate}T00:00:00Z`;
    }
    if (this.endDate) {
      url += `&until=${this.endDate}T23:59:59Z`;
    }

    const allCommits = [];
    let page = 1;
    let hasMore = true;
    let progressBar = new ProgressBar(1, "Fetching commits: ");

    while (
      hasMore &&
      (this.requestLimit === -1 || this.requestCount < this.requestLimit)
    ) {
      try {
        const currentUrl = `${url}&page=${page}`;
        this.log(`Fetching commits page ${page}...`, "debug");

        const response = await this.makeRequest(currentUrl);
        const commits = response.data;

        if (commits.length === 0) {
          hasMore = false;
          break;
        }

        // Update progress bar estimate on first page
        if (page === 1) {
          const linkHeader = response.headers.link;
          const estimatedPages =
            this.parseLinkHeader(linkHeader) || Math.min(page + 10, 50);
          progressBar = new ProgressBar(estimatedPages, "Fetching commits: ");
        }

        allCommits.push(...commits);
        progressBar.update(page);

        // Check if we have fewer than 100 commits (last page)
        if (commits.length < 100) {
          hasMore = false;
        }

        page++;

        // Enhanced rate limiting
        if (this.rateLimitRemaining && parseInt(this.rateLimitRemaining) < 10) {
          this.log("Approaching rate limit, adding delay...", "verbose");
          await new Promise((resolve) => setTimeout(resolve, 2000));
        } else {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      } catch (error) {
        progressBar.complete();
        if (error.message.includes("API request limit reached")) {
          this.log(
            `Reached API request limit (${this.requestLimit}). Fetched ${allCommits.length} commits so far.`,
            "verbose"
          );
          break;
        }
        this.log(`Error fetching commits: ${error.message}`, "debug");
        throw error;
      }
    }

    progressBar.complete();
    this.log(
      `Successfully fetched ${allCommits.length} commits from ${defaultBranch} branch`
    );
    return allCommits;
  }

  /**
   * Parse GitHub API Link header to estimate total pages
   */
  parseLinkHeader(linkHeader) {
    if (!linkHeader) return null;
    const lastMatch = linkHeader.match(/page=(\d+)>; rel="last"/);
    return lastMatch ? parseInt(lastMatch[1]) : null;
  }

  /**
   * Fetch detailed commit information including file changes
   */
  async fetchCommitDetails(sha) {
    const url = `${this.baseUrl}/repos/${this.owner}/${this.repo}/commits/${sha}`;
    try {
      const response = await this.makeRequest(url);
      return response.data;
    } catch (error) {
      this.log(
        `Error fetching commit details for ${sha}: ${error.message}`,
        "debug"
      );
      throw error;
    }
  }

  /**
   * Main analysis method with enhanced error handling and request limiting
   */
  async analyzeRepository() {
    this.log(`Starting analysis of ${this.owner}/${this.repo}...`);
    this.log(`Date range: ${this.startDate} to ${this.endDate}`, "verbose");
    this.log(
      `API request limit: ${
        this.requestLimit === -1 ? "unlimited" : this.requestLimit
      }`,
      "verbose"
    );

    // Validate token first
    await this.validateToken();

    // Validate repository access and fetch commits
    const commits = await this.fetchCommits();

    if (commits.length === 0) {
      this.log("No commits found for the specified criteria");
      return this.generateReport();
    }

    // Calculate how many commits we can process with remaining API limit
    const remainingRequests =
      this.requestLimit === -1
        ? commits.length
        : Math.max(0, this.requestLimit - this.requestCount);
    const commitsToProcess = Math.min(commits.length, remainingRequests);

    this.log(
      `Processing ${commitsToProcess} of ${
        commits.length
      } commits (API limit: ${
        this.requestLimit === -1 ? "unlimited" : this.requestLimit
      })`,
      "verbose"
    );

    // Progress bar for detailed commit analysis
    const detailsProgressBar = new ProgressBar(
      commitsToProcess,
      "Analyzing commits: "
    );
    this.log("Fetching detailed commit information with file changes...");

    // Process each commit to get file changes and build tree structure
    for (let i = 0; i < commitsToProcess; i++) {
      const commit = commits[i];
      detailsProgressBar.update(i + 1);

      try {
        // Check request limit before each detailed request
        if (
          this.requestLimit !== -1 &&
          this.requestCount >= this.requestLimit
        ) {
          this.log(
            `Reached API request limit (${this.requestLimit}). Processed ${i} commits with details.`,
            "verbose"
          );
          break;
        }

        const detailedCommit = await this.fetchCommitDetails(commit.sha);

        const processedCommit = {
          sha: commit.sha,
          shortSha: commit.sha.substring(0, 7),
          date: commit.commit.committer.date,
          message: commit.commit.message.split("\n")[0], // First line only
          fullMessage: commit.commit.message,
          author: {
            name: commit.commit.author.name,
            email: commit.commit.author.email,
            login: commit.author?.login || "unknown",
          },
          committer: {
            name: commit.commit.committer.name,
            date: commit.commit.committer.date,
          },
          url: commit.html_url,
          stats: {
            additions: detailedCommit.stats?.additions || 0,
            deletions: detailedCommit.stats?.deletions || 0,
            total: detailedCommit.stats?.total || 0,
          },
          files: (detailedCommit.files || []).map((file) => ({
            filename: file.filename,
            status: file.status, // added, modified, removed, renamed
            additions: file.additions || 0,
            deletions: file.deletions || 0,
            changes: file.changes || 0,
            previousFilename: file.previous_filename || null,
          })),
        };

        this.commits.push(processedCommit);

        // Update file metadata for tree structure
        this.updateFileMetadata(processedCommit);

        // Enhanced rate limiting with adaptive delays
        if (
          i % 10 === 0 &&
          this.rateLimitRemaining &&
          parseInt(this.rateLimitRemaining) < 20
        ) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        } else {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      } catch (error) {
        if (error.message.includes("API request limit reached")) {
          this.log(
            `Reached API request limit. Processed ${i} commits with details.`,
            "verbose"
          );
          break;
        }
        this.log(
          `Skipping commit ${commit.sha} due to error: ${error.message}`,
          "verbose"
        );
        continue;
      }
    }

    detailsProgressBar.complete();
    this.log(
      `Analysis complete. Processed ${this.commits.length} commits with detailed file information.`
    );

    return this.generateReport();
  }

  /**
   * Update file metadata to build the tree structure
   */
  updateFileMetadata(commit) {
    commit.files.forEach((file) => {
      const filename = file.filename;

      if (!this.fileMetadata[filename]) {
        this.fileMetadata[filename] = {
          totalChanges: 0,
          totalAdditions: 0,
          totalDeletions: 0,
          firstChanged: commit.date,
          lastChanged: commit.date,
          statuses: new Set(),
          commitHistory: [],
          fileExtension: this.getFileExtension(filename),
          filePath: this.getFilePath(filename),
          netChanges: 0,
        };
      }

      const fileMeta = this.fileMetadata[filename];
      fileMeta.totalChanges++;
      fileMeta.totalAdditions += file.additions;
      fileMeta.totalDeletions += file.deletions;
      fileMeta.netChanges = fileMeta.totalAdditions - fileMeta.totalDeletions;
      fileMeta.statuses.add(file.status);

      fileMeta.commitHistory.push({
        sha: commit.sha,
        shortSha: commit.shortSha,
        date: commit.date,
        message: commit.message,
        author: commit.author.name,
        authorEmail: commit.author.email,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        changes: file.changes,
      });

      // Update date range
      if (new Date(commit.date) < new Date(fileMeta.firstChanged)) {
        fileMeta.firstChanged = commit.date;
      }
      if (new Date(commit.date) > new Date(fileMeta.lastChanged)) {
        fileMeta.lastChanged = commit.date;
      }
    });
  }

  /**
   * Helper methods for file analysis
   */
  getFileExtension(filename) {
    const parts = filename.split(".");
    return parts.length > 1 ? parts.pop().toLowerCase() : "no-extension";
  }

  getFilePath(filename) {
    const parts = filename.split("/");
    return parts.length > 1 ? parts.slice(0, -1).join("/") : "root";
  }

  /**
   * Generate comprehensive analysis report grouped by user email
   */
  generateReport() {
    // Sort commits chronologically (newest first for timeline view)
    this.commits.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Convert Set to Array for JSON serialization
    Object.values(this.fileMetadata).forEach((meta) => {
      meta.statuses = Array.from(meta.statuses);
      // Sort commit history chronologically (newest first)
      meta.commitHistory.sort((a, b) => new Date(b.date) - new Date(a.date));
    });

    // Generate summary statistics
    const totalFiles = Object.keys(this.fileMetadata).length;
    const totalCommits = this.commits.length;

    // Calculate date range for the analysis
    const actualDateRange = this.calculateActualDateRange();

    // Find most active files
    const mostChangedFiles = Object.entries(this.fileMetadata)
      .sort(([, a], [, b]) => b.totalChanges - a.totalChanges)
      .slice(0, 10)
      .map(([filename, meta]) => ({
        filename,
        changeCount: meta.totalChanges,
        totalAdditions: meta.totalAdditions,
        totalDeletions: meta.totalDeletions,
        netChanges: meta.netChanges,
        firstChanged: meta.firstChanged,
        lastChanged: meta.lastChanged,
        statuses: meta.statuses,
        fileExtension: meta.fileExtension,
        filePath: meta.filePath,
      }));

    // Generate commit timeline merged tree by user email
    const commitTimelineByUserEmail = this.generateCommitTimelineByUserEmail();

    const report = {
      metadata: {
        repository: `${this.owner}/${this.repo}`,
        analysisDate: new Date().toISOString(),
        requestedDateRange: {
          start: this.startDate,
          end: this.endDate,
        },
        actualDateRange,
        totalCommits,
        totalFiles,
        apiRequestsMade: this.requestCount,
        requestLimit: this.requestLimit,
        rateLimitUsed: this.rateLimitRemaining
          ? 5000 - parseInt(this.rateLimitRemaining)
          : "unknown",
      },
      summary: {
        mostChangedFiles,
        commitFrequency: this.calculateCommitFrequency(),
        fileTypeDistribution: this.calculateFileTypeDistribution(),
        authorActivity: this.calculateAuthorActivity(),
      },
      commitTimelineByUserEmail, // Tree structure by user email
      commitTimeline: this.commits, // Original timeline
      fileMetadata: this.fileMetadata, // File metadata
    };

    return report;
  }

  /**
   * Generate commit timeline merged tree by user email
   */
  generateCommitTimelineByUserEmail() {
    const userEmailTree = {};

    this.commits.forEach((commit) => {
      const userEmail = commit.author.email;

      if (!userEmailTree[userEmail]) {
        userEmailTree[userEmail] = {
          authorInfo: {
            name: commit.author.name,
            email: commit.author.email,
            login: commit.author.login,
          },
          commitSummary: {
            totalCommits: 0,
            totalAdditions: 0,
            totalDeletions: 0,
            firstCommit: commit.date,
            lastCommit: commit.date,
            filesModified: new Set(),
          },
          commits: [],
        };
      }

      const userInfo = userEmailTree[userEmail];

      // Update summary statistics
      userInfo.commitSummary.totalCommits++;
      userInfo.commitSummary.totalAdditions += commit.stats.additions;
      userInfo.commitSummary.totalDeletions += commit.stats.deletions;

      // Track files modified by this user
      commit.files.forEach((file) => {
        userInfo.commitSummary.filesModified.add(file.filename);
      });

      // Update date range
      if (
        new Date(commit.date) < new Date(userInfo.commitSummary.firstCommit)
      ) {
        userInfo.commitSummary.firstCommit = commit.date;
      }
      if (new Date(commit.date) > new Date(userInfo.commitSummary.lastCommit)) {
        userInfo.commitSummary.lastCommit = commit.date;
      }

      // Add commit to user's timeline
      userInfo.commits.push(commit);
    });

    // Convert Sets to counts and sort commits
    Object.values(userEmailTree).forEach((userInfo) => {
      userInfo.commitSummary.uniqueFilesModified =
        userInfo.commitSummary.filesModified.size;
      userInfo.commitSummary.netChanges =
        userInfo.commitSummary.totalAdditions -
        userInfo.commitSummary.totalDeletions;
      userInfo.commitSummary.averageChangesPerCommit = Math.round(
        (userInfo.commitSummary.totalAdditions +
          userInfo.commitSummary.totalDeletions) /
          userInfo.commitSummary.totalCommits
      );
      delete userInfo.commitSummary.filesModified;

      // Sort commits chronologically (newest first)
      userInfo.commits.sort((a, b) => new Date(b.date) - new Date(a.date));
    });

    return userEmailTree;
  }

  /**
   * Calculate actual date range from processed commits
   */
  calculateActualDateRange() {
    if (this.commits.length === 0) return null;

    const dates = this.commits.map((c) => new Date(c.date));
    const earliest = new Date(Math.min(...dates));
    const latest = new Date(Math.max(...dates));

    return {
      start: earliest.toISOString().split("T")[0],
      end: latest.toISOString().split("T")[0],
      durationDays: Math.ceil((latest - earliest) / (1000 * 60 * 60 * 24)),
    };
  }

  /**
   * Calculate commit frequency by date
   */
  calculateCommitFrequency() {
    const frequency = {};
    this.commits.forEach((commit) => {
      const date = commit.date.split("T")[0];
      frequency[date] = (frequency[date] || 0) + 1;
    });
    return frequency;
  }

  /**
   * Calculate file type distribution
   */
  calculateFileTypeDistribution() {
    const distribution = {};
    Object.values(this.fileMetadata).forEach((meta) => {
      const ext = meta.fileExtension;
      distribution[ext] = (distribution[ext] || 0) + 1;
    });
    return distribution;
  }

  /**
   * Calculate author activity metrics
   */
  calculateAuthorActivity() {
    const activity = {};
    this.commits.forEach((commit) => {
      const author = commit.author.email; // Group by email for consistency
      if (!activity[author]) {
        activity[author] = {
          name: commit.author.name,
          email: commit.author.email,
          login: commit.author.login,
          commitCount: 0,
          totalAdditions: 0,
          totalDeletions: 0,
          filesChanged: new Set(),
          firstCommit: commit.date,
          lastCommit: commit.date,
        };
      }

      const authorStats = activity[author];
      authorStats.commitCount++;
      authorStats.totalAdditions += commit.stats.additions;
      authorStats.totalDeletions += commit.stats.deletions;

      commit.files.forEach((file) => {
        authorStats.filesChanged.add(file.filename);
      });

      // Update date range
      if (new Date(commit.date) < new Date(authorStats.firstCommit)) {
        authorStats.firstCommit = commit.date;
      }
      if (new Date(commit.date) > new Date(authorStats.lastCommit)) {
        authorStats.lastCommit = commit.date;
      }
    });

    // Convert Set to count and add productivity metrics
    Object.values(activity).forEach((stats) => {
      stats.uniqueFilesChanged = stats.filesChanged.size;
      stats.netChanges = stats.totalAdditions - stats.totalDeletions;
      stats.averageChangesPerCommit = Math.round(
        (stats.totalAdditions + stats.totalDeletions) / stats.commitCount
      );
      delete stats.filesChanged;
    });

    return activity;
  }

  /**
   * Export report to CSV format
   */
  exportToCSV(report) {
    const csvLines = [];

    // Header
    csvLines.push(
      [
        "Date",
        "SHA",
        "Short_SHA",
        "Author",
        "Author_Email",
        "Author_Login",
        "Message",
        "Total_Additions",
        "Total_Deletions",
        "Net_Changes",
        "Filename",
        "File_Status",
        "File_Additions",
        "File_Deletions",
        "File_Changes",
        "File_Extension",
        "File_Path",
      ].join(",")
    );

    // Data rows
    report.commitTimeline.forEach((commit) => {
      if (commit.files.length === 0) {
        // Commit with no files
        const row = [
          commit.date,
          commit.sha,
          commit.shortSha,
          `"${commit.author.name.replace(/"/g, '""')}"`,
          `"${commit.author.email}"`,
          `"${commit.author.login}"`,
          `"${commit.message.replace(/"/g, '""')}"`,
          commit.stats.additions,
          commit.stats.deletions,
          commit.stats.additions - commit.stats.deletions,
          "",
          "",
          "",
          "",
          "",
          "",
          "",
        ];
        csvLines.push(row.join(","));
      } else {
        // Commit with files
        commit.files.forEach((file) => {
          const row = [
            commit.date,
            commit.sha,
            commit.shortSha,
            `"${commit.author.name.replace(/"/g, '""')}"`,
            `"${commit.author.email}"`,
            `"${commit.author.login}"`,
            `"${commit.message.replace(/"/g, '""')}"`,
            commit.stats.additions,
            commit.stats.deletions,
            commit.stats.additions - commit.stats.deletions,
            `"${file.filename}"`,
            file.status,
            file.additions,
            file.deletions,
            file.changes,
            `"${report.fileMetadata[file.filename]?.fileExtension || ""}"`,
            `"${report.fileMetadata[file.filename]?.filePath || ""}"`,
          ];
          csvLines.push(row.join(","));
        });
      }
    });

    return csvLines.join("\n");
  }
}

/**
 * CLI Argument Parser with enhanced validation
 */
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
    limit: 200,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case "-r":
      case "--repo":
        if (!nextArg || nextArg.startsWith("-")) {
          throw new Error("Repository argument is required after -r/--repo");
        }
        if (!nextArg.includes("/")) {
          throw new Error('Repository must be in format "owner/repo"');
        }
        options.repo = nextArg;
        i++;
        break;
      case "-f":
      case "--format":
        if (!nextArg || !["json", "csv"].includes(nextArg)) {
          throw new Error('Format must be "json" or "csv"');
        }
        options.format = nextArg;
        i++;
        break;
      case "-o":
      case "--output":
        if (!nextArg || nextArg.startsWith("-")) {
          throw new Error("Output filename is required after -o/--output");
        }
        options.output = nextArg;
        i++;
        break;
      case "-s":
      case "--start":
        if (!nextArg || !isValidDate(nextArg)) {
          throw new Error("Start date must be in format YYYY-MM-DD");
        }
        options.start = nextArg;
        i++;
        break;
      case "-e":
      case "--end":
        if (!nextArg || !isValidDate(nextArg)) {
          throw new Error("End date must be in format YYYY-MM-DD");
        }
        options.end = nextArg;
        i++;
        break;
      case "-t":
      case "--token":
        if (!nextArg || nextArg.startsWith("-")) {
          throw new Error("Token is required after -t/--token");
        }
        options.token = nextArg;
        i++;
        break;
      case "-l":
      case "--limit":
        if (!nextArg) {
          throw new Error("Limit value is required after -l/--limit");
        }
        const limitValue = parseInt(nextArg);
        if (limitValue === -1) {
          options.limit = -1; // Infinite
        } else if (isNaN(limitValue) || limitValue < 1) {
          throw new Error(
            "Limit must be a positive number or -1 for unlimited"
          );
        } else {
          options.limit = limitValue;
        }
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
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown option: ${arg}`);
        }
    }
  }

  return options;
}

/**
 * Validate date format (YYYY-MM-DD)
 */
function isValidDate(dateString) {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateString)) return false;

  const date = new Date(dateString + "T00:00:00Z");
  return date instanceof Date && !isNaN(date);
}

/**
 * Show comprehensive help information
 */
function showHelp() {
  console.log(`
🔍 GitHub Repository Analyzer - Commit Timeline & File Change Analysis

USAGE:
  node main.mjs -r <owner/repo> [options]

REQUIRED:
  -r, --repo <owner/repo>           Repository to analyze (format: owner/repo)

OPTIONS:
  -f, --format <format>             Output format: json (default) or csv
  -o, --output <filename>           Output filename (auto-generated if not provided)
  -s, --start <date>                Start date (ISO format: YYYY-MM-DD) default: -30 days
  -e, --end <date>                  End date (ISO format: YYYY-MM-DD) default: now
  -t, --token <token>               GitHub personal access token
  -l, --limit <number>              API request limit (default: 200, use -1 for unlimited)
  -v, --verbose                     Enable verbose logging
  -d, --debug                       Enable debug logging
  -h, --help                        Show this help message

ENVIRONMENT VARIABLES:
  GITHUB_TOKEN                      GitHub personal access token (alternative to -t)

EXAMPLES:
  # Basic analysis with default 200 API request limit and 30-day range
  node main.mjs -r microsoft/vscode

  # Unlimited API requests for complete analysis
  node main.mjs -r facebook/react --limit -1

  # Date range analysis with 500 API request limit
  node main.mjs -r owner/repo -s 2024-01-01 -e 2024-01-31 --limit 500

  # CSV output with custom filename
  node main.mjs -r owner/repo -f csv -o my-analysis.csv

REPORT FEATURES:
  📊 Commit Timeline by User Email  - Tree structure grouped by author email
  📁 File Change Tracking          - Detailed file modification history  
  🌳 Merged Tree View              - Combined view of user commits and files
  👥 Author Contribution           - Developer activity and patterns
  📈 Development Velocity          - Trends and productivity metrics
  🔢 API Request Management        - Configurable limits to control analysis scope

TOKEN SETUP:
  1. Go to GitHub Settings > Developer settings > Personal access tokens
  2. Generate new token with 'repo' scope for private repos or 'public_repo' for public
  3. Use with -t flag or set GITHUB_TOKEN environment variable

RATE LIMITS & API USAGE:
  • Authenticated: 5,000 requests/hour
  • Default limit: 200 requests (balances speed vs. completeness)
  • Use --limit -1 for unlimited requests (may take longer for large repos)
  • Tool includes automatic rate limiting and retry logic
`);
}

/**
 * Generate automatic output filename
 */
function generateOutputFilename(repo, format, dateRange) {
  const repoName = repo.replace("/", "-");
  const timestamp = new Date().toISOString().split("T")[0];
  const range = dateRange ? `-${dateRange.start}-to-${dateRange.end}` : "";
  return `${repoName}-analysis${range}-${timestamp}.${format}`;
}

/**
 * Format file size for display
 */
function formatFileSize(bytes) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

/**
 * Main execution function with comprehensive error handling
 */
async function main() {
  try {
    const options = parseArguments();

    if (options.help) {
      showHelp();
      process.exit(0);
    }

    if (!options.repo) {
      console.error("❌ Error: Repository is required. Use -r or --repo flag.");
      console.error("Run with --help for usage information.");
      process.exit(1);
    }

    // Validate date range
    if (
      options.start &&
      options.end &&
      new Date(options.start) > new Date(options.end)
    ) {
      console.error("❌ Error: Start date must be before end date.");
      process.exit(1);
    }

    const [owner, repo] = options.repo.split("/");

    if (!owner || !repo) {
      console.error('❌ Error: Repository must be in format "owner/repo".');
      process.exit(1);
    }

    const analyzer = new GitHubAnalyzer(
      repo,
      owner,
      options.start,
      options.end,
      options.token,
      {
        verbose: options.verbose,
        debug: options.debug,
        requestLimit: options.limit,
      }
    );

    console.log(`🔍 Analyzing repository: ${options.repo}`);
    console.log(`📅 Date range: ${analyzer.startDate} to ${analyzer.endDate}`);
    console.log(`📊 Format: ${options.format.toUpperCase()}`);
    console.log(
      `🔢 API Request Limit: ${
        options.limit === -1 ? "Unlimited" : options.limit
      }`
    );
    console.log("");

    const startTime = Date.now();
    const report = await analyzer.analyzeRepository();
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(1);

    // Generate output filename if not provided
    const outputFilename =
      options.output ||
      generateOutputFilename(
        options.repo,
        options.format,
        options.start && options.end
          ? { start: options.start, end: options.end }
          : { start: analyzer.startDate, end: analyzer.endDate }
      );

    // Export data in requested format
    let outputData;
    if (options.format === "csv") {
      outputData = analyzer.exportToCSV(report);
    } else {
      outputData = JSON.stringify(report, null, 2);
    }

    fs.writeFileSync(outputFilename, outputData);
    const fileSize = fs.statSync(outputFilename).size;

    // Display comprehensive summary
    console.log(`\n✅ Analysis complete! (${duration}s)`);
    console.log(
      `📁 Output saved to: ${outputFilename} (${formatFileSize(fileSize)})`
    );

    console.log(`\n📊 Repository Analysis Summary:`);
    console.log(`   🏠 Repository: ${report.metadata.repository}`);
    console.log(
      `   📝 Total commits analyzed: ${report.metadata.totalCommits}`
    );
    console.log(`   📂 Total files tracked: ${report.metadata.totalFiles}`);
    console.log(`   🌐 API requests made: ${report.metadata.apiRequestsMade}`);
    console.log(
      `   🔢 Request limit: ${
        report.metadata.requestLimit === -1
          ? "Unlimited"
          : report.metadata.requestLimit
      }`
    );
    console.log(`   ⚡ Rate limit used: ${report.metadata.rateLimitUsed}`);

    if (report.metadata.actualDateRange) {
      console.log(
        `   📅 Analysis period: ${report.metadata.actualDateRange.start} to ${report.metadata.actualDateRange.end}`
      );
      console.log(
        `   📏 Duration: ${report.metadata.actualDateRange.durationDays} days`
      );
    }

    // Show commit timeline by user email summary
    const userEmailCount = Object.keys(report.commitTimelineByUserEmail).length;
    console.log(
      `\n👥 Commit Timeline by User Email (${userEmailCount} unique authors):`
    );

    const topUsers = Object.entries(report.commitTimelineByUserEmail)
      .sort(
        ([, a], [, b]) =>
          b.commitSummary.totalCommits - a.commitSummary.totalCommits
      )
      .slice(0, 5);

    topUsers.forEach(([email, userInfo], index) => {
      console.log(`   ${index + 1}. ${userInfo.authorInfo.name} (${email})`);
      console.log(
        `      📝 ${userInfo.commitSummary.totalCommits} commits, +${
          userInfo.commitSummary.totalAdditions
        }/-${userInfo.commitSummary.totalDeletions} (net: ${
          userInfo.commitSummary.netChanges >= 0 ? "+" : ""
        }${userInfo.commitSummary.netChanges})`
      );
      console.log(
        `      📂 ${userInfo.commitSummary.uniqueFilesModified} files modified, avg ${userInfo.commitSummary.averageChangesPerCommit} changes/commit`
      );
    });

    if (report.summary.mostChangedFiles.length > 0) {
      console.log(`\n🔥 Most frequently changed files:`);
      report.summary.mostChangedFiles.slice(0, 5).forEach((file, index) => {
        console.log(`   ${index + 1}. ${file.filename}`);
        console.log(
          `      📊 ${file.changeCount} changes, +${file.totalAdditions}/-${
            file.totalDeletions
          } (net: ${file.netChanges >= 0 ? "+" : ""}${file.netChanges})`
        );
      });
    }

    console.log(
      `\n💡 Use the generated ${options.format.toUpperCase()} file for detailed analysis and visualization.`
    );
    console.log(
      `   The report includes commit timeline by user email (merged tree structure) and file metadata for tracking changes over time.`
    );
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);

    if (error.message.includes("token")) {
      console.error(`\n🔑 Token Help:`);
      console.error(`   • Set GITHUB_TOKEN environment variable`);
      console.error(`   • Or use -t flag with your personal access token`);
      console.error(
        `   • Generate token at: https://github.com/settings/tokens`
      );
      console.error(
        `   • Required scopes: 'repo' (private) or 'public_repo' (public only)`
      );
    }

    if (error.message.includes("not found")) {
      console.error(`\n🔍 Repository Help:`);
      console.error(`   • Check repository name spelling`);
      console.error(`   • Ensure format is "owner/repo"`);
      console.error(`   • Verify you have access to the repository`);
      console.error(
        `   • For private repos, ensure token has proper permissions`
      );
    }

    if (error.message.includes("API request limit reached")) {
      console.error(`\n🔢 API Limit Help:`);
      console.error(`   • Increase limit with --limit <number>`);
      console.error(`   • Use --limit -1 for unlimited requests`);
      console.error(`   • Current analysis may be incomplete due to limit`);
    }

    if (process.argv.includes("--debug") || process.argv.includes("-d")) {
      console.error(`\n🐛 Debug Information:\n${error.stack}`);
    }

    process.exit(1);
  }
}

// Execute the CLI with error handling
main().catch((error) => {
  console.error(`💥 Unexpected error: ${error.message}`);
  console.error(
    `Please report this issue with the --debug flag for more details.`
  );
  process.exit(1);
});
