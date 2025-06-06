#!/usr/bin/env node

import { writeFile } from "fs/promises";
import { program } from "commander";
import fetch from "node-fetch";
import { createObjectCsvWriter } from "csv-writer";
import chalk from "chalk";

class GitHubReporter {
  constructor(token, options = {}) {
    this.token = token;
    this.baseUrl = "https://api.github.com";
    this.options = {
      verbose: options.verbose || false,
      debug: options.debug || false,
      retryAttempts: options.retryAttempts || 3,
      retryDelay: options.retryDelay || 1000,
      rateLimit: options.rateLimit || true,
    };
    this.rateLimitRemaining = 5000;
    this.rateLimitReset = Date.now();
  }

  log(message, level = "info") {
    const timestamp = new Date().toISOString();
    const colors = {
      error: chalk.red,
      warn: chalk.yellow,
      info: chalk.blue,
      success: chalk.green,
      debug: chalk.gray,
    };

    if (level === "debug" && !this.options.debug) return;
    if (level === "verbose" && !this.options.verbose && !this.options.debug)
      return;

    console.log(
      `${
        colors[level] || chalk.white
      }[${timestamp}] ${level.toUpperCase()}: ${message}`
    );
  }

  createSimpleProgressBar(current, total, label = "Progress") {
    const percentage = Math.round((current / total) * 100);
    const barLength = 40;
    const filledLength = Math.round((barLength * current) / total);
    const bar = "█".repeat(filledLength) + "░".repeat(barLength - filledLength);

    process.stdout.write(
      `\r${chalk.blue(label)} [${chalk.cyan(
        bar
      )}] ${percentage}% (${current}/${total})`
    );

    if (current === total) {
      process.stdout.write("\n");
    }
  }

