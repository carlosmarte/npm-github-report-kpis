#!/usr/bin/env node

import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class ProgressBar {
  constructor(total, label = "Progress") {
    this.total = total;
    this.current = 0;
    this.label = label;
    this.width = 40;
  }

  update(current) {
    this.current = current;
    const percentage = Math.round((current / this.total) * 100);
    const filledWidth = Math.round((current / this.total) * this.width);
    const bar = "█".repeat(filledWidth) + "░".repeat(this.width - filledWidth);

    process.stdout.write(
      `\r${this.label}: [${bar}] ${percentage}% (${current}/${this.total})`
    );

    if (current === this.total) {
      console.log(""); // New line when complete
    }
  }

  increment() {
    this.update(this.current + 1);
  }
}

class GitHubAnalyzer {
  constructor(token) {
    this.token = token || process.env.GITHUB_TOKEN;
    this.baseURL = "https://api.github.com";
    this.maxRetries = 3;
    this.rateLimitDelay = 1000;

    if (!this.token) {
      console.warn(
        "⚠️  No GitHub token provided. API rate limits will be lower."
      );
      console.warn("   Set GITHUB_TOKEN environment variable or use -t flag");
    }
  }

  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async makeRequest(url, options = {}) {
    const headers = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "GitHub-Analytics-CLI",
      ...(this.token && { Authorization: `token ${this.token}` }),
    };

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        if (options.debug) {
          console.log(`🔗 Making request to: ${url} (attempt ${attempt})`);
        }

        const response = await fetch(url, { ...options, headers });

        // Handle GitHub's async statistics generation
        if (response.status === 202) {
          console.log(
            `⏳ GitHub is calculating statistics... (attempt ${attempt}/${this.maxRetries})`
          );
          await this.sleep(3000 * attempt);
          continue;
        }

        // Handle rate limiting
        if (response.status === 403) {
          const resetTime = response.headers.get("x-ratelimit-reset");
          const remaining = response.headers.get("x-ratelimit-remaining");

          if (remaining === "0") {
            const waitTime = resetTime
              ? parseInt(resetTime) * 1000 - Date.now()
              : 60000;
            console.log(
              `⚠️  Rate limit exceeded. Waiting ${Math.round(
                waitTime / 1000
              )}s...`
            );
            await this.sleep(Math.max(waitTime, 1000));
            continue;
          }
        }

        // Handle other HTTP errors
        if (!response.ok) {
          const errorBody = await response.text();
          let errorMessage;

          try {
            const errorJson = JSON.parse(errorBody);
            errorMessage =
              errorJson.message || errorJson.error_description || errorBody;
          } catch {
            errorMessage = errorBody || response.statusText;
          }

          throw new Error(`HTTP ${response.status}: ${errorMessage}`);
        }

        const data = await response.json();

        // Validate response format
        if (url.includes("/stats/") && !Array.isArray(data)) {
          if (data && typeof data === "object" && data.message) {
            throw new Error(`GitHub API Error: ${data.message}`);
          }
          throw new Error(
            "API response is not in expected array format. Repository may not exist or may be private."
          );
        }

