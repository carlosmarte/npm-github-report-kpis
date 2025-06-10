#!/usr/bin/env node

/**
 * GitHub User Status Checker CLI
 *
 * JSON Report Structure:
 * {
 *   "results": [
 *     {
 *       "input": "username_or_email",
 *       "input_type": "username|email",
 *       "user": "username",
 *       "email": "user@example.com",
 *       "status": "active|suspended|not_found|limited",
 *       "analysis": {
 *         "profile_accessible": boolean,
 *         "recent_activity": boolean,
 *         "public_repos": number,
 *         "last_activity": "ISO_DATE",
 *         "account_created": "ISO_DATE"
 *       },
 *       "indicators": {
 *         "profile_404": boolean,
 *         "no_recent_commits": boolean,
 *         "empty_profile": boolean,
 *         "api_errors": array
 *       }
 *     }
 *   ],
 *   "summary": {
 *     "total_checked": number,
 *     "active": number,
 *     "suspended": number,
 *     "not_found": number,
 *     "limited": number
 *   },
 *   "timestamp": "ISO_DATE"
 * }
 *
 * Use Cases:
 * - Compliance checking for organizational access
 * - Security auditing of team members
 * - User verification before granting permissions
 * - Automated monitoring of GitHub accounts
 * - Due diligence for code review assignments
 */

import { program } from "commander";
import https from "https";
import fs from "fs/promises";
import path from "path";

// GitHub API configuration
const GITHUB_API_BASE = "https://api.github.com";
const DEFAULT_FETCH_LIMIT = 200;
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 1000;

class GitHubUserChecker {
  constructor(token, options = {}) {
    this.token = token;
    this.verbose = options.verbose || false;
    this.debug = options.debug || false;
    this.fetchLimit = options.fetchLimit || DEFAULT_FETCH_LIMIT;
    this.rateLimitRemaining = null;
    this.rateLimitReset = null;
  }

  log(message, level = "info") {
    const timestamp = new Date().toISOString();

    if (level === "debug" && !this.debug) return;
    if (level === "verbose" && !this.verbose && !this.debug) return;

    const prefix =
      {
        error: "❌",
        warn: "⚠️",
        info: "ℹ️",
        debug: "🔍",
        verbose: "📝",
      }[level] || "ℹ️";

    console.log(`${prefix} [${timestamp}] ${message}`);
  }

  async makeRequest(url, retryCount = 0) {
    return new Promise((resolve, reject) => {
      const options = {
        headers: {
          Authorization: `Bearer ${this.token}`,
          "User-Agent": "GitHub-User-Checker-CLI/1.0.0",
          Accept: "application/vnd.github.v3+json",
        },
      };

      this.log(`Making request to: ${url}`, "debug");

      const req = https.get(url, options, (res) => {
        let data = "";

        // Update rate limit info
        this.rateLimitRemaining = res.headers["x-ratelimit-remaining"];
        this.rateLimitReset = res.headers["x-ratelimit-reset"];

        this.log(`Rate limit remaining: ${this.rateLimitRemaining}`, "debug");

        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const response = {
              statusCode: res.statusCode,
              headers: res.headers,
              data: data ? JSON.parse(data) : null,
            };
            resolve(response);
          } catch (error) {
            this.log(`JSON parse error: ${error.message}`, "error");
            resolve({
              statusCode: res.statusCode,
              headers: res.headers,
              data: null,
              rawData: data,
            });
          }
        });
      });

