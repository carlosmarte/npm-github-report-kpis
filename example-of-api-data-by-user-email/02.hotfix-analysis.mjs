#!/usr/bin/env node

/*
JSON Report Structure:
{
  "repository": "owner/repo",
  "dateRange": {
    "start": "2024-01-01",
    "end": "2024-01-31"
  },
  "summary": {
    "totalPRs": 150,
    "totalUsers": 25,
    "totalHotfixPRs": 12,
    "overallHotfixRate": 0.08,
    "averageHotfixFrequency": 0.12
  },
  "hotfixMetrics": [
    {
      "userEmail": "developer@company.com",
      "username": "dev-user",
      "totalPRs": 12,
      "hotfixPRs": 3,
      "hotfixFrequency": 0.25,
      "hotfixDetails": [
        {
          "originalPR": {
            "number": 123,
            "title": "Feature: Add user authentication",
            "mergedAt": "2024-01-15T10:00:00Z",
            "files": ["auth.js", "login.js"]
          },
          "hotfixPR": {
            "number": 127,
            "title": "Hotfix: Fix authentication bug",
            "createdAt": "2024-01-16T08:30:00Z",
            "files": ["auth.js"],
            "hoursAfterOriginal": 22.5,
            "fileOverlap": 1,
            "overlapPercentage": 50
          }
        }
      ]
    }
  ]
}

Use Cases:
1. Code Quality Assessment: Identify developers who frequently need hotfixes
2. Process Improvement: Analyze patterns in post-merge emergency fixes
3. Training Needs: Spot users who might benefit from additional testing/review training
4. CI/CD Validation: Assess effectiveness of automated testing and validation
5. Risk Assessment: Predict potential stability issues based on hotfix patterns
*/

import { writeFileSync } from "fs";
import https from "https";
import { URL } from "url";

class GitHubHotfixAnalyzer {
  constructor(repo, owner, startDate, endDate, token) {
    this.repo = repo;
    this.owner = owner;
    this.startDate = startDate;
    this.endDate = endDate;
    this.token = token;
    this.baseUrl = "https://api.github.com";
    this.retryCount = 3;
    this.retryDelay = 1000;

    // Hotfix identification patterns
    this.hotfixKeywords = [
      "hotfix",
      "fix",
      "patch",
      "urgent",
      "emergency",
      "critical",
      "bugfix",
      "quickfix",
      "repair",
      "correction",
      "urgent-fix",
    ];

    // Time window for identifying hotfixes (48 hours in milliseconds)
    this.hotfixTimeWindow = 48 * 60 * 60 * 1000;
  }

