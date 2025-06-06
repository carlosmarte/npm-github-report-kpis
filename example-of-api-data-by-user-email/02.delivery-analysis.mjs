#!/usr/bin/env node

/*
JSON Report Structure:
{
  "repository": "owner/repo",
  "analysis_period": {
    "start": "2024-01-01",
    "end": "2024-01-31"
  },
  "delivery_metrics": {
    "contributors": [
      {
        "email": "user@example.com",
        "name": "John Doe",
        "total_commits": 25,
        "features": 8,
        "fixes": 12,
        "other": 5,
        "delivery_rate": 0.67,
        "weekly_delivery_rate": 5.0,
        "active_weeks": 4
      }
    ],
    "summary": {
      "total_contributors": 5,
      "total_deliveries": 45,
      "average_delivery_rate": 0.72,
      "top_contributor": "user@example.com"
    }
  }
}

Use Cases:
1. Team Productivity Analysis: Track commit frequency and patterns across time periods
2. Code Quality Assessment: Monitor additions/deletions trends and delivery consistency
3. Collaboration Metrics: Analyze contributor participation and delivery rates
4. Development Patterns: Identify working time distributions and delivery windows
5. Process Improvements: Compare before/after periods for process changes and team performance
6. Release Planning: Understand team capacity and delivery predictability
7. Performance Reviews: Objective data for individual contributor assessments
*/

import { program } from "commander";
import fs from "fs/promises";
import path from "path";

