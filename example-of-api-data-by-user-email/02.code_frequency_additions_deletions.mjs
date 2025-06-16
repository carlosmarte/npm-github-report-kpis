#!/usr/bin/env node

import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/*
JSON Report Structure:
{
  "repository": "owner/repo",
  "analysis_date": "2024-01-15T10:30:00.000Z",
  "date_range": {
    "start": "2024-01-01",
    "end": "2024-01-31",
    "period": "2024-01-01 to 2024-01-31"
  },
  "summary": {
    "total_commits": 150,
    "total_contributors": 12,
    "total_additions": 5420,
    "total_deletions": 2180,
    "net_changes": 3240,
    "date_range_days": 31
  },
  "contributors": [
    {
      "email": "developer@example.com",
      "name": "John Developer",
      "commits": 25,
      "additions": 1200,
      "deletions": 340,
      "net_changes": 860,
      "first_commit": "2024-01-02T09:15:00Z",
      "last_commit": "2024-01-30T16:45:00Z",
      "percentage_of_changes": 15.8
    }
  ]
}

Use Cases:
- Team Productivity Analysis: Track commit frequency and patterns by developer
- Code Quality Assessment: Monitor additions/deletions trends per contributor
- Collaboration Metrics: Analyze contributor participation and impact
- Development Patterns: Identify working time distributions and developer activity
- Process Improvements: Compare before/after periods for team process changes
- Performance Reviews: Quantitative data for developer contributions
- Project Planning: Historical data for estimation and capacity planning
*/

class ProgressBar {
  constructor(total = 100, label = "Progress") {
    this.total = Math.max(1, total); // Ensure minimum of 1
    this.current = 0;
    this.label = label;
    this.width = 40;
    this.lastUpdate = 0;
  }

  update(current) {
    // Ensure current is within valid bounds
    this.current = Math.max(0, Math.min(current, this.total));

    // Throttle updates to avoid too frequent redraws
    const now = Date.now();
    if (now - this.lastUpdate < 100 && this.current !== this.total) {
      return;
    }
    this.lastUpdate = now;

    const percentage = Math.round((this.current / this.total) * 100);
    const filledWidth = Math.round((this.current / this.total) * this.width);
    const bar =
      "█".repeat(Math.max(0, filledWidth)) +
      "░".repeat(Math.max(0, this.width - filledWidth));

    process.stdout.write(
      `\r${this.label}: [${bar}] ${percentage}% (${this.current}/${this.total})`
    );

    if (this.current === this.total) {
      console.log(""); // New line when complete
    }
  }

  increment() {
    this.update(this.current + 1);
  }

  setTotal(newTotal) {
    this.total = Math.max(1, newTotal);
  }

  updateLabel(newLabel) {
    this.label = newLabel;
  }
}

class GitHubAnalyzer {
  constructor(token) {
    this.token = token || process.env.GITHUB_TOKEN;
    this.baseURL = "https://api.github.com";
    this.maxRetries = 3;
    this.rateLimitDelay = 1000;
    this.fetchLimit = 200; // Default fetch limit

    if (!this.token) {
      console.warn(
        "⚠️  No GitHub token provided. API rate limits will be lower."
      );
      console.warn("   Set GITHUB_TOKEN environment variable or use -t flag");
    }
  }

