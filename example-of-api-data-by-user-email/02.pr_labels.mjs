#!/usr/bin/env node

/**
 * GitHub PR Labels Analytics CLI Tool
 *
 * JSON Report Structure:
 * {
 *   "repository": "owner/repo",
 *   "analysis_period": {
 *     "start_date": "2024-01-01",
 *     "end_date": "2024-01-31"
 *   },
 *   "summary": {
 *     "total_prs": 150,
 *     "total_labels": 25,
 *     "most_common_label": "feature",
 *     "label_distribution": {...}
 *   },
 *   "labels": [
 *     {
 *       "name": "feature",
 *       "description": "New feature implementation",
 *       "color": "0052cc",
 *       "count": 45,
 *       "percentage": 30.0,
 *       "prs": [...]
 *     }
 *   ],
 *   "categories": {
 *     "feature": 45,
 *     "fix": 32,
 *     "enhancement": 28,
 *     "documentation": 15
 *   },
 *   "insights": {
 *     "top_labels": [...],
 *     "trends": {...},
 *     "recommendations": [...]
 *   }
 * }
 *
 * Use Cases:
 * - Team Productivity Analysis: Track PR categorization patterns
 * - Quality Assessment: Monitor bug fix vs feature ratio
 * - Process Optimization: Identify labeling consistency
 * - Release Planning: Analyze feature delivery patterns
 * - Workflow Insights: Compare development focus areas
 * - Compliance Reporting: Track documentation and testing labels
 */

import { readFileSync } from "fs";
import { writeFileSync } from "fs";
import { createWriteStream } from "fs";
import https from "https";
import { URL } from "url";

class GitHubPRLabelsAnalyzer {
  constructor(repo, owner, startDate, endDate, token) {
    this.repo = repo;
    this.owner = owner;
    this.startDate = startDate;
    this.endDate = endDate;
    this.token = token;
    this.baseUrl = "https://api.github.com";
    this.requestCount = 0;
    this.maxRetries = 3;
    this.retryDelay = 1000;
  }