  async makeRequest(endpoint, page = 1, perPage = 100) {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    url.searchParams.append("page", page.toString());
    url.searchParams.append("per_page", perPage.toString());

    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "GitHub-Hotfix-Analyzer/1.0",
      },
    };

    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
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
                  `GitHub API Error: ${res.statusCode} - ${
                    parsed.message || "Unknown error"
                  }`
                )
              );
            }
          } catch (error) {
            reject(new Error(`Failed to parse response: ${error.message}`));
          }
        });
      });

      req.on("error", reject);
      req.setTimeout(30000, () => {
        req.destroy();
        reject(new Error("Request timeout"));
      });

      req.end();
    });
  }

  async retryRequest(endpoint, page = 1, perPage = 100, attempt = 1) {
    try {
      return await this.makeRequest(endpoint, page, perPage);
    } catch (error) {
      if (attempt < this.retryCount) {
        console.log(
          `Retry ${attempt}/${this.retryCount} for ${endpoint} (page ${page})`
        );
        await this.sleep(this.retryDelay * attempt);
        return this.retryRequest(endpoint, page, perPage, attempt + 1);
      }
      throw error;
    }
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  updateProgressBar(current, total, message = "Progress") {
    const percentage = Math.floor((current / total) * 100);
    const barLength = 30;
    const filledLength = Math.floor((current / total) * barLength);
    const bar = "█".repeat(filledLength) + "░".repeat(barLength - filledLength);
    process.stdout.write(
      `\r${message}: [${bar}] ${percentage}% (${current}/${total})`
    );
  }

  async fetchAllPages(endpoint, fetchLimit = 200) {
    const allData = [];
    let page = 1;
    let hasMore = true;
    let fetchedCount = 0;

    while (hasMore && (fetchLimit === -1 || fetchedCount < fetchLimit)) {
      try {
        const response = await this.retryRequest(endpoint, page, 100);
        const data = response.data;

        if (!Array.isArray(data) || data.length === 0) {
          hasMore = false;
          break;
        }

        allData.push(...data);
        fetchedCount += data.length;

        this.updateProgressBar(
          fetchedCount,
          Math.max(
            fetchedCount,
            fetchLimit === -1 ? fetchedCount + 100 : fetchLimit
          ),
          "Fetching"
        );

        const remaining = parseInt(
          response.headers["x-ratelimit-remaining"] || "0"
        );
        if (remaining < 10) {
          const resetTime =
            parseInt(response.headers["x-ratelimit-reset"] || "0") * 1000;
          const waitTime = Math.max(0, resetTime - Date.now()) + 1000;
          console.log(
            `\nRate limit approaching. Waiting ${Math.ceil(
              waitTime / 1000
            )}s...`
          );
          await this.sleep(waitTime);
        }

        page++;

        if (data.length < 100) {
          hasMore = false;
        }
      } catch (error) {
        console.error(`\nError fetching page ${page}: ${error.message}`);
        throw error;
      }
    }

    console.log(`\nCompleted fetching ${allData.length} items.`);
    return allData;
  }

  async fetchPullRequests(fetchLimit = 200) {
    console.log("Fetching pull requests...");
    const endpoint = `/repos/${this.owner}/${this.repo}/pulls`;
    const params = new URLSearchParams({
      state: "all",
      sort: "updated",
      direction: "desc",
    });

    const prs = await this.fetchAllPages(`${endpoint}?${params}`, fetchLimit);

    const filteredPRs = prs.filter((pr) => {
      const createdAt = new Date(pr.created_at);
      const start = new Date(this.startDate);
      const end = new Date(this.endDate);
      return createdAt >= start && createdAt <= end;
    });

    console.log(`Filtered ${filteredPRs.length} PRs within date range.`);
    return filteredPRs;
  }

  async fetchPRFiles(prNumber) {
    try {
      const endpoint = `/repos/${this.owner}/${this.repo}/pulls/${prNumber}/files`;
      const response = await this.retryRequest(endpoint, 1, 100);
      return response.data.map((file) => file.filename) || [];
    } catch (error) {
      console.log(
        `Warning: Could not fetch files for PR #${prNumber}: ${error.message}`
      );
      return [];
    }
  }

  isHotfixPR(pr) {
    const title = pr.title.toLowerCase();
    const branchName = (pr.head?.ref || "").toLowerCase();

    return this.hotfixKeywords.some(
      (keyword) => title.includes(keyword) || branchName.includes(keyword)
    );
  }

  calculateFileOverlap(originalFiles, hotfixFiles) {
    if (originalFiles.length === 0 || hotfixFiles.length === 0) {
      return { overlap: 0, percentage: 0 };
    }

    const originalSet = new Set(originalFiles);
    const overlap = hotfixFiles.filter((file) => originalSet.has(file)).length;
    const percentage = Math.round(
      (overlap / Math.max(originalFiles.length, hotfixFiles.length)) * 100
    );

    return { overlap, percentage };
  }

  async analyzeHotfixes(fetchLimit = 200) {
    try {
      const prs = await this.fetchPullRequests(fetchLimit);

      // Separate merged PRs and potential hotfix PRs
      const mergedPRs = prs
        .filter((pr) => pr.merged_at)
        .sort((a, b) => new Date(a.merged_at) - new Date(b.merged_at));

      const potentialHotfixes = prs.filter((pr) => this.isHotfixPR(pr));

      console.log(
        `Found ${mergedPRs.length} merged PRs and ${potentialHotfixes.length} potential hotfix PRs`
      );

      const userMetrics = new Map();
      const hotfixPairs = [];

      console.log("Analyzing hotfix patterns...");
      let processedCount = 0;

      // Group PRs by user
      for (const pr of prs) {
        const userEmail = pr.user.email || `${pr.user.login}@github.local`;
        const username = pr.user.login;

        if (!userMetrics.has(userEmail)) {
          userMetrics.set(userEmail, {
            userEmail,
            username,
            totalPRs: 0,
            hotfixPRs: 0,
            hotfixDetails: [],
          });
        }

        const userData = userMetrics.get(userEmail);
        userData.totalPRs++;
      }

      // Analyze each potential hotfix PR
      for (const hotfixPR of potentialHotfixes) {
        const hotfixUserEmail =
          hotfixPR.user.email || `${hotfixPR.user.login}@github.local`;
        const hotfixCreatedAt = new Date(hotfixPR.created_at);

        // Find potential original PRs by the same user that were merged before this hotfix
        const candidateOriginalPRs = mergedPRs.filter((originalPR) => {
          const originalUserEmail =
            originalPR.user.email || `${originalPR.user.login}@github.local`;
          const originalMergedAt = new Date(originalPR.merged_at);

          return (
            originalUserEmail === hotfixUserEmail &&
            originalMergedAt < hotfixCreatedAt &&
            hotfixCreatedAt - originalMergedAt <= this.hotfixTimeWindow
          );
        });

        // For each candidate, check file overlap
        for (const originalPR of candidateOriginalPRs) {
          const [originalFiles, hotfixFiles] = await Promise.all([
            this.fetchPRFiles(originalPR.number),
            this.fetchPRFiles(hotfixPR.number),
          ]);

          const { overlap, percentage } = this.calculateFileOverlap(
            originalFiles,
            hotfixFiles
          );

          // Consider it a hotfix if there's any file overlap
          if (overlap > 0) {
            const userData = userMetrics.get(hotfixUserEmail);
            const hoursAfterOriginal =
              (hotfixCreatedAt - new Date(originalPR.merged_at)) /
              (1000 * 60 * 60);

            userData.hotfixDetails.push({
              originalPR: {
                number: originalPR.number,
                title: originalPR.title,
                mergedAt: originalPR.merged_at,
                files: originalFiles,
              },
              hotfixPR: {
                number: hotfixPR.number,
                title: hotfixPR.title,
                createdAt: hotfixPR.created_at,
                files: hotfixFiles,
                hoursAfterOriginal: Math.round(hoursAfterOriginal * 10) / 10,
                fileOverlap: overlap,
                overlapPercentage: percentage,
              },
            });

            hotfixPairs.push({
              original: originalPR,
              hotfix: hotfixPR,
              user: hotfixUserEmail,
              hoursAfter: hoursAfterOriginal,
              fileOverlap: overlap,
            });

            break; // Only count this hotfix once per original PR
          }
        }

        processedCount++;
        this.updateProgressBar(
          processedCount,
          potentialHotfixes.length,
          "Analyzing hotfixes"
        );
      }

      console.log("\nCalculating hotfix frequencies...");

      // Calculate hotfix frequencies and update hotfix counts
      const results = Array.from(userMetrics.values())
        .map((userData) => {
          userData.hotfixPRs = userData.hotfixDetails.length;
          userData.hotfixFrequency =
            userData.totalPRs > 0
              ? Math.round((userData.hotfixPRs / userData.totalPRs) * 1000) /
                1000
              : 0;
          return userData;
        })
        .filter((userData) => userData.totalPRs > 0);

      // Calculate summary statistics
      const totalPRs = results.reduce((sum, user) => sum + user.totalPRs, 0);
      const totalHotfixPRs = results.reduce(
        (sum, user) => sum + user.hotfixPRs,
        0
      );
      const overallHotfixRate =
        totalPRs > 0
          ? Math.round((totalHotfixPRs / totalPRs) * 1000) / 1000
          : 0;
      const averageHotfixFrequency =
        results.length > 0
          ? Math.round(
              (results.reduce((sum, user) => sum + user.hotfixFrequency, 0) /
                results.length) *
                1000
            ) / 1000
          : 0;

      return {
        repository: `${this.owner}/${this.repo}`,
        dateRange: {
          start: this.startDate,
          end: this.endDate,
        },
        summary: {
          totalPRs,
          totalUsers: results.length,
          totalHotfixPRs,
          overallHotfixRate,
          averageHotfixFrequency,
        },
        hotfixMetrics: results.sort(
          (a, b) => b.hotfixFrequency - a.hotfixFrequency
        ),
      };
    } catch (error) {
      console.error("Analysis failed:", error.message);

      // Handle common errors with friendly messaging
      if (error.message.includes("401")) {
        console.error(
          "\n❌ Authentication Error: GitHub API requires a valid Bearer token."
        );
        console.error("   Please check your token format and permissions.");
        console.error(
          '   Token should have "repo" scope for private repositories.'
        );
      } else if (error.message.includes("403")) {
        console.error(
          "\n❌ API Rate Limit: You have exceeded GitHub API rate limits."
        );
        console.error(
          "   Please wait and try again, or use a token with higher limits."
        );
      } else if (error.message.includes("404")) {
        console.error(
          "\n❌ Repository Not Found: Please verify the repository owner/name."
        );
        console.error("   Make sure your token has access to this repository.");
      }

      throw error;
    }
  }
}

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
    token: process.env.GITHUB_TOKEN || null,
    fetchLimit: 200,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
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
        options.fetchLimit = limit === "infinite" ? -1 : parseInt(limit) || 200;
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
      default:
        if (args[i].startsWith("-")) {
          console.error(`Unknown option: ${args[i]}`);
          process.exit(1);
        }
    }
  }

  return options;
}

