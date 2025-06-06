import { promises as fs } from "fs";
import https from "https";
import { URL } from "url";
import { parseArgs } from "util";

class GitHubAnalyzer {
  constructor(options = {}) {
    this.token = options.token || process.env.GITHUB_TOKEN;
    this.verbose = options.verbose || false;
    this.debug = options.debug || false;
    this.baseUrl = "https://api.github.com";
    this.rateLimitRemaining = 5000;
    this.rateLimitResetTime = Date.now();
    this.requestCount = 0;
  }

  log(message, level = "info") {
    const timestamp = new Date().toISOString();
    if (level === "debug" && !this.debug) return;
    if (level === "verbose" && !this.verbose && !this.debug) return;

    const prefix =
      {
        error: "❌",
        warn: "⚠️",
        info: "📊",
        debug: "🔍",
        verbose: "📝",
      }[level] || "ℹ️";

    console.log(`${prefix} [${timestamp}] ${message}`);
  }

  async makeRequest(url, options = {}) {
    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        await this.checkRateLimit();

        const result = await this.httpRequest(url, {
          ...options,
          headers: {
            Authorization: `token ${this.token}`,
            "User-Agent": "GitHub-Analysis-CLI",
            Accept: "application/vnd.github.v3+json",
            ...options.headers,
          },
        });

        this.updateRateLimit(result.headers);
        this.requestCount++;

        if (this.debug) {
          this.log(`API Request ${this.requestCount}: ${url}`, "debug");
        }

        return result;
      } catch (error) {
        attempt++;
        const waitTime = Math.pow(2, attempt) * 1000; // Exponential backoff

        this.log(
          `Request failed (attempt ${attempt}/${maxRetries}): ${error.message}`,
          "warn"
        );

        if (attempt < maxRetries) {
          this.log(`Retrying in ${waitTime}ms...`, "verbose");
          await this.sleep(waitTime);
        } else {
          throw error;
        }
      }
    }
  }

  async httpRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const requestOptions = {
        hostname: urlObj.hostname,
        port: urlObj.port || 443,
        path: urlObj.pathname + urlObj.search,
        method: options.method || "GET",
        headers: options.headers || {},
      };

      const req = https.request(requestOptions, (res) => {
        let data = "";

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          try {
            const result = {
              data: JSON.parse(data),
              headers: res.headers,
              statusCode: res.statusCode,
            };

            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(result);
            } else {
              reject(
                new Error(
                  `HTTP ${res.statusCode}: ${
                    result.data.message || "Unknown error"
                  }`
                )
              );
            }
          } catch (error) {
            reject(new Error(`Failed to parse response: ${error.message}`));
          }
        });
      });

      req.on("error", (error) => {
        reject(new Error(`Request failed: ${error.message}`));
      });

      if (options.body) {
        req.write(JSON.stringify(options.body));
      }

      req.end();
    });
  }

  async checkRateLimit() {
    if (this.rateLimitRemaining <= 10 && Date.now() < this.rateLimitResetTime) {
      const waitTime = this.rateLimitResetTime - Date.now() + 1000;
      this.log(
        `Rate limit approaching. Waiting ${Math.round(waitTime / 1000)}s...`,
        "warn"
      );
      await this.sleep(waitTime);
    }
  }

  updateRateLimit(headers) {
    if (headers["x-ratelimit-remaining"]) {
      this.rateLimitRemaining = parseInt(headers["x-ratelimit-remaining"]);
    }
    if (headers["x-ratelimit-reset"]) {
      this.rateLimitResetTime = parseInt(headers["x-ratelimit-reset"]) * 1000;
    }
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  createProgressBar(current, total, label = "") {
    const width = 30;
    const progress = Math.round((current / total) * width);
    const bar = "█".repeat(progress) + "░".repeat(width - progress);
    const percentage = Math.round((current / total) * 100);

    process.stdout.write(
      `\r${label} [${bar}] ${percentage}% (${current}/${total})`
    );

    if (current === total) {
      process.stdout.write("\n");
    }
  }

  async analyzeRepository(repo, owner, startDate, endDate) {
    if (!this.token) {
      throw new Error(
        "GitHub token is required. Set GITHUB_TOKEN environment variable or use --token flag."
      );
    }

    this.log(`Starting analysis for ${owner}/${repo}`, "info");
    this.log(`Date range: ${startDate} to ${endDate}`, "verbose");

    const commits = await this.fetchAllCommits(owner, repo, startDate, endDate);
    this.log(`Found ${commits.length} commits in date range`, "info");

    const commitDetails = await this.fetchCommitDetails(owner, repo, commits);
    const analysis = this.analyzeCommitData(commitDetails, startDate, endDate);

    return analysis;
  }

  async fetchAllCommits(owner, repo, startDate, endDate) {
    const commits = [];
    let page = 1;
    const perPage = 100;
    let hasMore = true;

    this.log("Fetching commit list...", "verbose");

    while (hasMore) {
      const url =
        `${this.baseUrl}/repos/${owner}/${repo}/commits?` +
        `since=${startDate}T00:00:00Z&until=${endDate}T23:59:59Z&per_page=${perPage}&page=${page}`;

      const response = await this.makeRequest(url);
      const pageCommits = response.data;

      if (pageCommits.length === 0) {
        hasMore = false;
      } else {
        commits.push(
          ...pageCommits.map((commit) => ({
            sha: commit.sha,
            author: commit.commit.author,
            committer: commit.commit.committer,
            message: commit.commit.message,
            date: commit.commit.author.date,
          }))
        );

        this.createProgressBar(
          commits.length,
          commits.length + perPage,
          "Fetching commits"
        );
        page++;
      }
    }

    process.stdout.write("\n");
    return commits;
  }

  async fetchCommitDetails(owner, repo, commits) {
    this.log("Fetching detailed commit data...", "verbose");
    const commitDetails = [];
    const total = commits.length;

    for (let i = 0; i < commits.length; i++) {
      const commit = commits[i];

      try {
        const url = `${this.baseUrl}/repos/${owner}/${repo}/commits/${commit.sha}`;
        const response = await this.makeRequest(url);
        const detail = response.data;

        commitDetails.push({
          sha: commit.sha,
          author: {
            name: detail.commit.author.name,
            email: detail.commit.author.email,
            date: detail.commit.author.date,
          },
          committer: {
            name: detail.commit.committer.name,
            email: detail.commit.committer.email,
            date: detail.commit.committer.date,
          },
          message: detail.commit.message,
          stats: detail.stats,
          files:
            detail.files?.map((file) => ({
              filename: file.filename,
              additions: file.additions,
              deletions: file.deletions,
              changes: file.changes,
              status: file.status,
            })) || [],
        });

        this.createProgressBar(i + 1, total, "Processing commits");
      } catch (error) {
        this.log(
          `Failed to fetch details for commit ${commit.sha}: ${error.message}`,
          "warn"
        );
      }
    }

    return commitDetails;
  }

  analyzeCommitData(commitDetails, startDate, endDate) {
    this.log("Analyzing commit data...", "verbose");

    const userStats = {};
    const summary = {
      dateRange: {
        start: startDate,
        end: endDate,
      },
      totalCommits: commitDetails.length,
      totalAdditions: 0,
      totalDeletions: 0,
      totalChanges: 0,
      analysisDate: new Date().toISOString(),
      contributors: 0,
    };

    for (const commit of commitDetails) {
      const email = commit.author.email;
      const name = commit.author.name;

      if (!userStats[email]) {
        userStats[email] = {
          name: name,
          email: email,
          commits: 0,
          additions: 0,
          deletions: 0,
          changes: 0,
          files: 0,
          firstCommit: commit.author.date,
          lastCommit: commit.author.date,
        };
      }

      const stats = userStats[email];
      stats.commits++;
      stats.additions += commit.stats?.additions || 0;
      stats.deletions += commit.stats?.deletions || 0;
      stats.changes += commit.stats?.total || 0;
      stats.files += commit.files?.length || 0;

      // Update date range for user
      if (commit.author.date < stats.firstCommit) {
        stats.firstCommit = commit.author.date;
      }
      if (commit.author.date > stats.lastCommit) {
        stats.lastCommit = commit.author.date;
      }

      // Update summary
      summary.totalAdditions += commit.stats?.additions || 0;
      summary.totalDeletions += commit.stats?.deletions || 0;
      summary.totalChanges += commit.stats?.total || 0;
    }

    summary.contributors = Object.keys(userStats).length;

    // Sort users by total changes (descending)
    const sortedUsers = Object.values(userStats).sort(
      (a, b) => b.changes - a.changes
    );

    return {
      summary,
      contributors: sortedUsers,
      rawData: commitDetails,
    };
  }

  async exportToJson(data, filename) {
    const jsonData = JSON.stringify(data, null, 2);
    await fs.writeFile(filename, jsonData, "utf8");
    this.log(`JSON report saved to: ${filename}`, "info");
  }

  async exportToCsv(data, filename) {
    const headers = [
      "Name",
      "Email",
      "Commits",
      "Additions",
      "Deletions",
      "Total Changes",
      "Files Modified",
      "First Commit",
      "Last Commit",
    ];

    const csvRows = [
      headers.join(","),
      ...data.contributors.map((user) =>
        [
          `"${user.name}"`,
          `"${user.email}"`,
          user.commits,
          user.additions,
          user.deletions,
          user.changes,
          user.files,
          `"${user.firstCommit}"`,
          `"${user.lastCommit}"`,
        ].join(",")
      ),
    ];

    // Add summary at the top
    csvRows.unshift(
      `# GitHub Repository Analysis Report`,
      `# Date Range: ${data.summary.dateRange.start} to ${data.summary.dateRange.end}`,
      `# Total Commits: ${data.summary.totalCommits}`,
      `# Total Contributors: ${data.summary.contributors}`,
      `# Total Additions: ${data.summary.totalAdditions}`,
      `# Total Deletions: ${data.summary.totalDeletions}`,
      `# Total Changes: ${data.summary.totalChanges}`,
      `# Analysis Date: ${data.summary.analysisDate}`,
      `#`,
      ``
    );

    const csvContent = csvRows.join("\n");
    await fs.writeFile(filename, csvContent, "utf8");
    this.log(`CSV report saved to: ${filename}`, "info");
  }
}

