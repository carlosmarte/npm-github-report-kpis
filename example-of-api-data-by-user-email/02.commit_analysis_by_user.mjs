#!/usr/bin/env node

/*
JSON Report Structure:
{
  repository: "owner/repo",
  dateRange: { start: "YYYY-MM-DD", end: "YYYY-MM-DD" },
  totalCommits: number,
  summary: {
    dateRange: "start to end",
    totalCommits: number,
    uniqueAuthors: number,
    avgMessageLength: string,
    conventionalCommits: number,
    conventionalCommitPercentage: string,
    commitsWithAutomationIndicators: number,
    automationIndicatorPercentage: string,
    derivedAutomatedCommits: number,
    derivedAutomatedPercentage: string,
    highAutomationScoreCommits: number,
    highAutomationScorePercentage: string,
    totalAdditions: number,
    totalDeletions: number,
    avgLinesPerCommit: string,
    avgCommentToCodeRatio: string,
    commitsWithTests: number,
    testCommitPercentage: string,
    commitsWithQualityIndicators: number,
    qualityIndicatorPercentage: string,
    commitsWithDocumentation: number,
    documentationPercentage: string,
    mergeCommits: number,
    largeChangesetCommits: number,
    formattingCommits: number,
    topContributors: [
      {
        name: string,
        email: string,
        commits: number,
        additions: number,
        deletions: number,
        automatedCommits: number,
        avgAutomationScore: string,
        automatedPercentage: string
      }
    ]
  },
  commits: [
    {
      sha: string,
      author: string,
      authorEmail: string,
      date: string,
      message: string,
      url: string,
      hasAutomationIndicators: boolean,
      hasQualityIndicators: boolean,
      hasDocIndicators: boolean,
      isMergeCommit: boolean,
      messageLength: number,
      wordCount: number,
      isConventional: boolean,
      hasCodeTerms: boolean,
      hasFileReferences: boolean,
      automationScore: number,
      isPotentiallyAutomated: boolean,
      totalAdditions: number,
      totalDeletions: number,
      totalFiles: number,
      estimatedCodeLines: number,
      estimatedCommentLines: number,
      commentToCodeRatio: number,
      commentNetIncrease: number,
      testFiles: number,
      configFiles: number,
      documentationFiles: number,
      avgChangesPerFile: number,
      fileExtensionDiversity: number,
      hasLargeChangeset: boolean,
      hasHighCommentRatio: boolean,
      hasMultipleFileTypes: boolean,
      hasFormattingChanges: boolean,
      isPotentiallyAutomatedContent: boolean,
      combinedAutomationScore: number,
      isDerivedAutomated: boolean,
      linesPerCommit: number
    }
  ],
  authorshipAnalysis: {
    "[email]": {
      totalCommits: number,
      avgMessageLength: number,
      avgCommentRatio: number,
      automationLikelihood: number,
      messageLengths: number[],
      commentRatios: number[],
      timingPatterns: number[]
    }
  }
}

Use Cases:
1. Team Productivity Analysis - Track commit frequency and patterns across team members
2. Code Quality Assessment - Monitor additions/deletions trends and comment ratios
3. Collaboration Metrics - Analyze contributor participation and working patterns
4. Development Patterns - Identify working time distributions and automation usage
5. Process Improvements - Compare before/after periods for process changes
6. Automation Detection - Identify potentially automated commits and tools usage
7. Quality Gate Monitoring - Track test coverage and documentation improvements
8. Technical Debt Assessment - Monitor code complexity and refactoring patterns
*/

import { writeFile } from "fs/promises";
import { program } from "commander";
import fetch from "node-fetch";
import { createObjectCsvWriter } from "csv-writer";
import chalk from "chalk";