        return data;
      } catch (error) {
        if (options.debug) {
          console.error(
            `❌ Request failed (attempt ${attempt}/${this.maxRetries}):`,
            error.message
          );
        }

        if (attempt === this.maxRetries) {
          throw new Error(
            `Failed after ${this.maxRetries} attempts: ${error.message}`
          );
        }

        await this.sleep(2000 * attempt);
      }
    }
  }

  async getCommitsWithProgress(repo, owner, startDate, endDate, options = {}) {
    const { verbose = false, debug = false } = options;

    if (verbose) {
      console.log(`📊 Fetching commit data for ${owner}/${repo}`);
    }

    // First, get total commit count for progress tracking
    let page = 1;
    const perPage = 100;
    const commits = [];
    let hasMore = true;
    let progressBar;

    try {
      while (hasMore) {
        const url =
          `${this.baseURL}/repos/${owner}/${repo}/commits?page=${page}&per_page=${perPage}` +
          (startDate ? `&since=${startDate}T00:00:00Z` : "") +
          (endDate ? `&until=${endDate}T23:59:59Z` : "");

        const pageCommits = await this.makeRequest(url, { debug });

        if (!progressBar && pageCommits.length > 0) {
          // Initialize progress bar on first successful response
          progressBar = new ProgressBar(1, "📥 Fetching commits");
          progressBar.update(0);
        }

        if (pageCommits.length === 0) {
          hasMore = false;
        } else {
          commits.push(...pageCommits);
          if (progressBar) {
            progressBar.label = `📥 Fetching commits (${commits.length} total)`;
            progressBar.update(Math.min(page * perPage, commits.length));
          }

          // GitHub API pagination limit
          if (pageCommits.length < perPage) {
            hasMore = false;
          } else {
            page++;
            await this.sleep(this.rateLimitDelay); // Rate limiting
          }
        }
      }

      if (progressBar) {
        progressBar.update(commits.length);
      }

      return commits;
    } catch (error) {
      console.error(`❌ Failed to fetch commits: ${error.message}`);
      throw error;
    }
  }

  async getCodeFrequency(repo, owner, startDate, endDate, options = {}) {
    const { verbose = false, debug = false } = options;

    if (verbose) {
      console.log(`📊 Fetching code frequency statistics for ${owner}/${repo}`);
      if (startDate || endDate) {
        console.log(
          `📅 Date range: ${startDate || "beginning"} to ${endDate || "now"}`
        );
      }
    }

    try {
      const url = `${this.baseURL}/repos/${owner}/${repo}/stats/code_frequency`;

      if (debug) {
        console.log(`🔗 API URL: ${url}`);
      }

      const progressBar = new ProgressBar(1, "🔄 Fetching statistics");
      progressBar.update(0);

      const data = await this.makeRequest(url, { debug });
      progressBar.update(1);

      if (verbose) {
        console.log(`✅ Retrieved ${data.length} weekly data points`);
      }

      // Filter by date range if provided
      let filteredData = data;
      if (startDate || endDate) {
        const start = startDate ? new Date(startDate).getTime() / 1000 : 0;
        const end = endDate ? new Date(endDate).getTime() / 1000 : Infinity;

        filteredData = data.filter(([timestamp]) => {
          return timestamp >= start && timestamp <= end;
        });

        if (verbose) {
          console.log(
            `📊 Filtered to ${filteredData.length} data points in date range`
          );
        }
      }

      // Transform data for better readability
      const transformedData = filteredData.map(
        ([timestamp, additions, deletions]) => ({
          week: new Date(timestamp * 1000).toISOString().split("T")[0],
          timestamp,
          additions,
          deletions: Math.abs(deletions), // GitHub returns deletions as negative
          net: additions + deletions,
        })
      );

      // Calculate summary statistics
      const summary = this.calculateSummary(
        transformedData,
        startDate,
        endDate
      );

      return {
        repository: `${owner}/${repo}`,
        analysis_date: new Date().toISOString(),
        date_range: {
          start: startDate || "repository_start",
          end: endDate || "latest",
          period:
            startDate && endDate
              ? `${startDate} to ${endDate}`
              : "full repository history",
        },
        summary,
        data: transformedData,
      };
    } catch (error) {
      console.error(`❌ Failed to fetch code frequency: ${error.message}`);

      if (error.message.includes("not in expected array format")) {
        console.error(`
🔧 This error typically occurs when:
  • Repository doesn't exist or is private
  • Insufficient permissions to access repository statistics
  • Repository has no commit history
  • GitHub is still calculating statistics (try again in a few moments)
        `);
      }

      throw error;
    }
  }

  calculateSummary(data, startDate, endDate) {
    if (data.length === 0) {
      return {
        total_weeks: 0,
        total_additions: 0,
        total_deletions: 0,
        net_changes: 0,
        avg_additions_per_week: 0,
        avg_deletions_per_week: 0,
        most_active_week: null,
        least_active_week: null,
      };
    }

    const totalAdditions = data.reduce((sum, week) => sum + week.additions, 0);
    const totalDeletions = data.reduce((sum, week) => sum + week.deletions, 0);
    const netChanges = totalAdditions - totalDeletions;

    const mostActiveWeek = data.reduce((max, week) =>
      week.additions + week.deletions > max.additions + max.deletions
        ? week
        : max
    );

    const leastActiveWeek = data.reduce((min, week) =>
      week.additions + week.deletions < min.additions + min.deletions
        ? week
        : min
    );

    return {
      total_weeks: data.length,
      total_additions: totalAdditions,
      total_deletions: totalDeletions,
      net_changes: netChanges,
      avg_additions_per_week: Math.round(totalAdditions / data.length),
      avg_deletions_per_week: Math.round(totalDeletions / data.length),
      most_active_week: {
        week: mostActiveWeek.week,
        additions: mostActiveWeek.additions,
        deletions: mostActiveWeek.deletions,
        total_changes: mostActiveWeek.additions + mostActiveWeek.deletions,
      },
      least_active_week: {
        week: leastActiveWeek.week,
        additions: leastActiveWeek.additions,
        deletions: leastActiveWeek.deletions,
        total_changes: leastActiveWeek.additions + leastActiveWeek.deletions,
      },
    };
  }

  exportToCSV(data) {
    if (!data.data || data.data.length === 0) {
      return `# ${data.repository} Code Frequency Report (${data.date_range.period})\nweek,timestamp,additions,deletions,net_changes\n`;
    }

    const header = `# ${data.repository} Code Frequency Report (${data.date_range.period})\n`;
    const csvHeaders = "week,timestamp,additions,deletions,net_changes\n";
    const rows = data.data
      .map(
        (row) =>
          `${row.week},${row.timestamp},${row.additions},${row.deletions},${row.net}`
      )
      .join("\n");

    return header + csvHeaders + rows;
  }
}

