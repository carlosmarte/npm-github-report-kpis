#!/usr/bin/env node

import { writeFile } from "fs/promises";
import { program } from "commander";
import fetch from "node-fetch";
import { createObjectCsvWriter } from "csv-writer";
import chalk from "chalk";

class GitHubQualityAnalyzer {
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
      "User-Agent": "GitHub-Quality-Analyzer-CLI/1.0.0",
      ...options.headers,
    };

    for (let attempt = 1; attempt <= this.options.retryAttempts; attempt++) {
      try {
        // Check rate limit
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

        // Update rate limit info
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

        // Check for next page
        const linkHeader = response.headers.get("link");
        hasNextPage = linkHeader && linkHeader.includes('rel="next"');

        // Update total pages from link header
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
        process.stdout.write("\n"); // Ensure we're on a new line after progress bar
        throw error;
      }
    }

    return results;
  }

  analyzeCommentContent(comment) {
    const body = comment.body || "";
    const lowerBody = body.toLowerCase();

    // Categorize comment types
    const patterns = {
      style: [
        "style",
        "format",
        "formatting",
        "indent",
        "spacing",
        "whitespace",
        "naming",
        "convention",
        "lint",
        "prettier",
        "eslint",
        "camelcase",
        "underscore",
        "semicolon",
        "comma",
        "bracket",
        "brace",
      ],

      logic: [
        "logic",
        "algorithm",
        "flow",
        "condition",
        "loop",
        "recursive",
        "efficiency",
        "performance",
        "optimization",
        "complexity",
        "bug",
        "error",
        "issue",
        "fix",
        "problem",
        "incorrect",
        "wrong",
      ],

      security: [
        "security",
        "vulnerability",
        "exploit",
        "injection",
        "xss",
        "csrf",
        "authentication",
        "authorization",
        "sanitize",
        "validate",
        "escape",
      ],

      documentation: [
        "comment",
        "documentation",
        "docs",
        "readme",
        "docstring",
        "jsdoc",
        "explain",
        "clarify",
        "description",
        "example",
        "usage",
      ],

      testing: [
        "test",
        "testing",
        "unit test",
        "integration",
        "coverage",
        "mock",
        "assertion",
        "expect",
        "should",
        "spec",
        "scenario",
      ],

      architecture: [
        "architecture",
        "design",
        "pattern",
        "structure",
        "refactor",
        "modular",
        "separation",
        "coupling",
        "cohesion",
        "abstraction",
      ],

      nitpick: [
        "nit:",
        "nitpick",
        "minor",
        "small",
        "tiny",
        "trivial",
        "optional",
        "suggestion",
        "consider",
        "maybe",
        "perhaps",
        "could",
      ],
    };

    // Sentiment analysis keywords
    const sentimentPatterns = {
      positive: [
        "good",
        "great",
        "excellent",
        "nice",
        "perfect",
        "clean",
        "clear",
        "well done",
        "looks good",
        "lgtm",
        "approved",
      ],

      negative: [
        "bad",
        "wrong",
        "incorrect",
        "issue",
        "problem",
        "broken",
        "fail",
        "error",
        "bug",
        "terrible",
        "awful",
        "messy",
      ],

      neutral: [
        "question",
        "wondering",
        "think",
        "consider",
        "suggest",
        "recommend",
        "what if",
        "how about",
        "could we",
        "maybe",
      ],
    };

    // Urgency indicators
    const urgencyPatterns = {
      high: [
        "critical",
        "urgent",
        "important",
        "must",
        "required",
        "necessary",
        "blocking",
        "blocker",
        "high priority",
        "security",
      ],

      medium: ["should", "recommend", "suggest", "prefer", "better", "improve"],

      low: [
        "nit",
        "minor",
        "optional",
        "consider",
        "maybe",
        "could",
        "nice to have",
      ],
    };

    // Calculate scores
    const getScore = (text, patternGroup) => {
      return Object.entries(patternGroup).reduce(
        (scores, [category, keywords]) => {
          scores[category] = keywords.filter((keyword) =>
            text.includes(keyword.toLowerCase())
          ).length;
          return scores;
        },
        {}
      );
    };

    const commentType = getScore(lowerBody, patterns);
    const sentiment = getScore(lowerBody, sentimentPatterns);
    const urgency = getScore(lowerBody, urgencyPatterns);

    // Determine primary category
    const primaryType = Object.entries(commentType).reduce((a, b) =>
      commentType[a[0]] > commentType[b[0]] ? a : b
    )[0];

    const primarySentiment = Object.entries(sentiment).reduce((a, b) =>
      sentiment[a[0]] > sentiment[b[0]] ? a : b
    )[0];

    const primaryUrgency = Object.entries(urgency).reduce((a, b) =>
      urgency[a[0]] > urgency[b[0]] ? a : b
    )[0];

    // Additional metrics
    const wordCount = body.split(/\s+/).length;
    const hasCodeSuggestion = /```[\s\S]*```|`[^`]+`/.test(body);
    const isQuestion = body.includes("?");
    const hasLinks = /https?:\/\/\S+/.test(body);
    const mentionsOthers = /@\w+/.test(body);

    return {
      body,
      wordCount,
      hasCodeSuggestion,
      isQuestion,
      hasLinks,
      mentionsOthers,
      primaryType: commentType[primaryType] > 0 ? primaryType : "general",
      primarySentiment:
        sentiment[primarySentiment] > 0 ? primarySentiment : "neutral",
      primaryUrgency: urgency[primaryUrgency] > 0 ? primaryUrgency : "medium",
      typeScores: commentType,
      sentimentScores: sentiment,
      urgencyScores: urgency,
      isNitpick: commentType.nitpick > 0 || urgency.low > 0,
      isBlocker: urgency.high > 0,
      isStyleComment: commentType.style > 0,
      isLogicComment: commentType.logic > 0,
      isSecurityComment: commentType.security > 0,
    };
  }

  async analyzeQualityDelta(owner, repo, startDate, endDate) {
    this.log(`Starting quality analysis for ${owner}/${repo}`, "info");
    this.log(`Date range: ${startDate} to ${endDate}`, "info");

    try {
      // Fetch all pull request comments in the date range
      this.log("Fetching pull request review comments...", "info");

      const comments = await this.fetchAllPages(
        `${this.baseUrl}/repos/${owner}/${repo}/pulls/comments`,
        {
          since: startDate,
          // Note: GitHub API doesn't have 'until' for PR comments, so we'll filter client-side
          sort: "created",
          direction: "asc",
        }
      );

      // Filter comments by end date client-side
      const filteredComments = comments.filter((comment) => {
        const commentDate = new Date(comment.created_at);
        const endDateObj = new Date(endDate);
        return commentDate <= endDateObj;
      });

      this.log(
        `Found ${filteredComments.length} review comments in date range`,
        "success"
      );

      if (filteredComments.length === 0) {
        return {
          repository: `${owner}/${repo}`,
          dateRange: { start: startDate, end: endDate },
          totalComments: 0,
          summary: this.generateQualitySummary([], startDate, endDate),
          comments: [],
        };
      }

      // Fetch additional PR details for each comment to get context
      this.log("Analyzing comment content and context...", "info");
      const analysisResults = [];
      const processedPRs = new Map(); // Cache PR details

      for (let i = 0; i < filteredComments.length; i++) {
        const comment = filteredComments[i];

        this.createSimpleProgressBar(
          i + 1,
          filteredComments.length,
          "Analyzing comments"
        );

        try {
          // Get PR details if not cached
          let prDetails = processedPRs.get(comment.pull_request_url);
          if (!prDetails) {
            const prResponse = await this.makeRequest(comment.pull_request_url);
            prDetails = await prResponse.json();
            processedPRs.set(comment.pull_request_url, prDetails);
          }

          // Analyze comment content
          const contentAnalysis = this.analyzeCommentContent(comment);

          const analysis = {
            id: comment.id,
            pullRequestNumber: prDetails.number,
            pullRequestTitle: prDetails.title,
            pullRequestState: prDetails.state,
            author: comment.user.login,
            createdAt: comment.created_at,
            updatedAt: comment.updated_at,
            position: comment.position,
            line: comment.line,
            path: comment.path,
            commitId: comment.commit_id,
            url: comment.html_url,
            inReplyToId: comment.in_reply_to_id,
            isReply: !!comment.in_reply_to_id,
            ...contentAnalysis,
            // Additional context
            prAuthor: prDetails.user.login,
            prCreatedAt: prDetails.created_at,
            prMergedAt: prDetails.merged_at,
            prClosedAt: prDetails.closed_at,
            isDifferentAuthor: comment.user.login !== prDetails.user.login,
          };

          analysisResults.push(analysis);
        } catch (error) {
          this.log(
            `Failed to analyze comment ${comment.id}: ${error.message}`,
            "warn"
          );
        }
      }

      // Generate comprehensive summary
      const summary = this.generateQualitySummary(
        analysisResults,
        startDate,
        endDate
      );

      return {
        repository: `${owner}/${repo}`,
        dateRange: { start: startDate, end: endDate },
        totalComments: analysisResults.length,
        summary,
        comments: analysisResults,
      };
    } catch (error) {
      this.log(`Quality analysis failed: ${error.message}`, "error");
      throw error;
    }
  }

  generateQualitySummary(comments, startDate, endDate) {
    if (comments.length === 0) {
      return {
        totalComments: 0,
        dateRange: `${startDate} to ${endDate}`,
        message: "No review comments found in the specified date range",
      };
    }

    const uniquePRs = new Set(comments.map((c) => c.pullRequestNumber)).size;
    const uniqueReviewers = new Set(comments.map((c) => c.author)).size;
    const uniqueAuthors = new Set(comments.map((c) => c.prAuthor)).size;

    // Comment type distribution
    const typeDistribution = {};
    const sentimentDistribution = {};
    const urgencyDistribution = {};

    comments.forEach((comment) => {
      typeDistribution[comment.primaryType] =
        (typeDistribution[comment.primaryType] || 0) + 1;
      sentimentDistribution[comment.primarySentiment] =
        (sentimentDistribution[comment.primarySentiment] || 0) + 1;
      urgencyDistribution[comment.primaryUrgency] =
        (urgencyDistribution[comment.primaryUrgency] || 0) + 1;
    });

    // Quality metrics
    const nitpickComments = comments.filter((c) => c.isNitpick).length;
    const blockerComments = comments.filter((c) => c.isBlocker).length;
    const styleComments = comments.filter((c) => c.isStyleComment).length;
    const logicComments = comments.filter((c) => c.isLogicComment).length;
    const securityComments = comments.filter((c) => c.isSecurityComment).length;
    const questionsCount = comments.filter((c) => c.isQuestion).length;
    const codeSuggestions = comments.filter((c) => c.hasCodeSuggestion).length;

    // Thread analysis
    const replyComments = comments.filter((c) => c.isReply).length;
    const topLevelComments = comments.length - replyComments;

    // Time-based analysis
    const commentsByWeek = this.groupCommentsByWeek(comments);
    const avgCommentsPerPR = comments.length / uniquePRs;
    const avgWordCount =
      comments.reduce((sum, c) => sum + c.wordCount, 0) / comments.length;

    // Cross-author collaboration
    const crossAuthorComments = comments.filter(
      (c) => c.isDifferentAuthor
    ).length;
    const selfReviewComments = comments.length - crossAuthorComments;

    // Calculate percentages
    const calculatePercentage = (count, total) =>
      ((count / total) * 100).toFixed(2);

    return {
      dateRange: `${startDate} to ${endDate}`,
      totalComments: comments.length,
      uniquePullRequests: uniquePRs,
      uniqueReviewers,
      uniqueAuthors,

      // Comment volume metrics
      avgCommentsPerPR: avgCommentsPerPR.toFixed(2),
      avgWordCount: avgWordCount.toFixed(2),
      topLevelComments,
      replyComments,
      threadDepth: (replyComments / topLevelComments).toFixed(2),

      // Comment type analysis
      typeDistribution,
      sentimentDistribution,
      urgencyDistribution,

      // Quality indicators
      nitpickComments,
      nitpickPercentage: calculatePercentage(nitpickComments, comments.length),

      blockerComments,
      blockerPercentage: calculatePercentage(blockerComments, comments.length),

      styleComments,
      stylePercentage: calculatePercentage(styleComments, comments.length),

      logicComments,
      logicPercentage: calculatePercentage(logicComments, comments.length),

      securityComments,
      securityPercentage: calculatePercentage(
        securityComments,
        comments.length
      ),

      // Interaction patterns
      questionsCount,
      questionsPercentage: calculatePercentage(questionsCount, comments.length),

      codeSuggestions,
      codeSuggestionsPercentage: calculatePercentage(
        codeSuggestions,
        comments.length
      ),

      crossAuthorComments,
      crossAuthorPercentage: calculatePercentage(
        crossAuthorComments,
        comments.length
      ),

      selfReviewComments,
      selfReviewPercentage: calculatePercentage(
        selfReviewComments,
        comments.length
      ),

      // Time-based patterns
      commentsByWeek,
      peakWeek: this.findPeakWeek(commentsByWeek),

      // Quality score (lower score indicates higher quality - fewer nitpicks, blockers)
      qualityScore: this.calculateQualityScore(comments),

      // Top contributors
      topReviewers: this.getTopReviewers(comments, 5),
      mostReviewedAuthors: this.getMostReviewedAuthors(comments, 5),
    };
  }

  groupCommentsByWeek(comments) {
    const weekGroups = {};

    comments.forEach((comment) => {
      const date = new Date(comment.createdAt);
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay()); // Start of week (Sunday)
      const weekKey = weekStart.toISOString().split("T")[0];

      weekGroups[weekKey] = (weekGroups[weekKey] || 0) + 1;
    });

    return weekGroups;
  }

  findPeakWeek(commentsByWeek) {
    const weeks = Object.entries(commentsByWeek);
    if (weeks.length === 0) return null;

    return weeks.reduce((peak, current) =>
      current[1] > peak[1] ? current : peak
    );
  }

  calculateQualityScore(comments) {
    // Quality score calculation (0-100, higher is better)
    // Factors: fewer nitpicks, more substantive comments, better collaboration

    const total = comments.length;
    if (total === 0) return 100;

    const nitpicks = comments.filter((c) => c.isNitpick).length;
    const blockers = comments.filter((c) => c.isBlocker).length;
    const logic = comments.filter((c) => c.isLogicComment).length;
    const security = comments.filter((c) => c.isSecurityComment).length;
    const crossAuthor = comments.filter((c) => c.isDifferentAuthor).length;
    const codeSuggestions = comments.filter((c) => c.hasCodeSuggestion).length;

    // Weighted scoring
    let score = 100;
    score -= (nitpicks / total) * 20; // Penalize nitpicks
    score -= (blockers / total) * 30; // Heavily penalize blockers
    score += (logic / total) * 10; // Reward substantive feedback
    score += (security / total) * 15; // Reward security focus
    score += (crossAuthor / total) * 10; // Reward collaboration
    score += (codeSuggestions / total) * 5; // Reward constructive suggestions

    return Math.max(0, Math.min(100, score)).toFixed(2);
  }

  getTopReviewers(comments, limit = 5) {
    const reviewerStats = {};

    comments.forEach((comment) => {
      const reviewer = comment.author;
      if (!reviewerStats[reviewer]) {
        reviewerStats[reviewer] = {
          name: reviewer,
          totalComments: 0,
          nitpicks: 0,
          blockers: 0,
          logicComments: 0,
          securityComments: 0,
          codeSuggestions: 0,
          avgWordCount: 0,
          wordCounts: [],
        };
      }

      const stats = reviewerStats[reviewer];
      stats.totalComments++;
      stats.wordCounts.push(comment.wordCount);

      if (comment.isNitpick) stats.nitpicks++;
      if (comment.isBlocker) stats.blockers++;
      if (comment.isLogicComment) stats.logicComments++;
      if (comment.isSecurityComment) stats.securityComments++;
      if (comment.hasCodeSuggestion) stats.codeSuggestions++;
    });

    return Object.values(reviewerStats)
      .map((reviewer) => ({
        ...reviewer,
        avgWordCount: (
          reviewer.wordCounts.reduce((a, b) => a + b, 0) /
          reviewer.wordCounts.length
        ).toFixed(2),
        nitpickPercentage: (
          (reviewer.nitpicks / reviewer.totalComments) *
          100
        ).toFixed(2),
        qualityScore: this.calculateReviewerQualityScore(reviewer),
      }))
      .sort((a, b) => b.totalComments - a.totalComments)
      .slice(0, limit);
  }

  getMostReviewedAuthors(comments, limit = 5) {
    const authorStats = {};

    comments.forEach((comment) => {
      const author = comment.prAuthor;
      if (!authorStats[author]) {
        authorStats[author] = {
          name: author,
          pullRequests: new Set(),
          totalComments: 0,
          avgCommentsPerPR: 0,
        };
      }

      authorStats[author].pullRequests.add(comment.pullRequestNumber);
      authorStats[author].totalComments++;
    });

    return Object.values(authorStats)
      .map((author) => ({
        ...author,
        pullRequestCount: author.pullRequests.size,
        avgCommentsPerPR: (
          author.totalComments / author.pullRequests.size
        ).toFixed(2),
        pullRequests: undefined, // Remove Set for serialization
      }))
      .sort((a, b) => b.totalComments - a.totalComments)
      .slice(0, limit);
  }

  calculateReviewerQualityScore(reviewer) {
    // Quality score for individual reviewer (0-100, higher is better)
    let score = 100;

    const total = reviewer.totalComments;
    if (total === 0) return 100;

    score -= (reviewer.nitpicks / total) * 25;
    score -= (reviewer.blockers / total) * 35;
    score += (reviewer.logicComments / total) * 15;
    score += (reviewer.securityComments / total) * 20;
    score += (reviewer.codeSuggestions / total) * 10;

    return Math.max(0, Math.min(100, score)).toFixed(2);
  }

  async exportToJson(data, filename) {
    await writeFile(filename, JSON.stringify(data, null, 2));
    this.log(`Exported JSON to: ${filename}`, "success");
  }

  async exportToCsv(data, filename) {
    const csvWriter = createObjectCsvWriter({
      path: filename,
      header: [
        { id: "id", title: "Comment ID" },
        { id: "pullRequestNumber", title: "PR Number" },
        { id: "pullRequestTitle", title: "PR Title" },
        { id: "author", title: "Reviewer" },
        { id: "prAuthor", title: "PR Author" },
        { id: "createdAt", title: "Created At" },
        { id: "path", title: "File Path" },
        { id: "line", title: "Line Number" },
        { id: "wordCount", title: "Word Count" },
        { id: "primaryType", title: "Comment Type" },
        { id: "primarySentiment", title: "Sentiment" },
        { id: "primaryUrgency", title: "Urgency" },
        { id: "isNitpick", title: "Is Nitpick" },
        { id: "isBlocker", title: "Is Blocker" },
        { id: "isStyleComment", title: "Is Style Comment" },
        { id: "isLogicComment", title: "Is Logic Comment" },
        { id: "isSecurityComment", title: "Is Security Comment" },
        { id: "isQuestion", title: "Is Question" },
        { id: "hasCodeSuggestion", title: "Has Code Suggestion" },
        { id: "isDifferentAuthor", title: "Cross-Author Review" },
        { id: "isReply", title: "Is Reply" },
        { id: "body", title: "Comment Body" },
      ],
    });

    await csvWriter.writeRecords(data.comments);
    this.log(`Exported CSV to: ${filename}`, "success");
  }
}

// CLI Setup
program
  .name("github-quality-analyzer")
  .description(
    "Analyze GitHub repository code review comment patterns and quality metrics"
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
      const defaultFilename = `${owner}-${repo}-quality-analysis-${startDate}-to-${endDate}-${timestamp}`;
      const outputFilename =
        options.output || `${defaultFilename}.${options.format}`;

      console.log(chalk.blue("🔍 GitHub Repository Quality Analysis Tool\n"));

      // Initialize analyzer
      const analyzer = new GitHubQualityAnalyzer(token, {
        verbose: options.verbose,
        debug: options.debug,
      });

      // Run analysis
      const results = await analyzer.analyzeQualityDelta(
        owner,
        repo,
        startDate,
        endDate
      );

      // Display summary
      console.log(chalk.green("\n📊 Quality Analysis Summary:"));
      console.log(`Repository: ${results.repository}`);
      console.log(`Date Range: ${results.summary.dateRange}`);
      console.log(`Total Comments: ${results.totalComments}`);
      console.log(`Unique PRs: ${results.summary.uniquePullRequests}`);
      console.log(`Unique Reviewers: ${results.summary.uniqueReviewers}`);
      console.log(
        `Average Comments per PR: ${results.summary.avgCommentsPerPR}`
      );
      console.log(`Quality Score: ${results.summary.qualityScore}/100`);

      console.log(chalk.blue("\n📈 Comment Distribution:"));
      console.log(`Nitpicks: ${results.summary.nitpickPercentage}%`);
      console.log(`Blockers: ${results.summary.blockerPercentage}%`);
      console.log(`Style Comments: ${results.summary.stylePercentage}%`);
      console.log(`Logic Comments: ${results.summary.logicPercentage}%`);
      console.log(`Security Comments: ${results.summary.securityPercentage}%`);
      console.log(
        `Code Suggestions: ${results.summary.codeSuggestionsPercentage}%`
      );
      console.log(
        `Cross-Author Reviews: ${results.summary.crossAuthorPercentage}%`
      );

      // Export results
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

      // Display top insights
      if (
        results.summary.topReviewers &&
        results.summary.topReviewers.length > 0
      ) {
        console.log(chalk.blue("\n👥 Top Reviewers:"));
        results.summary.topReviewers.forEach((reviewer, index) => {
          console.log(
            `${index + 1}. ${reviewer.name} (${
              reviewer.totalComments
            } comments, Quality Score: ${reviewer.qualityScore}/100)`
          );
        });
      }

      if (
        results.summary.mostReviewedAuthors &&
        results.summary.mostReviewedAuthors.length > 0
      ) {
        console.log(chalk.blue("\n📝 Most Reviewed Authors:"));
        results.summary.mostReviewedAuthors.forEach((author, index) => {
          console.log(
            `${index + 1}. ${author.name} (${author.pullRequestCount} PRs, ${
              author.avgCommentsPerPR
            } avg comments/PR)`
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
