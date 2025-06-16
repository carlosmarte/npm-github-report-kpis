#!/usr/bin/env node

import { createWriteStream } from "fs";
import { writeFile } from "fs/promises";
import { program } from "commander";
import fetch from "node-fetch";

class GitHubAnalyzer {
  constructor(token, options = {}) {
    this.token = token;
    this.baseUrl = "https://api.github.com";
    this.rateLimit = {
      limit: 5000,
      remaining: 5000,
      resetTime: Date.now(),
    };

    // Properly bind logging methods
    this.isDebug = options.debug || false;
    this.isVerbose = options.verbose || false;

    // Bind logging methods to this instance
    this.debug = this.debug.bind(this);
    this.verbose = this.verbose.bind(this);
    this.log = this.log.bind(this);
  }

  debug(message, ...args) {
    if (this.isDebug) {
      console.log(`🐛 DEBUG: ${message}`, ...args);
    }
  }

  verbose(message, ...args) {
    if (this.isVerbose || this.isDebug) {
      console.log(`ℹ️  VERBOSE: ${message}`, ...args);
    }
  }

  log(message, ...args) {
    console.log(message, ...args);
  }

  async delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async makeRequest(url, retries = 3) {
    this.debug(`Making request to: ${url}`);

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        // Check rate limits
        if (
          this.rateLimit.remaining < 10 &&
          Date.now() < this.rateLimit.resetTime
        ) {
          const waitTime = this.rateLimit.resetTime - Date.now();
          this.verbose(`Rate limit low, waiting ${waitTime}ms`);
          await this.delay(waitTime);
        }

        const response = await fetch(url, {
          headers: {
            Authorization: `token ${this.token}`,
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "GitHub-Activity-Reporter/1.0",
          },
        });

        // Update rate limit info
        this.rateLimit.limit =
          parseInt(response.headers.get("x-ratelimit-limit")) || 5000;
        this.rateLimit.remaining =
          parseInt(response.headers.get("x-ratelimit-remaining")) || 5000;
        this.rateLimit.resetTime =
          parseInt(response.headers.get("x-ratelimit-reset")) * 1000 ||
          Date.now() + 3600000;

        this.debug(
          `Rate limit status: ${this.rateLimit.remaining}/${this.rateLimit.limit}`
        );

        if (response.status === 202) {
          this.verbose("API computing data, waiting...");
          await this.delay(2000);
          continue;
        }

        if (!response.ok) {
          if (response.status === 403) {
            const resetTime = new Date(this.rateLimit.resetTime);
            throw new Error(
              `Rate limit exceeded. Resets at ${resetTime.toISOString()}`
            );
          }
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        this.debug(`Successfully fetched data from ${url}`);
        return data;
      } catch (error) {
        this.debug(`Attempt ${attempt} failed: ${error.message}`);

        if (attempt === retries) {
          throw error;
        }

        const backoffTime = Math.pow(2, attempt) * 1000;
        this.verbose(`Retrying in ${backoffTime}ms...`);
        await this.delay(backoffTime);
      }
    }
  }

  async getParticipationMetrics(owner, repo) {
    this.verbose(`Fetching participation metrics for ${owner}/${repo}`);
    const url = `${this.baseUrl}/repos/${owner}/${repo}/stats/participation`;

    const data = await this.makeRequest(url);

    return {
      repository: `${owner}/${repo}`,
      fetchedAt: new Date().toISOString(),
      metrics: {
        totalCommits: data.all.reduce((sum, week) => sum + week, 0),
        ownerCommits: data.owner.reduce((sum, week) => sum + week, 0),
        weeklyData: data.all.map((total, index) => ({
          week: index + 1,
          totalCommits: total,
          ownerCommits: data.owner[index],
          contributorCommits: total - data.owner[index],
        })),
      },
    };
  }

  async getCommitActivity(owner, repo, startDate, endDate) {
    this.verbose(`Fetching commit activity for ${owner}/${repo}`);
    const url = `${this.baseUrl}/repos/${owner}/${repo}/stats/commit_activity`;

    const data = await this.makeRequest(url);

    // Filter by date range if provided
    let filteredData = data;
    if (startDate || endDate) {
      const start = startDate ? new Date(startDate).getTime() / 1000 : 0;
      const end = endDate ? new Date(endDate).getTime() / 1000 : Infinity;

      filteredData = data.filter((week) => {
        return week.week >= start && week.week <= end;
      });
    }

    return {
      repository: `${owner}/${repo}`,
      dateRange: {
        start: startDate || "beginning",
        end: endDate || "present",
      },
      fetchedAt: new Date().toISOString(),
      metrics: {
        totalWeeks: filteredData.length,
        totalCommits: filteredData.reduce((sum, week) => sum + week.total, 0),
        weeklyData: filteredData.map((week) => ({
          weekTimestamp: week.week,
          weekDate: new Date(week.week * 1000).toISOString().split("T")[0],
          totalCommits: week.total,
          dailyBreakdown: week.days,
        })),
      },
    };
  }

  async getContributorStats(owner, repo) {
    this.verbose(`Fetching contributor statistics for ${owner}/${repo}`);
    const url = `${this.baseUrl}/repos/${owner}/${repo}/stats/contributors`;

    const data = await this.makeRequest(url);

    return {
      repository: `${owner}/${repo}`,
      fetchedAt: new Date().toISOString(),
      metrics: {
        totalContributors: data.length,
        contributors: data.map((contributor) => ({
          author: contributor.author.login,
          totalCommits: contributor.total,
          additions: contributor.weeks.reduce((sum, week) => sum + week.a, 0),
          deletions: contributor.weeks.reduce((sum, week) => sum + week.d, 0),
          weeklyActivity: contributor.weeks.map((week) => ({
            weekTimestamp: week.w,
            weekDate: new Date(week.w * 1000).toISOString().split("T")[0],
            commits: week.c,
            additions: week.a,
            deletions: week.d,
          })),
        })),
      },
    };
  }

  formatAsCSV(data, type) {
    let csvContent = "";

    if (type === "participation") {
      csvContent = "Week,Total Commits,Owner Commits,Contributor Commits\n";
      data.metrics.weeklyData.forEach((week) => {
        csvContent += `${week.week},${week.totalCommits},${week.ownerCommits},${week.contributorCommits}\n`;
      });
    } else if (type === "activity") {
      csvContent = "Week Date,Total Commits,Sun,Mon,Tue,Wed,Thu,Fri,Sat\n";
      data.metrics.weeklyData.forEach((week) => {
        csvContent += `${week.weekDate},${
          week.totalCommits
        },${week.dailyBreakdown.join(",")}\n`;
      });
    } else if (type === "contributors") {
      csvContent = "Author,Total Commits,Total Additions,Total Deletions\n";
      data.metrics.contributors.forEach((contributor) => {
        csvContent += `${contributor.author},${contributor.totalCommits},${contributor.additions},${contributor.deletions}\n`;
      });
    }

    return csvContent;
  }

  async saveOutput(data, filename, format, type) {
    if (format === "csv") {
      const csvData = this.formatAsCSV(data, type);
      await writeFile(filename, csvData, "utf8");
    } else {
      await writeFile(filename, JSON.stringify(data, null, 2), "utf8");
    }

    this.log(`📄 Output saved to: ${filename}`);
  }
}

