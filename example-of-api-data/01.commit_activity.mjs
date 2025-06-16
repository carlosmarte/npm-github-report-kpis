#!/usr/bin/env node

import { parseArgs } from "node:util";
import { writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { stdout } from "node:process";

class GitHubAnalyzer {
  constructor(token) {
    this.token = token || process.env.GITHUB_TOKEN;
    this.baseURL = "https://api.github.com";
    this.retryAttempts = 5;
    this.retryDelay = 2000; // Initial delay in ms
  }

  async makeRequest(url, options = {}) {
    const headers = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "GitHub-Analytics-CLI",
      ...(this.token && { Authorization: `Bearer ${this.token}` }),
    };

    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        const response = await fetch(url, { ...options, headers });

        // Handle rate limiting
        if (response.status === 403) {
          const resetTime = response.headers.get("x-ratelimit-reset");
          if (resetTime) {
            const waitTime = parseInt(resetTime) * 1000 - Date.now();
            if (waitTime > 0) {
              console.log(
                `Rate limited. Waiting ${Math.ceil(waitTime / 1000)} seconds...`
              );
              await this.sleep(waitTime);
              continue;
            }
          }
        }

        // Handle 202 Accepted (data being computed)
        if (response.status === 202) {
          console.log(
            `GitHub is computing stats... Attempt ${attempt}/${this.retryAttempts}`
          );
          await this.sleep(this.retryDelay * attempt);
          continue;
        }

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        return data;
      } catch (error) {
        if (attempt === this.retryAttempts) {
          throw error;
        }
        console.log(
          `Request failed (attempt ${attempt}/${this.retryAttempts}): ${error.message}`
        );
        await this.sleep(this.retryDelay * attempt);
      }
    }
  }

  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async getWeeklyCommitActivity(owner, repo, startDate, endDate) {
    const url = `${this.baseURL}/repos/${owner}/${repo}/stats/commit_activity`;

    console.log(`Fetching weekly commit activity for ${owner}/${repo}...`);
    this.showProgress();

    try {
      const data = await this.makeRequest(url);
      this.clearProgress();

      // Fix for the error: Check if data exists and is an array
      if (!data || !Array.isArray(data)) {
        throw new Error(
          "Invalid response: Expected array of commit activity data"
        );
      }

      // Filter by date range if provided
      let filteredData = data;
      if (startDate || endDate) {
        filteredData = this.filterByDateRange(data, startDate, endDate);
      }

      // Process the data to add meaningful information
      const processedData = filteredData.map((week) => ({
        week: new Date(week.week * 1000).toISOString().split("T")[0],
        total_commits: week.total,
        daily_commits: week.days,
        weekday_commits: week.days
          .slice(1, 6)
          .reduce((sum, day) => sum + day, 0),
        weekend_commits: week.days[0] + week.days[6],
      }));

      return {
        repository: `${owner}/${repo}`,
        date_range: {
          start: startDate || "earliest",
          end: endDate || "latest",
        },
        total_weeks: processedData.length,
        total_commits: processedData.reduce(
          (sum, week) => sum + week.total_commits,
          0
        ),
        average_commits_per_week:
          processedData.length > 0
            ? Math.round(
                (processedData.reduce(
                  (sum, week) => sum + week.total_commits,
                  0
                ) /
                  processedData.length) *
                  100
              ) / 100
            : 0,
        data: processedData,
      };
    } catch (error) {
      this.clearProgress();
      throw new Error(`Failed to fetch commit activity: ${error.message}`);
    }
  }

  filterByDateRange(data, startDate, endDate) {
    return data.filter((week) => {
      const weekDate = new Date(week.week * 1000);
      const start = startDate ? new Date(startDate) : null;
      const end = endDate ? new Date(endDate) : null;

      if (start && weekDate < start) return false;
      if (end && weekDate > end) return false;
      return true;
    });
  }

  showProgress() {
    this.progressInterval = setInterval(() => {
      stdout.write(".");
    }, 500);
  }

  clearProgress() {
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      stdout.write("\n");
    }
  }

  async exportToJSON(data, filename) {
    await writeFile(filename, JSON.stringify(data, null, 2));
    console.log(`Data exported to ${filename}`);
  }

  async exportToCSV(data, filename) {
    const csvHeader =
      "Week,Total Commits,Weekday Commits,Weekend Commits,Mon,Tue,Wed,Thu,Fri,Sat,Sun\n";
    const csvRows = data.data
      .map(
        (week) =>
          `${week.week},${week.total_commits},${week.weekday_commits},${
            week.weekend_commits
          },${week.daily_commits.join(",")}`
      )
      .join("\n");

    const csvContent = csvHeader + csvRows;
    await writeFile(filename, csvContent);
    console.log(`Data exported to ${filename}`);
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      repo: { type: "string", short: "r" },
      format: { type: "string", short: "f", default: "json" },
      output: { type: "string", short: "o" },
      start: { type: "string", short: "s" },
      end: { type: "string", short: "e" },
      verbose: { type: "boolean", short: "v", default: false },
      debug: { type: "boolean", short: "d", default: false },
      token: { type: "string", short: "t" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
GitHub Weekly Commit Volume Analyzer

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
  GITHUB_TOKEN                      GitHub API token (can be used instead of -t)

Examples:
  node main.mjs -r "microsoft/typescript" -f json
  node main.mjs -r "facebook/react" -s "2024-01-01" -e "2024-06-30" -f csv
  node main.mjs -r "nodejs/node" -o weekly-commits.json -v
    `);
    return;
  }

  if (!values.repo) {
    console.error("Error: Repository (-r, --repo) is required");
    console.error("Use --help for usage information");
    process.exit(1);
  }

  const [owner, repo] = values.repo.split("/");
  if (!owner || !repo) {
    console.error('Error: Repository must be in format "owner/repo"');
    process.exit(1);
  }

  if (values.format && !["json", "csv"].includes(values.format)) {
    console.error('Error: Format must be either "json" or "csv"');
    process.exit(1);
  }

  try {
    const analyzer = new GitHubAnalyzer(values.token);

    if (values.verbose) {
      console.log(`Analyzing repository: ${values.repo}`);
      if (values.start) console.log(`Start date: ${values.start}`);
      if (values.end) console.log(`End date: ${values.end}`);
      console.log(`Output format: ${values.format}`);
    }

    const data = await analyzer.getWeeklyCommitActivity(
      owner,
      repo,
      values.start,
      values.end
    );

    if (values.debug) {
      console.log("Raw data received:", JSON.stringify(data, null, 2));
    }

    // Generate output filename if not provided
    const timestamp = new Date().toISOString().split("T")[0];
    const filename =
      values.output || `${owner}-${repo}-commits-${timestamp}.${values.format}`;

    // Export data
    if (values.format === "csv") {
      await analyzer.exportToCSV(data, filename);
    } else {
      await analyzer.exportToJSON(data, filename);
    }

    if (values.verbose) {
      console.log(`\nSummary:`);
      console.log(`Total weeks analyzed: ${data.total_weeks}`);
      console.log(`Total commits: ${data.total_commits}`);
      console.log(`Average commits per week: ${data.average_commits_per_week}`);
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    if (values.debug) {
      console.error("Stack trace:", error.stack);
    }
    process.exit(1);
  }
}

main().catch(console.error);

// ```
// node main.mjs -r "owner/repo" -t "your_github_token_here"
// # Analyze a repository with default settings
// node main.mjs -r "microsoft/typescript"

// # Analyze with date range and CSV output
// node main.mjs -r "facebook/react" -s "2024-01-01" -e "2024-06-30" -f csv

// # Verbose output with custom filename
// node main.mjs -r "nodejs/node" -o weekly-commits.json -v
// node main.mjs -r "owner/repo" -d
// # Before period
// node main.mjs -r "owner/repo" -s "2023-01-01" -e "2023-06-30" -o before.json

// # After period
// node main.mjs -r "owner/repo" -s "2023-07-01" -e "2023-12-31" -o after.json

// #!/bin/bash
// # Weekly report automation
// node main.mjs -r "company/project" -s "$(date -d '7 days ago' +%Y-%m-%d)" -f csv -o "weekly-$(date +%Y-%m-%d).csv"
// ```