  async makeRequest(endpoint, page = 1, perPage = 100) {
    return new Promise((resolve, reject) => {
      const url = new URL(`${this.baseUrl}${endpoint}`);
      url.searchParams.append("page", page.toString());
      url.searchParams.append("per_page", perPage.toString());
      url.searchParams.append("state", "all");
      url.searchParams.append("sort", "updated");
      url.searchParams.append("direction", "desc");

      const options = {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.token}`, // Fixed: Use Bearer format
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "GitHub-PR-Labels-Analyzer/1.0",
        },
      };

      const req = https.request(url, options, (res) => {
        let data = "";

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          this.requestCount++;

          try {
            const parsed = JSON.parse(data);

            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve({
                data: parsed,
                headers: res.headers,
                statusCode: res.statusCode,
              });
            } else {
              reject(
                new Error(
                  `GitHub API Error (${res.statusCode}): ${
                    parsed.message || "Unknown error"
                  }`
                )
              );
            }
          } catch (error) {
            reject(
              new Error(`JSON Parse Error: ${error.message}\nResponse: ${data}`)
            );
          }
        });
      });

      req.on("error", (error) => {
        reject(new Error(`Request Error: ${error.message}`));
      });

      req.setTimeout(30000, () => {
        req.destroy();
        reject(new Error("Request timeout (30s)"));
      });

      req.end();
    });
  }

  async makeRequestWithRetry(
    endpoint,
    page = 1,
    perPage = 100,
    retryCount = 0
  ) {
    try {
      return await this.makeRequest(endpoint, page, perPage);
    } catch (error) {
      console.log(`Full error details: ${error.message}`);

      if (retryCount < this.maxRetries) {
        console.log(
          `Retrying request (${retryCount + 1}/${this.maxRetries}) after ${
            this.retryDelay
          }ms...`
        );
        await this.sleep(this.retryDelay * (retryCount + 1));
        return this.makeRequestWithRetry(
          endpoint,
          page,
          perPage,
          retryCount + 1
        );
      }

      // Provide friendly error messages while still logging full details
      if (error.message.includes("401")) {
        throw new Error(
          "Authentication failed. Please check your GitHub token permissions and format."
        );
      } else if (error.message.includes("403")) {
        throw new Error(
          "Access forbidden. Your token may lack repository access or hit rate limits."
        );
      } else if (error.message.includes("404")) {
        throw new Error(
          `Repository '${this.owner}/${this.repo}' not found or not accessible.`
        );
      }

      throw error;
    }
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  isWithinDateRange(prDate) {
    const date = new Date(prDate);
    const start = new Date(this.startDate);
    const end = new Date(this.endDate);
    return date >= start && date <= end;
  }

  updateProgressBar(current, total, operation) {
    const percentage = Math.round((current / total) * 100);
    const barLength = 30;
    const filledLength = Math.round((barLength * current) / total);
    const bar = "█".repeat(filledLength) + "░".repeat(barLength - filledLength);

    process.stdout.write(
      `\r${operation}: [${bar}] ${percentage}% (${current}/${total})`
    );

    if (current === total) {
      process.stdout.write("\n");
    }
  }

  async fetchAllPRs(fetchLimit = 200) {
    console.log(
      `\nFetching PRs for ${this.owner}/${this.repo} from ${this.startDate} to ${this.endDate}...`
    );

    const allPRs = [];
    let page = 1;
    let hasMorePages = true;
    let fetchedCount = 0;

    while (
      hasMorePages &&
      (fetchLimit === "infinite" || fetchedCount < fetchLimit)
    ) {
      try {
        const response = await this.makeRequestWithRetry(
          `/repos/${this.owner}/${this.repo}/pulls`,
          page,
          100
        );

        const prs = response.data;

        if (prs.length === 0) {
          hasMorePages = false;
          break;
        }

        // Filter PRs by date range
        const filteredPRs = prs.filter(
          (pr) =>
            this.isWithinDateRange(pr.created_at) ||
            this.isWithinDateRange(pr.updated_at)
        );

        allPRs.push(...filteredPRs);
        fetchedCount += prs.length;

        this.updateProgressBar(
          Math.min(
            fetchedCount,
            fetchLimit === "infinite" ? fetchedCount : fetchLimit
          ),
          fetchLimit === "infinite" ? fetchedCount + 100 : fetchLimit,
          "Fetching PRs"
        );

        // Check rate limiting
        const remaining =
          parseInt(response.headers["x-ratelimit-remaining"]) || 0;
        if (remaining < 10) {
          const resetTime =
            parseInt(response.headers["x-ratelimit-reset"]) * 1000;
          const waitTime = resetTime - Date.now() + 1000;
          if (waitTime > 0) {
            console.log(
              `\nRate limit approaching. Waiting ${Math.round(
                waitTime / 1000
              )}s...`
            );
            await this.sleep(waitTime);
          }
        }

        page++;

        // If we've reached our fetch limit, break
        if (fetchLimit !== "infinite" && fetchedCount >= fetchLimit) {
          hasMorePages = false;
        }
      } catch (error) {
        console.error(`\nError fetching PRs on page ${page}:`, error.message);
        break;
      }
    }

    console.log(`\nFetched ${allPRs.length} PRs within date range.`);
    return allPRs;
  }

  analyzePRLabels(prs) {
    console.log("\nAnalyzing PR labels...");

    const labelStats = new Map();
    const categoryStats = new Map();

    prs.forEach((pr, index) => {
      this.updateProgressBar(index + 1, prs.length, "Analyzing labels");

      pr.labels.forEach((label) => {
        if (!labelStats.has(label.name)) {
          labelStats.set(label.name, {
            name: label.name,
            description: label.description || "",
            color: label.color,
            count: 0,
            prs: [],
          });
        }

        const labelData = labelStats.get(label.name);
        labelData.count++;
        labelData.prs.push({
          number: pr.number,
          title: pr.title,
          url: pr.html_url,
          created_at: pr.created_at,
          state: pr.state,
        });

        // Categorize labels
        const category = this.categorizeLabel(label.name);
        categoryStats.set(category, (categoryStats.get(category) || 0) + 1);
      });
    });

    // Convert maps to arrays and calculate percentages
    const totalPRs = prs.length;
    const labels = Array.from(labelStats.values())
      .map((label) => ({
        ...label,
        percentage: ((label.count / totalPRs) * 100).toFixed(2),
      }))
      .sort((a, b) => b.count - a.count);

    const categories = Object.fromEntries(categoryStats);

    return {
      labels,
      categories,
      totalPRs,
      totalLabels: labels.length,
    };
  }

  categorizeLabel(labelName) {
    const name = labelName.toLowerCase();

    if (
      name.includes("feature") ||
      name.includes("enhancement") ||
      name.includes("new")
    ) {
      return "feature";
    } else if (
      name.includes("bug") ||
      name.includes("fix") ||
      name.includes("hotfix")
    ) {
      return "fix";
    } else if (name.includes("doc") || name.includes("readme")) {
      return "documentation";
    } else if (name.includes("test") || name.includes("spec")) {
      return "testing";
    } else if (name.includes("refactor") || name.includes("cleanup")) {
      return "refactoring";
    } else if (name.includes("security") || name.includes("vulnerability")) {
      return "security";
    } else if (name.includes("performance") || name.includes("optimization")) {
      return "performance";
    } else {
      return "other";
    }
  }

  generateInsights(analysis) {
    const { labels, categories, totalPRs } = analysis;

    const topLabels = labels.slice(0, 5);
    const mostCommonLabel = labels[0]?.name || "None";

    const recommendations = [];

    // Analyze label distribution
    if (categories.fix && categories.feature) {
      const fixRatio = (categories.fix / totalPRs) * 100;
      const featureRatio = (categories.feature / totalPRs) * 100;

      if (fixRatio > featureRatio * 1.5) {
        recommendations.push(
          "High bug fix ratio detected. Consider implementing more preventive measures."
        );
      } else if (featureRatio > fixRatio * 3) {
        recommendations.push(
          "Feature-heavy development detected. Ensure adequate testing and documentation."
        );
      }
    }

    if (
      !categories.documentation ||
      categories.documentation < totalPRs * 0.1
    ) {
      recommendations.push(
        "Low documentation activity. Consider increasing documentation efforts."
      );
    }

    if (!categories.testing || categories.testing < totalPRs * 0.15) {
      recommendations.push(
        "Limited testing-related PRs. Consider improving test coverage."
      );
    }

    return {
      topLabels,
      mostCommonLabel,
      recommendations,
      trends: {
        fix_to_feature_ratio:
          categories.fix && categories.feature
            ? (categories.fix / categories.feature).toFixed(2)
            : "N/A",
        documentation_coverage: categories.documentation
          ? ((categories.documentation / totalPRs) * 100).toFixed(2) + "%"
          : "0%",
        testing_coverage: categories.testing
          ? ((categories.testing / totalPRs) * 100).toFixed(2) + "%"
          : "0%",
      },
    };
  }

  generateReport(analysis) {
    const insights = this.generateInsights(analysis);

    return {
      repository: `${this.owner}/${this.repo}`,
      analysis_period: {
        start_date: this.startDate,
        end_date: this.endDate,
      },
      summary: {
        total_prs: analysis.totalPRs,
        total_labels: analysis.totalLabels,
        most_common_label: insights.mostCommonLabel,
        label_distribution: analysis.categories,
      },
      labels: analysis.labels,
      categories: analysis.categories,
      insights: insights,
      generated_at: new Date().toISOString(),
      api_requests_made: this.requestCount,
    };
  }

  async exportToJSON(report, filename) {
    const jsonData = JSON.stringify(report, null, 2);
    writeFileSync(filename, jsonData, "utf8");
    console.log(`\nJSON report exported to: ${filename}`);
  }

  async exportToCSV(report, filename) {
    const csvLines = ["Label Name,Count,Percentage,Description,Color,Category"];

    report.labels.forEach((label) => {
      const category = this.categorizeLabel(label.name);
      const line = [
        `"${label.name}"`,
        label.count,
        label.percentage,
        `"${label.description}"`,
        label.color,
        category,
      ].join(",");
      csvLines.push(line);
    });

    const csvData = csvLines.join("\n");
    writeFileSync(filename, csvData, "utf8");
    console.log(`\nCSV report exported to: ${filename}`);
  }

  async analyze(fetchLimit = 200) {
    try {
      console.log(`Starting PR labels analysis for ${this.owner}/${this.repo}`);
      console.log(`Date range: ${this.startDate} to ${this.endDate}`);
      console.log(
        `Fetch limit: ${fetchLimit === "infinite" ? "No limit" : fetchLimit}`
      );

      const prs = await this.fetchAllPRs(fetchLimit);

      if (prs.length === 0) {
        throw new Error("No PRs found in the specified date range.");
      }

      const analysis = this.analyzePRLabels(prs);
      const report = this.generateReport(analysis);

      return report;
    } catch (error) {
      throw new Error(`Analysis failed: ${error.message}`);
    }
  }
}

// CLI Implementation
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    repo: null,
    format: "json",
    output: null,
    start: null,
    end: null,
    verbose: false,
    debug: false,
    token: process.env.GITHUB_TOKEN,
    fetchLimit: 200,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "-r":
      case "--repo":
        options.repo = args[++i];
        break;
      case "-f":
      case "--format":
        options.format = args[++i];
        break;
      case "-o":
      case "--output":
        options.output = args[++i];
        break;
      case "-s":
      case "--start":
        options.start = args[++i];
        break;
      case "-e":
      case "--end":
        options.end = args[++i];
        break;
      case "-t":
      case "--token":
        options.token = args[++i];
        break;
      case "-l":
      case "--fetchLimit":
        const limit = args[++i];
        options.fetchLimit =
          limit === "infinite" ? "infinite" : parseInt(limit);
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
        showHelp();
        process.exit(0);
        break;
    }
  }

  return options;
}

function showHelp() {
  console.log(`
GitHub PR Labels Analytics CLI Tool

Usage: node main.mjs [options]

Options:
  -r, --repo <owner/repo>         Repository to analyze (required)
  -f, --format <format>           Output format: json (default) or csv
  -o, --output <filename>         Output filename (auto-generated if not provided)
  -s, --start <date>              Start date (ISO format: YYYY-MM-DD) default -30 days
  -e, --end <date>                End date (ISO format: YYYY-MM-DD) default: now
  -v, --verbose                   Enable verbose logging
  -d, --debug                     Enable debug logging
  -t, --token <token>             GitHub Token (or use GITHUB_TOKEN env var)
  -l, --fetchLimit <number>       Set fetch limit (default: 200, use 'infinite' for no limit)
  -h, --help                      Show help message

Examples:
  node main.mjs -r microsoft/vscode -s 2024-01-01 -e 2024-01-31
  node main.mjs -r facebook/react -f csv -l infinite
  node main.mjs -r owner/repo -t ghp_xxxxxxxxxxxx --verbose
    `);
}

function validateOptions(options) {
  if (!options.repo) {
    throw new Error("Repository (-r, --repo) is required. Format: owner/repo");
  }

  if (!options.repo.includes("/")) {
    throw new Error("Repository must be in format: owner/repo");
  }

  if (!options.token) {
    throw new Error(
      "GitHub token is required. Use -t flag or set GITHUB_TOKEN environment variable."
    );
  }

  if (!["json", "csv"].includes(options.format)) {
    throw new Error('Format must be either "json" or "csv"');
  }

  // Set default dates if not provided
  if (!options.end) {
    options.end = new Date().toISOString().split("T")[0];
  }

  if (!options.start) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    options.start = thirtyDaysAgo.toISOString().split("T")[0];
  }

  // Validate date format
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(options.start) || !dateRegex.test(options.end)) {
    throw new Error("Dates must be in YYYY-MM-DD format");
  }

  if (new Date(options.start) > new Date(options.end)) {
    throw new Error("Start date must be before end date");
  }

  return options;
}

function generateFilename(repo, format, start, end) {
  const repoName = repo.replace("/", "_");
  const dateRange = `${start}_to_${end}`;
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, "-");
  return `pr_labels_${repoName}_${dateRange}_${timestamp}.${format}`;
}

async function main() {
  try {
    const options = parseArgs();
    validateOptions(options);

    const [owner, repo] = options.repo.split("/");

    if (options.verbose) {
      console.log("Configuration:", {
        repository: options.repo,
        format: options.format,
        start: options.start,
        end: options.end,
        fetchLimit: options.fetchLimit,
        output: options.output || "auto-generated",
      });
    }

    const analyzer = new GitHubPRLabelsAnalyzer(
      repo,
      owner,
      options.start,
      options.end,
      options.token
    );

    const report = await analyzer.analyze(options.fetchLimit);

    // Generate output filename if not provided
    const filename =
      options.output ||
      generateFilename(
        options.repo,
        options.format,
        options.start,
        options.end
      );

    // Export report
    if (options.format === "json") {
      await analyzer.exportToJSON(report, filename);
    } else {
      await analyzer.exportToCSV(report, filename);
    }

    // Display summary
    console.log("\n=== Analysis Summary ===");
    console.log(`Repository: ${report.repository}`);
    console.log(
      `Period: ${report.analysis_period.start_date} to ${report.analysis_period.end_date}`
    );
    console.log(`Total PRs: ${report.summary.total_prs}`);
    console.log(`Unique Labels: ${report.summary.total_labels}`);
    console.log(`Most Common Label: ${report.summary.most_common_label}`);
    console.log(`API Requests: ${report.api_requests_made}`);

    if (options.verbose && report.insights.recommendations.length > 0) {
      console.log("\n=== Recommendations ===");
      report.insights.recommendations.forEach((rec) => {
        console.log(`• ${rec}`);
      });
    }

    console.log(`\nReport exported to: ${filename}`);
  } catch (error) {
    console.error(`\nError: ${error.message}`);

    if (
      error.message.includes("Authentication") ||
      error.message.includes("token")
    ) {
      console.error("\nTroubleshooting:");
      console.error("1. Ensure your GitHub token is valid");
      console.error('2. Token must have "repo" scope for private repositories');
      console.error(
        "3. Use Bearer token format (GitHub Personal Access Token)"
      );
      console.error(
        "4. Set token via -t flag or GITHUB_TOKEN environment variable"
      );
    }

    process.exit(1);
  }
}

// Run CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { GitHubPRLabelsAnalyzer };