function generateFilename(repo, format, startDate, endDate) {
  const repoName = repo.replace("/", "-");
  const dateRange = startDate && endDate ? `_${startDate}_to_${endDate}` : "";
  const timestamp = new Date().toISOString().split("T")[0];
  return `${repoName}_code_frequency${dateRange}_${timestamp}.${format}`;
}

function parseArguments() {
  const args = process.argv.slice(2);
  const parsed = {
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
        parsed.repo = nextArg;
        i++;
        break;
      case "-f":
      case "--format":
        parsed.format = nextArg;
        i++;
        break;
      case "-o":
      case "--output":
        parsed.output = nextArg;
        i++;
        break;
      case "-s":
      case "--start":
        parsed.start = nextArg;
        i++;
        break;
      case "-e":
      case "--end":
        parsed.end = nextArg;
        i++;
        break;
      case "-t":
      case "--token":
        parsed.token = nextArg || "";
        i++;
        break;
      case "-v":
      case "--verbose":
        parsed.verbose = true;
        break;
      case "-d":
      case "--debug":
        parsed.debug = true;
        break;
      case "-h":
      case "--help":
        parsed.help = true;
        break;
      default:
        if (arg.startsWith("-")) {
          console.error(`❌ Unknown option: ${arg}`);
          process.exit(1);
        }
        break;
    }
  }

  // Validation
  if (parsed.help) {
    showHelp();
    process.exit(0);
  }

  if (!parsed.repo) {
    console.error("❌ Error: Repository (-r, --repo) is required");
    showHelp();
    process.exit(1);
  }

  if (!["json", "csv"].includes(parsed.format)) {
    console.error('❌ Error: Format must be either "json" or "csv"');
    process.exit(1);
  }

  // Parse repository owner/name
  const repoParts = parsed.repo.split("/");
  if (repoParts.length !== 2 || !repoParts[0] || !repoParts[1]) {
    console.error('❌ Error: Repository must be in format "owner/repo"');
    process.exit(1);
  }

  // Validate dates
  if (parsed.start && !isValidDate(parsed.start)) {
    console.error("❌ Error: Start date must be in YYYY-MM-DD format");
    process.exit(1);
  }

  if (parsed.end && !isValidDate(parsed.end)) {
    console.error("❌ Error: End date must be in YYYY-MM-DD format");
    process.exit(1);
  }

  if (
    parsed.start &&
    parsed.end &&
    new Date(parsed.start) > new Date(parsed.end)
  ) {
    console.error("❌ Error: Start date must be before end date");
    process.exit(1);
  }

  return { ...parsed, owner: repoParts[0], repoName: repoParts[1] };
}

function isValidDate(dateString) {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateString)) return false;

  const date = new Date(dateString);
  return (
    date instanceof Date &&
    !isNaN(date) &&
    date.toISOString().startsWith(dateString)
  );
}

