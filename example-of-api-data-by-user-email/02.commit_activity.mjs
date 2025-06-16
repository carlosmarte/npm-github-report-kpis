#!/usr/bin/env node

/*
JSON Report Structure:
{
  "repository": "owner/repo",
  "analysis_type": "commit_activity_by_user",
  "date_range": {
    "start": "2024-01-01",
    "end": "2024-12-31"
  },
  "total_commits": 1250,
  "total_contributors": 15,
  "data": [
    {
      "user_email": "developer@example.com",
      "user_name": "John Doe",
      "total_commits": 150,
      "percentage": 12.0,
      "first_commit": "2024-01-15T10:30:00Z",
      "last_commit": "2024-12-20T16:45:00Z",
      "commit_frequency": {
        "daily_average": 0.41,
        "weekly_average": 2.88,
        "monthly_average": 12.5
      }
    }
  ]
}

Use Cases:
1. Team Productivity Analysis: Track individual developer contribution patterns
2. Code Quality Assessment: Monitor commit frequency and identify potential burnout
3. Collaboration Metrics: Analyze team participation and identify key contributors
4. Development Patterns: Understand working time distributions across team members
5. Process Improvements: Compare before/after periods for process changes
6. Resource Planning: Identify high-performing developers and workload distribution
7. Onboarding Analysis: Track new team member integration and productivity ramp-up
*/

import { parseArgs } from "node:util";
import { writeFile } from "node:fs/promises";
import { stdout } from "node:process";

class GitHubCommitAnalyzer {
  constructor(token) {
    this.token = token || process.env.GITHUB_TOKEN;
    this.baseURL = "https://api.github.com";
    this.retryAttempts = 5;
    this.retryDelay = 2000;
    this.fetchLimit = 200;
    this.progressChars = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    this.progressIndex = 0;
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

        // Handle rate limiting with proper error messaging
        if (response.status === 403) {
          const rateLimitRemaining = response.headers.get(
            "x-ratelimit-remaining"
          );
          const resetTime = response.headers.get("x-ratelimit-reset");

          if (rateLimitRemaining === "0" && resetTime) {
            const waitTime = parseInt(resetTime) * 1000 - Date.now();
            if (waitTime > 0) {
              console.log(
                `\n⚠️  Rate limit exceeded. Waiting ${Math.ceil(
                  waitTime / 1000
                )} seconds...`
              );
              await this.sleep(waitTime);
              continue;
            }
          }

          throw new Error(
            `Access forbidden. Please check your token permissions and repository access.`
          );
        }

        // Handle authentication errors
        if (response.status === 401) {
          throw new Error(
            `Authentication failed. Please verify your GitHub token is valid and has proper format (Bearer token required).`
          );
        }

        // Handle not found errors
        if (response.status === 404) {
          throw new Error(
            `Repository not found. Please verify the repository exists and you have access to it.`
          );
        }

        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(
            `HTTP ${response.status}: ${response.statusText}. ${errorBody}`
          );
        }