      req.on("error", async (error) => {
        this.log(`Request error: ${error.message}`, "error");

        if (retryCount < RETRY_ATTEMPTS) {
          this.log(
            `Retrying request (${retryCount + 1}/${RETRY_ATTEMPTS})...`,
            "verbose"
          );
          await this.sleep(RETRY_DELAY * (retryCount + 1));
          try {
            const result = await this.makeRequest(url, retryCount + 1);
            resolve(result);
          } catch (retryError) {
            reject(retryError);
          }
        } else {
          reject(error);
        }
      });

      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error("Request timeout"));
      });
    });
  }

  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async searchUserByEmail(email) {
    try {
      const url = `${GITHUB_API_BASE}/search/users?q=${encodeURIComponent(
        email
      )}+in:email`;
      const response = await this.makeRequest(url);

      if (response.statusCode === 200 && response.data.items.length > 0) {
        return response.data.items[0].login;
      }
      return null;
    } catch (error) {
      this.log(`Email search failed: ${error.message}`, "error");
      return null;
    }
  }

  async getUserProfile(username) {
    try {
      const url = `${GITHUB_API_BASE}/users/${username}`;
      const response = await this.makeRequest(url);

      return {
        success: response.statusCode === 200,
        statusCode: response.statusCode,
        data: response.data,
        error: response.statusCode !== 200 ? response.data : null,
      };
    } catch (error) {
      this.log(`Profile fetch failed: ${error.message}`, "error");
      return {
        success: false,
        statusCode: 0,
        data: null,
        error: error.message,
      };
    }
  }

  async getUserActivity(username) {
    try {
      const url = `${GITHUB_API_BASE}/users/${username}/events/public?per_page=10`;
      const response = await this.makeRequest(url);

      return {
        success: response.statusCode === 200,
        statusCode: response.statusCode,
        data: response.data || [],
        error: response.statusCode !== 200 ? response.data : null,
      };
    } catch (error) {
      this.log(`Activity fetch failed: ${error.message}`, "error");
      return {
        success: false,
        statusCode: 0,
        data: [],
        error: error.message,
      };
    }
  }

  async getUserRepos(username) {
    try {
      const url = `${GITHUB_API_BASE}/users/${username}/repos?per_page=1&sort=updated`;
      const response = await this.makeRequest(url);

      return {
        success: response.statusCode === 200,
        statusCode: response.statusCode,
        data: response.data || [],
        error: response.statusCode !== 200 ? response.data : null,
      };
    } catch (error) {
      this.log(`Repos fetch failed: ${error.message}`, "error");
      return {
        success: false,
        statusCode: 0,
        data: [],
        error: error.message,
      };
    }
  }

  analyzeUserStatus(profile, activity, repos) {
    const indicators = {
      profile_404: false,
      no_recent_commits: false,
      empty_profile: false,
      api_errors: [],
    };

    const analysis = {
      profile_accessible: false,
      recent_activity: false,
      public_repos: 0,
      last_activity: null,
      account_created: null,
    };

    // Analyze profile
    if (!profile.success) {
      indicators.profile_404 = profile.statusCode === 404;
      indicators.api_errors.push(
        `Profile: ${profile.error?.message || "Unknown error"}`
      );
    } else {
      analysis.profile_accessible = true;
      analysis.public_repos = profile.data.public_repos || 0;
      analysis.account_created = profile.data.created_at;

      // Check for empty/limited profile
      if (
        !profile.data.name &&
        !profile.data.bio &&
        !profile.data.company &&
        analysis.public_repos === 0
      ) {
        indicators.empty_profile = true;
      }
    }

    // Analyze activity
    if (activity.success && activity.data.length > 0) {
      analysis.recent_activity = true;
      analysis.last_activity = activity.data[0].created_at;

      // Check if last activity is older than 90 days
      const lastActivity = new Date(activity.data[0].created_at);
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

      if (lastActivity < ninetyDaysAgo) {
        indicators.no_recent_commits = true;
      }
    } else {
      indicators.no_recent_commits = true;
      if (!activity.success) {
        indicators.api_errors.push(
          `Activity: ${activity.error?.message || "Unknown error"}`
        );
      }
    }

    // Determine status
    let status = "active";

    if (indicators.profile_404) {
      status = "not_found";
    } else if (indicators.empty_profile && indicators.no_recent_commits) {
      status = "suspended";
    } else if (indicators.api_errors.length > 1) {
      status = "limited";
    }

    return { status, analysis, indicators };
  }

  async checkUser(identifier, inputType = "auto") {
    const isEmail =
      inputType === "email" ||
      (inputType === "auto" && identifier.includes("@"));
    let username = identifier;

    this.log(
      `Checking ${isEmail ? "email" : "username"}: ${identifier}`,
      "info"
    );

    // Convert email to username if needed
    if (isEmail) {
      this.log("Searching for user by email...", "verbose");
      username = await this.searchUserByEmail(identifier);
      if (!username) {
        return {
          input: identifier,
          input_type: "email",
          user: null,
          email: identifier,
          status: "not_found",
          analysis: null,
          indicators: { api_errors: ["Email not found in GitHub search"] },
        };
      }
      this.log(`Found username: ${username}`, "verbose");
    }

    // Show progress
    console.log(`🔍 Fetching profile for ${username}...`);
    const profile = await this.getUserProfile(username);

    console.log(`📊 Checking recent activity for ${username}...`);
    const activity = await this.getUserActivity(username);

    console.log(`📂 Analyzing repositories for ${username}...`);
    const repos = await this.getUserRepos(username);

    console.log(`🔍 Analyzing status for ${username}...`);
    const { status, analysis, indicators } = this.analyzeUserStatus(
      profile,
      activity,
      repos
    );

    return {
      input: identifier,
      input_type: isEmail ? "email" : "username",
      user: username,
      email: isEmail ? identifier : profile.data?.email || null,
      status,
      analysis,
      indicators,
    };
  }

  async checkMultipleUsers(targets) {
    const results = [];
    const total = targets.length;

    console.log(
      `🚀 Starting GitHub user status check for ${total} target(s)...`
    );

    for (let i = 0; i < targets.length; i++) {
      const { identifier, type } = targets[i];
      console.log(`\n📊 [${i + 1}/${total}] Checking: ${identifier} (${type})`);

      try {
        const result = await this.checkUser(identifier, type);
        results.push(result);

        // Brief pause between requests to be nice to GitHub API
        if (i < targets.length - 1) {
          await this.sleep(500);
        }
      } catch (error) {
        this.log(`Failed to check ${identifier}: ${error.message}`, "error");
        results.push({
          input: identifier,
          input_type: type,
          user: null,
          email: type === "email" ? identifier : null,
          status: "error",
          analysis: null,
          indicators: { api_errors: [error.message] },
        });
      }
    }

    // Generate summary statistics
    const summary = {
      total_checked: results.length,
      active: results.filter((r) => r.status === "active").length,
      suspended: results.filter((r) => r.status === "suspended").length,
      not_found: results.filter((r) => r.status === "not_found").length,
      limited: results.filter((r) => r.status === "limited").length,
      error: results.filter((r) => r.status === "error").length,
    };

    return {
      results,
      summary,
      timestamp: new Date().toISOString(),
    };
  }
}