  setFetchLimit(limit) {
    this.fetchLimit = limit === "infinite" ? Infinity : parseInt(limit) || 200;
  }

  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async makeRequest(url, options = {}) {
    const headers = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "GitHub-Analytics-CLI",
      // Fixed: Use Bearer token format instead of legacy token format
      ...(this.token && { Authorization: `Bearer ${this.token}` }),
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

        // Handle authentication errors with friendly messaging
        if (response.status === 401) {
          throw new Error(
            "Authentication failed. Please check your GitHub token permissions and ensure it has repository access scopes."
          );
        }

        // Handle forbidden access with friendly messaging
        if (response.status === 403) {
          const errorBody = await response.text();
          let errorMessage;

          try {
            const errorJson = JSON.parse(errorBody);
            errorMessage =
              errorJson.message || errorJson.error_description || errorBody;
          } catch {
            errorMessage = errorBody || "Access forbidden";
          }

          throw new Error(
            `Access denied: ${errorMessage}. The token might lack proper repository access scopes or the repository may be private.`
          );
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
        return data;
      } catch (error) {
        if (options.debug) {
          console.error(
            `❌ Request failed (attempt ${attempt}/${this.maxRetries}):`,
            error.message
          );
        }

        if (attempt === this.maxRetries) {
          // Provide full error message in console.log for debugging
          console.log(`Full error details: ${error.stack || error.message}`);
          throw new Error(
            `Failed after ${this.maxRetries} attempts: ${error.message}`
          );
        }

        await this.sleep(2000 * attempt);
      }
    }
  }

  async getCommitsWithStats(repo, owner, startDate, endDate, options = {}) {
    const { verbose = false, debug = false } = options;

    if (verbose) {
      console.log(
        `📊 Fetching commit data with statistics for ${owner}/${repo}`
      );
      if (startDate || endDate) {
        console.log(
          `📅 Date range: ${startDate || "beginning"} to ${endDate || "now"}`
        );
      }
    }

    try {
      // First, get a rough estimate of total commits
      const firstPageUrl =
        `${this.baseURL}/repos/${owner}/${repo}/commits?page=1&per_page=1` +
        (startDate ? `&since=${startDate}T00:00:00Z` : "") +
        (endDate ? `&until=${endDate}T23:59:59Z` : "");

      await this.makeRequest(firstPageUrl, { debug });

      let page = 1;
      const perPage = 100;
      const commits = [];
      let hasMore = true;
      let fetchedCount = 0;
      let progressBar;

      // Initialize progress bar with estimated total
      if (verbose) {
        const maxPossible =
          this.fetchLimit === Infinity ? "∞" : this.fetchLimit;
        progressBar = new ProgressBar(
          this.fetchLimit === Infinity ? 100 : this.fetchLimit,
          `📥 Fetching commits (max: ${maxPossible})`
        );
        progressBar.update(0);
      }

      while (hasMore && fetchedCount < this.fetchLimit) {
        const url =
          `${this.baseURL}/repos/${owner}/${repo}/commits?page=${page}&per_page=${perPage}` +
          (startDate ? `&since=${startDate}T00:00:00Z` : "") +
          (endDate ? `&until=${endDate}T23:59:59Z` : "");

        const pageCommits = await this.makeRequest(url, { debug });

        if (pageCommits.length === 0) {
          hasMore = false;
          break;
        }

        // Get detailed commit info including stats
        for (const commit of pageCommits) {
          if (fetchedCount >= this.fetchLimit) break;

          try {
            const detailUrl = `${this.baseURL}/repos/${owner}/${repo}/commits/${commit.sha}`;
            const detailCommit = await this.makeRequest(detailUrl, { debug });

            commits.push({
              sha: commit.sha,
              author: {
                name: commit.commit.author.name,
                email: commit.commit.author.email,
                date: commit.commit.author.date,
              },
              committer: {
                name: commit.commit.committer.name,
                email: commit.commit.committer.email,
                date: commit.commit.committer.date,
              },
              message: commit.commit.message,
              stats: detailCommit.stats || {
                additions: 0,
                deletions: 0,
                total: 0,
              },
            });

            fetchedCount++;

            // Update progress bar with correct values
            if (progressBar) {
              const limitForDisplay =
                this.fetchLimit === Infinity ? 100 : this.fetchLimit;
              const currentProgress =
                this.fetchLimit === Infinity
                  ? Math.min(fetchedCount, 100)
                  : fetchedCount;

              progressBar.updateLabel(
                `📥 Fetching commits (${fetchedCount}/${
                  this.fetchLimit === Infinity ? "∞" : this.fetchLimit
                })`
              );
              progressBar.update(currentProgress);
            }

            // Rate limiting for detailed requests
            await this.sleep(this.rateLimitDelay / 2);
          } catch (error) {
            if (debug) {
              console.warn(
                `⚠️  Failed to get stats for commit ${commit.sha}: ${error.message}`
              );
            }
            // Continue with basic commit info if stats fail
            commits.push({
              sha: commit.sha,
              author: {
                name: commit.commit.author.name,
                email: commit.commit.author.email,
                date: commit.commit.author.date,
              },
              committer: {
                name: commit.commit.committer.name,
                email: commit.commit.committer.email,
                date: commit.commit.committer.date,
              },
              message: commit.commit.message,
              stats: { additions: 0, deletions: 0, total: 0 },
            });
            fetchedCount++;

            // Update progress bar even on errors
            if (progressBar) {
              const currentProgress =
                this.fetchLimit === Infinity
                  ? Math.min(fetchedCount, 100)
                  : fetchedCount;

              progressBar.updateLabel(
                `📥 Fetching commits (${fetchedCount}/${
                  this.fetchLimit === Infinity ? "∞" : this.fetchLimit
                })`
              );
              progressBar.update(currentProgress);
            }
          }
        }

        // Check if we should continue
        if (pageCommits.length < perPage || fetchedCount >= this.fetchLimit) {
          hasMore = false;
        } else {
          page++;
          await this.sleep(this.rateLimitDelay);
        }
      }

      // Complete progress bar
      if (progressBar) {
        const finalProgress =
          this.fetchLimit === Infinity
            ? 100
            : Math.min(fetchedCount, this.fetchLimit);
        progressBar.update(finalProgress);
      }

      if (verbose) {
        console.log(`✅ Retrieved ${commits.length} commits with statistics`);
        if (fetchedCount >= this.fetchLimit && this.fetchLimit !== Infinity) {
          console.log(
            `📝 Note: Reached fetch limit of ${this.fetchLimit} commits`
          );
        }
      }

      return commits;
    } catch (error) {
      console.error(`❌ Failed to fetch commits: ${error.message}`);
      throw error;
    }
  }

  async analyzeCodeFrequencyByUser(
    repo,
    owner,
    startDate,
    endDate,
    options = {}
  ) {
    const { verbose = false, debug = false } = options;

    if (verbose) {
      console.log(`📊 Analyzing code frequency by user for ${owner}/${repo}`);
    }

    try {
      const commits = await this.getCommitsWithStats(
        repo,
        owner,
        startDate,
        endDate,
        options
      );

      if (commits.length === 0) {
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
          summary: {
            total_commits: 0,
            total_contributors: 0,
            total_additions: 0,
            total_deletions: 0,
            net_changes: 0,
            date_range_days: this.calculateDateRangeDays(startDate, endDate),
          },
          contributors: [],
        };
      }

      // Group commits by user email
      const userStats = new Map();

      for (const commit of commits) {
        const email = commit.author.email;
        const name = commit.author.name;
        const stats = commit.stats;

        if (!userStats.has(email)) {
          userStats.set(email, {
            email,
            name,
            commits: 0,
            additions: 0,
            deletions: 0,
            net_changes: 0,
            first_commit: commit.author.date,
            last_commit: commit.author.date,
            commit_dates: [],
          });
        }

        const user = userStats.get(email);
        user.commits++;
        user.additions += stats.additions || 0;
        user.deletions += stats.deletions || 0;
        user.net_changes = user.additions - user.deletions;
        user.commit_dates.push(commit.author.date);

        // Update first and last commit dates
        if (new Date(commit.author.date) < new Date(user.first_commit)) {
          user.first_commit = commit.author.date;
        }
        if (new Date(commit.author.date) > new Date(user.last_commit)) {
          user.last_commit = commit.author.date;
        }
      }

      // Calculate summary statistics
      const totalAdditions = Array.from(userStats.values()).reduce(
        (sum, user) => sum + user.additions,
        0
      );
      const totalDeletions = Array.from(userStats.values()).reduce(
        (sum, user) => sum + user.deletions,
        0
      );
      const totalCommits = commits.length;
      const totalContributors = userStats.size;

      // Convert to array and add percentage calculations
      const contributors = Array.from(userStats.values()).map((user) => ({
        ...user,
        percentage_of_changes:
          totalAdditions + totalDeletions > 0
            ? parseFloat(
                (
                  ((user.additions + user.deletions) /
                    (totalAdditions + totalDeletions)) *
                  100
                ).toFixed(2)
              )
            : 0,
        commit_dates: undefined, // Remove commit_dates from output
      }));

      // Sort by total changes (additions + deletions) descending
      contributors.sort(
        (a, b) => b.additions + b.deletions - (a.additions + a.deletions)
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
        summary: {
          total_commits: totalCommits,
          total_contributors: totalContributors,
          total_additions: totalAdditions,
          total_deletions: totalDeletions,
          net_changes: totalAdditions - totalDeletions,
          date_range_days: this.calculateDateRangeDays(startDate, endDate),
        },
        contributors,
      };
    } catch (error) {
      console.error(
        `❌ Failed to analyze code frequency by user: ${error.message}`
      );
      throw error;
    }
  }

  calculateDateRangeDays(startDate, endDate) {
    if (!startDate || !endDate) {
      return null;
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = Math.abs(end - start);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  exportToCSV(data) {
    if (!data.contributors || data.contributors.length === 0) {
      return `# ${data.repository} Code Frequency by User Report (${data.date_range.period})\nemail,name,commits,additions,deletions,net_changes,percentage_of_changes,first_commit,last_commit\n`;
    }

    const header = `# ${data.repository} Code Frequency by User Report (${data.date_range.period})\n`;
    const csvHeaders =
      "email,name,commits,additions,deletions,net_changes,percentage_of_changes,first_commit,last_commit\n";
    const rows = data.contributors
      .map(
        (user) =>
          `"${user.email}","${user.name}",${user.commits},${user.additions},${user.deletions},${user.net_changes},${user.percentage_of_changes},"${user.first_commit}","${user.last_commit}"`
      )
      .join("\n");

    return header + csvHeaders + rows;
  }
}

function generateFilename(repo, format, startDate, endDate) {
  const repoName = repo.replace("/", "-");
  const dateRange = startDate && endDate ? `_${startDate}_to_${endDate}` : "";
  const timestamp = new Date().toISOString().split("T")[0];
  return `${repoName}_user_code_frequency${dateRange}_${timestamp}.${format}`;
}

function parseArguments() {
  const args = process.argv.slice(2);

  // Set default start date to 30 days ago
  const defaultStartDate = new Date();
  defaultStartDate.setDate(defaultStartDate.getDate() - 30);

  const parsed = {
    repo: null,
    format: "json",
    output: null,
    start: defaultStartDate.toISOString().split("T")[0],
    end: new Date().toISOString().split("T")[0],
    verbose: false,
    debug: false,
    token: null,
    help: false,
    fetchLimit: 200,
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
      case "-l":
      case "--fetchLimit":
        parsed.fetchLimit =
          nextArg === "infinite" ? "infinite" : parseInt(nextArg) || 200;
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
📊 GitHub Code Frequency Analyzer by User

Analyze GitHub repository code frequency (additions/deletions) per user email.
Perfect for measuring individual developer productivity and team contribution patterns.

Usage: node main.mjs [options]

Options:
  -r, --repo <owner/repo>           Repository to analyze (required)
  -f, --format <format>             Output format: json (default) or csv
  -o, --output <filename>           Output filename (auto-generated if not provided)
  -s, --start <date>                Start date (ISO format: YYYY-MM-DD) default: -30 days
  -e, --end <date>                  End date (ISO format: YYYY-MM-DD) default: now
  -v, --verbose                     Enable verbose logging
  -d, --debug                       Enable debug logging
  -t, --token <token>               GitHub Token (or use GITHUB_TOKEN env var)
  -l, --fetchLimit <number>         Set fetch limit (default: 200, use 'infinite' for no limit)
  -h, --help                        Show help message

Examples:
  # Basic analysis (last 30 days)
  node main.mjs -r "expressjs/express"

  # Analyze specific date range with CSV output
  node main.mjs -r "expressjs/express" -s "2024-01-01" -e "2024-06-30" -f csv

  # Verbose output with custom filename and unlimited fetch
  node main.mjs -r "expressjs/express" -o team-productivity.json -v -l infinite

  # Compare team productivity periods
  node main.mjs -r "owner/repo" -s "2023-01-01" -e "2023-06-30" -o team-before.json
  node main.mjs -r "owner/repo" -s "2023-07-01" -e "2023-12-31" -o team-after.json

Environment Variables:
  GITHUB_TOKEN                      GitHub personal access token

Reports Generated:
  • Code additions and deletions per user email
  • Individual developer productivity metrics
  • Team contribution percentages
  • Commit frequency analysis by contributor
  • First and last commit dates per user
  • Summary statistics with date ranges included

Rate Limiting:
  • Without token: 60 requests/hour
  • With token: 5,000 requests/hour
  • Automatic retry with exponential backoff
  • Progress indicators during long operations
  • Configurable fetch limits to manage API usage

Note: For private repositories or higher rate limits, use a GitHub personal access token.
Fetch limit prevents excessive API usage - use 'infinite' carefully on large repositories.
`);
}

async function main() {
  let args;

  try {
    args = parseArguments();

    if (args.verbose) {
      console.log("🚀 GitHub Code Frequency Analyzer by User");
      console.log(`📋 Configuration:`);
      console.log(`   Repository: ${args.repo}`);
      console.log(`   Format: ${args.format}`);
      console.log(`   Date Range: ${args.start} to ${args.end}`);
      console.log(`   Output: ${args.output || "auto-generated"}`);
      console.log(
        `   Fetch Limit: ${
          args.fetchLimit === "infinite" ? "∞" : args.fetchLimit
        }`
      );
      console.log(
        `   Token: ${args.token ? "provided" : "using GITHUB_TOKEN env var"}`
      );
      console.log("");
    }

    // Handle empty token gracefully
    const token = args.token === "" ? process.env.GITHUB_TOKEN : args.token;
    const analyzer = new GitHubAnalyzer(token);
    analyzer.setFetchLimit(args.fetchLimit);

    const result = await analyzer.analyzeCodeFrequencyByUser(
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

    if (args.verbose && result.contributors.length > 0) {
      console.log(`\n📊 Summary for ${result.date_range.period}:`);
      console.log(
        `   • Total commits analyzed: ${result.summary.total_commits.toLocaleString()}`
      );
      console.log(
        `   • Total contributors: ${result.summary.total_contributors}`
      );
      console.log(
        `   • Total additions: ${result.summary.total_additions.toLocaleString()} lines`
      );
      console.log(
        `   • Total deletions: ${result.summary.total_deletions.toLocaleString()} lines`
      );
      console.log(
        `   • Net changes: ${result.summary.net_changes.toLocaleString()} lines`
      );

      if (result.summary.date_range_days) {
        console.log(`   • Date range: ${result.summary.date_range_days} days`);
      }

      console.log(`\n👥 Top Contributors:`);
      result.contributors.slice(0, 5).forEach((contributor, index) => {
        console.log(
          `   ${index + 1}. ${contributor.name} (${contributor.email})`
        );
        console.log(
          `      📝 ${contributor.commits} commits, +${contributor.additions}/-${contributor.deletions} lines (${contributor.percentage_of_changes}%)`
        );
      });
    }
  } catch (error) {
    console.error(`\n💥 Fatal error: ${error.message}`);

    if (args && args.debug) {
      console.error("\n🔧 Debug information:");
      console.error(error.stack);
    }

    console.error(`\n🛠️  Troubleshooting tips:`);
    console.error(`   • Verify repository exists and is accessible`);
    console.error(
      `   • Check your GitHub token permissions (needs repo access)`
    );
    console.error(`   • Ensure date format is YYYY-MM-DD`);
    console.error(`   • Try with --verbose flag for more details`);
    console.error(`   • Consider using --fetchLimit to reduce API calls`);

    process.exit(1);
  }
}

// Run the CLI
main();
