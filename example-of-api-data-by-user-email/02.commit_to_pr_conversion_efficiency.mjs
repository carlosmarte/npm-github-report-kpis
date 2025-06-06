#!/usr/bin/env node

/*
JSON Report Structure:
{
  "repository": "owner/repo",
  "analysisDate": "2024-01-15T10:30:00.000Z",
  "dateRange": {
    "start": "2024-01-01",
    "end": "2024-01-31"
  },
  "userMetrics": {
    "user@example.com": {
      "totalCommits": 45,
      "commitsInPRs": 35,
      "prsCreated": 8,
      "prsMerged": 7,
      "commitToPREfficiency": 77.8,
      "avgCommitsPerPR": 4.4,
      "codeChurn": {
        "additions": 1250,
        "deletions": 340,
        "churnRate": 21.4
      }
    }
  },
  "repositoryMetrics": {
    "totalCommits": 342,
    "totalPRs": 67,
    "mergedPRs": 59,
    "overallEfficiency": 68.4
  },
  "summary": {
    "topPerformers": ["user1@example.com", "user2@example.com"],
    "efficiencyRating": "Medium",
    "recommendations": ["Encourage more PR usage", "Review large commits"]
  }
}

Use Cases:
1. Team Performance Review: Identify team members with high/low commit-to-PR ratios
2. Code Review Process Assessment: Understand how much code bypasses review
3. Development Workflow Optimization: Find opportunities to improve PR adoption
4. Quality Assurance: Correlate PR usage with code quality metrics
5. Onboarding Evaluation: Track new team member adoption of PR processes
6. Process Change Impact: Compare efficiency before/after workflow changes
7. Resource Allocation: Identify contributors who need additional PR training
*/