class GitHubDeliveryAnalyzer {
  constructor(repo, owner, startDate, endDate, token) {
    this.repo = repo;
    this.owner = owner;
    this.startDate = startDate;
    this.endDate = endDate;
    this.token = token;
    this.baseUrl = "https://api.github.com";
    this.headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "GitHub-Delivery-Analyzer",
    };
    this.fetchCount = 0;
    this.maxFetches = 200;
  }

  async makeRequest(url, retries = 3) {
    if (this.fetchCount >= this.maxFetches) {
      console.log(`Reached fetch limit of ${this.maxFetches}`);
      return null;
    }

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await fetch(url, { headers: this.headers });
        this.fetchCount++;

        if (response.status === 401) {
          throw new Error(
            "Authentication failed. Please check your GitHub token format and permissions."
          );
        }

        if (response.status === 403) {
          const resetTime = response.headers.get("x-ratelimit-reset");
          if (resetTime) {
            const waitTime = parseInt(resetTime) * 1000 - Date.now();
            if (waitTime > 0) {
              console.log(
                `Rate limit exceeded. Waiting ${Math.ceil(waitTime / 1000)}s...`
              );
              await new Promise((resolve) => setTimeout(resolve, waitTime));
              continue;
            }
          }
          throw new Error("Rate limit exceeded or insufficient permissions");
        }

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();
      } catch (error) {
        console.log(`Attempt ${attempt} failed:`, error.message);
        if (attempt === retries) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  updateProgressBar(current, total, operation) {
    const percentage = Math.round((current / total) * 100);
    const bar =
      "█".repeat(Math.floor(percentage / 2)) +
      "░".repeat(50 - Math.floor(percentage / 2));
    process.stdout.write(
      `\r${operation}: [${bar}] ${percentage}% (${current}/${total})`
    );
    if (current === total) process.stdout.write("\n");
  }

  categorizeCommit(message) {
    const msg = message.toLowerCase();

    // Feature indicators
    if (msg.match(/^(feat|feature|add|implement|new)/)) {
      return "feature";
    }

    // Fix indicators
    if (msg.match(/^(fix|bug|patch|resolve|correct)/)) {
      return "fix";
    }

    // Other categories
    if (msg.match(/^(docs|doc|documentation)/)) {
      return "documentation";
    }

    if (msg.match(/^(refactor|clean|optimize)/)) {
      return "refactor";
    }

    if (msg.match(/^(test|spec)/)) {
      return "test";
    }

    if (msg.match(/^(chore|style|format)/)) {
      return "maintenance";
    }

    return "other";
  }

  async fetchCommits() {
    const commits = [];
    let page = 1;
    let hasMore = true;

    console.log("Fetching commits...");

    while (hasMore && this.fetchCount < this.maxFetches) {
      const url = `${this.baseUrl}/repos/${this.owner}/${this.repo}/commits?since=${this.startDate}&until=${this.endDate}&per_page=100&page=${page}`;

      try {
        const data = await this.makeRequest(url);
        if (!data || data.length === 0) {
          hasMore = false;
          break;
        }

        commits.push(...data);
        this.updateProgressBar(
          commits.length,
          commits.length + 100,
          "Fetching commits"
        );
        page++;
      } catch (error) {
        console.error(`Error fetching commits (page ${page}):`, error.message);
        break;
      }
    }

    console.log(`\nFetched ${commits.length} commits`);
    return commits;
  }

  async fetchPullRequests() {
    const prs = [];
    let page = 1;
    let hasMore = true;

    console.log("Fetching pull requests...");

    while (hasMore && this.fetchCount < this.maxFetches) {
      const url = `${this.baseUrl}/repos/${this.owner}/${this.repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`;

      try {
        const data = await this.makeRequest(url);
        if (!data || data.length === 0) {
          hasMore = false;
          break;
        }

        // Filter PRs by date range
        const filteredPRs = data.filter((pr) => {
          const mergedAt = pr.merged_at;
          if (!mergedAt) return false;
          const mergedDate = new Date(mergedAt);
          return (
            mergedDate >= new Date(this.startDate) &&
            mergedDate <= new Date(this.endDate)
          );
        });

        prs.push(...filteredPRs);
        this.updateProgressBar(
          prs.length,
          prs.length + filteredPRs.length,
          "Fetching PRs"
        );

        // If no PRs in this page match our date range, we might be done
        if (filteredPRs.length === 0 && data.length > 0) {
          const oldestPR = new Date(data[data.length - 1].updated_at);
          if (oldestPR < new Date(this.startDate)) {
            hasMore = false;
          }
        }

        page++;
      } catch (error) {
        console.error(
          `Error fetching pull requests (page ${page}):`,
          error.message
        );
        break;
      }
    }

    console.log(`\nFetched ${prs.length} merged pull requests`);
    return prs;
  }

  analyzeDeliveries(commits, pullRequests) {
    const contributors = new Map();
    const startDate = new Date(this.startDate);
    const endDate = new Date(this.endDate);
    const totalWeeks = Math.ceil(
      (endDate - startDate) / (7 * 24 * 60 * 60 * 1000)
    );

    console.log("Analyzing deliveries...");

    // Process commits
    commits.forEach((commit, index) => {
      this.updateProgressBar(index + 1, commits.length, "Processing commits");

      const email =
        commit.commit?.author?.email || commit.author?.email || "unknown";
      const name =
        commit.commit?.author?.name || commit.author?.login || "Unknown";
      const message = commit.commit?.message || "";
      const category = this.categorizeCommit(message);

      if (!contributors.has(email)) {
        contributors.set(email, {
          email,
          name,
          commits: [],
          pullRequests: [],
          features: 0,
          fixes: 0,
          other: 0,
          weeklyActivity: new Set(),
        });
      }

      const contributor = contributors.get(email);
      contributor.commits.push({
        sha: commit.sha,
        message,
        category,
        date: commit.commit.author.date,
      });

      // Track weekly activity
      const commitDate = new Date(commit.commit.author.date);
      const weekNumber = Math.floor(
        (commitDate - startDate) / (7 * 24 * 60 * 60 * 1000)
      );
      contributor.weeklyActivity.add(weekNumber);

      // Categorize
      if (category === "feature") contributor.features++;
      else if (category === "fix") contributor.fixes++;
      else contributor.other++;
    });

    // Process pull requests
    pullRequests.forEach((pr, index) => {
      this.updateProgressBar(index + 1, pullRequests.length, "Processing PRs");

      const email = pr.user?.email || pr.user?.login + "@github.local";
      const name = pr.user?.login || "Unknown";

      if (!contributors.has(email)) {
        contributors.set(email, {
          email,
          name,
          commits: [],
          pullRequests: [],
          features: 0,
          fixes: 0,
          other: 0,
          weeklyActivity: new Set(),
        });
      }

      const contributor = contributors.get(email);
      const category = this.categorizeCommit(pr.title);

      contributor.pullRequests.push({
        number: pr.number,
        title: pr.title,
        category,
        merged_at: pr.merged_at,
      });

      // Track weekly activity for PRs
      const mergedDate = new Date(pr.merged_at);
      const weekNumber = Math.floor(
        (mergedDate - startDate) / (7 * 24 * 60 * 60 * 1000)
      );
      contributor.weeklyActivity.add(weekNumber);
    });

    // Calculate delivery metrics
    const contributorMetrics = Array.from(contributors.values()).map(
      (contributor) => {
        const totalDeliveries = contributor.features + contributor.fixes;
        const totalContributions =
          contributor.commits.length + contributor.pullRequests.length;
        const activeWeeks = contributor.weeklyActivity.size;

        return {
          email: contributor.email,
          name: contributor.name,
          total_commits: contributor.commits.length,
          total_prs: contributor.pullRequests.length,
          features: contributor.features,
          fixes: contributor.fixes,
          other: contributor.other,
          total_deliveries: totalDeliveries,
          delivery_rate:
            totalContributions > 0 ? totalDeliveries / totalContributions : 0,
          weekly_delivery_rate:
            activeWeeks > 0 ? totalDeliveries / activeWeeks : 0,
          active_weeks: activeWeeks,
          total_weeks_in_period: totalWeeks,
        };
      }
    );

    return contributorMetrics.sort(
      (a, b) => b.total_deliveries - a.total_deliveries
    );
  }

  async analyze() {
    try {
      console.log(`Analyzing delivery rates for ${this.owner}/${this.repo}`);
      console.log(`Period: ${this.startDate} to ${this.endDate}`);
      console.log(`Fetch limit: ${this.maxFetches}\n`);

      const [commits, pullRequests] = await Promise.all([
        this.fetchCommits(),
        this.fetchPullRequests(),
      ]);

      const contributorMetrics = this.analyzeDeliveries(commits, pullRequests);

      const summary = {
        total_contributors: contributorMetrics.length,
        total_deliveries: contributorMetrics.reduce(
          (sum, c) => sum + c.total_deliveries,
          0
        ),
        average_delivery_rate:
          contributorMetrics.length > 0
            ? contributorMetrics.reduce((sum, c) => sum + c.delivery_rate, 0) /
              contributorMetrics.length
            : 0,
        top_contributor:
          contributorMetrics.length > 0 ? contributorMetrics[0].email : null,
      };

      return {
        repository: `${this.owner}/${this.repo}`,
        analysis_period: {
          start: this.startDate,
          end: this.endDate,
        },
        delivery_metrics: {
          contributors: contributorMetrics,
          summary,
        },
        metadata: {
          total_api_calls: this.fetchCount,
          fetch_limit: this.maxFetches,
          generated_at: new Date().toISOString(),
        },
      };
    } catch (error) {
      console.error("Analysis failed:", error.message);

      // Provide specific error explanations and solutions
      if (error.message.includes("Authentication failed")) {
        console.error(
          "\n🔧 Solution: Ensure your GitHub token is in Bearer format and has proper repository access scopes."
        );
        console.error(
          "   Required scopes: repo (for private repos) or public_repo (for public repos)"
        );
        console.error("   Set token via: export GITHUB_TOKEN=your_token_here");
      } else if (error.message.includes("Rate limit")) {
        console.error(
          "\n🔧 Solution: Wait for rate limit reset or use a token with higher limits."
        );
        console.error(
          "   Consider reducing the date range or using --fetchLimit to control API usage."
        );
      } else if (error.message.includes("HTTP 404")) {
        console.error(
          "\n🔧 Solution: Verify the repository owner/name is correct and accessible."
        );
      }

      throw error;
    }
  }
}

