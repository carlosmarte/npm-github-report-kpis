#!/usr/bin/env node

/*
JSON Report Structure:
{
  "repository": "owner/repo",
  "analysis_period": {
    "start_date": "2024-01-01",
    "end_date": "2024-01-31",
    "total_weeks": 4.4
  },
  "summary": {
    "total_prs": 45,
    "total_developers": 8,
    "avg_prs_per_week_overall": 10.2
  },
  "developer_throughput": [
    {
      "email": "alice@example.com",
      "name": "Alice Johnson",
      "total_prs": 18,
      "weeks_active": 4,
      "avg_prs_per_week": 4.5,
      "first_pr_date": "2024-01-03",
      "last_pr_date": "2024-01-28"
    }
  ],
  "trends": {
    "weekly_breakdown": [
      {
        "week_start": "2024-01-01",
        "total_prs": 12,
        "developers_active": 5
      }
    ]
  }
}

Use Cases:
- Team Productivity Analysis: Track commit frequency and patterns
- Code Quality Assessment: Monitor additions/deletions trends  
- Collaboration Metrics: Analyze contributor participation
- Development Patterns: Identify working time distributions
- Process Improvements: Compare before/after periods for process changes
*/

import fs from "fs/promises";
import { program } from "commander";

class GitHubPRAnalyzer {
  constructor(repo, owner, startDate, endDate, token) {
    this.repo = repo;
    this.owner = owner;
    this.startDate = new Date(startDate);
    this.endDate = new Date(endDate);
    this.token = token;
    this.baseUrl = "https://api.github.com";
    this.headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "GitHub-PR-Analyzer/1.0",
    };
    this.fetchedPRs = [];
    this.verbose = false;
    this.debug = false;
  }

  setVerbose(verbose) {
    this.verbose = verbose;
  }

  setDebug(debug) {
    this.debug = debug;
  }

  log(message, level = "info") {
    if (level === "verbose" && !this.verbose) return;
    if (level === "debug" && !this.debug) return;

    const timestamp = new Date().toISOString();
    const prefix =
      level === "error"
        ? "❌"
        : level === "debug"
        ? "🔍"
        : level === "verbose"
        ? "📝"
        : "✅";
    console.log(`[${timestamp}] ${prefix} ${message}`);
  }

  async makeRequest(url, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        this.log(`Making request to: ${url}`, "debug");

        const response = await fetch(url, {
          headers: this.headers,
        });

        // Handle rate limiting
        if (response.status === 403) {
          const resetTime = response.headers.get("x-ratelimit-reset");
          if (resetTime) {
            const waitTime = parseInt(resetTime) * 1000 - Date.now();
            if (waitTime > 0) {
              this.log(
                `Rate limit hit. Waiting ${Math.ceil(waitTime / 1000)}s...`,
                "verbose"
              );
              await this.sleep(waitTime);
              continue;
            }
          }
          throw new Error(
            "Rate limit exceeded. GitHub API now requires Bearer token format. Please check your token permissions."
          );
        }

        // Handle authentication errors
        if (response.status === 401) {
          console.log(
            `Full authentication error: HTTP ${response.status} - ${response.statusText}`
          );
          throw new Error(
            'Authentication failed. GitHub API now requires Bearer token format instead of legacy token format. Please check your GitHub token permissions. Token should have "repo" scope for private repositories or "public_repo" for public ones.'
          );
        }

        // Handle not found errors
        if (response.status === 404) {
          console.log(
            `Full repository error: HTTP ${response.status} - ${response.statusText}`
          );
          throw new Error(
            `Repository ${this.owner}/${this.repo} not found. The request might be hitting rate limits or using incorrect headers. Please verify the repository name and your access permissions.`
          );
        }

        if (!response.ok) {
          console.log(
            `Full API error: HTTP ${response.status} - ${response.statusText}`
          );
          throw new Error(
            `GitHub API error: ${response.status} - ${response.statusText}. The token might lack proper repository access scopes.`
          );
        }

        const data = await response.json();

        // Log rate limit info
        const remaining = response.headers.get("x-ratelimit-remaining");
        const limit = response.headers.get("x-ratelimit-limit");
        this.log(`Rate limit: ${remaining}/${limit} remaining`, "debug");

        return {
          data,
          linkHeader: response.headers.get("link"),
        };
      } catch (error) {
        this.log(`Attempt ${attempt} failed: ${error.message}`, "debug");

        if (attempt === retries) {
          this.log(
            `Failed after ${retries} attempts: ${error.message}`,
            "error"
          );
          console.log("Full error details:", error);
          throw error;
        }

        const backoffDelay = Math.pow(2, attempt) * 1000;
        this.log(`Retrying in ${backoffDelay / 1000}s...`, "verbose");
        await this.sleep(backoffDelay);
      }
    }
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  parseLinkHeader(linkHeader) {
    if (!linkHeader) return {};

    const links = {};
    const parts = linkHeader.split(",");

    for (const part of parts) {
      const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
      if (match) {
        links[match[2]] = match[1];
      }
    }

    return links;
  }

  async fetchAllPRs(fetchLimit = 200) {
    this.log(
      `Fetching PRs for ${this.owner}/${this.repo} from ${
        this.startDate.toISOString().split("T")[0]
      } to ${this.endDate.toISOString().split("T")[0]}`,
      "info"
    );

    let url = `${this.baseUrl}/repos/${this.owner}/${this.repo}/pulls?state=all&sort=updated&direction=desc&per_page=100`;
    let allPRs = [];
    let page = 1;
    let progressCount = 0;

    const isInfinite = fetchLimit === Infinity;

    console.log("🔄 Starting fetch process...");

    while (url && (isInfinite || progressCount < fetchLimit)) {
      this.log(`Fetching page ${page}...`, "verbose");

      try {
        const result = await this.makeRequest(url);
        const prs = result.data;

        if (!Array.isArray(prs)) {
          this.log("Invalid response format from GitHub API", "error");
          break;
        }

        // Filter PRs by date range and completion status
        const filteredPRs = prs.filter((pr) => {
          const prDate = new Date(
            pr.merged_at || pr.closed_at || pr.updated_at
          );
          const isInRange = prDate >= this.startDate && prDate <= this.endDate;
          const isCompleted = pr.merged_at || pr.closed_at;
          return isInRange && isCompleted;
        });

        allPRs.push(...filteredPRs);
        progressCount += prs.length;

        // Simple progress bar using dots
        const dots = "⚫".repeat(Math.floor(page / 5) + 1);
        process.stdout.write(
          `\r📊 Progress ${dots} | Fetched: ${progressCount} PRs | Filtered: ${allPRs.length} relevant PRs`
        );

        // Check if we should continue
        const oldestPR = prs[prs.length - 1];
        if (oldestPR) {
          const oldestDate = new Date(oldestPR.updated_at);
          if (oldestDate < this.startDate) {
            this.log(
              "\nReached PRs older than start date, stopping fetch",
              "verbose"
            );
            break;
          }
        }

        // Parse pagination
        const links = this.parseLinkHeader(result.linkHeader);
        url = links.next;
        page++;

        if (!url) {
          this.log("\nNo more pages available", "verbose");
          break;
        }

        // Rate limiting courtesy delay
        await this.sleep(100);
      } catch (error) {
        console.log(`\nError fetching page ${page}:`, error.message);
        break;
      }
    }

    console.log(""); // New line after progress
    this.fetchedPRs = allPRs;
    this.log(`Successfully fetched ${allPRs.length} relevant PRs`, "info");
    return allPRs;
  }

  calculateThroughput() {
    this.log("Calculating developer throughput metrics...", "info");

    const developerMetrics = new Map();
    const weeklyBreakdown = new Map();

    // Process each PR
    for (const pr of this.fetchedPRs) {
      const authorEmail = pr.user?.email || `${pr.user?.login}@github.local`;
      const authorName = pr.user?.name || pr.user?.login || "Unknown";
      const completedDate = new Date(pr.merged_at || pr.closed_at);

      // Get week start (Monday)
      const weekStart = this.getWeekStart(completedDate);
      const weekKey = weekStart.toISOString().split("T")[0];

      // Initialize developer metrics
      if (!developerMetrics.has(authorEmail)) {
        developerMetrics.set(authorEmail, {
          email: authorEmail,
          name: authorName,
          prs: [],
          weeks: new Set(),
        });
      }

      // Add PR to developer
      const dev = developerMetrics.get(authorEmail);
      dev.prs.push({
        number: pr.number,
        title: pr.title,
        completed_date: completedDate.toISOString(),
        was_merged: !!pr.merged_at,
      });
      dev.weeks.add(weekKey);

      // Track weekly breakdown
      if (!weeklyBreakdown.has(weekKey)) {
        weeklyBreakdown.set(weekKey, {
          week_start: weekKey,
          total_prs: 0,
          developers: new Set(),
        });
      }
      weeklyBreakdown.get(weekKey).total_prs++;
      weeklyBreakdown.get(weekKey).developers.add(authorEmail);
    }

    // Calculate final metrics
    const totalWeeks = this.getTotalWeeks();
    const developerThroughput = Array.from(developerMetrics.values()).map(
      (dev) => {
        const weeksActive = dev.weeks.size;
        const totalPRs = dev.prs.length;

        return {
          email: dev.email,
          name: dev.name,
          total_prs: totalPRs,
          weeks_active: weeksActive,
          avg_prs_per_week:
            weeksActive > 0 ? +(totalPRs / weeksActive).toFixed(2) : 0,
          first_pr_date:
            dev.prs.length > 0
              ? dev.prs.reduce(
                  (min, pr) =>
                    pr.completed_date < min ? pr.completed_date : min,
                  dev.prs[0].completed_date
                )
              : null,
          last_pr_date:
            dev.prs.length > 0
              ? dev.prs.reduce(
                  (max, pr) =>
                    pr.completed_date > max ? pr.completed_date : max,
                  dev.prs[0].completed_date
                )
              : null,
        };
      }
    );

    // Sort by average PRs per week (descending)
    developerThroughput.sort((a, b) => b.avg_prs_per_week - a.avg_prs_per_week);

    // Prepare weekly breakdown
    const weeklyData = Array.from(weeklyBreakdown.values()).map((week) => ({
      week_start: week.week_start,
      total_prs: week.total_prs,
      developers_active: week.developers.size,
    }));
    weeklyData.sort((a, b) => a.week_start.localeCompare(b.week_start));

    const report = {
      repository: `${this.owner}/${this.repo}`,
      analysis_period: {
        start_date: this.startDate.toISOString().split("T")[0],
        end_date: this.endDate.toISOString().split("T")[0],
        total_weeks: +totalWeeks.toFixed(1),
      },
      summary: {
        total_prs: this.fetchedPRs.length,
        total_developers: developerThroughput.length,
        avg_prs_per_week_overall:
          totalWeeks > 0
            ? +(this.fetchedPRs.length / totalWeeks).toFixed(2)
            : 0,
      },
      developer_throughput: developerThroughput,
      trends: {
        weekly_breakdown: weeklyData,
      },
    };

    return report;
  }

  getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
    return new Date(d.setDate(diff));
  }

  getTotalWeeks() {
    const timeDiff = this.endDate - this.startDate;
    return timeDiff / (1000 * 60 * 60 * 24 * 7);
  }

  async generateReport(format = "json", outputFile = null) {
    const report = this.calculateThroughput();

    if (!outputFile) {
      const dateRange = `${this.startDate.toISOString().split("T")[0]}_to_${
        this.endDate.toISOString().split("T")[0]
      }`;
      outputFile = `${this.owner}_${this.repo}_pr_throughput_${dateRange}.${format}`;
    }

    if (format === "json") {
      await fs.writeFile(outputFile, JSON.stringify(report, null, 2));
    } else if (format === "csv") {
      const csvContent = this.convertToCSV(report);
      await fs.writeFile(outputFile, csvContent);
    }

    this.log(`Report generated: ${outputFile}`, "info");
    return { report, outputFile };
  }

  convertToCSV(report) {
    const headers = [
      "Email",
      "Name",
      "Total PRs",
      "Weeks Active",
      "Avg PRs/Week",
      "First PR Date",
      "Last PR Date",
    ];
    const rows = report.developer_throughput.map((dev) => [
      dev.email,
      dev.name,
      dev.total_prs,
      dev.weeks_active,
      dev.avg_prs_per_week,
      dev.first_pr_date || "",
      dev.last_pr_date || "",
    ]);

    return [headers, ...rows]
      .map((row) =>
        row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
      )
      .join("\n");
  }
}