class GitHubCommitAnalyzer {
  constructor(token, options = {}) {
    this.token = token;
    this.baseUrl = "https://api.github.com";
    this.options = {
      verbose: options.verbose || false,
      debug: options.debug || false,
      retryAttempts: options.retryAttempts || 3,
      retryDelay: options.retryDelay || 1000,
      rateLimit: options.rateLimit || true,
      fetchLimit: options.fetchLimit || 200,
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
    // Fixed: Use Bearer token format instead of legacy token format
    const headers = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "GitHub-Analyzer-CLI/1.0.0",
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

        const response = await fetch(url, {
          ...options,
          headers,
        });

        this.rateLimitRemaining = parseInt(
          response.headers.get("x-ratelimit-remaining") || "5000"
        );
        this.rateLimitReset =
          parseInt(
            response.headers.get("x-ratelimit-reset") || Date.now() / 1000
          ) * 1000;

        if (!response.ok) {
          // Enhanced error handling with friendly messages
          if (response.status === 401) {
            throw new Error(
              `Authentication failed: Invalid or expired GitHub token. Please check your token permissions and ensure it's in the correct Bearer format. Status: ${response.status}`
            );
          }
          if (response.status === 403) {
            const resetTime = new Date(this.rateLimitReset).toISOString();
            throw new Error(
              `Rate limit exceeded or insufficient permissions. The token might lack proper repository access scopes. Resets at: ${resetTime}. Status: ${response.status}`
            );
          }
          if (response.status === 404) {
            throw new Error(
              `Repository not found or not accessible. Check if the repository exists and your token has access to it. Status: ${response.status}`
            );
          }
          throw new Error(
            `GitHub API request failed: HTTP ${response.status}: ${response.statusText}`
          );
        }

        return response;
      } catch (error) {
        this.log(
          `Request failed (attempt ${attempt}): ${error.message}`,
          "error"
        );
        console.log(`Full error details:`, error.message); // Full error message in console

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
    let fetchedCount = 0;

    while (
      hasNextPage &&
      (this.options.fetchLimit === 0 || fetchedCount < this.options.fetchLimit)
    ) {
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
          const itemsToAdd =
            this.options.fetchLimit > 0
              ? data.slice(
                  0,
                  Math.max(0, this.options.fetchLimit - fetchedCount)
                )
              : data;

          results.push(...itemsToAdd);
          fetchedCount += itemsToAdd.length;
        } else {
          results.push(data);
          fetchedCount++;
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
          } items (total: ${fetchedCount})`,
          "verbose"
        );

        // Stop if we've reached the fetch limit
        if (
          this.options.fetchLimit > 0 &&
          fetchedCount >= this.options.fetchLimit
        ) {
          this.log(
            `Reached fetch limit of ${this.options.fetchLimit} items`,
            "info"
          );
          break;
        }
      } catch (error) {
        process.stdout.write("\n");
        throw error;
      }
    }

    return results;
  }

  analyzeCommitMessage(message) {
    const patterns = {
      automationKeywords: [
        "refactor",
        "optimize",
        "improve",
        "enhance",
        "cleanup",
        "clean up",
        "auto-generated",
        "generated",
        "automated",
        "suggested",
        "auto-fixed",
        "auto-format",
        "linting",
        "prettier",
        "eslint",
        "format",
        "style fix",
      ],
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
        "jsdoc",
        "javadoc",
        "api doc",
        "guide",
        "tutorial",
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

    const hasAutomationKeywords = patterns.automationKeywords.some((keyword) =>
      lowerMessage.includes(keyword.toLowerCase())
    );
    const hasQualityIndicators = patterns.qualityKeywords.some((keyword) =>
      lowerMessage.includes(keyword.toLowerCase())
    );
    const hasDocIndicators = patterns.docKeywords.some((keyword) =>
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

    let automationScore = 0;
    if (hasAutomationKeywords) automationScore += 3;
    if (message.length > 100 && wordCount > 15) automationScore += 2;
    if (hasCodeTerms) automationScore += 1;
    if (isConventional) automationScore += 1;
    if (hasQualityIndicators) automationScore += 1;

    return {
      hasAutomationIndicators: hasAutomationKeywords,
      hasQualityIndicators,
      hasDocIndicators,
      isMergeCommit,
      messageLength: message.length,
      wordCount,
      isConventional,
      hasCodeTerms,
      hasFileReferences,
      automationScore,
      isPotentiallyAutomated: automationScore >= 4,
    };
  }

  analyzeCommitContent(commit) {
    const stats = commit.stats || {};
    const files = commit.files || [];

    let codeLines = 0;
    let commentLines = 0;
    let testFiles = 0;
    let configFiles = 0;
    let documentationFiles = 0;
    let addedCommentLines = 0;
    let deletedCommentLines = 0;

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
      }

      if (file.patch) {
        const lines = file.patch.split("\n");
        lines.forEach((line) => {
          const trimmedLine = line.trim();

          if (line.startsWith("+")) {
            if (this.isCommentLine(trimmedLine.substring(1))) {
              commentLines++;
              addedCommentLines++;
            } else if (
              trimmedLine.length > 3 &&
              !trimmedLine.startsWith("+++")
            ) {
              codeLines++;
            }
          } else if (line.startsWith("-")) {
            if (this.isCommentLine(trimmedLine.substring(1))) {
              deletedCommentLines++;
            }
          }
        });
      }
    });

    const totalChanges = stats.additions + stats.deletions;
    const commentToCodeRatio = codeLines > 0 ? commentLines / codeLines : 0;
    const commentNetIncrease = addedCommentLines - deletedCommentLines;

    const highCommentRatio = commentToCodeRatio > 0.3;
    const largeChangeset = totalChanges > 100;
    const multipleFileTypes =
      new Set(files.map((f) => this.getFileExtension(f.filename))).size > 3;
    const hasFormattingChanges = files.some(
      (f) =>
        f.patch &&
        (f.patch.includes("  +") ||
          f.patch.includes("- ") ||
          f.patch.includes("+ "))
    );

    return {
      totalAdditions: stats.additions || 0,
      totalDeletions: stats.deletions || 0,
      totalFiles: files.length,
      estimatedCodeLines: codeLines,
      estimatedCommentLines: commentLines,
      commentToCodeRatio,
      commentNetIncrease,
      testFiles,
      configFiles,
      documentationFiles,
      avgChangesPerFile: files.length > 0 ? totalChanges / files.length : 0,
      fileExtensionDiversity: new Set(
        files.map((f) => this.getFileExtension(f.filename))
      ).size,
      hasLargeChangeset: largeChangeset,
      hasHighCommentRatio: highCommentRatio,
      hasMultipleFileTypes: multipleFileTypes,
      hasFormattingChanges,
      isPotentiallyAutomatedContent:
        highCommentRatio || (largeChangeset && multipleFileTypes),
    };
  }

  isCommentLine(line) {
    const trimmed = line.trim();
    const commentPatterns = [
      /^\/\//,
      /^\/\*/,
      /^\*/,
      /^\*\//, // JavaScript, C++, Java
      /^#/, // Python, Shell, Ruby
      /^<!--/,
      /^-->/, // HTML, XML
      /^--/, // SQL, Haskell
      /^;/, // Lisp, Assembly
      /^%/, // LaTeX, Erlang
      /^\s*\*/, // Javadoc style
      /^"""/,
      /^'''/, // Python docstrings
    ];

    return commentPatterns.some((pattern) => pattern.test(trimmed));
  }

  getFileExtension(filename) {
    const parts = filename.split(".");
    return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
  }

  analyzeAuthorshipStyle(commits) {
    const authorStyles = {};

    commits.forEach((commit) => {
      const email = commit.authorEmail;
      if (!authorStyles[email]) {
        authorStyles[email] = {
          totalCommits: 0,
          avgMessageLength: 0,
          conventionalCommitRate: 0,
          avgLinesPerCommit: 0,
          avgFilesPerCommit: 0,
          commentRatios: [],
          messageLengths: [],
          timingPatterns: [],
        };
      }

      const style = authorStyles[email];
      style.totalCommits++;
      style.messageLengths.push(commit.messageLength);
      style.commentRatios.push(commit.commentToCodeRatio);

      const commitHour = new Date(commit.date).getHours();
      style.timingPatterns.push(commitHour);
    });

    Object.keys(authorStyles).forEach((email) => {
      const style = authorStyles[email];
      style.avgMessageLength =
        style.messageLengths.reduce((a, b) => a + b, 0) /
        style.messageLengths.length;
      style.avgCommentRatio =
        style.commentRatios.reduce((a, b) => a + b, 0) /
        style.commentRatios.length;

      const hasConsistentLongMessages = style.avgMessageLength > 80;
      const hasHighCommentRatio = style.avgCommentRatio > 0.25;
      const hasRegularTiming = this.detectRegularPattern(style.timingPatterns);

      style.automationLikelihood =
        (hasConsistentLongMessages ? 1 : 0) +
        (hasHighCommentRatio ? 1 : 0) +
        (hasRegularTiming ? 1 : 0);
    });

    return authorStyles;
  }

  detectRegularPattern(timingArray) {
    const workingHours = timingArray.filter((hour) => hour >= 9 && hour <= 17);
    return workingHours.length / timingArray.length > 0.8;
  }

  // Main analysis method with required signature: (repo, owner, startDate, endDate, token)
  async analyzeRepository(repo, owner, startDate, endDate, token = null) {
    // Use provided token or fallback to instance token
    if (token) {
      this.token = token;
    }

    this.log(`Starting analysis for ${owner}/${repo}`, "info");
    this.log(`Date range: ${startDate} to ${endDate}`, "info");
    this.log(
      `Fetch limit: ${
        this.options.fetchLimit === 0 ? "infinite" : this.options.fetchLimit
      }`,
      "info"
    );

    try {
      const commits = await this.fetchAllPages(
        `${this.baseUrl}/repos/${owner}/${repo}/commits`,
        {
          since: startDate,
          until: endDate,
        }
      );

      this.log(`Found ${commits.length} commits in date range`, "success");

      if (commits.length === 0) {
        return {
          repository: `${owner}/${repo}`,
          dateRange: { start: startDate, end: endDate },
          totalCommits: 0,
          summary: this.generateSummary([], startDate, endDate),
          commits: [],
          authorshipAnalysis: {},
        };
      }

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
            combinedAutomationScore:
              messageAnalysis.automationScore +
              (contentAnalysis.hasHighCommentRatio ? 2 : 0) +
              (contentAnalysis.isPotentiallyAutomatedContent ? 3 : 0),
            isDerivedAutomated:
              messageAnalysis.isPotentiallyAutomated ||
              contentAnalysis.isPotentiallyAutomatedContent,
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

      const authorshipAnalysis = this.analyzeAuthorshipStyle(analysisResults);
      const summary = this.generateSummary(analysisResults, startDate, endDate);

      return {
        repository: `${owner}/${repo}`,
        dateRange: { start: startDate, end: endDate },
        totalCommits: analysisResults.length,
        summary,
        commits: analysisResults,
        authorshipAnalysis,
      };
    } catch (error) {
      this.log(`Analysis failed: ${error.message}`, "error");
      throw error;
    }
  }

  generateSummary(commits, startDate, endDate) {
    if (commits.length === 0) {
      return {
        totalCommits: 0,
        dateRange: `${startDate} to ${endDate}`,
        message: "No commits found in the specified date range",
      };
    }

    const automatedCommits = commits.filter((c) => c.isDerivedAutomated);
    const highScoreCommits = commits.filter(
      (c) => c.combinedAutomationScore >= 6
    );

    const summary = {
      dateRange: `${startDate} to ${endDate}`,
      totalCommits: commits.length,
      uniqueAuthors: new Set(commits.map((c) => c.authorEmail)).size,

      avgMessageLength: (
        commits.reduce((sum, c) => sum + c.messageLength, 0) / commits.length
      ).toFixed(2),
      conventionalCommits: commits.filter((c) => c.isConventional).length,
      conventionalCommitPercentage: (
        (commits.filter((c) => c.isConventional).length / commits.length) *
        100
      ).toFixed(2),

      commitsWithAutomationIndicators: commits.filter(
        (c) => c.hasAutomationIndicators
      ).length,
      automationIndicatorPercentage: (
        (commits.filter((c) => c.hasAutomationIndicators).length /
          commits.length) *
        100
      ).toFixed(2),

      derivedAutomatedCommits: automatedCommits.length,
      derivedAutomatedPercentage: (
        (automatedCommits.length / commits.length) *
        100
      ).toFixed(2),

      highAutomationScoreCommits: highScoreCommits.length,
      highAutomationScorePercentage: (
        (highScoreCommits.length / commits.length) *
        100
      ).toFixed(2),

      totalAdditions: commits.reduce((sum, c) => sum + c.totalAdditions, 0),
      totalDeletions: commits.reduce((sum, c) => sum + c.totalDeletions, 0),
      avgLinesPerCommit: (
        commits.reduce((sum, c) => sum + c.linesPerCommit, 0) / commits.length
      ).toFixed(2),
      avgCommentToCodeRatio: (
        commits.reduce((sum, c) => sum + c.commentToCodeRatio, 0) /
        commits.length
      ).toFixed(3),

      commitsWithTests: commits.filter((c) => c.testFiles > 0).length,
      testCommitPercentage: (
        (commits.filter((c) => c.testFiles > 0).length / commits.length) *
        100
      ).toFixed(2),

      commitsWithQualityIndicators: commits.filter(
        (c) => c.hasQualityIndicators
      ).length,
      qualityIndicatorPercentage: (
        (commits.filter((c) => c.hasQualityIndicators).length /
          commits.length) *
        100
      ).toFixed(2),

      commitsWithDocumentation: commits.filter((c) => c.hasDocIndicators)
        .length,
      documentationPercentage: (
        (commits.filter((c) => c.hasDocIndicators).length / commits.length) *
        100
      ).toFixed(2),

      mergeCommits: commits.filter((c) => c.isMergeCommit).length,
      largeChangesetCommits: commits.filter((c) => c.hasLargeChangeset).length,
      formattingCommits: commits.filter((c) => c.hasFormattingChanges).length,

      topContributors: this.getTopContributors(commits, 5),
    };

    return summary;
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
          automatedCommits: 0,
          avgAutomationScore: 0,
          automationScores: [],
        };
      }

      const stats = contributorStats[author];
      stats.commits++;
      stats.additions += commit.totalAdditions;
      stats.deletions += commit.totalDeletions;
      stats.automationScores.push(commit.combinedAutomationScore);

      if (commit.isDerivedAutomated) {
        stats.automatedCommits++;
      }
    });

    return Object.values(contributorStats)
      .map((contributor) => ({
        ...contributor,
        avgAutomationScore: (
          contributor.automationScores.reduce((a, b) => a + b, 0) /
          contributor.automationScores.length
        ).toFixed(2),
        automatedPercentage: (
          (contributor.automatedCommits / contributor.commits) *
          100
        ).toFixed(2),
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
        { id: "hasAutomationIndicators", title: "Has Automation Indicators" },
        { id: "hasQualityIndicators", title: "Has Quality Indicators" },
        { id: "hasDocIndicators", title: "Has Doc Indicators" },
        { id: "isMergeCommit", title: "Is Merge Commit" },
        { id: "automationScore", title: "Automation Score" },
        { id: "combinedAutomationScore", title: "Combined Automation Score" },
        { id: "isPotentiallyAutomated", title: "Potentially Automated" },
        { id: "isDerivedAutomated", title: "Derived Automated" },
        { id: "totalAdditions", title: "Total Additions" },
        { id: "totalDeletions", title: "Total Deletions" },
        { id: "totalFiles", title: "Total Files" },
        { id: "commentToCodeRatio", title: "Comment to Code Ratio" },
        { id: "testFiles", title: "Test Files" },
        { id: "configFiles", title: "Config Files" },
        { id: "documentationFiles", title: "Documentation Files" },
        { id: "hasLargeChangeset", title: "Has Large Changeset" },
        { id: "hasFormattingChanges", title: "Has Formatting Changes" },
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
  .name("github-analyzer")
  .description(
    "Analyze GitHub repository commit patterns by user email with automation detection"
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
  .option(
    "-l, --fetchLimit <number>",
    "Set fetch limit (0 for infinite, default: 200)",
    "200"
  )
  .action(async (options) => {
    try {
      const [owner, repo] = options.repo.split("/");
      if (!owner || !repo) {
        console.error(
          chalk.red('Error: Repository must be in format "owner/repo"')
        );
        process.exit(1);
      }

      const token = options.token || process.env.GITHUB_TOKEN;
      if (!token) {
        console.error(
          chalk.red(
            "Error: GitHub token required. Use --token or set GITHUB_TOKEN environment variable"
          )
        );
        process.exit(1);
      }

      const endDate = options.end || new Date().toISOString().split("T")[0];
      const startDate =
        options.start ||
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split("T")[0];

      const fetchLimit = parseInt(options.fetchLimit) || 200;

      const timestamp = new Date().toISOString().split("T")[0];
      const defaultFilename = `${owner}-${repo}-commit-analysis-${startDate}-to-${endDate}-${timestamp}`;
      const outputFilename =
        options.output || `${defaultFilename}.${options.format}`;

      console.log(chalk.blue("🔍 GitHub Repository Commit Analysis Tool\n"));

      const analyzer = new GitHubCommitAnalyzer(token, {
        verbose: options.verbose,
        debug: options.debug,
        fetchLimit: fetchLimit,
      });

      const results = await analyzer.analyzeRepository(
        repo,
        owner,
        startDate,
        endDate
      );

      console.log(chalk.green("\n📊 Analysis Summary:"));
      console.log(`Repository: ${results.repository}`);
      console.log(`Date Range: ${results.summary.dateRange}`);
      console.log(`Total Commits: ${results.totalCommits}`);
      console.log(`Unique Authors: ${results.summary.uniqueAuthors}`);
      console.log(
        `Conventional Commits: ${results.summary.conventionalCommitPercentage}%`
      );
      console.log(
        `Automation Indicators: ${results.summary.automationIndicatorPercentage}%`
      );
      console.log(
        `Derived Automated: ${results.summary.derivedAutomatedPercentage}%`
      );
      console.log(
        `High Automation Score: ${results.summary.highAutomationScorePercentage}%`
      );
      console.log(
        `Average Lines per Commit: ${results.summary.avgLinesPerCommit}`
      );
      console.log(`Test Coverage: ${results.summary.testCommitPercentage}%`);
      console.log(
        `Quality Indicators: ${results.summary.qualityIndicatorPercentage}%`
      );

      if (options.format === "csv") {
        await analyzer.exportToCsv(results, outputFilename);
      } else {
        await analyzer.exportToJson(results, outputFilename);
      }

      console.log(
        chalk.green(
          `\n✅ Analysis complete! Results saved to: ${outputFilename}`
        )
      );

      if (
        results.summary.topContributors &&
        results.summary.topContributors.length > 0
      ) {
        console.log(chalk.blue("\n👥 Top Contributors:"));
        results.summary.topContributors.forEach((contributor, index) => {
          console.log(
            `${index + 1}. ${contributor.name} (${
              contributor.commits
            } commits, ${contributor.automatedPercentage}% automated)`
          );
        });
      }
    } catch (error) {
      console.error(chalk.red(`\n❌ Error: ${error.message}`));
      if (options.debug) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

program.parse();