import { Command } from "commander";
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class GitHubAnalyzer {
  constructor(options = {}) {
    this.token = options.token || process.env.GITHUB_TOKEN;
    this.baseURL = "https://api.github.com";
    this.retryAttempts = 3;
    this.retryDelay = 1000;
    this.verbose = options.verbose || false;
    this.debug = options.debug || false;
    this.fetchLimit = options.fetchLimit || 200;
  }

  log(message, level = "info") {
    if (level === "debug" && !this.debug) return;
    if (level === "verbose" && !this.verbose && !this.debug) return;

    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${level.toUpperCase()}: ${message}`);
  }

  async makeRequest(url, retryCount = 0) {
    try {
      const headers = {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "GitHub-Analyzer-CLI",
      };

      if (this.token) {
        // Fix: Use Bearer token format instead of legacy token format
        headers["Authorization"] = `Bearer ${this.token}`;
      }

      this.log(`Making request to: ${url}`, "debug");
      const response = await fetch(url, { headers });

      // Handle rate limiting
      if (
        response.status === 403 &&
        response.headers.get("x-ratelimit-remaining") === "0"
      ) {
        const resetTime =
          parseInt(response.headers.get("x-ratelimit-reset")) * 1000;
        const waitTime = resetTime - Date.now() + 1000;
        this.log(
          `Rate limit exceeded. Waiting ${Math.ceil(
            waitTime / 1000
          )} seconds...`,
          "verbose"
        );
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        return this.makeRequest(url, retryCount);
      }

      // Handle authentication errors with friendly messaging
      if (response.status === 401) {
        throw new Error(
          "Authentication failed. Please check your GitHub token permissions and ensure it has repository access."
        );
      }

      if (response.status === 403) {
        const errorBody = await response.text();
        throw new Error(
          `Access forbidden. Your token might lack proper repository access scopes. GitHub response: ${errorBody}`
        );
      }

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `HTTP ${response.status}: ${response.statusText}. Response: ${errorBody}`
        );
      }

      const data = await response.json();
      return { data, response };
    } catch (error) {
      console.log(`Full error details: ${error.message}`);

      if (retryCount < this.retryAttempts) {
        this.log(
          `Request failed, retrying in ${this.retryDelay}ms... (${
            retryCount + 1
          }/${this.retryAttempts})`,
          "verbose"
        );
        await new Promise((resolve) => setTimeout(resolve, this.retryDelay));
        return this.makeRequest(url, retryCount + 1);
      }
      throw error;
    }
  }

  createProgressBar(total, current, label = "") {
    const width = 40;
    const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
    const filled = Math.round((width * current) / total);
    const empty = width - filled;

    const bar = "█".repeat(filled) + "░".repeat(empty);
    process.stdout.write(
      `\r${label} [${bar}] ${percentage}% (${current}/${total})`
    );

    if (current >= total) {
      console.log(""); // New line when complete
    }
  }

  async fetchAllPages(baseUrl, progressCallback, limitOverride = null) {
    let allData = [];
    let page = 1;
    let hasMore = true;
    const limit = limitOverride || this.fetchLimit;

    while (hasMore && (limit === -1 || allData.length < limit)) {
      const url = `${baseUrl}${
        baseUrl.includes("?") ? "&" : "?"
      }page=${page}&per_page=100`;

      try {
        const { data, response } = await this.makeRequest(url);
        allData = allData.concat(data);

        if (progressCallback) {
          progressCallback(allData.length, page);
        }

        const linkHeader = response.headers.get("link");
        hasMore =
          linkHeader && linkHeader.includes('rel="next"') && data.length > 0;
        page++;

        // Respect fetch limit
        if (limit !== -1 && allData.length >= limit) {
          allData = allData.slice(0, limit);
          break;
        }
      } catch (error) {
        this.log(`Failed to fetch page ${page}: ${error.message}`, "debug");
        break;
      }
    }

    return allData;
  }

  async analyzeCommitToPREfficiency(repo, owner, startDate, endDate, token) {
    this.token = token || this.token;

    if (!this.token) {
      throw new Error(
        "GitHub token is required. Set GITHUB_TOKEN environment variable or use --token flag."
      );
    }

    this.log(`Starting analysis for ${owner}/${repo}`, "info");
    this.log(
      `Date range: ${startDate || "30 days ago"} to ${endDate || "now"}`,
      "info"
    );

    // Set default start date to 30 days ago if not provided
    if (!startDate) {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      startDate = thirtyDaysAgo.toISOString().split("T")[0];
    }

    const results = {
      repository: `${owner}/${repo}`,
      analysisDate: new Date().toISOString(),
      dateRange: {
        start: startDate,
        end: endDate || new Date().toISOString().split("T")[0],
      },
      userMetrics: {},
      repositoryMetrics: {},
      summary: {},
    };

    try {
      // Fetch Pull Requests
      this.log("Fetching pull requests...", "info");
      let prUrl = `${this.baseURL}/repos/${owner}/${repo}/pulls?state=all`;
      if (startDate) prUrl += `&since=${startDate}T00:00:00Z`;

      const pulls = await this.fetchAllPages(prUrl, (count, page) => {
        this.createProgressBar(
          this.fetchLimit === -1 ? count + 100 : this.fetchLimit,
          count,
          "Fetching PRs"
        );
      });

      this.log(`Found ${pulls.length} pull requests`, "verbose");

      // Filter pulls by date range
      const filteredPulls = pulls.filter((pr) => {
        const prDate = new Date(pr.created_at);
        const start = startDate ? new Date(startDate) : null;
        const end = endDate ? new Date(endDate) : null;

        if (start && prDate < start) return false;
        if (end && prDate > end) return false;
        return true;
      });

      results.pullRequests = filteredPulls;

      // Fetch commits for each PR with user mapping
      this.log("Fetching commits for pull requests...", "info");
      const prCommitsByUser = new Map();
      let processedPRs = 0;

      for (const pr of filteredPulls) {
        try {
          const commitsUrl = `${this.baseURL}/repos/${owner}/${repo}/pulls/${pr.number}/commits`;
          const commits = await this.fetchAllPages(commitsUrl);

          // Map commits by user email
          commits.forEach((commit) => {
            const email =
              commit.commit?.author?.email ||
              commit.author?.email ||
              "unknown@unknown.com";
            if (!prCommitsByUser.has(email)) {
              prCommitsByUser.set(email, []);
            }
            prCommitsByUser.get(email).push({
              sha: commit.sha,
              prNumber: pr.number,
              prMerged: !!pr.merged_at,
              additions: commit.stats?.additions || 0,
              deletions: commit.stats?.deletions || 0,
            });
          });

          processedPRs++;
          this.createProgressBar(
            filteredPulls.length,
            processedPRs,
            "Processing PR commits"
          );
        } catch (error) {
          this.log(
            `Failed to fetch commits for PR #${pr.number}: ${error.message}`,
            "debug"
          );
        }
      }

      // Fetch all repository commits
      this.log("Fetching repository commits...", "info");
      let commitsUrl = `${this.baseURL}/repos/${owner}/${repo}/commits`;
      if (startDate) commitsUrl += `?since=${startDate}T00:00:00Z`;
      if (endDate) {
        commitsUrl += startDate
          ? `&until=${endDate}T23:59:59Z`
          : `?until=${endDate}T23:59:59Z`;
      }

      const allCommits = await this.fetchAllPages(commitsUrl, (count, page) => {
        this.createProgressBar(
          this.fetchLimit === -1 ? count + 100 : this.fetchLimit,
          count,
          "Fetching commits"
        );
      });

      // Group commits by user email
      const commitsByUser = new Map();
      allCommits.forEach((commit) => {
        const email =
          commit.commit?.author?.email ||
          commit.author?.email ||
          "unknown@unknown.com";
        if (!commitsByUser.has(email)) {
          commitsByUser.set(email, []);
        }
        commitsByUser.get(email).push(commit);
      });

      // Calculate user-specific metrics
      this.log("Calculating user metrics...", "info");
      const userEmails = new Set([
        ...commitsByUser.keys(),
        ...prCommitsByUser.keys(),
      ]);

      for (const email of userEmails) {
        const userCommits = commitsByUser.get(email) || [];
        const userPRCommits = prCommitsByUser.get(email) || [];

        // Get unique PRs created by user
        const userPRNumbers = new Set(userPRCommits.map((c) => c.prNumber));
        const userPRs = filteredPulls.filter(
          (pr) => pr.user?.email === email || userPRNumbers.has(pr.number)
        );

        const mergedPRs = userPRs.filter((pr) => pr.merged_at);

        // Calculate code churn for user's PRs
        let totalAdditions = 0;
        let totalDeletions = 0;
        userPRs.forEach((pr) => {
          totalAdditions += pr.additions || 0;
          totalDeletions += pr.deletions || 0;
        });

        const totalChanges = totalAdditions + totalDeletions;
        const churnRate =
          totalChanges > 0 ? (totalDeletions / totalChanges) * 100 : 0;

        const commitToPREfficiency =
          userCommits.length > 0
            ? (userPRCommits.length / userCommits.length) * 100
            : 0;

        results.userMetrics[email] = {
          totalCommits: userCommits.length,
          commitsInPRs: userPRCommits.length,
          prsCreated: userPRs.length,
          prsMerged: mergedPRs.length,
          commitToPREfficiency: Math.round(commitToPREfficiency * 100) / 100,
          avgCommitsPerPR:
            userPRs.length > 0 ? userPRCommits.length / userPRs.length : 0,
          codeChurn: {
            additions: totalAdditions,
            deletions: totalDeletions,
            churnRate: Math.round(churnRate * 100) / 100,
          },
        };
      }

      // Calculate repository-wide metrics
      const totalCommits = allCommits.length;
      const totalPRs = filteredPulls.length;
      const mergedPRs = filteredPulls.filter((pr) => pr.merged_at).length;
      const allPRCommits = Array.from(prCommitsByUser.values()).flat();
      const uniqueCommitsInPRs = new Set(allPRCommits.map((c) => c.sha)).size;
      const overallEfficiency =
        totalCommits > 0 ? (uniqueCommitsInPRs / totalCommits) * 100 : 0;

      results.repositoryMetrics = {
        totalCommits,
        totalPRs,
        mergedPRs,
        abandonedPRs: totalPRs - mergedPRs,
        overallEfficiency: Math.round(overallEfficiency * 100) / 100,
        avgCommitsPerPR: totalPRs > 0 ? allPRCommits.length / totalPRs : 0,
      };

      // Generate summary
      const userEfficiencies = Object.entries(results.userMetrics)
        .filter(([, metrics]) => metrics.totalCommits > 0)
        .sort((a, b) => b[1].commitToPREfficiency - a[1].commitToPREfficiency);

      const topPerformers = userEfficiencies
        .slice(0, 3)
        .map(([email]) => email);
      const avgEfficiency =
        userEfficiencies.length > 0
          ? userEfficiencies.reduce(
              (sum, [, metrics]) => sum + metrics.commitToPREfficiency,
              0
            ) / userEfficiencies.length
          : 0;

      results.summary = {
        topPerformers,
        averageUserEfficiency: Math.round(avgEfficiency * 100) / 100,
        efficiencyRating:
          avgEfficiency >= 70 ? "High" : avgEfficiency >= 50 ? "Medium" : "Low",
        recommendations: this.generateUserRecommendations(
          results.userMetrics,
          overallEfficiency
        ),
        dateRangeIncluded: `${results.dateRange.start} to ${results.dateRange.end}`,
      };

      this.log("Analysis completed successfully", "info");
      return results;
    } catch (error) {
      this.log(`Analysis failed: ${error.message}`, "info");
      throw error;
    }
  }

  generateUserRecommendations(userMetrics, overallEfficiency) {
    const recommendations = [];
    const users = Object.entries(userMetrics);

    const lowEfficiencyUsers = users.filter(
      ([, metrics]) =>
        metrics.commitToPREfficiency < 30 && metrics.totalCommits > 5
    );

    const highChurnUsers = users.filter(
      ([, metrics]) => metrics.codeChurn.churnRate > 50
    );

    if (lowEfficiencyUsers.length > 0) {
      recommendations.push(
        `${lowEfficiencyUsers.length} users have low commit-to-PR efficiency (<30%) - consider PR workflow training`
      );
    }

    if (highChurnUsers.length > 0) {
      recommendations.push(
        `${highChurnUsers.length} users show high code churn (>50%) - review code quality practices`
      );
    }

    if (overallEfficiency < 50) {
      recommendations.push(
        "Overall efficiency is low - consider enforcing PR requirements for all changes"
      );
    }

    const avgCommitsPerUser =
      users.length > 0
        ? users.reduce((sum, [, metrics]) => sum + metrics.totalCommits, 0) /
          users.length
        : 0;

    if (avgCommitsPerUser > 20) {
      recommendations.push(
        "High average commits per user - consider shorter development cycles"
      );
    }

    return recommendations.length > 0
      ? recommendations
      : ["User efficiency metrics appear healthy for the analyzed period"];
  }

  formatOutput(data, format) {
    if (format === "csv") {
      return this.convertToCSV(data);
    }
    return JSON.stringify(data, null, 2);
  }

  convertToCSV(data) {
    const lines = [];

    // Header
    lines.push("Type,Metric,Value");

    // Repository info
    lines.push(`Repository,Name,${data.repository}`);
    lines.push(`Repository,Analysis Date,${data.analysisDate}`);
    lines.push(`Repository,Date Range,${data.summary.dateRangeIncluded}`);

    // Repository metrics
    lines.push(
      `Repository,Total Commits,${data.repositoryMetrics.totalCommits}`
    );
    lines.push(`Repository,Total PRs,${data.repositoryMetrics.totalPRs}`);
    lines.push(`Repository,Merged PRs,${data.repositoryMetrics.mergedPRs}`);
    lines.push(
      `Repository,Overall Efficiency,${data.repositoryMetrics.overallEfficiency}%`
    );

    // Summary
    lines.push(
      `Summary,Average User Efficiency,${data.summary.averageUserEfficiency}%`
    );
    lines.push(`Summary,Efficiency Rating,${data.summary.efficiencyRating}`);
    lines.push(
      `Summary,Top Performer,${data.summary.topPerformers[0] || "N/A"}`
    );

    // User metrics header
    lines.push(
      "User,Email,Total Commits,Commits in PRs,PRs Created,PRs Merged,Efficiency %,Avg Commits/PR,Churn Rate %"
    );

    // User data
    Object.entries(data.userMetrics).forEach(([email, metrics]) => {
      lines.push(
        `User,${email},${metrics.totalCommits},${metrics.commitsInPRs},${
          metrics.prsCreated
        },${metrics.prsMerged},${
          metrics.commitToPREfficiency
        },${metrics.avgCommitsPerPR.toFixed(1)},${metrics.codeChurn.churnRate}`
      );
    });

    return lines.join("\n");
  }
}