// Helper function to get default start date (30 days ago)
function getDefaultStartDate() {
  const date = new Date();
  date.setDate(date.getDate() - 30);
  return date.toISOString().split("T")[0];
}

// Helper function to get default end date (today)
function getDefaultEndDate() {
  return new Date().toISOString().split("T")[0];
}

// CLI Implementation
program
  .name("github-pr-analyzer")
  .description(
    "Analyze GitHub PR throughput by developer - Date range included in output"
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
    getDefaultStartDate()
  )
  .option(
    "-e, --end <date>",
    "End date (ISO format: YYYY-MM-DD)",
    getDefaultEndDate()
  )
  .option("-v, --verbose", "Enable verbose logging")
  .option("-d, --debug", "Enable debug logging")
  .option("-t, --token <token>", "GitHub token (or set GITHUB_TOKEN env var)")
  .option(
    "-l, --fetchLimit <limit>",
    'Set fetch limit (default: 200, use "infinite" for no limit)',
    "200"
  );

program.parse();

const options = program.opts();

async function main() {
  try {
    // Validate repository format
    const repoMatch = options.repo.match(/^([^\/]+)\/([^\/]+)$/);
    if (!repoMatch) {
      console.error("❌ Invalid repository format. Use: owner/repo");
      process.exit(1);
    }

    const [, owner, repo] = repoMatch;

    // Get GitHub token
    const token = options.token || process.env.GITHUB_TOKEN;
    if (!token) {
      console.error(
        "❌ GitHub token required. Use --token or set GITHUB_TOKEN environment variable"
      );
      console.error(
        '   Token should have "repo" scope for private repos or "public_repo" for public repos'
      );
      process.exit(1);
    }

    // Parse fetch limit
    let fetchLimit = 200;
    if (options.fetchLimit === "infinite") {
      fetchLimit = Infinity;
    } else {
      fetchLimit = parseInt(options.fetchLimit) || 200;
    }

    // Validate dates
    const startDate = new Date(options.start);
    const endDate = new Date(options.end);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      console.error("❌ Invalid date format. Use YYYY-MM-DD");
      console.error(`   Provided start: ${options.start}, end: ${options.end}`);
      process.exit(1);
    }

    if (startDate >= endDate) {
      console.error("❌ Start date must be before end date");
      process.exit(1);
    }

    // Validate format
    if (!["json", "csv"].includes(options.format)) {
      console.error('❌ Invalid format. Use "json" or "csv"');
      process.exit(1);
    }

    console.log("🚀 Starting GitHub PR throughput analysis...");
    console.log(`📊 Repository: ${owner}/${repo}`);
    console.log(`📅 Date range: ${options.start} to ${options.end}`);
    console.log(`📄 Output format: ${options.format}`);
    console.log(
      `🔢 Fetch limit: ${fetchLimit === Infinity ? "unlimited" : fetchLimit}`
    );

    // Create analyzer instance
    const analyzer = new GitHubPRAnalyzer(
      repo,
      owner,
      options.start,
      options.end,
      token
    );
    analyzer.setVerbose(options.verbose);
    analyzer.setDebug(options.debug);

    // Fetch and analyze PRs
    await analyzer.fetchAllPRs(fetchLimit);
    const { report, outputFile } = await analyzer.generateReport(
      options.format,
      options.output
    );

    // Display summary
    console.log("\n📈 Analysis Summary:");
    console.log(`   Total PRs analyzed: ${report.summary.total_prs}`);
    console.log(`   Total developers: ${report.summary.total_developers}`);
    console.log(
      `   Average PRs per week (overall): ${report.summary.avg_prs_per_week_overall}`
    );
    console.log(
      `   Analysis period: ${report.analysis_period.total_weeks} weeks`
    );

    console.log("\n🏆 Top 5 Developers by Throughput:");
    report.developer_throughput.slice(0, 5).forEach((dev, index) => {
      console.log(
        `   ${index + 1}. ${dev.email} → ${dev.avg_prs_per_week} PRs/week (${
          dev.total_prs
        } total)`
      );
    });

    console.log(`\n✅ Full report saved to: ${outputFile}`);
    console.log(
      `📊 Report includes date range: ${report.analysis_period.start_date} to ${report.analysis_period.end_date}`
    );
  } catch (error) {
    console.error("❌ Error:", error.message);
    if (options.debug) {
      console.error("Full error details:", error);
    }
    process.exit(1);
  }
}

main();
