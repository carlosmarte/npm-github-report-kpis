#!/usr/bin/env node

/**
 * GitHub Email to Username CLI Tool
 *
 * Fetches GitHub userId and userName from email address using GitHub API.
 *
 * Features:
 * - Email-based user lookup via GitHub Search API
 * - Retry logic for failed requests
 * - Rate limiting respect
 * - Bearer token authentication
 * - Verbose and debug logging
 * - Comprehensive error handling
 *
 * Use Cases:
 * - Developer identity verification
 * - User profile mapping for integration tools
 * - Email-to-username resolution for automation
 * - Team member identification in projects
 *
 * JSON Report Structure:
 * {
 *   "success": boolean,
 *   "email": "user@example.com",
 *   "user": {
 *     "userId": 12345,
 *     "userName": "username"
 *   },
 *   "timestamp": "2024-01-01T00:00:00.000Z",
 *   "rateLimit": {
 *     "remaining": 999,
 *     "resetTime": "2024-01-01T01:00:00.000Z"
 *   }
 * }
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const CONFIG = {
  baseUrl: "https://api.github.com",
  maxRetries: 3,
  retryDelay: 1000,
  searchEndpoint: "/search/users",
  userAgent: "GitHub-Email-To-Username-CLI/1.0.0",
};

// CLI State
let verbose = false;
let debug = false;

/**
 * Display help information
 */
function showHelp() {
  const packageJson = JSON.parse(
    readFileSync(join(__dirname, "package.json"), "utf8")
  );

  console.log(`
${packageJson.name} v${packageJson.version}
${packageJson.description}

Usage:
  node main.mjs <email> [options]

Arguments:
  <email>                    GitHub user email address (required)

Options:
  -t, --token <token>        GitHub personal access token
  -v, --verbose              Enable verbose logging
  -d, --debug                Enable debug logging
  -h, --help                 Show this help message

Environment Variables:
  GITHUB_TOKEN              GitHub personal access token

Examples:
  node main.mjs user@example.com
  node main.mjs user@example.com --token ghp_xxxxxxxxxxxx
  node main.mjs user@example.com --verbose
  GITHUB_TOKEN=ghp_xxxx node main.mjs user@example.com

Note: GitHub's email search only works for publicly visible email addresses.
`);
}

/**
 * Log message with timestamp if verbose mode is enabled
 */
function log(message) {
  if (verbose) {
    console.log(`[${new Date().toISOString()}] ${message}`);
  }
}

/**
 * Log debug message if debug mode is enabled
 */
function debugLog(message, data = null) {
  if (debug) {
    console.log(`[DEBUG ${new Date().toISOString()}] ${message}`);
    if (data) {
      console.log(JSON.stringify(data, null, 2));
    }
  }
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Validate email format
 */
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Parse command line arguments
 */
function parseArguments() {
  const args = process.argv.slice(2);
  const options = {
    email: null,
    token: null,
    verbose: false,
    debug: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "-h":
      case "--help":
        options.help = true;
        break;
      case "-v":
      case "--verbose":
        options.verbose = true;
        break;
      case "-d":
      case "--debug":
        options.debug = true;
        break;
      case "-t":
      case "--token":
        if (i + 1 < args.length) {
          options.token = args[++i];
        } else {
          throw new Error("Token option requires a value");
        }
        break;
      default:
        if (!arg.startsWith("-") && !options.email) {
          options.email = arg;
        } else if (arg.startsWith("-")) {
          throw new Error(`Unknown option: ${arg}`);
        }
        break;
    }
  }

  return options;
}

/**
 * Get GitHub token from arguments or environment
 */
function getGitHubToken(providedToken) {
  const token = providedToken || process.env.GITHUB_TOKEN;

  if (!token) {
    throw new Error(`
GitHub token is required. Provide it via:
1. Command line: --token <your-token>
2. Environment variable: GITHUB_TOKEN=<your-token>

Get a token from: https://github.com/settings/tokens
Required scopes: public_repo (for public repositories)
`);
  }

  return token;
}

/**
 * Make HTTP request with retry logic
 */