// CLI Setup
program
  .name("github-delivery-analyzer")
  .description("Analyze contributor delivery rates for GitHub repositories")
  .version("1.0.0");

program
  .requiredOption("-r, --repo <owner/repo>", "Repository to analyze (required)")
  .option(
    "-f, --format <format>",
    "Output format: json (default) or csv",
    "json"
  )
  .option(
    "-o, --output <filename>",
    "Output filename (auto-generated if not provided)"
  )
  .option(
    "-s, --start <date>",
    "Start date (ISO format: YYYY-MM-DD)",
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]
  )
  .option(
    "-e, --end <date>",
    "End date (ISO format: YYYY-MM-DD)",
    new Date().toISOString().split("T")[0]
  )
  .option("-v, --verbose", "Enable verbose logging")
  .option("-d, --debug", "Enable debug logging")
  .option(
    "-t, --token <token>",
    "GitHub token (can also use GITHUB_TOKEN env var)"
  )
  .option(
    "-l, --fetchLimit <number>",
    'Set fetch limit (default: 200, use "infinite" for no limit)',
    "200"
  );

program.parse();

const options = program.opts();

// Validate and setup
const [owner, repo] = options.repo.split("/");
if (!owner || !repo) {
  console.error('Error: Repository must be in format "owner/repo"');
  process.exit(1);
}