function showHelp() {
  console.log(`
📊 GitHub Code Frequency Analyzer

Analyze GitHub repository code frequency (additions/deletions) over time.
Perfect for measuring development velocity and comparing periods before/after process changes.

Usage: node main.mjs [options]

Options:
  -r, --repo <owner/repo>           Repository to analyze (required)
  -f, --format <format>             Output format: json (default) or csv
  -o, --output <filename>           Output filename (auto-generated if not provided)
  -s, --start <date>                Start date (ISO format: YYYY-MM-DD)
  -e, --end <date>                  End date (ISO format: YYYY-MM-DD)
  -v, --verbose                     Enable verbose logging
  -d, --debug                       Enable debug logging
  -t, --token <token>               GitHub Token (or use GITHUB_TOKEN env var)
  -h, --help                        Show help message

Examples:
  # Basic analysis
  node main.mjs -r "expressjs/express"

  # Analyze specific date range with CSV output
  node main.mjs -r "expressjs/express" -s "2024-01-01" -e "2024-06-30" -f csv

  # Verbose output with custom filename
  node main.mjs -r "expressjs/express" -o weekly-activity.json -v

  # Compare before/after periods (run separately)
  node main.mjs -r "owner/repo" -s "2023-01-01" -e "2023-06-30" -o before-period.json
  node main.mjs -r "owner/repo" -s "2023-07-01" -e "2023-12-31" -o after-period.json

Environment Variables:
  GITHUB_TOKEN                      GitHub personal access token

Reports Generated:
  • Weekly code additions and deletions
  • Development velocity trends
  • Most/least active periods
  • Summary statistics with date ranges included
  • Team productivity patterns

Rate Limiting:
  • Without token: 60 requests/hour
  • With token: 5,000 requests/hour
  • Automatic retry with exponential backoff
  • Progress indicators during long operations

Note: For private repositories or higher rate limits, use a GitHub personal access token.
`);
}

async function main() {
  try {
    const args = parseArguments();

    if (args.verbose) {
      console.log("🚀 GitHub Code Frequency Analyzer");
      console.log(`📋 Configuration:`);
      console.log(`   Repository: ${args.repo}`);
      console.log(`   Format: ${args.format}`);
      console.log(
        `   Date Range: ${args.start || "start"} to ${args.end || "latest"}`
      );
      console.log(`   Output: ${args.output || "auto-generated"}`);
      console.log(
        `   Token: ${args.token ? "provided" : "using GITHUB_TOKEN env var"}`
      );
      console.log("");
    }

    // Handle empty token gracefully
    const token = args.token === "" ? process.env.GITHUB_TOKEN : args.token;
    const analyzer = new GitHubAnalyzer(token);

    const result = await analyzer.getCodeFrequency(
      args.repoName,
      args.owner,
      args.start,
      args.end,
      { verbose: args.verbose, debug: args.debug }
    );

    // Generate output filename if not provided
    const filename =
      args.output ||
      generateFilename(args.repo, args.format, args.start, args.end);

    // Export data
    let content;
    if (args.format === "csv") {
      content = analyzer.exportToCSV(result);
    } else {
      content = JSON.stringify(result, null, 2);
    }

    writeFileSync(filename, content);

    console.log(`✅ Analysis complete!`);
    console.log(`📄 Output saved to: ${filename}`);

    if (args.verbose && result.data.length > 0) {
      console.log(`\n📊 Summary for ${result.date_range.period}:`);
      console.log(`   • Total weeks analyzed: ${result.summary.total_weeks}`);
      console.log(
        `   • Total additions: ${result.summary.total_additions.toLocaleString()} lines`
      );
      console.log(
        `   • Total deletions: ${result.summary.total_deletions.toLocaleString()} lines`
      );
      console.log(
        `   • Net changes: ${result.summary.net_changes.toLocaleString()} lines`
      );
      console.log(
        `   • Average additions/week: ${result.summary.avg_additions_per_week.toLocaleString()}`
      );
      console.log(
        `   • Average deletions/week: ${result.summary.avg_deletions_per_week.toLocaleString()}`
      );

      if (result.summary.most_active_week) {
        console.log(
          `   • Most active week: ${
            result.summary.most_active_week.week
          } (${result.summary.most_active_week.total_changes.toLocaleString()} changes)`
        );
      }

      if (result.summary.least_active_week) {
        console.log(
          `   • Least active week: ${
            result.summary.least_active_week.week
          } (${result.summary.least_active_week.total_changes.toLocaleString()} changes)`
        );
      }
    }
  } catch (error) {
    console.error(`\n💥 Fatal error: ${error.message}`);

    if (args && args.debug) {
      console.error("\n🔧 Debug information:");
      console.error(error.stack);
    }

    console.error(`\n🛠️  Troubleshooting tips:`);
    console.error(`   • Verify repository exists and is accessible`);
    console.error(`   • Check your GitHub token permissions`);
    console.error(`   • Ensure date format is YYYY-MM-DD`);
    console.error(`   • Try with --verbose flag for more details`);

    process.exit(1);
  }
}

// Run the CLI
main();

// ```
// # Analyze a public repository
// node main.mjs -r "expressjs/express" -t $GITHUB_TOKEN_ACTIVITY_REPORT_READYONLY

// # With date range and verbose output
// node main.mjs -r "expressjs/express" -s "2024-01-01" -e "2024-06-30" -v

// # Export to CSV format
// node main.mjs -r "expressjs/express" -f csv -o activity-report.csv
// ```;