        const data = await response.json();
        return data;
      } catch (error) {
        console.log(
          `\n❌ Request failed (attempt ${attempt}/${this.retryAttempts}): ${error.message}`
        );

        if (attempt === this.retryAttempts) {
          throw error;
        }

        await this.sleep(this.retryDelay * attempt);
      }
    }
  }

  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  showProgress(message = "Fetching data") {
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
    }

    this.progressInterval = setInterval(() => {
      stdout.write(`\r${this.progressChars[this.progressIndex]} ${message}...`);
      this.progressIndex = (this.progressIndex + 1) % this.progressChars.length;
    }, 100);
  }

  clearProgress() {
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      stdout.write("\r");
      this.progressInterval = null;
    }
  }

  async getAllCommits(
    owner,
    repo,
    startDate,
    endDate,
    fetchLimit = this.fetchLimit
  ) {
    const commits = [];
    let page = 1;
    const perPage = 100;
    let hasMore = true;
    let totalFetched = 0;

    this.showProgress(`Fetching commits from ${owner}/${repo}`);

    while (
      hasMore &&
      (fetchLimit === "infinite" || totalFetched < fetchLimit)
    ) {
      try {
        let url = `${this.baseURL}/repos/${owner}/${repo}/commits?page=${page}&per_page=${perPage}`;

        // Add date filters if provided
        const params = new URLSearchParams();
        if (startDate)
          params.append("since", new Date(startDate).toISOString());
        if (endDate) params.append("until", new Date(endDate).toISOString());

        if (params.toString()) {
          url += `&${params.toString()}`;
        }

        const data = await this.makeRequest(url);

        if (!Array.isArray(data) || data.length === 0) {
          hasMore = false;
          break;
        }

        const remainingLimit =
          fetchLimit === "infinite"
            ? data.length
            : Math.min(data.length, fetchLimit - totalFetched);
        commits.push(...data.slice(0, remainingLimit));
        totalFetched += remainingLimit;

        if (
          data.length < perPage ||
          (fetchLimit !== "infinite" && totalFetched >= fetchLimit)
        ) {
          hasMore = false;
        }

        page++;

        // Update progress
        stdout.write(
          `\r${
            this.progressChars[this.progressIndex]
          } Fetched ${totalFetched} commits...`
        );
        this.progressIndex =
          (this.progressIndex + 1) % this.progressChars.length;
      } catch (error) {
        this.clearProgress();
        throw new Error(`Failed to fetch commits: ${error.message}`);
      }
    }

    this.clearProgress();
    console.log(`✅ Successfully fetched ${commits.length} commits`);
    return commits;
  }

  async getCommitActivityByUser(
    owner,
    repo,
    startDate,
    endDate,
    fetchLimit = this.fetchLimit
  ) {
    try {
      const commits = await this.getAllCommits(
        owner,
        repo,
        startDate,
        endDate,
        fetchLimit
      );

      if (commits.length === 0) {
        return {
          repository: `${owner}/${repo}`,
          analysis_type: "commit_activity_by_user",
          date_range: {
            start: startDate || "earliest",
            end: endDate || "latest",
          },
          total_commits: 0,
          total_contributors: 0,
          data: [],
        };
      }

      // Group commits by user email
      const userCommits = new Map();

      commits.forEach((commit) => {
        const email = commit.commit?.author?.email || "unknown@unknown.com";
        const name = commit.commit?.author?.name || "Unknown User";
        const date = commit.commit?.author?.date || new Date().toISOString();

        if (!userCommits.has(email)) {
          userCommits.set(email, {
            user_email: email,
            user_name: name,
            commits: [],
            total_commits: 0,
          });
        }

        const userData = userCommits.get(email);
        userData.commits.push({
          sha: commit.sha,
          date: date,
          message: commit.commit?.message || "",
        });
        userData.total_commits++;
      });

      // Calculate statistics for each user
      const totalCommits = commits.length;
      const userData = Array.from(userCommits.values()).map((user) => {
        const dates = user.commits.map((c) => new Date(c.date)).sort();
        const firstCommit = dates[0];
        const lastCommit = dates[dates.length - 1];

        // Calculate frequency metrics
        const daysDiff = Math.max(
          1,
          Math.ceil((lastCommit - firstCommit) / (1000 * 60 * 60 * 24))
        );
        const weeksDiff = Math.max(1, daysDiff / 7);
        const monthsDiff = Math.max(1, daysDiff / 30);

        return {
          user_email: user.user_email,
          user_name: user.user_name,
          total_commits: user.total_commits,
          percentage:
            Math.round((user.total_commits / totalCommits) * 100 * 100) / 100,
          first_commit: firstCommit.toISOString(),
          last_commit: lastCommit.toISOString(),
          commit_frequency: {
            daily_average:
              Math.round((user.total_commits / daysDiff) * 100) / 100,
            weekly_average:
              Math.round((user.total_commits / weeksDiff) * 100) / 100,
            monthly_average:
              Math.round((user.total_commits / monthsDiff) * 100) / 100,
          },
        };
      });

      // Sort by total commits (descending)
      userData.sort((a, b) => b.total_commits - a.total_commits);

      return {
        repository: `${owner}/${repo}`,
        analysis_type: "commit_activity_by_user",
        date_range: {
          start: startDate || "earliest",
          end: endDate || "latest",
        },
        total_commits: totalCommits,
        total_contributors: userData.length,
        fetch_limit: fetchLimit,
        data: userData,
      };
    } catch (error) {
      this.clearProgress();
      throw new Error(`Failed to analyze commit activity: ${error.message}`);
    }
  }

  async exportToJSON(data, filename) {
    await writeFile(filename, JSON.stringify(data, null, 2));
    console.log(`📄 Data exported to ${filename}`);
  }

  async exportToCSV(data, filename) {
    const csvHeader =
      "User Email,User Name,Total Commits,Percentage,First Commit,Last Commit,Daily Average,Weekly Average,Monthly Average\n";
    const csvRows = data.data
      .map(
        (user) =>
          `"${user.user_email}","${user.user_name}",${user.total_commits},${user.percentage},"${user.first_commit}","${user.last_commit}",${user.commit_frequency.daily_average},${user.commit_frequency.weekly_average},${user.commit_frequency.monthly_average}`
      )
      .join("\n");

    const csvContent = csvHeader + csvRows;
    await writeFile(filename, csvContent);
    console.log(`📊 Data exported to ${filename}`);
  }
}