  async makeRequest(url, options = {}) {
    const headers = {
      Authorization: `token ${this.token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "GitHub-Reporter-CLI/1.0.0",
      ...options.headers,
    };

    for (let attempt = 1; attempt <= this.options.retryAttempts; attempt++) {
      try {
        if (this.options.rateLimit && this.rateLimitRemaining <= 10) {
          const waitTime = Math.max(0, this.rateLimitReset - Date.now());
          if (waitTime > 0) {
            this.log(
              `Rate limit approaching. Waiting ${Math.ceil(
                waitTime / 1000
              )} seconds...`,
              "warn"
            );
            await this.sleep(waitTime);
          }
        }

        this.log(`Making request to: ${url} (attempt ${attempt})`, "debug");

        const response = await fetch(url, { ...options, headers });

        this.rateLimitRemaining = parseInt(
          response.headers.get("x-ratelimit-remaining") || "5000"
        );
        this.rateLimitReset =
          parseInt(
            response.headers.get("x-ratelimit-reset") || Date.now() / 1000
          ) * 1000;

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error(
              `Repository not found or not accessible: ${response.status}`
            );
          }
          if (response.status === 403) {
            const resetTime = new Date(this.rateLimitReset).toISOString();
            throw new Error(`Rate limit exceeded. Resets at: ${resetTime}`);
          }
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return response;
      } catch (error) {
        this.log(
          `Request failed (attempt ${attempt}): ${error.message}`,
          "error"
        );

        if (attempt === this.options.retryAttempts) {
          throw error;
        }

        await this.sleep(this.options.retryDelay * attempt);
      }
    }
  }

  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async fetchAllPages(baseUrl, params = {}) {
    const results = [];
    let page = 1;
    let hasNextPage = true;
    let totalPages = 1;

    while (hasNextPage) {
      const url = new URL(baseUrl);
      Object.entries({ ...params, page, per_page: 100 }).forEach(
        ([key, value]) => {
          if (value !== undefined && value !== null) {
            url.searchParams.set(key, value);
          }
        }
      );

      try {
        const response = await this.makeRequest(url.toString());
        const data = await response.json();

        if (Array.isArray(data)) {
          results.push(...data);
        } else {
          results.push(data);
        }

        const linkHeader = response.headers.get("link");
        hasNextPage = linkHeader && linkHeader.includes('rel="next"');

        if (linkHeader && linkHeader.includes('rel="last"')) {
          const lastPageMatch = linkHeader.match(/page=(\d+).*rel="last"/);
          if (lastPageMatch) {
            totalPages = parseInt(lastPageMatch[1]);
          }
        }

        this.createSimpleProgressBar(page, totalPages, "Fetching pages");
        page++;

        this.log(
          `Fetched page ${page - 1}, got ${
            Array.isArray(data) ? data.length : 1
          } items`,
          "verbose"
        );
      } catch (error) {
        process.stdout.write("\n");
        throw error;
      }
    }

    return results;
  }

  analyzeCommitMessage(message) {
    const patterns = {
      qualityKeywords: [
        "fix",
        "bug",
        "error",
        "issue",
        "patch",
        "hotfix",
        "critical",
        "test",
        "tests",
        "testing",
        "unit test",
        "integration test",
        "e2e",
        "coverage",
        "validation",
        "security",
        "vulnerability",
      ],
      docKeywords: [
        "docs",
        "documentation",
        "readme",
        "comment",
        "comments",
        "docstring",
        "guide",
        "tutorial",
      ],
      refactorKeywords: [
        "refactor",
        "optimize",
        "improve",
        "enhance",
        "cleanup",
        "clean up",
      ],
      mergePatterns: [
        "merge",
        "merge pull request",
        "merge branch",
        "auto-merge",
        "dependabot",
        "renovate",
        "bump",
        "update dependencies",
      ],
    };

    const lowerMessage = message.toLowerCase();

    const hasQualityIndicators = patterns.qualityKeywords.some((keyword) =>
      lowerMessage.includes(keyword.toLowerCase())
    );

    const hasDocIndicators = patterns.docKeywords.some((keyword) =>
      lowerMessage.includes(keyword.toLowerCase())
    );

    const hasRefactorIndicators = patterns.refactorKeywords.some((keyword) =>
      lowerMessage.includes(keyword.toLowerCase())
    );

    const isMergeCommit = patterns.mergePatterns.some((pattern) =>
      lowerMessage.includes(pattern.toLowerCase())
    );

    const conventionalRegex =
      /^(feat|fix|docs|style|refactor|test|chore|perf|ci|build|revert)(\(.+\))?: .+/;
    const isConventional = conventionalRegex.test(message);

    const wordCount = message.split(/\s+/).length;
    const hasCodeTerms =
      /`[^`]+`|```[\s\S]*```|function|class|const|let|var|import|export/.test(
        message
      );
    const hasFileReferences =
      /\.(js|ts|py|java|cpp|c|h|css|html|json|md|txt|yml|yaml|xml)(\s|$|:)/i.test(
        message
      );

    return {
      messageLength: message.length,
      wordCount,
      hasQualityIndicators,
      hasDocIndicators,
      hasRefactorIndicators,
      isMergeCommit,
      isConventional,
      hasCodeTerms,
      hasFileReferences,
    };
  }

  analyzeCommitContent(commit) {
    const stats = commit.stats || {};
    const files = commit.files || [];

    let testFiles = 0;
    let configFiles = 0;
    let documentationFiles = 0;
    let codeFiles = 0;

    files.forEach((file) => {
      const filename = file.filename.toLowerCase();

      if (
        filename.includes("test") ||
        filename.includes("spec") ||
        filename.includes("__tests__")
      ) {
        testFiles++;
      } else if (
        filename.includes("config") ||
        filename.includes("package.json") ||
        filename.includes("package-lock.json") ||
        filename.includes("yarn.lock") ||
        filename.includes(".env") ||
        filename.includes("dockerfile") ||
        filename.includes("docker-compose") ||
        filename.endsWith(".yml") ||
        filename.endsWith(".yaml")
      ) {
        configFiles++;
      } else if (
        filename.includes("readme") ||
        filename.includes("doc") ||
        filename.endsWith(".md") ||
        filename.endsWith(".rst") ||
        filename.endsWith(".txt")
      ) {
        documentationFiles++;
      } else {
        codeFiles++;
      }
    });

    const totalChanges = stats.additions + stats.deletions;

    return {
      totalAdditions: stats.additions || 0,
      totalDeletions: stats.deletions || 0,
      totalFiles: files.length,
      testFiles,
      configFiles,
      documentationFiles,
      codeFiles,
      avgChangesPerFile: files.length > 0 ? totalChanges / files.length : 0,
      fileExtensionDiversity: new Set(
        files.map((f) => this.getFileExtension(f.filename))
      ).size,
      isLargeChangeset: totalChanges > 100,
      isSmallChangeset: totalChanges <= 10,
      hasMultipleFileTypes:
        new Set(files.map((f) => this.getFileExtension(f.filename))).size > 3,
    };
  }

  getFileExtension(filename) {
    const parts = filename.split(".");
    return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
  }

  async fetchPullRequests(owner, repo, startDate, endDate) {
    try {
      const prs = await this.fetchAllPages(
        `${this.baseUrl}/repos/${owner}/${repo}/pulls`,
        {
          state: "all",
          sort: "updated",
          direction: "desc",
        }
      );

      // Filter PRs by date range
      const filteredPrs = prs.filter((pr) => {
        const prDate = new Date(pr.created_at);
        const start = new Date(startDate);
        const end = new Date(endDate);
        return prDate >= start && prDate <= end;
      });

      return filteredPrs;
    } catch (error) {
      this.log(`Failed to fetch pull requests: ${error.message}`, "warn");
      return [];
    }
  }

  async generateProductivityReport(owner, repo, startDate, endDate, token) {
    this.log(`Starting productivity analysis for ${owner}/${repo}`, "info");
    this.log(`Date range: ${startDate} to ${endDate}`, "info");

    try {
      // Fetch commits with pagination
      const commits = await this.fetchAllPages(
        `${this.baseUrl}/repos/${owner}/${repo}/commits`,
        { since: startDate, until: endDate }
      );

      this.log(`Found ${commits.length} commits in date range`, "success");

      // Fetch pull requests
      const prs = await this.fetchPullRequests(owner, repo, startDate, endDate);
      this.log(`Found ${prs.length} pull requests in date range`, "success");

      if (commits.length === 0) {
        return {
          repository: `${owner}/${repo}`,
          dateRange: { start: startDate, end: endDate },
          totalCommits: 0,
          totalPullRequests: 0,
          summary: this.generateSummary([], [], startDate, endDate),
          commits: [],
          pullRequests: [],
          userSegmentation: {},
          teamMetrics: {},
        };
      }

      // Analyze commits in detail
      const analysisResults = [];
      this.log("Analyzing commit details...", "info");

      for (let i = 0; i < commits.length; i++) {
        const commit = commits[i];

        this.createSimpleProgressBar(
          i + 1,
          commits.length,
          "Analyzing commits"
        );

        try {
          const detailResponse = await this.makeRequest(
            `${this.baseUrl}/repos/${owner}/${repo}/commits/${commit.sha}`
          );
          const detailedCommit = await detailResponse.json();

          const messageAnalysis = this.analyzeCommitMessage(
            commit.commit.message
          );
          const contentAnalysis = this.analyzeCommitContent(detailedCommit);

          const analysis = {
            sha: commit.sha,
            author: commit.commit.author.name,
            authorEmail: commit.commit.author.email,
            date: commit.commit.author.date,
            message: commit.commit.message,
            url: commit.html_url,
            ...messageAnalysis,
            ...contentAnalysis,
            linesPerCommit:
              contentAnalysis.totalAdditions + contentAnalysis.totalDeletions,
          };

          analysisResults.push(analysis);
        } catch (error) {
          this.log(
            `Failed to analyze commit ${commit.sha}: ${error.message}`,
            "warn"
          );
        }
      }

      // Generate user segmentation and team metrics
      const userSegmentation = this.generateUserSegmentation(
        analysisResults,
        prs,
        startDate,
        endDate
      );
      const teamMetrics = this.generateTeamMetrics(
        analysisResults,
        prs,
        userSegmentation
      );
      const summary = this.generateSummary(
        analysisResults,
        prs,
        startDate,
        endDate
      );

      return {
        repository: `${owner}/${repo}`,
        dateRange: { start: startDate, end: endDate },
        totalCommits: analysisResults.length,
        totalPullRequests: prs.length,
        summary,
        commits: analysisResults,
        pullRequests: prs,
        userSegmentation,
        teamMetrics,
      };
    } catch (error) {
      this.log(`Analysis failed: ${error.message}`, "error");
      throw error;
    }
  }

  generateUserSegmentation(commits, prs, startDate, endDate) {
    const userStats = {};

    // Process commits by user
    commits.forEach((commit) => {
      const email = commit.authorEmail;
      if (!userStats[email]) {
        userStats[email] = {
          name: commit.author,
          email: email,
          commits: 0,
          additions: 0,
          deletions: 0,
          pullRequests: 0,
          mergedPRs: 0,
          filesChanged: 0,
          avgCommitSize: 0,
          workingDays: new Set(),
          commitsByWeek: {},
          commitsByHour: Array(24).fill(0),
          qualityCommits: 0,
          refactorCommits: 0,
          testCommits: 0,
          docCommits: 0,
        };
      }

      const user = userStats[email];
      user.commits++;
      user.additions += commit.totalAdditions;
      user.deletions += commit.totalDeletions;
      user.filesChanged += commit.totalFiles;

      // Quality indicators
      if (commit.hasQualityIndicators) user.qualityCommits++;
      if (commit.hasRefactorIndicators) user.refactorCommits++;
      if (commit.testFiles > 0) user.testCommits++;
      if (commit.hasDocIndicators) user.docCommits++;

      // Time-based analysis
      const commitDate = new Date(commit.date);
      const dayKey = commitDate.toISOString().split("T")[0];
      user.workingDays.add(dayKey);

      const hour = commitDate.getHours();
      user.commitsByHour[hour]++;

      const weekKey = this.getWeekKey(commitDate);
      user.commitsByWeek[weekKey] = (user.commitsByWeek[weekKey] || 0) + 1;
    });

    // Process PRs by user
    prs.forEach((pr) => {
      const userEmail = pr.user.email || `${pr.user.login}@github.local`;
      if (userStats[userEmail]) {
        userStats[userEmail].pullRequests++;
        if (pr.merged_at) {
          userStats[userEmail].mergedPRs++;
        }
      }
    });

    // Calculate derived metrics
    Object.values(userStats).forEach((user) => {
      user.avgCommitSize =
        user.commits > 0 ? (user.additions + user.deletions) / user.commits : 0;
      user.workingDaysCount = user.workingDays.size;
      user.commitsPerWorkingDay =
        user.workingDaysCount > 0 ? user.commits / user.workingDaysCount : 0;
      user.prMergeRate =
        user.pullRequests > 0 ? (user.mergedPRs / user.pullRequests) * 100 : 0;
      user.qualityScore =
        user.commits > 0
          ? ((user.qualityCommits + user.testCommits) / user.commits) * 100
          : 0;
    });

    return userStats;
  }

  generateTeamMetrics(commits, prs, userSegmentation) {
    const totalUsers = Object.keys(userSegmentation).length;
    const totalCommits = commits.length;
    const totalPRs = prs.length;

    const teamMetrics = {
      teamSize: totalUsers,
      totalCommits,
      totalPullRequests: totalPRs,

      // Normalized metrics (per developer)
      avgCommitsPerDeveloper: totalUsers > 0 ? totalCommits / totalUsers : 0,
      avgPRsPerDeveloper: totalUsers > 0 ? totalPRs / totalUsers : 0,
      avgLinesPerDeveloper:
        totalUsers > 0
          ? commits.reduce((sum, c) => sum + c.linesPerCommit, 0) / totalUsers
          : 0,

      // Collaboration metrics
      collaborationScore: this.calculateCollaborationScore(userSegmentation),
      codeReviewParticipation: this.calculateReviewParticipation(prs),

      // Quality metrics
      teamQualityScore: this.calculateTeamQualityScore(userSegmentation),
      testCoverage: this.calculateTestCoverage(commits),

      // Velocity metrics
      weeklyVelocity: this.calculateWeeklyVelocity(commits),
      commitSizeDistribution: this.calculateCommitSizeDistribution(commits),

      // Time-based patterns
      workingTimeDistribution:
        this.calculateWorkingTimeDistribution(userSegmentation),
      productivityPatterns:
        this.calculateProductivityPatterns(userSegmentation),
    };

    return teamMetrics;
  }

  calculateCollaborationScore(userSegmentation) {
    const users = Object.values(userSegmentation);
    if (users.length === 0) return 0;

    const avgPRsPerUser =
      users.reduce((sum, user) => sum + user.pullRequests, 0) / users.length;
    const activeDevelopers = users.filter((user) => user.commits > 0).length;

    return {
      avgPRsPerUser: Math.round(avgPRsPerUser * 100) / 100,
      activeDeveloperRatio: (activeDevelopers / users.length) * 100,
      collaborationIndex: Math.min(
        100,
        ((avgPRsPerUser * activeDevelopers) / users.length) * 10
      ),
    };
  }

  calculateReviewParticipation(prs) {
    const reviewers = new Set();
    const prAuthors = new Set();

    prs.forEach((pr) => {
      prAuthors.add(pr.user.login);
      // Note: Would need additional API calls to get reviewers
    });

    return {
      uniquePRAuthors: prAuthors.size,
      avgPRsPerAuthor: prAuthors.size > 0 ? prs.length / prAuthors.size : 0,
    };
  }

  calculateTeamQualityScore(userSegmentation) {
    const users = Object.values(userSegmentation);
    if (users.length === 0) return 0;

    const avgQualityScore =
      users.reduce((sum, user) => sum + user.qualityScore, 0) / users.length;
    const testContributors = users.filter(
      (user) => user.testCommits > 0
    ).length;
    const docContributors = users.filter((user) => user.docCommits > 0).length;

    return {
      avgQualityScore: Math.round(avgQualityScore * 100) / 100,
      testContributorRatio: (testContributors / users.length) * 100,
      docContributorRatio: (docContributors / users.length) * 100,
    };
  }

  calculateTestCoverage(commits) {
    const testCommits = commits.filter((commit) => commit.testFiles > 0).length;
    return commits.length > 0 ? (testCommits / commits.length) * 100 : 0;
  }

  calculateWeeklyVelocity(commits) {
    const weeklyData = {};

    commits.forEach((commit) => {
      const weekKey = this.getWeekKey(new Date(commit.date));
      if (!weeklyData[weekKey]) {
        weeklyData[weekKey] = {
          commits: 0,
          additions: 0,
          deletions: 0,
          files: 0,
        };
      }
      weeklyData[weekKey].commits++;
      weeklyData[weekKey].additions += commit.totalAdditions;
      weeklyData[weekKey].deletions += commit.totalDeletions;
      weeklyData[weekKey].files += commit.totalFiles;
    });

    const weeks = Object.values(weeklyData);
    return {
      avgCommitsPerWeek:
        weeks.length > 0
          ? weeks.reduce((sum, week) => sum + week.commits, 0) / weeks.length
          : 0,
      avgLinesPerWeek:
        weeks.length > 0
          ? weeks.reduce(
              (sum, week) => sum + week.additions + week.deletions,
              0
            ) / weeks.length
          : 0,
      weeklyData,
    };
  }

  calculateCommitSizeDistribution(commits) {
    const small = commits.filter((c) => c.isSmallChangeset).length;
    const large = commits.filter((c) => c.isLargeChangeset).length;
    const medium = commits.length - small - large;

    return {
      small: { count: small, percentage: (small / commits.length) * 100 },
      medium: { count: medium, percentage: (medium / commits.length) * 100 },
      large: { count: large, percentage: (large / commits.length) * 100 },
    };
  }

  calculateWorkingTimeDistribution(userSegmentation) {
    const users = Object.values(userSegmentation);
    const hourlyTotals = Array(24).fill(0);

    users.forEach((user) => {
      user.commitsByHour.forEach((count, hour) => {
        hourlyTotals[hour] += count;
      });
    });

    const workingHours = hourlyTotals.slice(9, 18).reduce((a, b) => a + b, 0);
    const totalCommits = hourlyTotals.reduce((a, b) => a + b, 0);

    return {
      hourlyDistribution: hourlyTotals,
      workingHoursPercentage:
        totalCommits > 0 ? (workingHours / totalCommits) * 100 : 0,
      peakHour: hourlyTotals.indexOf(Math.max(...hourlyTotals)),
    };
  }

  calculateProductivityPatterns(userSegmentation) {
    const users = Object.values(userSegmentation);

    return {
      avgWorkingDaysPerUser:
        users.length > 0
          ? users.reduce((sum, user) => sum + user.workingDaysCount, 0) /
            users.length
          : 0,
      avgCommitsPerWorkingDay:
        users.length > 0
          ? users.reduce((sum, user) => sum + user.commitsPerWorkingDay, 0) /
            users.length
          : 0,
      mostProductiveUsers: users
        .sort((a, b) => b.commitsPerWorkingDay - a.commitsPerWorkingDay)
        .slice(0, 5)
        .map((user) => ({
          name: user.name,
          email: user.email,
          commitsPerWorkingDay:
            Math.round(user.commitsPerWorkingDay * 100) / 100,
        })),
    };
  }

  getWeekKey(date) {
    const year = date.getFullYear();
    const week = this.getWeekNumber(date);
    return `${year}-W${week.toString().padStart(2, "0")}`;
  }

  getWeekNumber(date) {
    const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
    const pastDaysOfYear = (date - firstDayOfYear) / 86400000;
    return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
  }

  generateSummary(commits, prs, startDate, endDate) {
    if (commits.length === 0) {
      return {
        totalCommits: 0,
        totalPullRequests: prs.length,
        dateRange: `${startDate} to ${endDate}`,
        message: "No commits found in the specified date range",
      };
    }

    const uniqueAuthors = new Set(commits.map((c) => c.authorEmail)).size;

    return {
      dateRange: `${startDate} to ${endDate}`,
      totalCommits: commits.length,
      totalPullRequests: prs.length,
      uniqueAuthors,

      // Productivity metrics
      avgCommitsPerAuthor:
        Math.round((commits.length / uniqueAuthors) * 100) / 100,
      avgPRsPerAuthor: Math.round((prs.length / uniqueAuthors) * 100) / 100,

      // Message characteristics
      avgMessageLength:
        Math.round(
          (commits.reduce((sum, c) => sum + c.messageLength, 0) /
            commits.length) *
            100
        ) / 100,
      conventionalCommits: commits.filter((c) => c.isConventional).length,
      conventionalCommitPercentage:
        Math.round(
          (commits.filter((c) => c.isConventional).length / commits.length) *
            100 *
            100
        ) / 100,

      // Code metrics
      totalAdditions: commits.reduce((sum, c) => sum + c.totalAdditions, 0),
      totalDeletions: commits.reduce((sum, c) => sum + c.totalDeletions, 0),
      avgLinesPerCommit:
        Math.round(
          (commits.reduce((sum, c) => sum + c.linesPerCommit, 0) /
            commits.length) *
            100
        ) / 100,

      // Quality indicators
      commitsWithTests: commits.filter((c) => c.testFiles > 0).length,
      testCommitPercentage:
        Math.round(
          (commits.filter((c) => c.testFiles > 0).length / commits.length) *
            100 *
            100
        ) / 100,

      commitsWithQualityIndicators: commits.filter(
        (c) => c.hasQualityIndicators
      ).length,
      qualityIndicatorPercentage:
        Math.round(
          (commits.filter((c) => c.hasQualityIndicators).length /
            commits.length) *
            100 *
            100
        ) / 100,

      commitsWithDocumentation: commits.filter((c) => c.hasDocIndicators)
        .length,
      documentationPercentage:
        Math.round(
          (commits.filter((c) => c.hasDocIndicators).length / commits.length) *
            100 *
            100
        ) / 100,

      // File and change metrics
      mergeCommits: commits.filter((c) => c.isMergeCommit).length,
      largeChangesetCommits: commits.filter((c) => c.isLargeChangeset).length,
      refactorCommits: commits.filter((c) => c.hasRefactorIndicators).length,

      // Top contributors
      topContributors: this.getTopContributors(commits, 5),
    };
  }

  getTopContributors(commits, limit = 5) {
    const contributorStats = {};

    commits.forEach((commit) => {
      const author = commit.authorEmail;
      if (!contributorStats[author]) {
        contributorStats[author] = {
          name: commit.author,
          email: author,
          commits: 0,
          additions: 0,
          deletions: 0,
          qualityCommits: 0,
          testCommits: 0,
        };
      }

      const stats = contributorStats[author];
      stats.commits++;
      stats.additions += commit.totalAdditions;
      stats.deletions += commit.totalDeletions;

      if (commit.hasQualityIndicators) stats.qualityCommits++;
      if (commit.testFiles > 0) stats.testCommits++;
    });

    return Object.values(contributorStats)
      .map((contributor) => ({
        ...contributor,
        qualityPercentage:
          Math.round(
            (contributor.qualityCommits / contributor.commits) * 100 * 100
          ) / 100,
        testPercentage:
          Math.round(
            (contributor.testCommits / contributor.commits) * 100 * 100
          ) / 100,
      }))
      .sort((a, b) => b.commits - a.commits)
      .slice(0, limit);
  }

  async exportToJson(data, filename) {
    await writeFile(filename, JSON.stringify(data, null, 2));
    this.log(`Exported JSON to: ${filename}`, "success");
  }

  async exportToCsv(data, filename) {
    const csvWriter = createObjectCsvWriter({
      path: filename,
      header: [
        { id: "sha", title: "SHA" },
        { id: "author", title: "Author" },
        { id: "authorEmail", title: "Author Email" },
        { id: "date", title: "Date" },
        { id: "messageLength", title: "Message Length" },
        { id: "wordCount", title: "Word Count" },
        { id: "isConventional", title: "Conventional Commit" },
        { id: "hasQualityIndicators", title: "Has Quality Indicators" },
        { id: "hasDocIndicators", title: "Has Doc Indicators" },
        { id: "hasRefactorIndicators", title: "Has Refactor Indicators" },
        { id: "isMergeCommit", title: "Is Merge Commit" },
        { id: "totalAdditions", title: "Total Additions" },
        { id: "totalDeletions", title: "Total Deletions" },
        { id: "totalFiles", title: "Total Files" },
        { id: "testFiles", title: "Test Files" },
        { id: "configFiles", title: "Config Files" },
        { id: "documentationFiles", title: "Documentation Files" },
        { id: "codeFiles", title: "Code Files" },
        { id: "isLargeChangeset", title: "Is Large Changeset" },
        { id: "isSmallChangeset", title: "Is Small Changeset" },
        { id: "linesPerCommit", title: "Lines Per Commit" },
        { id: "message", title: "Commit Message" },
      ],
    });

    await csvWriter.writeRecords(data.commits);
    this.log(`Exported CSV to: ${filename}`, "success");
  }
}

// CLI Setup
program
  .name("github-reporter")
  .description(
    "Analyze GitHub repository productivity metrics and team collaboration patterns"
  )
  .version("1.0.0")
  .requiredOption(
    "-r, --repo <owner/repo>",
    "Repository to analyze (format: owner/repo)"
  )
  .option("-f, --format <format>", "Output format: json or csv", "json")
  .option(
    "-o, --output <filename>",
    "Output filename (auto-generated if not provided)"
  )
  .option("-s, --start <date>", "Start date (ISO format: YYYY-MM-DD)")
  .option("-e, --end <date>", "End date (ISO format: YYYY-MM-DD)")
  .option("-v, --verbose", "Enable verbose logging", false)
  .option("-d, --debug", "Enable debug logging", false)
  .option(
    "-t, --token <token>",
    "GitHub token (can also use GITHUB_TOKEN env var)"
  )
  .action(async (options) => {
    try {
      // Validate inputs
      const [owner, repo] = options.repo.split("/");
      if (!owner || !repo) {
        console.error(
          chalk.red('Error: Repository must be in format "owner/repo"')
        );
        process.exit(1);
      }

      // Get GitHub token
      const token = options.token || process.env.GITHUB_TOKEN;
      if (!token) {
        console.error(
          chalk.red(
            "Error: GitHub token required. Use --token or set GITHUB_TOKEN environment variable"
          )
        );
        process.exit(1);
      }

      // Set default dates if not provided
      const endDate = options.end || new Date().toISOString().split("T")[0];
      const startDate =
        options.start ||
        new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split("T")[0];

      // Generate output filename if not provided
      const timestamp = new Date().toISOString().split("T")[0];
      const defaultFilename = `${owner}-${repo}-productivity-report-${startDate}-to-${endDate}-${timestamp}`;
      const outputFilename =
        options.output || `${defaultFilename}.${options.format}`;

      console.log(
        chalk.blue("📊 GitHub Repository Productivity Analysis Tool\n")
      );

      // Initialize reporter
      const reporter = new GitHubReporter(token, {
        verbose: options.verbose,
        debug: options.debug,
      });

      // Run analysis
      const results = await reporter.generateProductivityReport(
        owner,
        repo,
        startDate,
        endDate,
        token
      );

      // Display summary
      console.log(chalk.green("\n📈 Productivity Analysis Summary:"));
      console.log(`Repository: ${results.repository}`);
      console.log(`Date Range: ${results.summary.dateRange}`);
      console.log(`Total Commits: ${results.totalCommits}`);
      console.log(`Total Pull Requests: ${results.totalPullRequests}`);
      console.log(`Unique Authors: ${results.summary.uniqueAuthors}`);
      console.log(`Team Size: ${results.teamMetrics.teamSize}`);
      console.log(
        `Avg Commits per Developer: ${
          Math.round(results.teamMetrics.avgCommitsPerDeveloper * 100) / 100
        }`
      );
      console.log(
        `Avg PRs per Developer: ${
          Math.round(results.teamMetrics.avgPRsPerDeveloper * 100) / 100
        }`
      );
      console.log(
        `Conventional Commits: ${results.summary.conventionalCommitPercentage}%`
      );
      console.log(
        `Quality Indicators: ${results.summary.qualityIndicatorPercentage}%`
      );
      console.log(
        `Test Coverage: ${
          Math.round(results.teamMetrics.testCoverage * 100) / 100
        }%`
      );
      console.log(
        `Average Lines per Commit: ${results.summary.avgLinesPerCommit}`
      );
      console.log(
        `Collaboration Score: ${
          Math.round(
            results.teamMetrics.collaborationScore.collaborationIndex * 100
          ) / 100
        }`
      );

      // Export results
      if (options.format === "csv") {
        await reporter.exportToCsv(results, outputFilename);
      } else {
        await reporter.exportToJson(results, outputFilename);
      }

      console.log(
        chalk.green(
          `\n✅ Analysis complete! Results saved to: ${outputFilename}`
        )
      );

      // Display top insights
      if (
        results.summary.topContributors &&
        results.summary.topContributors.length > 0
      ) {
        console.log(chalk.blue("\n👥 Top Contributors:"));
        results.summary.topContributors.forEach((contributor, index) => {
          console.log(
            `${index + 1}. ${contributor.name} (${
              contributor.commits
            } commits, ${contributor.qualityPercentage}% quality)`
          );
        });
      }

      // Display team metrics
      console.log(chalk.blue("\n🏢 Team Productivity Metrics:"));
      console.log(
        `Average Working Days per User: ${
          Math.round(
            results.teamMetrics.productivityPatterns.avgWorkingDaysPerUser * 100
          ) / 100
        }`
      );
      console.log(
        `Average Commits per Working Day: ${
          Math.round(
            results.teamMetrics.productivityPatterns.avgCommitsPerWorkingDay *
              100
          ) / 100
        }`
      );
      console.log(
        `Working Hours Activity: ${
          Math.round(
            results.teamMetrics.workingTimeDistribution.workingHoursPercentage *
              100
          ) / 100
        }%`
      );
      console.log(
        `Peak Activity Hour: ${results.teamMetrics.workingTimeDistribution.peakHour}:00`
      );
    } catch (error) {
      console.error(chalk.red(`\n❌ Error: ${error.message}`));
      if (options.debug) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

program.parse();