// Error handling helper
function handleCommonErrors(error) {
  console.log(`Full error details: ${error.message}`);

  if (error.message.includes("401")) {
    console.log(
      "❌ Authentication Error: GitHub API requires a valid Bearer token"
    );
    console.log(
      "💡 Solution: Ensure your GITHUB_TOKEN environment variable is set or use --token flag"
    );
    console.log(
      "📝 Token format should be: ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    );
  } else if (error.message.includes("403")) {
    console.log(
      "❌ Permission Error: Token lacks proper repository access scopes"
    );
    console.log(
      "💡 Solution: Regenerate token with user:read and public_repo scopes"
    );
  } else if (error.message.includes("rate limit")) {
    console.log("❌ Rate Limit Error: Too many requests to GitHub API");
    console.log(
      "💡 Solution: Wait for rate limit reset or use authenticated requests"
    );
  } else {
    console.log(`❌ Unexpected Error: ${error.message}`);
  }
}

// CLI setup
program
  .name("github-user-checker")
  .description(
    "Check if GitHub users are suspended by analyzing their profile and activity"
  )
  .version("1.0.0")
  .argument(
    "[identifier]",
    "GitHub username or email address to check (optional if using --user/--email)"
  )
  .option("-u, --user <username>", "GitHub username to check")
  .option("-e, --email <email>", "Email address to search and check")
  .option("-t, --token <token>", "GitHub token (or use GITHUB_TOKEN env var)")
  .option(
    "-f, --format <format>",
    "Output format: json (default) or summary",
    "json"
  )
  .option(
    "-o, --output <filename>",
    "Output filename (auto-generated if not provided)"
  )
  .option("-v, --verbose", "Enable verbose logging", false)
  .option("-d, --debug", "Enable debug logging", false)
  .option(
    "-l, --fetch-limit <limit>",
    'Set fetch limit (default: 200, use "infinite" for no limit)',
    DEFAULT_FETCH_LIMIT.toString()
  )
  .helpOption("-h, --help", "Show help message");

// Parse arguments first
program.parse();

// Main execution
async function main() {
  try {
    const options = program.opts();
    const identifier = program.args[0];

    // Collect all targets to check
    const targets = [];

    if (identifier) {
      targets.push({
        identifier: identifier,
        type: "auto",
      });
    }

    if (options.user) {
      targets.push({
        identifier: options.user,
        type: "username",
      });
    }

    if (options.email) {
      targets.push({
        identifier: options.email,
        type: "email",
      });
    }

    if (targets.length === 0) {
      console.log("❌ Error: At least one identifier is required");
      console.log(
        "💡 Use: <identifier> argument, --user <username>, or --email <email>"
      );
      program.help();
      process.exit(1);
    }

    // Get GitHub token
    const token = options.token || process.env.GITHUB_TOKEN;
    if (!token) {
      console.log("❌ Error: GitHub token is required");
      console.log(
        "💡 Set GITHUB_TOKEN environment variable or use --token flag"
      );
      console.log("📝 Get token from: https://github.com/settings/tokens");
      process.exit(1);
    }

    // Parse fetch limit
    let fetchLimit = DEFAULT_FETCH_LIMIT;
    if (options.fetchLimit) {
      if (options.fetchLimit.toLowerCase() === "infinite") {
        fetchLimit = Infinity;
      } else {
        fetchLimit = parseInt(options.fetchLimit);
        if (isNaN(fetchLimit)) {
          console.log(
            '❌ Error: Invalid fetch limit. Use a number or "infinite"'
          );
          process.exit(1);
        }
      }
    }

    // Initialize checker
    const checker = new GitHubUserChecker(token, {
      verbose: options.verbose,
      debug: options.debug,
      fetchLimit,
    });

    console.log(
      `🔢 Fetch limit: ${fetchLimit === Infinity ? "Infinite" : fetchLimit}`
    );
    console.log(
      `📋 Targets: ${targets
        .map((t) => `${t.identifier} (${t.type})`)
        .join(", ")}`
    );

    // Check user(s)
    const result = await checker.checkMultipleUsers(targets);

    // Output results
    if (options.format === "summary") {
      console.log("\n🎯 GITHUB USER STATUS REPORT");
      console.log("==============================");
      console.log(`Total checked: ${result.summary.total_checked}`);
      console.log(`Report time: ${result.timestamp}`);

      console.log("\n📊 STATUS SUMMARY");
      console.log("-----------------");
      console.log(`✅ Active: ${result.summary.active}`);
      console.log(`⚠️  Suspended: ${result.summary.suspended}`);
      console.log(`❌ Not Found: ${result.summary.not_found}`);
      console.log(`🔒 Limited: ${result.summary.limited}`);
      if (result.summary.error > 0) {
        console.log(`💥 Errors: ${result.summary.error}`);
      }

      console.log("\n👤 DETAILED RESULTS");
      console.log("===================");

      result.results.forEach((user, index) => {
        console.log(`\n[${index + 1}] ${user.input} (${user.input_type})`);
        console.log(`    Username: ${user.user || "Not found"}`);
        console.log(`    Email: ${user.email || "Not provided"}`);
        console.log(`    Status: ${user.status.toUpperCase()}`);

        if (user.analysis) {
          console.log(
            `    Profile accessible: ${
              user.analysis.profile_accessible ? "✅" : "❌"
            }`
          );
          console.log(
            `    Recent activity: ${
              user.analysis.recent_activity ? "✅" : "❌"
            }`
          );
          console.log(`    Public repos: ${user.analysis.public_repos}`);
          console.log(
            `    Account created: ${user.analysis.account_created || "Unknown"}`
          );
          console.log(
            `    Last activity: ${user.analysis.last_activity || "None found"}`
          );
        }

        if (user.indicators?.api_errors?.length > 0) {
          console.log(`    Issues: ${user.indicators.api_errors.join(", ")}`);
        }
      });
    } else {
      console.log("\n" + JSON.stringify(result, null, 2));
    }

    // Save to file if requested
    if (options.output) {
      const outputPath = path.resolve(options.output);
      await fs.writeFile(outputPath, JSON.stringify(result, null, 2));
      console.log(`\n💾 Results saved to: ${outputPath}`);
    }

    // Status-based exit codes
    const hasIssues =
      result.summary.suspended > 0 ||
      result.summary.not_found > 0 ||
      result.summary.limited > 0 ||
      result.summary.error > 0;
    process.exit(hasIssues ? 1 : 0);
  } catch (error) {
    handleCommonErrors(error);
    console.log("\n💡 For more help, run with --help flag");
    process.exit(1);
  }
}

// Export for module usage
export { GitHubUserChecker };

// Run CLI if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