function showHelp() {
  console.log(`
GitHub PR Hotfix Frequency Analysis Tool

Usage: node main.mjs [options]

Options:
  -r, --repo <owner/repo>         Repository to analyze (required)
  -f, --format <format>           Output format: json (default) or csv
  -o, --output <filename>         Output filename (auto-generated if not provided)
  -s, --start <date>              Start date (ISO format: YYYY-MM-DD) default -30Days
  -e, --end <date>                End date (ISO format: YYYY-MM-DD) default: now
  -v, --verbose                   Enable verbose logging
  -d, --debug                     Enable debug logging
  -t, --token                     GitHub Token
  -l, --fetchLimit                Set a fetch limit (default: 200, use 'infinite' for no limit)
  -h, --help                      Show help message

Environment Variables:
  GITHUB_TOKEN                    GitHub personal access token

Examples:
  node main.mjs -r facebook/react -s 2024-01-01 -e 2024-01-31
  node main.mjs -r microsoft/vscode --format csv --fetchLimit infinite
  node main.mjs -r owner/repo --token your_token_here

Metrics Explained:
  - Hotfix Frequency: (Number of hotfix PRs) / (Total number of original PRs) per user
  - Hotfix PR: PR with keywords like "hotfix", "fix", "patch", "urgent" in title/branch
  - Time Window: Hotfix PRs created within 48 hours of original PR merge
  - File Overlap: Hotfix and original PR must modify at least one common file

A "hotfix PR" is identified by:
  • PR title or branch name includes keywords like hotfix, fix, patch, urgent, etc.
  • PR is opened within 48 hours after an original PR was merged
  • PR modifies the same files or modules as the original PR

High hotfix frequency may indicate:
  • Inadequate test coverage before merging
  • Rushed reviews or overlooked edge cases
  • Gaps in CI/CD validation
`);
}