async function makeRequest(url, options, retryCount = 0) {
  try {
    debugLog(`Making request to: ${url}`, { options, retryCount });

    const response = await fetch(url, options);

    debugLog(`Response status: ${response.status}`, {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
    });

    // Handle rate limiting
    if (response.status === 403) {
      const resetTime = response.headers.get("x-ratelimit-reset");
      const remaining = response.headers.get("x-ratelimit-remaining");

      if (remaining === "0" && resetTime) {
        const resetDate = new Date(parseInt(resetTime) * 1000);
        const waitTime = resetDate.getTime() - Date.now();

        if (waitTime > 0 && waitTime < 3600000) {
          // Wait max 1 hour
          log(`Rate limited. Waiting ${Math.ceil(waitTime / 1000)} seconds...`);
          await sleep(waitTime + 1000); // Add 1 second buffer
          return makeRequest(url, options, retryCount);
        }
      }

      throw new Error(
        `GitHub API rate limit exceeded. Reset time: ${
          resetTime
            ? new Date(parseInt(resetTime) * 1000).toISOString()
            : "unknown"
        }`
      );
    }

    if (!response.ok) {
      const errorBody = await response.text();
      debugLog(`Error response body:`, errorBody);

      // Provide user-friendly error messages
      switch (response.status) {
        case 401:
          throw new Error(
            "Authentication failed. Please check your GitHub token and ensure it uses Bearer format."
          );
        case 404:
          throw new Error(
            "Resource not found. The repository or user may not exist or may be private."
          );
        case 422:
          throw new Error(
            "Invalid request. Please check your input parameters."
          );
        default:
          throw new Error(
            `GitHub API error (${response.status}): ${
              errorBody || response.statusText
            }`
          );
      }
    }

    const data = await response.json();
    debugLog(`Response data:`, data);

    return {
      data,
      rateLimit: {
        remaining: parseInt(
          response.headers.get("x-ratelimit-remaining") || "0"
        ),
        resetTime: response.headers.get("x-ratelimit-reset")
          ? new Date(
              parseInt(response.headers.get("x-ratelimit-reset")) * 1000
            ).toISOString()
          : null,
      },
    };
  } catch (error) {
    debugLog(`Request failed:`, { error: error.message, retryCount });

    if (retryCount < CONFIG.maxRetries) {
      const delay = CONFIG.retryDelay * Math.pow(2, retryCount);
      log(
        `Request failed, retrying in ${delay}ms... (attempt ${retryCount + 1}/${
          CONFIG.maxRetries
        })`
      );
      await sleep(delay);
      return makeRequest(url, options, retryCount + 1);
    }

    throw error;
  }
}

/**
 * Search for GitHub user by email
 */
async function fetchUserByEmail(email, token) {
  if (!isValidEmail(email)) {
    throw new Error(`Invalid email format: ${email}`);
  }

  log(`Searching for user with email: ${email}`);

  const searchQuery = encodeURIComponent(`${email} in:email`);
  const url = `${CONFIG.baseUrl}${CONFIG.searchEndpoint}?q=${searchQuery}`;

  const options = {
    headers: {
      Authorization: `Bearer ${token}`, // Use Bearer format instead of token
      Accept: "application/vnd.github.v3+json",
      "User-Agent": CONFIG.userAgent,
    },
  };

  const result = await makeRequest(url, options);

  if (result.data.items && result.data.items.length > 0) {
    const userData = result.data.items[0]; // Get first match
    log(`Found user: ${userData.login} (ID: ${userData.id})`);

    return {
      success: true,
      email,
      user: {
        userId: userData.id,
        userName: userData.login,
      },
      timestamp: new Date().toISOString(),
      rateLimit: result.rateLimit,
    };
  }

  log(`No user found with email: ${email}`);
  return {
    success: false,
    email,
    user: null,
    message:
      "No user found with the provided email. Note: Only publicly visible email addresses can be searched.",
    timestamp: new Date().toISOString(),
    rateLimit: result.rateLimit,
  };
}

/**
 * Main CLI function
 */
async function main() {
  try {
    // Parse command line arguments
    const options = parseArguments();

    // Set global flags
    verbose = options.verbose;
    debug = options.debug;

    // Show help if requested
    if (options.help) {
      showHelp();
      return;
    }

    // Validate email argument
    if (!options.email) {
      console.error("Error: Email address is required");
      console.error("Use --help for usage information");
      process.exit(1);
    }

    log("Starting GitHub email to username lookup...");
    debugLog("CLI options:", options);

    // Get GitHub token
    const token = getGitHubToken(options.token);
    log("GitHub token configured");

    // Progress indicator
    if (verbose) {
      process.stdout.write("Searching... ");
    }

    // Fetch user data
    const result = await fetchUserByEmail(options.email, token);

    if (verbose) {
      process.stdout.write("✓\n");
    }

    // Output result
    console.log(JSON.stringify(result, null, 2));

    // Exit with appropriate code
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error("\n❌ Error:", error.message);

    // Provide helpful error explanations
    if (error.message.includes("Authentication")) {
      console.error(
        "\n💡 Solution: GitHub API now requires Bearer token format. Ensure your token is valid and has appropriate permissions."
      );
    } else if (error.message.includes("rate limit")) {
      console.error(
        "\n💡 Solution: Wait for the rate limit to reset or use an authenticated token for higher limits."
      );
    } else if (error.message.includes("Token")) {
      console.error(
        "\n💡 Solution: Get a GitHub token from https://github.com/settings/tokens"
      );
    }

    debugLog("Full error details:", error);
    process.exit(1);
  }
}

// Run CLI if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("Unhandled error:", error);
    process.exit(1);
  });
}

export { fetchUserByEmail, makeRequest };

//node main.mjs torvalds@linux-foundation.org
