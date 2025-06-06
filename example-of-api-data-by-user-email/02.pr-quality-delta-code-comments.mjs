#!/usr/bin/env node

import { writeFile } from "fs/promises";
import { program } from "commander";
import fetch from "node-fetch";
import { createObjectCsvWriter } from "csv-writer";
import chalk from "chalk";

/*
JSON Report Structure:
{
  repository: "owner/repo",
  dateRange: { start: "YYYY-MM-DD", end: "YYYY-MM-DD" },
  totalComments: number,
  summary: {
    dateRange: "start to end",
    totalComments: number,
    uniquePullRequests: number,
    uniqueReviewers: number,
    uniqueAuthors: number,
    avgCommentsPerPR: string,
    avgWordCount: string,
    qualityScore: string,
    typeDistribution: object,
    sentimentDistribution: object,
    urgencyDistribution: object,
    topReviewers: array,
    mostReviewedAuthors: array,
    commentsByWeek: object,
    nitpickPercentage: string,
    blockerPercentage: string,
    stylePercentage: string,
    logicPercentage: string,
    securityPercentage: string,
    crossAuthorPercentage: string
  },
  comments: [
    {
      id: number,
      pullRequestNumber: number,
      pullRequestTitle: string,
      author: string,
      prAuthor: string,
      createdAt: string,
      path: string,
      line: number,
      wordCount: number,
      primaryType: string,
      primarySentiment: string,
      primaryUrgency: string,
      isNitpick: boolean,
      isBlocker: boolean,
      isStyleComment: boolean,
      isLogicComment: boolean,
      isSecurityComment: boolean,
      isQuestion: boolean,
      hasCodeSuggestion: boolean,
      isDifferentAuthor: boolean,
      body: string
    }
  ]
}

Use Cases:
1. Team Productivity Analysis: Track commit frequency and patterns
2. Code Quality Assessment: Monitor additions/deletions trends
3. Collaboration Metrics: Analyze contributor participation
4. Development Patterns: Identify working time distributions
5. Process Improvements: Compare before/after periods for process changes
6. Quality Delta Analysis: Review comment patterns by user email
7. Security Review Tracking: Identify security-focused feedback
8. Style vs Logic Comment Ratio: Balance between superficial and substantive feedback
9. Cross-team Collaboration: Measure inter-team code review participation
10. Reviewer Burnout Prevention: Track review workload distribution
*/

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
    const headers = {
      Authorization: `Bearer ${this.token}`, // Fixed: Updated to Bearer format
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
          if (response.status === 401) {
            throw new Error(
              `Authentication failed (${response.status}): Please check your GitHub token format and permissions. Ensure you're using a valid Personal Access Token with proper repository access scopes.`
            );
          }
          if (response.status === 404) {
            throw new Error(
              `Repository not found or not accessible (${response.status}): The repository may be private, doesn't exist, or your token lacks access permissions.`
            );
          }
          if (response.status === 403) {
            const resetTime = new Date(this.rateLimitReset).toISOString();
            throw new Error(
              `Rate limit exceeded (${response.status}): API rate limit reached. Resets at: ${resetTime}. Consider using authentication or waiting before retrying.`
            );
          }
          throw new Error(
            `HTTP ${response.status}: ${response.statusText} - The request failed. Please check the repository name, your token permissions, and network connectivity.`
          );
        }

        return response;
      } catch (error) {
        this.log(
          `Request failed (attempt ${attempt}): ${error.message}`,
          "error"
        );
        console.log(`Full error details: ${error.message}`); // Always show full error

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
      (this.options.fetchLimit === "infinite" ||
        fetchedCount < this.options.fetchLimit)
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
          results.push(...data);
          fetchedCount += data.length;
        } else {
          results.push(data);
          fetchedCount += 1;
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

        // Check fetch limit
        if (
          this.options.fetchLimit !== "infinite" &&
          fetchedCount >= this.options.fetchLimit
        ) {
          this.log(
            `Reached fetch limit of ${this.options.fetchLimit} items`,
            "info"
          );
          break;
        }
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

  async analyzeQualityDelta(owner, repo, startDate, endDate, token = null) {
    // Use provided token or fallback to instance token
    if (token) {
      this.token = token;
    }

    this.log(`Starting quality analysis for ${owner}/${repo}`, "info");
    this.log(`Date range: ${startDate} to ${endDate}`, "info");

    try {
      // Fetch all pull request comments in the date range
      this.log("Fetching pull request review comments...", "info");

      const comments = await this.fetchAllPages(
        `${this.baseUrl}/repos/${owner}/${repo}/pulls/comments`,
        {
          since: startDate,
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
            authorEmail:
              comment.user.email ||
              `${comment.user.login}@users.noreply.github.com`,
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
            prAuthorEmail:
              prDetails.user.email ||
              `${prDetails.user.login}@users.noreply.github.com`,
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
      console.log(`Full error details: ${error.message}`); // Always show full error
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
    const uniqueReviewerEmails = new Set(comments.map((c) => c.authorEmail))
      .size;

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

    // Email-based quality delta analysis
    const emailQualityDelta = this.calculateEmailQualityDelta(comments);

    // Calculate percentages
    const calculatePercentage = (count, total) =>
      ((count / total) * 100).toFixed(2);

    return {
      dateRange: `${startDate} to ${endDate}`,
      totalComments: comments.length,
      uniquePullRequests: uniquePRs,
      uniqueReviewers,
      uniqueAuthors,
      uniqueReviewerEmails,

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

      // Email-based quality delta
      emailQualityDelta,
    };
  }

  calculateEmailQualityDelta(comments) {
    const emailStats = {};

    comments.forEach((comment) => {
      const email = comment.authorEmail;
      if (!emailStats[email]) {
        emailStats[email] = {
          email,
          username: comment.author,
          totalComments: 0,
          nitpicks: 0,
          blockers: 0,
          styleComments: 0,
          logicComments: 0,
          securityComments: 0,
          codeSuggestions: 0,
          questions: 0,
          avgWordCount: 0,
          wordCounts: [],
          sentimentScores: { positive: 0, negative: 0, neutral: 0 },
          weeklyActivity: {},
        };
      }

      const stats = emailStats[email];
      stats.totalComments++;
      stats.wordCounts.push(comment.wordCount);

      if (comment.isNitpick) stats.nitpicks++;
      if (comment.isBlocker) stats.blockers++;
      if (comment.isStyleComment) stats.styleComments++;
      if (comment.isLogicComment) stats.logicComments++;
      if (comment.isSecurityComment) stats.securityComments++;
      if (comment.hasCodeSuggestion) stats.codeSuggestions++;
      if (comment.isQuestion) stats.questions++;

      stats.sentimentScores[comment.primarySentiment]++;

      // Weekly activity tracking
      const weekKey = new Date(comment.createdAt).toISOString().split("T")[0];
      stats.weeklyActivity[weekKey] = (stats.weeklyActivity[weekKey] || 0) + 1;
    });

    return Object.values(emailStats)
      .map((stats) => ({
        ...stats,
        avgWordCount: (
          stats.wordCounts.reduce((a, b) => a + b, 0) / stats.wordCounts.length
        ).toFixed(2),
        nitpickPercentage: (
          (stats.nitpicks / stats.totalComments) *
          100
        ).toFixed(2),
        blockerPercentage: (
          (stats.blockers / stats.totalComments) *
          100
        ).toFixed(2),
        stylePercentage: (
          (stats.styleComments / stats.totalComments) *
          100
        ).toFixed(2),
        logicPercentage: (
          (stats.logicComments / stats.totalComments) *
          100
        ).toFixed(2),
        securityPercentage: (
          (stats.securityComments / stats.totalComments) *
          100
        ).toFixed(2),
        codeSuggestionPercentage: (
          (stats.codeSuggestions / stats.totalComments) *
          100
        ).toFixed(2),
        questionPercentage: (
          (stats.questions / stats.totalComments) *
          100
        ).toFixed(2),
        qualityScore: this.calculateReviewerQualityScore(stats),
        wordCounts: undefined, // Remove for serialization
      }))
      .sort((a, b) => b.totalComments - a.totalComments);
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
          email: comment.authorEmail,
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
          email: comment.prAuthorEmail,
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
        { id: "authorEmail", title: "Reviewer Email" },
        { id: "prAuthor", title: "PR Author" },
        { id: "prAuthorEmail", title: "PR Author Email" },
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
    "Analyze GitHub repository code review comment patterns and quality metrics by user email"
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
  .option(
    "-s, --start <date>",
    "Start date (ISO format: YYYY-MM-DD)",
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]
  )
  .option(
    "-e, --end <date>",
    "End date (ISO format: YYYY-MM-DD)",
    new Date().toISOString().split("T")[0]
  )
  .option("-v, --verbose", "Enable verbose logging", false)
  .option("-d, --debug", "Enable debug logging", false)
  .option(
    "-t, --token <token>",
    "GitHub token (can also use GITHUB_TOKEN env var)"
  )
  .option(
    "-l, --fetchLimit <limit>",
    "Set fetch limit (default: 200, use 'infinite' for no limit)",
    "200"
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
        console.error(
          chalk.yellow(
            "Note: Use Bearer token format for GitHub API authentication"
          )
        );
        process.exit(1);
      }

      // Parse fetch limit
      const fetchLimit =
        options.fetchLimit === "infinite"
          ? "infinite"
          : parseInt(options.fetchLimit);
      if (fetchLimit !== "infinite" && (isNaN(fetchLimit) || fetchLimit < 1)) {
        console.error(
          chalk.red(
            "Error: Fetch limit must be a positive number or 'infinite'"
          )
        );
        process.exit(1);
      }

      // Generate output filename if not provided
      const timestamp = new Date().toISOString().split("T")[0];
      const defaultFilename = `${owner}-${repo}-quality-delta-${options.start}-to-${options.end}-${timestamp}`;
      const outputFilename =
        options.output || `${defaultFilename}.${options.format}`;

      console.log(
        chalk.blue("🔍 GitHub Repository Quality Delta Analysis Tool\n")
      );
      console.log(chalk.cyan(`Date Range: ${options.start} to ${options.end}`));

      // Initialize analyzer
      const analyzer = new GitHubQualityAnalyzer(token, {
        verbose: options.verbose,
        debug: options.debug,
        fetchLimit,
      });

      // Run analysis
      const results = await analyzer.analyzeQualityDelta(
        owner,
        repo,
        options.start,
        options.end,
        token
      );

      // Display summary
      console.log(chalk.green("\n📊 Quality Delta Analysis Summary:"));
      console.log(`Repository: ${results.repository}`);
      console.log(`Date Range: ${results.summary.dateRange}`);
      console.log(`Total Comments: ${results.totalComments}`);
      console.log(`Unique PRs: ${results.summary.uniquePullRequests}`);
      console.log(`Unique Reviewers: ${results.summary.uniqueReviewers}`);
      console.log(
        `Unique Reviewer Emails: ${results.summary.uniqueReviewerEmails}`
      );
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
          `\n✅ Quality delta analysis complete! Results saved to: ${outputFilename}`
        )
      );

      // Display top insights
      if (
        results.summary.topReviewers &&
        results.summary.topReviewers.length > 0
      ) {
        console.log(chalk.blue("\n👥 Top Reviewers by Email:"));
        results.summary.topReviewers.forEach((reviewer, index) => {
          console.log(
            `${index + 1}. ${reviewer.name} (${reviewer.email}) - ${
              reviewer.totalComments
            } comments, Quality Score: ${reviewer.qualityScore}/100`
          );
        });
      }

      if (
        results.summary.emailQualityDelta &&
        results.summary.emailQualityDelta.length > 0
      ) {
        console.log(chalk.blue("\n📧 Quality Delta by User Email (Top 5):"));
        results.summary.emailQualityDelta.slice(0, 5).forEach((user, index) => {
          console.log(
            `${index + 1}. ${user.email} (${user.username}) - ${
              user.totalComments
            } comments`
          );
          console.log(`   Quality Score: ${user.qualityScore}/100`);
          console.log(
            `   Nitpicks: ${user.nitpickPercentage}%, Logic: ${user.logicPercentage}%, Security: ${user.securityPercentage}%`
          );
        });
      }

      if (
        results.summary.mostReviewedAuthors &&
        results.summary.mostReviewedAuthors.length > 0
      ) {
        console.log(chalk.blue("\n📝 Most Reviewed Authors by Email:"));
        results.summary.mostReviewedAuthors.forEach((author, index) => {
          console.log(
            `${index + 1}. ${author.name} (${author.email}) - ${
              author.pullRequestCount
            } PRs, ${author.avgCommentsPerPR} avg comments/PR`
          );
        });
      }
    } catch (error) {
      console.error(chalk.red(`\n❌ Error: ${error.message}`));
      if (options.debug) {
        console.error(error.stack);
      }

      // Provide helpful error explanations
      if (error.message.includes("Authentication failed")) {
        console.error(
          chalk.yellow(
            "\n💡 Solution: Ensure your GitHub token uses the 'Bearer' format and has proper repository access scopes."
          )
        );
      } else if (error.message.includes("Repository not found")) {
        console.error(
          chalk.yellow(
            "\n💡 Solution: Check the repository name format (owner/repo) and ensure your token has access to this repository."
          )
        );
      } else if (error.message.includes("Rate limit exceeded")) {
        console.error(
          chalk.yellow(
            "\n💡 Solution: Wait for the rate limit to reset or use authentication to increase your API limits."
          )
        );
      }

      process.exit(1);
    }
  });

program.parse();