async function main() {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const defaultStartDate = thirtyDaysAgo.toISOString().split("T")[0];

  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      repo: { type: "string", short: "r" },
      format: { type: "string", short: "f", default: "json" },
      output: { type: "string", short: "o" },
      start: { type: "string", short: "s", default: defaultStartDate },
      end: { type: "string", short: "e" },
      verbose: { type: "boolean", short: "v", default: false },
      debug: { type: "boolean", short: "d", default: false },
      token: { type: "string", short: "t" },
      fetchLimit: { type: "string", short: "l", default: "200" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(`
🚀 GitHub Commit Activity Analyzer by User Email

Usage: node main.mjs [options]

Options:
  -r, --repo <owner/repo>         Repository to analyze (required)
  -f, --format <format>           Output format: json (default) or csv
  -o, --output <filename>         Output filename (auto-generated if not provided)
  -s, --start <date>              Start date (ISO format: YYYY-MM-DD) default: -30 days
  -e, --end <date>                End date (ISO format: YYYY-MM-DD) default: now
  -v, --verbose                   Enable verbose logging
  -d, --debug                     Enable debug logging
  -t, --token                     GitHub Token
  -l, --fetchLimit                Set fetch limit (default: 200, use 'infinite' for no limit)
  -h, --help                      Show help message

Environment Variables:
  GITHUB_TOKEN                    GitHub API token (can be used instead of -t)

Examples:
  node main.mjs -r "microsoft/typescript" -f json
  node main.mjs -r "facebook/react" -s "2024-01-01" -e "2024-06-30" -f csv
  node main.mjs -r "nodejs/node" -o commit-activity.json -v -l infinite
    `);
    return;
  }

  if (!values.repo) {
    console.error("❌ Error: Repository (-r, --repo) is required");
    console.error("💡 Use --help for usage information");
    process.exit(1);
  }

  const [owner, repo] = values.repo.split("/");
  if (!owner || !repo) {
    console.error('❌ Error: Repository must be in format "owner/repo"');
    process.exit(1);
  }

  if (values.format && !["json", "csv"].includes(values.format)) {
    console.error('❌ Error: Format must be either "json" or "csv"');
    process.exit(1);
  }

  // Validate fetch limit
  const fetchLimit =
    values.fetchLimit === "infinite" ? "infinite" : parseInt(values.fetchLimit);
  if (fetchLimit !== "infinite" && (isNaN(fetchLimit) || fetchLimit < 1)) {
    console.error(
      '❌ Error: Fetch limit must be a positive number or "infinite"'
    );
    process.exit(1);
  }

  try {
    const analyzer = new GitHubCommitAnalyzer(values.token);

    if (values.verbose) {
      console.log(`🔍 Analyzing repository: ${values.repo}`);
      console.log(`📅 Start date: ${values.start}`);
      if (values.end) console.log(`📅 End date: ${values.end}`);
      console.log(`📄 Output format: ${values.format}`);
      console.log(`📊 Fetch limit: ${fetchLimit}`);
    }

    const data = await analyzer.getCommitActivityByUser(
      owner,
      repo,
      values.start,
      values.end,
      fetchLimit
    );

    if (values.debug) {
      console.log("🐛 Raw data received:", JSON.stringify(data, null, 2));
    }

    // Generate output filename if not provided
    const timestamp = new Date().toISOString().split("T")[0];
    const dateRange = `${values.start || "earliest"}_to_${
      values.end || "latest"
    }`;
    const filename =
      values.output ||
      `${owner}-${repo}-commit-activity-${dateRange}.${values.format}`;

    // Export data
    if (values.format === "csv") {
      await analyzer.exportToCSV(data, filename);
    } else {
      await analyzer.exportToJSON(data, filename);
    }

    if (values.verbose) {
      console.log(`\n📈 Summary:`);
      console.log(`👥 Total contributors: ${data.total_contributors}`);
      console.log(`💾 Total commits analyzed: ${data.total_commits}`);
      console.log(
        `🏆 Top contributor: ${data.data[0]?.user_name || "N/A"} (${
          data.data[0]?.total_commits || 0
        } commits)`
      );
      console.log(
        `📊 Date range: ${data.date_range.start} to ${data.date_range.end}`
      );
    }
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    if (values.debug) {
      console.error("🐛 Stack trace:", error.stack);
    }

    // Provide helpful error guidance
    if (error.message.includes("Authentication failed")) {
      console.error("\n💡 Try these solutions:");
      console.error('   • Use Bearer token format: -t "your_token_here"');
      console.error("   • Set GITHUB_TOKEN environment variable");
      console.error("   • Verify token has proper repository access scopes");
    } else if (error.message.includes("Rate limit")) {
      console.error(
        "\n💡 GitHub API rate limit reached. Wait a few minutes and try again."
      );
    } else if (error.message.includes("Repository not found")) {
      console.error(
        "\n💡 Verify the repository exists and you have access to it."
      );
    }

    process.exit(1);
  }
}

main().catch(console.error);