const token = options.token || process.env.GITHUB_TOKEN;
if (!token) {
  console.error(
    "Error: GitHub token required. Use -t option or set GITHUB_TOKEN environment variable"
  );
  process.exit(1);
}

// Setup fetch limit
const fetchLimit =
  options.fetchLimit === "infinite" ? Infinity : parseInt(options.fetchLimit);

// Create analyzer
const analyzer = new GitHubDeliveryAnalyzer(
  repo,
  owner,
  options.start,
  options.end,
  token
);
analyzer.maxFetches = fetchLimit;

// Run analysis
try {
  const results = await analyzer.analyze();

  // Generate output filename if not provided
  let outputFile = options.output;
  if (!outputFile) {
    const dateRange = `${options.start}_to_${options.end}`;
    outputFile = `${owner}-${repo}-delivery-analysis-${dateRange}.${options.format}`;
  }

  // Output results
  if (options.format === "csv") {
    const csv = convertToCSV(results);
    await fs.writeFile(outputFile, csv);
  } else {
    await fs.writeFile(outputFile, JSON.stringify(results, null, 2));
  }

  console.log(`\n✅ Analysis complete! Results saved to: ${outputFile}`);
  console.log(
    `📊 Summary: ${results.delivery_metrics.summary.total_contributors} contributors, ${results.delivery_metrics.summary.total_deliveries} total deliveries`
  );

  if (options.verbose || options.debug) {
    console.log("\n📈 Top Contributors:");
    results.delivery_metrics.contributors
      .slice(0, 5)
      .forEach((contributor, index) => {
        console.log(
          `${index + 1}. ${contributor.name} (${contributor.email}): ${
            contributor.total_deliveries
          } deliveries`
        );
      });
  }
} catch (error) {
  console.error("❌ Analysis failed:", error.message);
  process.exit(1);
}

function convertToCSV(data) {
  const headers = [
    "email",
    "name",
    "total_commits",
    "total_prs",
    "features",
    "fixes",
    "other",
    "total_deliveries",
    "delivery_rate",
    "weekly_delivery_rate",
    "active_weeks",
  ];

  const rows = data.delivery_metrics.contributors.map((contributor) =>
    headers.map((header) => contributor[header] || 0).join(",")
  );

  return [headers.join(","), ...rows].join("\n");
}