function parseRepoArg(repoArg) {
  const parts = repoArg.split("/");
  if (parts.length !== 2) {
    throw new Error('Repository must be in format "owner/repo"');
  }
  return { owner: parts[0], repo: parts[1] };
}

function generateFilename(owner, repo, type, format, dateRange) {
  const timestamp = new Date().toISOString().split("T")[0];
  const dateStr =
    dateRange.start && dateRange.end
      ? `_${dateRange.start}_to_${dateRange.end}`
      : "";
  return `${owner}-${repo}-${type}${dateStr}_${timestamp}.${format}`;
}

function showProgressBar(message) {
  process.stdout.write(`🔄 ${message}...`);

  const spinner = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;

  const interval = setInterval(() => {
    process.stdout.write(`\r${spinner[i]} ${message}...`);
    i = (i + 1) % spinner.length;
  }, 100);

  return () => {
    clearInterval(interval);
    process.stdout.write(`\r✅ ${message} completed\n`);
  };
}

async function main() {
  program
    .name("github-analyzer")
    .description("Analyze GitHub repository participation and activity metrics")
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
    .option("-s, --start <date>", "Start date (ISO format: YYYY-MM-DD)")
    .option("-e, --end <date>", "End date (ISO format: YYYY-MM-DD)")
    .option("-t, --token <token>", "GitHub token (or use GITHUB_TOKEN env var)")
    .option("-v, --verbose", "Enable verbose logging")
    .option("-d, --debug", "Enable debug logging")
    .option("--participation", "Fetch participation metrics")
    .option("--activity", "Fetch commit activity")
    .option("--contributors", "Fetch contributor statistics")
    .option("--all", "Fetch all available metrics")
    .parse();

  const options = program.opts();

  try {
    // Get GitHub token
    const token = options.token || process.env.GITHUB_TOKEN;
    if (!token) {
      console.error(
        "❌ GitHub token required. Use --token or set GITHUB_TOKEN environment variable"
      );
      process.exit(1);
    }

    // Parse repository
    const { owner, repo } = parseRepoArg(options.repo);

    // Validate date range
    if (options.start && options.end) {
      const startDate = new Date(options.start);
      const endDate = new Date(options.end);
      if (startDate > endDate) {
        console.error("❌ Start date must be before end date");
        process.exit(1);
      }
    }

    // Initialize analyzer
    const analyzer = new GitHubAnalyzer(token, {
      debug: options.debug,
      verbose: options.verbose,
    });

    const dateRange = {
      start: options.start,
      end: options.end,
    };

    // Determine what to fetch
    const fetchAll =
      options.all ||
      (!options.participation && !options.activity && !options.contributors);

    if (options.participation || fetchAll) {
      const stopProgress = showProgressBar("Fetching participation metrics");
      try {
        const data = await analyzer.getParticipationMetrics(owner, repo);
        stopProgress();

        const filename =
          options.output ||
          generateFilename(
            owner,
            repo,
            "participation",
            options.format,
            dateRange
          );
        await analyzer.saveOutput(
          data,
          filename,
          options.format,
          "participation"
        );

        console.log(`📊 Participation Summary:`);
        console.log(`   Total Commits: ${data.metrics.totalCommits}`);
        console.log(`   Owner Commits: ${data.metrics.ownerCommits}`);
        console.log(
          `   Contributor Commits: ${
            data.metrics.totalCommits - data.metrics.ownerCommits
          }`
        );
      } catch (error) {
        stopProgress();
        console.error(
          `❌ Failed to fetch participation metrics: ${error.message}`
        );
      }
    }

    if (options.activity || fetchAll) {
      const stopProgress = showProgressBar("Fetching commit activity");
      try {
        const data = await analyzer.getCommitActivity(
          owner,
          repo,
          options.start,
          options.end
        );
        stopProgress();

        const filename =
          options.output ||
          generateFilename(owner, repo, "activity", options.format, dateRange);
        await analyzer.saveOutput(data, filename, options.format, "activity");

        console.log(`📈 Activity Summary:`);
        console.log(
          `   Date Range: ${data.dateRange.start} to ${data.dateRange.end}`
        );
        console.log(`   Total Weeks: ${data.metrics.totalWeeks}`);
        console.log(`   Total Commits: ${data.metrics.totalCommits}`);
      } catch (error) {
        stopProgress();
        console.error(`❌ Failed to fetch commit activity: ${error.message}`);
      }
    }

    if (options.contributors || fetchAll) {
      const stopProgress = showProgressBar("Fetching contributor statistics");
      try {
        const data = await analyzer.getContributorStats(owner, repo);
        stopProgress();

        const filename =
          options.output ||
          generateFilename(
            owner,
            repo,
            "contributors",
            options.format,
            dateRange
          );
        await analyzer.saveOutput(
          data,
          filename,
          options.format,
          "contributors"
        );

        console.log(`👥 Contributors Summary:`);
        console.log(`   Total Contributors: ${data.metrics.totalContributors}`);
        console.log(`   Top 5 Contributors:`);
        data.metrics.contributors
          .sort((a, b) => b.totalCommits - a.totalCommits)
          .slice(0, 5)
          .forEach((contributor, index) => {
            console.log(
              `   ${index + 1}. ${contributor.author}: ${
                contributor.totalCommits
              } commits`
            );
          });
      } catch (error) {
        stopProgress();
        console.error(
          `❌ Failed to fetch contributor statistics: ${error.message}`
        );
      }
    }

    console.log("\n🎉 Analysis complete!");
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    if (options.debug) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run the CLI
main().catch((error) => {
  console.error("❌ Unexpected error:", error.message);
  process.exit(1);
});