// CLI Implementation
async function main() {
  try {
    const { values: args, positionals } = parseArgs({
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

    if (args.help) {
      console.log(`
GitHub Repository Analysis CLI

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

Examples:
  node main.mjs -r facebook/react -s 2024-01-01 -e 2024-03-31 -f csv -v
  node main.mjs -r microsoft/vscode -s 2024-01-01 -e 2024-12-31 -o report.json
      `);
      return;
    }

    // Validate required arguments
    if (!args.repo) {
      throw new Error("Repository is required. Use -r or --repo flag.");
    }

    const [owner, repo] = args.repo.split("/");
    if (!owner || !repo) {
      throw new Error("Repository must be in format: owner/repo");
    }

    // Set default dates (last 30 days if not specified)
    const endDate = args.end || new Date().toISOString().split("T")[0];
    const startDate =
      args.start ||
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];

    // Validate date format
    if (
      !startDate.match(/^\d{4}-\d{2}-\d{2}$/) ||
      !endDate.match(/^\d{4}-\d{2}-\d{2}$/)
    ) {
      throw new Error("Dates must be in YYYY-MM-DD format");
    }

    // Generate output filename if not provided
    const outputFilename =
      args.output ||
      `github-analysis-${owner}-${repo}-${startDate}-to-${endDate}.${args.format}`;

    // Initialize analyzer
    const analyzer = new GitHubAnalyzer({
      token: args.token,
      verbose: args.verbose,
      debug: args.debug,
    });

    // Run analysis
    console.log("🚀 Starting GitHub repository analysis...\n");

    const analysisData = await analyzer.analyzeRepository(
      repo,
      owner,
      startDate,
      endDate
    );

    // Export results
    if (args.format === "csv") {
      await analyzer.exportToCsv(analysisData, outputFilename);
    } else {
      await analyzer.exportToJson(analysisData, outputFilename);
    }

    // Display summary
    console.log("\n📊 Analysis Summary:");
    console.log(`├─ Date Range: ${startDate} to ${endDate}`);
    console.log(`├─ Total Commits: ${analysisData.summary.totalCommits}`);
    console.log(`├─ Contributors: ${analysisData.summary.contributors}`);
    console.log(
      `├─ Total Additions: ${analysisData.summary.totalAdditions.toLocaleString()}`
    );
    console.log(
      `├─ Total Deletions: ${analysisData.summary.totalDeletions.toLocaleString()}`
    );
    console.log(
      `├─ Total Changes: ${analysisData.summary.totalChanges.toLocaleString()}`
    );
    console.log(`└─ Report saved: ${outputFilename}`);

    if (analysisData.contributors.length > 0) {
      console.log("\n🏆 Top Contributors:");
      analysisData.contributors.slice(0, 5).forEach((contributor, index) => {
        console.log(`${index + 1}. ${contributor.name} (${contributor.email})`);
        console.log(`   ├─ Commits: ${contributor.commits}`);
        console.log(
          `   ├─ Additions: ${contributor.additions.toLocaleString()}`
        );
        console.log(
          `   ├─ Deletions: ${contributor.deletions.toLocaleString()}`
        );
        console.log(
          `   └─ Total Changes: ${contributor.changes.toLocaleString()}`
        );
      });
    }
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
}

// Run CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { GitHubAnalyzer };