function formatAsCSV(data) {
  const lines = [
    "User Email,Username,Total PRs,Hotfix PRs,Hotfix Frequency,Hotfix Details Count",
  ];

  data.hotfixMetrics.forEach((user) => {
    lines.push(
      `"${user.userEmail}","${user.username}",${user.totalPRs},${user.hotfixPRs},${user.hotfixFrequency},${user.hotfixDetails.length}`
    );
  });

  return lines.join("\n");
}

async function main() {
  try {
    const options = parseArgs();

    if (!options.repo) {
      console.error("Error: Repository is required. Use -r or --repo option.");
      process.exit(1);
    }

    if (!options.token) {
      console.error(
        "Error: GitHub token is required. Use -t option or set GITHUB_TOKEN environment variable."
      );
      process.exit(1);
    }

    const [owner, repo] = options.repo.split("/");
    if (!owner || !repo) {
      console.error('Error: Repository must be in format "owner/repo"');
      process.exit(1);
    }

    if (!options.start) {
      const date = new Date();
      date.setDate(date.getDate() - 30);
      options.start = date.toISOString().split("T")[0];
    }

    if (!options.end) {
      options.end = new Date().toISOString().split("T")[0];
    }

    const startDate = new Date(options.start);
    const endDate = new Date(options.end);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      console.error("Error: Invalid date format. Use YYYY-MM-DD");
      process.exit(1);
    }

    if (startDate > endDate) {
      console.error("Error: Start date must be before end date");
      process.exit(1);
    }

    console.log(`\n🔍 Analyzing repository: ${options.repo}`);
    console.log(`📅 Date range: ${options.start} to ${options.end}`);
    console.log(
      `📊 Fetch limit: ${
        options.fetchLimit === -1 ? "unlimited" : options.fetchLimit
      }`
    );

    const analyzer = new GitHubHotfixAnalyzer(
      repo,
      owner,
      options.start,
      options.end,
      options.token
    );

    const results = await analyzer.analyzeHotfixes(options.fetchLimit);

    if (!options.output) {
      const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .split("T")[0];
      options.output = `hotfix-analysis-${owner}-${repo}-${timestamp}.${options.format}`;
    }

    let outputContent;
    if (options.format === "csv") {
      outputContent = formatAsCSV(results);
    } else {
      outputContent = JSON.stringify(results, null, 2);
    }

    writeFileSync(options.output, outputContent, "utf8");

    console.log(`\n✅ Analysis complete!`);
    console.log(`📁 Results saved to: ${options.output}`);
    console.log(`\n📈 Summary:`);
    console.log(`   📋 Total PRs analyzed: ${results.summary.totalPRs}`);
    console.log(`   👥 Total users: ${results.summary.totalUsers}`);
    console.log(`   🚨 Total hotfix PRs: ${results.summary.totalHotfixPRs}`);
    console.log(
      `   📊 Overall hotfix rate: ${(
        results.summary.overallHotfixRate * 100
      ).toFixed(1)}%`
    );
    console.log(
      `   ⭐ Average hotfix frequency: ${(
        results.summary.averageHotfixFrequency * 100
      ).toFixed(1)}%`
    );

    if (options.verbose) {
      console.log(`\n🚨 Top users by hotfix frequency:`);
      results.hotfixMetrics.slice(0, 5).forEach((user, i) => {
        if (user.hotfixFrequency > 0) {
          console.log(
            `   ${i + 1}. ${user.username}: ${(
              user.hotfixFrequency * 100
            ).toFixed(1)}% (${user.hotfixPRs}/${user.totalPRs} PRs)`
          );
        }
      });

      console.log(`\n🔍 Recent hotfix examples:`);
      const recentHotfixes = results.hotfixMetrics
        .flatMap((user) => user.hotfixDetails)
        .sort(
          (a, b) =>
            new Date(b.hotfixPR.createdAt) - new Date(a.hotfixPR.createdAt)
        )
        .slice(0, 3);

      recentHotfixes.forEach((detail, i) => {
        console.log(
          `   ${i + 1}. PR #${detail.hotfixPR.number}: "${
            detail.hotfixPR.title
          }"`
        );
        console.log(
          `      → Fixes PR #${detail.originalPR.number} after ${detail.hotfixPR.hoursAfterOriginal}h`
        );
        console.log(
          `      → File overlap: ${detail.hotfixPR.fileOverlap} files (${detail.hotfixPR.overlapPercentage}%)`
        );
      });
    }
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    if (options?.debug) {
      console.error("Stack trace:", error.stack);
    }
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { GitHubHotfixAnalyzer };