// CLI Setup
const program = new Command();

program
  .name("github-analyzer")
  .description(
    "Analyze GitHub repository commit-to-PR conversion efficiency by user email"
  )
  .version("1.0.0");

program
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
    "Start date (ISO format: YYYY-MM-DD) - default: 30 days ago"
  )
  .option(
    "-e, --end <date>",
    "End date (ISO format: YYYY-MM-DD) - default: now"
  )
  .option("-v, --verbose", "Enable verbose logging")
  .option("-d, --debug", "Enable debug logging")
  .option("-t, --token <token>", "GitHub token (or set GITHUB_TOKEN env var)")
  .option(
    "-l, --fetchLimit <number>",
    "Set fetch limit (default: 200, use -1 for infinite)",
    "200"
  )
  .action(async (options) => {
    try {
      // Parse repository
      const [owner, repo] = options.repo.split("/");
      if (!owner || !repo) {
        console.error('Error: Repository must be in format "owner/repo"');
        process.exit(1);
      }

      // Validate date formats
      if (options.start && !/^\d{4}-\d{2}-\d{2}$/.test(options.start)) {
        console.error("Error: Start date must be in YYYY-MM-DD format");
        process.exit(1);
      }

      if (options.end && !/^\d{4}-\d{2}-\d{2}$/.test(options.end)) {
        console.error("Error: End date must be in YYYY-MM-DD format");
        process.exit(1);
      }

      // Parse fetch limit
      const fetchLimit = parseInt(options.fetchLimit);
      if (isNaN(fetchLimit) && options.fetchLimit !== "-1") {
        console.error("Error: Fetch limit must be a number or -1 for infinite");
        process.exit(1);
      }

      // Create analyzer
      const analyzer = new GitHubAnalyzer({
        verbose: options.verbose,
        debug: options.debug,
        token: options.token,
        fetchLimit: fetchLimit === -1 ? -1 : fetchLimit,
      });

      // Run analysis
      console.log(
        `🔍 Analyzing ${owner}/${repo} for commit-to-PR efficiency by user...`
      );
      const results = await analyzer.analyzeCommitToPREfficiency(
        repo,
        owner,
        options.start,
        options.end,
        options.token
      );

      // Generate output filename
      const timestamp = new Date().toISOString().split("T")[0];
      const dateRange = `${results.dateRange.start}_to_${results.dateRange.end}`;
      const defaultFilename = `${owner}_${repo}_user_efficiency_${dateRange}_${timestamp}.${options.format}`;
      const outputFile = options.output || defaultFilename;

      // Format and save output
      const formattedOutput = analyzer.formatOutput(results, options.format);
      writeFileSync(outputFile, formattedOutput);

      // Display summary
      console.log("\n📊 Analysis Summary:");
      console.log(`Repository: ${results.repository}`);
      console.log(`Date Range: ${results.summary.dateRangeIncluded}`);
      console.log(
        `Total Users Analyzed: ${Object.keys(results.userMetrics).length}`
      );
      console.log(
        `Repository Efficiency: ${results.repositoryMetrics.overallEfficiency}%`
      );
      console.log(
        `Average User Efficiency: ${results.summary.averageUserEfficiency}%`
      );
      console.log(`Efficiency Rating: ${results.summary.efficiencyRating}`);

      console.log("\n🏆 Top Performers:");
      results.summary.topPerformers.slice(0, 3).forEach((email, index) => {
        const metrics = results.userMetrics[email];
        console.log(
          `${index + 1}. ${email}: ${metrics.commitToPREfficiency}% efficiency`
        );
      });

      console.log("\n💡 Recommendations:");
      results.summary.recommendations.forEach((rec) => console.log(`• ${rec}`));

      console.log(`\n✅ Results saved to: ${outputFile}`);
    } catch (error) {
      console.error(`❌ Error: ${error.message}`);
      if (options.debug) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

program.parse();
