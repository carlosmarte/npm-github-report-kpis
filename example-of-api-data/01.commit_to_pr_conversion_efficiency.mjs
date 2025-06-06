#!/usr/bin/env node

import { Command } from "commander";
import { writeFileSync } from "fs";
import { join } from "path";
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
        headers["Authorization"] = `token ${this.token}`;
      }

      this.log(`Making request to: ${url}`, "debug");
      const response = await fetch(url, { headers });

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

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return { data, response };
    } catch (error) {
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

  async fetchAllPages(baseUrl, progressCallback) {
    let allData = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const url = `${baseUrl}${
        baseUrl.includes("?") ? "&" : "?"
      }page=${page}&per_page=100`;
      const { data, response } = await this.makeRequest(url);

      allData = allData.concat(data);

      if (progressCallback) {
        progressCallback(allData.length, page);
      }

      const linkHeader = response.headers.get("link");
      hasMore = linkHeader && linkHeader.includes('rel="next"');
      page++;
    }

    return allData;
  }

  formatDateFilter(date) {
    return date ? `&since=${date}T00:00:00Z` : "";
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
      `Date range: ${startDate || "beginning"} to ${endDate || "now"}`,
      "info"
    );

    const results = {
      repository: `${owner}/${repo}`,
      analysisDate: new Date().toISOString(),
      dateRange: {
        start: startDate || null,
        end: endDate || null,
      },
      metrics: {},
      pullRequests: [],
      commits: [],
      summary: {},
    };

    try {
      // Fetch Pull Requests
      this.log("Fetching pull requests...", "info");
      let prUrl = `${this.baseURL}/repos/${owner}/${repo}/pulls?state=all`;
      if (startDate) prUrl += `&since=${startDate}T00:00:00Z`;

      const pulls = await this.fetchAllPages(prUrl, (count, page) => {
        process.stdout.write(
          `\rFetched ${count} pull requests (page ${page})...`
        );
      });
      console.log(""); // New line after progress

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

      // Fetch commits for each PR
      this.log("Fetching commits for pull requests...", "info");
      const prCommits = new Map();
      let processedPRs = 0;

      for (const pr of filteredPulls) {
        try {
          const commitsUrl = `${this.baseURL}/repos/${owner}/${repo}/pulls/${pr.number}/commits`;
          const commits = await this.fetchAllPages(commitsUrl);
          prCommits.set(pr.number, commits);

          processedPRs++;
          process.stdout.write(
            `\rProcessed ${processedPRs}/${filteredPulls.length} PRs for commits...`
          );
        } catch (error) {
          this.log(
            `Failed to fetch commits for PR #${pr.number}: ${error.message}`,
            "debug"
          );
        }
      }
      console.log(""); // New line after progress

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
        process.stdout.write(
          `\rFetched ${count} repository commits (page ${page})...`
        );
      });
      console.log(""); // New line after progress

      results.commits = allCommits;

      // Calculate metrics
      this.log("Calculating metrics...", "info");

      const totalCommits = allCommits.length;
      const totalPRs = filteredPulls.length;
      const mergedPRs = filteredPulls.filter((pr) => pr.merged_at).length;
      const abandonedPRs = filteredPulls.filter(
        (pr) => pr.state === "closed" && !pr.merged_at
      ).length;

      // Calculate commits tied to PRs
      const commitsInPRs = Array.from(prCommits.values()).flat();
      const uniqueCommitsInPRs = new Set(commitsInPRs.map((c) => c.sha)).size;

      // Calculate code churn metrics
      let totalAdditions = 0;
      let totalDeletions = 0;
      let totalChanges = 0;

      for (const pr of filteredPulls) {
        totalAdditions += pr.additions || 0;
        totalDeletions += pr.deletions || 0;
        totalChanges += (pr.additions || 0) + (pr.deletions || 0);
      }

      const churnRate =
        totalChanges > 0 ? (totalDeletions / totalChanges) * 100 : 0;
      const commitToPRRatio =
        totalCommits > 0 ? (uniqueCommitsInPRs / totalCommits) * 100 : 0;

      // Average commits per PR
      const avgCommitsPerPR = totalPRs > 0 ? commitsInPRs.length / totalPRs : 0;
      const avgCommitsPerMergedPR =
        mergedPRs > 0
          ? Array.from(prCommits.entries())
              .filter(([prNumber]) =>
                filteredPulls.find(
                  (pr) => pr.number === prNumber && pr.merged_at
                )
              )
              .reduce((sum, [, commits]) => sum + commits.length, 0) / mergedPRs
          : 0;

      results.metrics = {
        totalCommits,
        totalPRs,
        mergedPRs,
        abandonedPRs,
        uniqueCommitsInPRs,
        commitToPRConversionRate: commitToPRRatio,
        avgCommitsPerPR,
        avgCommitsPerMergedPR,
        codeChurn: {
          totalAdditions,
          totalDeletions,
          totalChanges,
          churnRate,
        },
      };

      results.summary = {
        commitToPREfficiency:
          commitToPRRatio >= 70
            ? "High"
            : commitToPRRatio >= 50
            ? "Medium"
            : "Low",
        codeQuality:
          churnRate <= 30 ? "High" : churnRate <= 50 ? "Medium" : "Low",
        prSuccessRate: totalPRs > 0 ? (mergedPRs / totalPRs) * 100 : 0,
        recommendations: this.generateRecommendations(
          commitToPRRatio,
          churnRate,
          avgCommitsPerPR
        ),
      };

      this.log("Analysis completed successfully", "info");
      return results;
    } catch (error) {
      this.log(`Analysis failed: ${error.message}`, "info");
      throw error;
    }
  }

  generateRecommendations(commitToPRRatio, churnRate, avgCommitsPerPR) {
    const recommendations = [];

    if (commitToPRRatio < 50) {
      recommendations.push(
        "Low commit-to-PR conversion suggests many commits aren't going through PR review process"
      );
    }

    if (churnRate > 50) {
      recommendations.push(
        "High code churn rate indicates potential rework or frequent changes"
      );
    }

    if (avgCommitsPerPR > 10) {
      recommendations.push(
        "Large number of commits per PR may indicate need for smaller, focused changes"
      );
    }

    if (avgCommitsPerPR < 2) {
      recommendations.push(
        "Very few commits per PR might suggest overly granular changes"
      );
    }

    return recommendations.length > 0
      ? recommendations
      : ["Metrics appear healthy for the analyzed period"];
  }

  formatOutput(data, format) {
    if (format === "csv") {
      return this.convertToCSV(data);
    }
    return JSON.stringify(data, null, 2);
  }

  convertToCSV(data) {
    const lines = [];
    lines.push("Metric,Value");

    // Add summary metrics
    lines.push(`Repository,${data.repository}`);
    lines.push(`Analysis Date,${data.analysisDate}`);
    lines.push(`Date Range Start,${data.dateRange.start || "N/A"}`);
    lines.push(`Date Range End,${data.dateRange.end || "N/A"}`);
    lines.push(`Total Commits,${data.metrics.totalCommits}`);
    lines.push(`Total PRs,${data.metrics.totalPRs}`);
    lines.push(`Merged PRs,${data.metrics.mergedPRs}`);
    lines.push(`Abandoned PRs,${data.metrics.abandonedPRs}`);
    lines.push(`Commits in PRs,${data.metrics.uniqueCommitsInPRs}`);
    lines.push(
      `Commit-to-PR Conversion Rate,${data.metrics.commitToPRConversionRate.toFixed(
        2
      )}%`
    );
    lines.push(`Avg Commits per PR,${data.metrics.avgCommitsPerPR.toFixed(2)}`);
    lines.push(
      `Avg Commits per Merged PR,${data.metrics.avgCommitsPerMergedPR.toFixed(
        2
      )}`
    );
    lines.push(
      `Code Churn Rate,${data.metrics.codeChurn.churnRate.toFixed(2)}%`
    );
    lines.push(`Total Additions,${data.metrics.codeChurn.totalAdditions}`);
    lines.push(`Total Deletions,${data.metrics.codeChurn.totalDeletions}`);
    lines.push(`PR Success Rate,${data.summary.prSuccessRate.toFixed(2)}%`);

    return lines.join("\n");
  }
}

