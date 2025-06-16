#!/usr/bin/env node

import fs from "fs/promises";
import path from "path";
import { createWriteStream } from "fs";
import { performance } from "perf_hooks";

class GitHubAnalyzer {
  constructor(token, options = {}) {
    this.token = token;
    this.baseUrl = "https://api.github.com";
    this.options = {
      verbose: false,
      debug: false,
      retryCount: 3,
      retryDelay: 1000,
      ...options,
    };
    this.rateLimitRemaining = 5000;
    this.rateLimitReset = null;
  }

  log(message, level = "info") {
    const timestamp = new Date().toISOString();
    const levels = {
      debug: this.options.debug,
      verbose: this.options.verbose || this.options.debug,
      info: true,
      warn: true,
      error: true,
    };

    if (levels[level]) {
      const prefix =
        level === "error"
          ? "❌"
          : level === "warn"
          ? "⚠️"
          : level === "debug"
          ? "🔍"
          : "📊";
      console.log(`${prefix} [${timestamp}] ${message}`);
    }
  }

  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async makeRequest(url, retryCount = 0) {
    try {
      this.log(`Making request to: ${url}`, "debug");

      // Check rate limit
      if (this.rateLimitRemaining < 10 && this.rateLimitReset) {
        const waitTime = this.rateLimitReset - Date.now();
        if (waitTime > 0) {
          this.log(
            `Rate limit approaching, waiting ${Math.ceil(waitTime / 1000)}s...`,
            "warn"
          );
          await this.sleep(waitTime);
        }
      }

      const response = await fetch(url, {
        headers: {
          Authorization: `token ${this.token}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "GitHub-Commit-Analyzer/1.0.0",
        },
      });

      // Update rate limit info
      this.rateLimitRemaining = parseInt(
        response.headers.get("X-RateLimit-Remaining") || "5000"
      );
      this.rateLimitReset =
        parseInt(response.headers.get("X-RateLimit-Reset")) * 1000;

      this.log(`Rate limit remaining: ${this.rateLimitRemaining}`, "debug");

      if (!response.ok) {
        if (response.status === 403 && retryCount < this.options.retryCount) {
          const retryAfter =
            parseInt(response.headers.get("Retry-After") || "60") * 1000;
          this.log(
            `Rate limited, retrying after ${retryAfter / 1000}s (attempt ${
              retryCount + 1
            }/${this.options.retryCount})`,
            "warn"
          );
          await this.sleep(retryAfter);
          return this.makeRequest(url, retryCount + 1);
        }

        if (response.status >= 500 && retryCount < this.options.retryCount) {
          const delay = this.options.retryDelay * Math.pow(2, retryCount);
          this.log(
            `Server error (${
              response.status
            }), retrying in ${delay}ms (attempt ${retryCount + 1}/${
              this.options.retryCount
            })`,
            "warn"
          );
          await this.sleep(delay);
          return this.makeRequest(url, retryCount + 1);
        }

        throw new Error(
          `GitHub API error: ${response.status} ${response.statusText}`
        );
      }

      return await response.json();
    } catch (error) {
      if (
        retryCount < this.options.retryCount &&
        (error.code === "ECONNRESET" || error.code === "ETIMEDOUT")
      ) {
        const delay = this.options.retryDelay * Math.pow(2, retryCount);
        this.log(
          `Network error, retrying in ${delay}ms (attempt ${retryCount + 1}/${
            this.options.retryCount
          })`,
          "warn"
        );
        await this.sleep(delay);
        return this.makeRequest(url, retryCount + 1);
      }
      throw error;
    }
  }

  showProgress(message) {
    if (this.options.verbose) {
      const spinner = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
      let i = 0;
      const interval = setInterval(() => {
        process.stdout.write(`\r${spinner[i]} ${message}`);
        i = (i + 1) % spinner.length;
      }, 100);

      return () => {
        clearInterval(interval);
        process.stdout.write("\r✅ " + message + " - Complete\n");
      };
    }
    return () => {};
  }

  async fetchCommitTimeDistribution(owner, repo, startDate, endDate) {
    const startTime = performance.now();

    this.log(`Analyzing commit time distribution for ${owner}/${repo}`, "info");
    this.log(
      `Date range: ${startDate || "all-time"} to ${endDate || "present"}`,
      "verbose"
    );

    const stopProgress = this.showProgress(
      "Fetching punch card data from GitHub..."
    );

    try {
      const url = `${this.baseUrl}/repos/${owner}/${repo}/stats/punch_card`;
      const punchCardData = await this.makeRequest(url);

      stopProgress();

      if (!punchCardData || punchCardData.length === 0) {
        throw new Error(
          "No punch card data available. Repository might be empty or private."
        );
      }

      this.log(`Retrieved ${punchCardData.length} data points`, "verbose");

      // Transform punch card data into more readable format
      const transformedData = this.transformPunchCardData(punchCardData);

      const endTime = performance.now();
      this.log(
        `Analysis completed in ${Math.round(endTime - startTime)}ms`,
        "debug"
      );

      return {
        repository: `${owner}/${repo}`,
        analysis_date: new Date().toISOString(),
        date_range: {
          start: startDate || "all-time",
          end: endDate || "present",
          note: "GitHub punch card data represents all-time repository activity",
        },
        commit_time_distribution: transformedData,
        summary: this.generateSummary(transformedData),
        metadata: {
          total_commits: transformedData.reduce(
            (sum, item) => sum + item.commits,
            0
          ),
          analysis_duration_ms: Math.round(endTime - startTime),
          api_rate_limit_remaining: this.rateLimitRemaining,
        },
      };
    } catch (error) {
      stopProgress();
      this.log(
        `Error fetching commit time distribution: ${error.message}`,
        "error"
      );
      throw error;
    }
  }

  transformPunchCardData(punchCardData) {
    const dayNames = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];

    return punchCardData.map(([day, hour, commits]) => ({
      day_of_week: day,
      day_name: dayNames[day],
      hour: hour,
      hour_label: this.formatHour(hour),
      commits: commits,
      is_business_hours: this.isBusinessHours(day, hour),
      is_weekend: day === 0 || day === 6,
    }));
  }

  formatHour(hour) {
    const period = hour < 12 ? "AM" : "PM";
    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return `${displayHour}:00 ${period}`;
  }

  isBusinessHours(day, hour) {
    // Monday-Friday (1-5), 9 AM - 5 PM (9-17)
    return day >= 1 && day <= 5 && hour >= 9 && hour <= 17;
  }

  generateSummary(data) {
    const totalCommits = data.reduce((sum, item) => sum + item.commits, 0);
    const businessHoursCommits = data
      .filter((item) => item.is_business_hours)
      .reduce((sum, item) => sum + item.commits, 0);
    const weekendCommits = data
      .filter((item) => item.is_weekend)
      .reduce((sum, item) => sum + item.commits, 0);

    // Find peak activity periods
    const peakHour = data.reduce((max, item) =>
      item.commits > max.commits ? item : max
    );
    const peakDay = this.getPeakDay(data);

    return {
      total_commits: totalCommits,
      business_hours_percentage:
        totalCommits > 0
          ? Math.round((businessHoursCommits / totalCommits) * 100)
          : 0,
      weekend_percentage:
        totalCommits > 0
          ? Math.round((weekendCommits / totalCommits) * 100)
          : 0,
      peak_activity: {
        hour: {
          time: peakHour.hour_label,
          day: peakHour.day_name,
          commits: peakHour.commits,
        },
        day: peakDay,
      },
      working_patterns: this.analyzeWorkingPatterns(data),
    };
  }

  getPeakDay(data) {
    const dayTotals = {};
    const dayNames = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];

    data.forEach((item) => {
      if (!dayTotals[item.day_name]) {
        dayTotals[item.day_name] = 0;
      }
      dayTotals[item.day_name] += item.commits;
    });

    const peakDay = Object.entries(dayTotals).reduce(
      (max, [day, commits]) => (commits > max.commits ? { day, commits } : max),
      { day: "", commits: 0 }
    );

    return peakDay;
  }

  analyzeWorkingPatterns(data) {
    const patterns = {
      early_bird: data
        .filter((item) => item.hour >= 6 && item.hour <= 9)
        .reduce((sum, item) => sum + item.commits, 0),
      traditional: data
        .filter((item) => item.hour >= 9 && item.hour <= 17)
        .reduce((sum, item) => sum + item.commits, 0),
      evening: data
        .filter((item) => item.hour >= 17 && item.hour <= 22)
        .reduce((sum, item) => sum + item.commits, 0),
      night_owl: data
        .filter((item) => item.hour >= 22 || item.hour <= 6)
        .reduce((sum, item) => sum + item.commits, 0),
    };

    const total = Object.values(patterns).reduce(
      (sum, count) => sum + count,
      0
    );

    return Object.entries(patterns).reduce((result, [pattern, count]) => {
      result[pattern] = {
        commits: count,
        percentage: total > 0 ? Math.round((count / total) * 100) : 0,
      };
      return result;
    }, {});
  }

  async exportToJson(data, filename) {
    try {
      await fs.writeFile(filename, JSON.stringify(data, null, 2), "utf8");
      this.log(`JSON report exported to: ${filename}`, "info");
    } catch (error) {
      this.log(`Error exporting JSON: ${error.message}`, "error");
      throw error;
    }
  }

  async exportToCsv(data, filename) {
    try {
      const csvRows = [
        "Day,Day_Name,Hour,Hour_Label,Commits,Business_Hours,Weekend",
      ];

      data.commit_time_distribution.forEach((item) => {
        csvRows.push(
          [
            item.day_of_week,
            item.day_name,
            item.hour,
            item.hour_label,
            item.commits,
            item.is_business_hours,
            item.is_weekend,
          ].join(",")
        );
      });

      await fs.writeFile(filename, csvRows.join("\n"), "utf8");
      this.log(`CSV report exported to: ${filename}`, "info");
    } catch (error) {
      this.log(`Error exporting CSV: ${error.message}`, "error");
      throw error;
    }
  }
}

// CLI Implementation
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
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case "-r":
      case "--repo":
        options.repo = nextArg;
        i++;
        break;
      case "-f":
      case "--format":
        options.format = nextArg;
        i++;
        break;
      case "-o":
      case "--output":
        options.output = nextArg;
        i++;
        break;
      case "-s":
      case "--start":
        options.start = nextArg;
        i++;
        break;
      case "-e":
      case "--end":
        options.end = nextArg;
        i++;
        break;
      case "-t":
      case "--token":
        options.token = nextArg;
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
    }
  }

  return options;
}

function showHelp() {
  console.log(`
GitHub Commit Time Distribution Analyzer

Usage: node main.mjs [options]

Options:
  -r, --repo <owner/repo>           Repository to analyze (required)
  -f, --format <format>             Output format: json (default) or csv
  -o, --output <filename>           Output filename (auto-generated if not provided)
  -s, --start <date>                Start date (ISO format: YYYY-MM-DD)
  -e, --end <date>                  End date (ISO format: YYYY-MM-DD)
  -v, --verbose                     Enable verbose logging
  -d, --debug                       Enable debug logging
  -t, --token                       GitHub Token
  -h, --help                        Show help message

Environment Variables:
  GITHUB_TOKEN                      GitHub personal access token

Examples:
  node main.mjs -r facebook/react -f json -v
  node main.mjs -r microsoft/vscode -f csv -o vscode-analysis.csv
  node main.mjs -r owner/repo -s 2024-01-01 -e 2024-12-31 -d

Note: The GitHub punch card API returns all-time repository data.
Date range parameters are included for consistency and future enhancements.
`);
}

function generateFilename(repo, format, dateRange) {
  const repoName = repo.replace("/", "-");
  const timestamp = new Date().toISOString().split("T")[0];
  const rangeStr =
    dateRange.start !== "all-time"
      ? `_${dateRange.start}_to_${dateRange.end}`
      : "";
  return `commit-time-distribution_${repoName}${rangeStr}_${timestamp}.${format}`;
}

async function main() {
  try {
    const options = parseArguments();

    if (options.help) {
      showHelp();
      process.exit(0);
    }

    // Validate required arguments
    if (!options.repo) {
      console.error("❌ Error: Repository (-r, --repo) is required");
      console.error("Use -h or --help for usage information");
      process.exit(1);
    }

    if (!options.repo.includes("/")) {
      console.error('❌ Error: Repository must be in format "owner/repo"');
      process.exit(1);
    }

    const [owner, repo] = options.repo.split("/");

    // Get GitHub token
    const token = options.token || process.env.GITHUB_TOKEN;
    if (!token) {
      console.error("❌ Error: GitHub token is required");
      console.error(
        "Provide via -t/--token argument or GITHUB_TOKEN environment variable"
      );
      process.exit(1);
    }

    // Validate format
    if (!["json", "csv"].includes(options.format)) {
      console.error('❌ Error: Format must be "json" or "csv"');
      process.exit(1);
    }

    // Create analyzer instance
    const analyzer = new GitHubAnalyzer(token, {
      verbose: options.verbose,
      debug: options.debug,
    });

    // Fetch and analyze data
    const report = await analyzer.fetchCommitTimeDistribution(
      owner,
      repo,
      options.start,
      options.end
    );

    // Generate output filename if not provided
    const filename =
      options.output ||
      generateFilename(options.repo, options.format, report.date_range);

    // Export data
    if (options.format === "json") {
      await analyzer.exportToJson(report, filename);
    } else {
      await analyzer.exportToCsv(report, filename);
    }

    // Display summary
    console.log("\n📊 Analysis Summary:");
    console.log(`Repository: ${report.repository}`);
    console.log(
      `Total Commits: ${report.summary.total_commits.toLocaleString()}`
    );
    console.log(`Business Hours: ${report.summary.business_hours_percentage}%`);
    console.log(`Weekend Activity: ${report.summary.weekend_percentage}%`);
    console.log(
      `Peak Activity: ${report.summary.peak_activity.hour.time} on ${report.summary.peak_activity.hour.day} (${report.summary.peak_activity.hour.commits} commits)`
    );
    console.log(
      `Most Active Day: ${report.summary.peak_activity.day.day} (${report.summary.peak_activity.day.commits} commits)`
    );

    console.log("\n🕐 Working Patterns:");
    Object.entries(report.summary.working_patterns).forEach(
      ([pattern, data]) => {
        console.log(
          `  ${pattern.replace("_", " ")}: ${data.percentage}% (${
            data.commits
          } commits)`
        );
      }
    );

    console.log(`\n✅ Report saved to: ${filename}`);
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    if (error.stack && process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run CLI if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { GitHubAnalyzer };