// CLI Setup
const program = new Command();

program
  .name("github-analyzer")
  .description(
    "Analyze GitHub repository commit-to-PR conversion efficiency and code churn"
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
  .option("-s, --start <date>", "Start date (ISO format: YYYY-MM-DD)")
  .option("-e, --end <date>", "End date (ISO format: YYYY-MM-DD)")
  .option("-v, --verbose", "Enable verbose logging")
  .option("-d, --debug", "Enable debug logging")
  .option("-t, --token <token>", "GitHub token (or set GITHUB_TOKEN env var)")
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

      // Create analyzer
      const analyzer = new GitHubAnalyzer({
        verbose: options.verbose,
        debug: options.debug,
        token: options.token,
      });

      // Run analysis
      console.log(`🔍 Analyzing ${owner}/${repo}...`);
      const results = await analyzer.analyzeCommitToPREfficiency(
        repo,
        owner,
        options.start,
        options.end,
        options.token
      );

      // Generate output filename
      const timestamp = new Date().toISOString().split("T")[0];
      const dateRange =
        options.start && options.end
          ? `_${options.start}_to_${options.end}`
          : options.start
          ? `_from_${options.start}`
          : options.end
          ? `_until_${options.end}`
          : "";
      const defaultFilename = `${owner}_${repo}_analysis${dateRange}_${timestamp}.${options.format}`;
      const outputFile = options.output || defaultFilename;

      // Format and save output
      const formattedOutput = analyzer.formatOutput(results, options.format);
      writeFileSync(outputFile, formattedOutput);

      // Display summary
      console.log("\n📊 Analysis Summary:");
      console.log(`Repository: ${results.repository}`);
      console.log(
        `Date Range: ${results.dateRange.start || "beginning"} to ${
          results.dateRange.end || "now"
        }`
      );
      console.log(`Total Commits: ${results.metrics.totalCommits}`);
      console.log(`Total PRs: ${results.metrics.totalPRs}`);
      console.log(
        `Commit-to-PR Conversion: ${results.metrics.commitToPRConversionRate.toFixed(
          2
        )}%`
      );
      console.log(
        `Code Churn Rate: ${results.metrics.codeChurn.churnRate.toFixed(2)}%`
      );
      console.log(
        `PR Success Rate: ${results.summary.prSuccessRate.toFixed(2)}%`
      );

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
