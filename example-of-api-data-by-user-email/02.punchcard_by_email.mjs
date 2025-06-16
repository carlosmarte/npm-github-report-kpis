#!/usr/bin/env node

/**
 * GitHub Repository Contributor Analysis CLI with Punch Card Shift Analysis
 *
 * JSON Report Structure:
 * {
 *   "repository": {
 *     "name": "repo-name",
 *     "owner": "owner-name",
 *     "url": "https://github.com/owner/repo",
 *     "analysisDateRange": {
 *       "start": "2024-01-01",
 *       "end": "2024-12-31"
 *     }
 *   },
 *   "summary": {
 *     "totalCommits": 150,
 *     "totalContributors": 5,
 *     "dateRange": "2024-01-01 to 2024-12-31",
 *     "analysisTimestamp": "2024-01-15T10:30:00Z",
 *     "commitLimit": 200
 *   },
 *   "contributors": [
 *     {
 *       "email": "developer@example.com",
 *       "name": "John Developer",
 *       "commitCount": 45,
 *       "linesAdded": 1250,
 *       "linesDeleted": 320,
 *       "firstCommit": "2024-01-15T09:30:00Z",
 *       "lastCommit": "2024-03-20T14:45:00Z",
 *       "punchCard": {
 *         "hourlyDistribution": [0,0,0,5,12,8,15,20,18,22,25,30,28,25,20,15,10,8,5,2,1,0,0,0],
 *         "dailyDistribution": [15,25,30,28,20,10,5],
 *         "shiftBreakdown": {
 *           "morning": 35,
 *           "afternoon": 45,
 *           "evening": 20
 *         }
 *       }
 *     }
 *   ],
 *   "punchCardAnalysis": {
 *     "repositoryPunchCard": {
 *       "hourlyDistribution": [...],
 *       "dailyDistribution": [...],
 *       "peakHour": 14,
 *       "peakDay": "Tuesday"
 *     },
 *     "shiftComparison": {
 *       "morning": {"commits": 120, "contributors": ["dev1@email.com"]},
 *       "afternoon": {"commits": 180, "contributors": ["dev2@email.com"]},
 *       "evening": {"commits": 80, "contributors": ["dev3@email.com"]}
 *     }
 *   }
 * }
 *
 * Use Cases:
 * 1. Team Productivity Analysis: Track commit frequency and patterns across team members
 * 2. Work Pattern Analysis: Identify working time distributions and shift preferences
 * 3. Collaboration Timing: Understand when teams are most active for better coordination
 * 4. Remote Work Insights: Analyze distributed team patterns across time zones
 * 5. Process Optimization: Compare before/after periods for development process changes
 * 6. Productivity Patterns: Identify peak performance hours and days
 * 7. Team Health Assessment: Monitor work-life balance through commit timing patterns
 * 8. Resource Planning: Optimize meeting schedules and code review timing
 */

import { promises as fs } from "fs";
import { performance } from "perf_hooks";

class GitHubAnalyzer {
  constructor() {
    this.baseUrl = "https://api.github.com";
    this.requestCount = 0;
    this.rateLimitRemaining = 5000;
    this.rateLimitReset = null;
  }

  /**
   * Main analysis method with punch card shift breakdown
   * @param {string} repo - Repository name
   * @param {string} owner - Repository owner
   * @param {string} startDate - Start date (YYYY-MM-DD) - defaults to 2 days ago
   * @param {string} endDate - End date (YYYY-MM-DD) - defaults to now
   * @param {string} token - GitHub token
   * @param {number} fetchLimit - Maximum commits to analyze (default: 200, 0 for infinite)
   * @returns {Object} Analysis results with punch card data
   */
  async analyzeRepository(
    repo,
    owner,
    startDate = null,
    endDate = null,
    token,
    fetchLimit = 200
  ) {
    this.token = token;

    // Set default dates if not provided
    if (!startDate) {
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 55);
      startDate = twoDaysAgo.toISOString().split("T")[0];
    }

    if (!endDate) {
      endDate = new Date().toISOString().split("T")[0];
    }

    this.validateInputs(repo, owner, startDate, endDate, token);

    console.log(`🔍 Analyzing repository: ${owner}/${repo}`);
    console.log(`📅 Date range: ${startDate} to ${endDate}`);
    console.log(
      `📊 Fetch limit: ${fetchLimit === 0 ? "Infinite" : fetchLimit}`
    );
    console.log("⏰ Including punch card shift analysis...");
    console.log("");

    const startTime = performance.now();

    try {
      // Get repository information
      const repoInfo = await this.fetchRepositoryInfo(owner, repo);

      // Fetch commits in date range with limit
      const commits = await this.fetchCommitsInDateRange(
        owner,
        repo,
        startDate,
        endDate,
        fetchLimit
      );

      if (commits.length === 0) {
        console.log("⚠️  No commits found in the specified date range.");
        return this.createEmptyReport(
          repo,
          owner,
          startDate,
          endDate,
          fetchLimit
        );
      }

      // Process contributor data with punch card analysis
      const contributorData = await this.processContributorData(
        commits,
        owner,
        repo
      );

      // Generate punch card analysis
      const punchCardAnalysis = this.generatePunchCardAnalysis(
        contributorData,
        commits
      );

      // Generate insights
      const insights = this.generateInsights(contributorData);

      const endTime = performance.now();
      const duration = ((endTime - startTime) / 1000).toFixed(2);

      const report = {
        repository: {
          name: repo,
          owner: owner,
          url: `https://github.com/${owner}/${repo}`,
          analysisDateRange: {
            start: startDate,
            end: endDate,
          },
        },
        summary: {
          totalCommits: commits.length,
          totalContributors: Object.keys(contributorData).length,
          dateRange: `${startDate} to ${endDate}`,
          analysisTimestamp: new Date().toISOString(),
          processingTimeSeconds: parseFloat(duration),
          fetchLimit: fetchLimit === 0 ? "Infinite" : fetchLimit,
          fetchLimitReached: fetchLimit > 0 && commits.length >= fetchLimit,
        },
        contributors: Object.values(contributorData).sort(
          (a, b) => b.commitCount - a.commitCount
        ),
        punchCardAnalysis,
        insights,
      };

      console.log(`\n✅ Analysis completed in ${duration}s`);
      console.log(`📊 Total commits analyzed: ${commits.length}`);
      console.log(
        `👥 Contributors found: ${Object.keys(contributorData).length}`
      );
      console.log(
        `⏰ Punch card patterns identified for ${
          Object.keys(contributorData).length
        } contributors`
      );

      if (fetchLimit > 0 && commits.length >= fetchLimit) {
        console.log(
          `⚠️  Fetch limit reached (${fetchLimit}). Use --fetchLimit 0 for infinite.`
        );
      }

      return report;
    } catch (error) {
      console.error("❌ Analysis failed:", error.message);
      this.handleCommonErrors(error);
      throw error;
    }
  }

  handleCommonErrors(error) {
    if (error.message.includes("Authentication failed")) {
      console.error(
        "\n💡 Solution: Ensure your GitHub token is valid and uses Bearer format:"
      );
      console.error(
        "   - Personal Access Token should start with 'ghp_' or 'github_pat_'"
      );
      console.error(
        "   - Token must have 'repo' scope for private repositories"
      );
      console.error("   - Use: export GITHUB_TOKEN=your_token_here");
    } else if (error.message.includes("rate limit")) {
      console.error("\n💡 Solution: GitHub API rate limit exceeded:");
      console.error("   - Wait for rate limit reset (usually 1 hour)");
      console.error(
        "   - Use authenticated requests (increases limit to 5000/hour)"
      );
      console.error("   - Consider using --fetchLimit to reduce API calls");
    } else if (error.message.includes("Repository not found")) {
      console.error("\n💡 Solution: Repository access issue:");
      console.error("   - Check repository name format: owner/repo");
      console.error("   - Ensure repository exists and is accessible");
      console.error("   - For private repos, token needs 'repo' scope");
    } else if (error.message.includes("Token Permissions")) {
      console.error("\n💡 Solution: Token permission issue:");
      console.error("   - Token may lack proper repository access scopes");
      console.error("   - Regenerate token with 'repo' and 'user' scopes");
      console.error("   - Ensure token hasn't expired");
    }
  }

  createEmptyReport(repo, owner, startDate, endDate, fetchLimit) {
    return {
      repository: {
        name: repo,
        owner: owner,
        url: `https://github.com/${owner}/${repo}`,
        analysisDateRange: {
          start: startDate,
          end: endDate,
        },
      },
      summary: {
        totalCommits: 0,
        totalContributors: 0,
        dateRange: `${startDate} to ${endDate}`,
        analysisTimestamp: new Date().toISOString(),
        processingTimeSeconds: 0,
        fetchLimit: fetchLimit === 0 ? "Infinite" : fetchLimit,
        fetchLimitReached: false,
      },
      contributors: [],
      punchCardAnalysis: {
        repositoryPunchCard: {
          hourlyDistribution: new Array(24).fill(0),
          dailyDistribution: new Array(7).fill(0),
          peakHour: 0,
          peakDay: "Unknown",
          totalCommits: 0,
        },
        shiftComparison: {
          morning: { commits: 0, contributors: [], percentage: 0 },
          afternoon: { commits: 0, contributors: [], percentage: 0 },
          evening: { commits: 0, contributors: [], percentage: 0 },
        },
        workPatterns: {
          weekdayCommits: 0,
          weekendCommits: 0,
          businessHoursCommits: 0,
          afterHoursCommits: 0,
        },
      },
      insights: {
        topContributorByCommits: null,
        topContributorByLinesAdded: null,
        averageCommitsPerContributor: 0,
        codeChurnRate: 0,
        totalLinesAdded: 0,
        totalLinesDeleted: 0,
        mostActiveDay: { day: "Unknown", count: 0 },
        mostActiveHour: { hour: 0, count: 0, timeDisplay: "00:00 UTC" },
        contributorDistribution: [],
        shiftPreferences: { morning: [], afternoon: [], evening: [] },
      },
    };
  }

  validateInputs(repo, owner, startDate, endDate, token) {
    if (!repo || !owner || !token) {
      throw new Error("Repository, owner, and token are required");
    }

    if (startDate && !this.isValidDate(startDate)) {
      throw new Error("Invalid start date format. Use YYYY-MM-DD");
    }

    if (endDate && !this.isValidDate(endDate)) {
      throw new Error("Invalid end date format. Use YYYY-MM-DD");
    }

    if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
      throw new Error("Start date must be before end date");
    }
  }

  isValidDate(dateString) {
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!regex.test(dateString)) return false;
    const date = new Date(dateString);
    return (
      date instanceof Date &&
      !isNaN(date) &&
      dateString === date.toISOString().split("T")[0]
    );
  }

  async fetchRepositoryInfo(owner, repo) {
    const url = `${this.baseUrl}/repos/${owner}/${repo}`;
    const response = await this.makeRequest(url);
    return response;
  }

  async fetchCommitsInDateRange(
    owner,
    repo,
    startDate,
    endDate,
    fetchLimit = 200
  ) {
    let allCommits = [];
    let page = 1;
    const perPage = 100;
    let hasMore = true;

    console.log("📡 Fetching commit data...");
    const progressChars = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    let progressIndex = 0;

    while (hasMore && (fetchLimit === 0 || allCommits.length < fetchLimit)) {
      const params = new URLSearchParams({
        page: page.toString(),
        per_page: perPage.toString(),
      });

      if (startDate) params.append("since", new Date(startDate).toISOString());
      if (endDate)
        params.append("until", new Date(endDate + "T23:59:59Z").toISOString());

      const url = `${this.baseUrl}/repos/${owner}/${repo}/commits?${params}`;

      // Show progress
      const limitText = fetchLimit === 0 ? "infinite" : fetchLimit;
      process.stdout.write(
        `\r${progressChars[progressIndex]} Fetching page ${page}... (${allCommits.length} commits, limit: ${limitText})`
      );
      progressIndex = (progressIndex + 1) % progressChars.length;

      try {
        const commits = await this.makeRequest(url);

        if (commits.length === 0) {
          hasMore = false;
        } else {
          // Get detailed commit info with stats
          const detailedCommits = await Promise.all(
            commits.map(async (commit) => {
              try {
                return await this.fetchCommitDetails(owner, repo, commit.sha);
              } catch (error) {
                console.log(
                  `\n⚠️  Warning: Could not fetch details for commit ${commit.sha}: ${error.message}`
                );
                return null;
              }
            })
          );

          const validCommits = detailedCommits.filter(
            (commit) => commit !== null
          );

          // Check if adding these commits would exceed the limit
          if (fetchLimit > 0) {
            const remainingSlots = fetchLimit - allCommits.length;
            if (remainingSlots <= 0) {
              break;
            }
            allCommits.push(...validCommits.slice(0, remainingSlots));
          } else {
            allCommits.push(...validCommits);
          }

          page++;

          // Rate limiting: small delay between requests
          await this.sleep(100);

          // Check if we've reached the limit
          if (fetchLimit > 0 && allCommits.length >= fetchLimit) {
            hasMore = false;
          }
        }
      } catch (error) {
        console.log(`\n⚠️  Error fetching page ${page}: ${error.message}`);
        hasMore = false;
      }
    }

    process.stdout.write("\r" + " ".repeat(80) + "\r"); // Clear progress line
    return allCommits;
  }

  async fetchCommitDetails(owner, repo, sha) {
    const url = `${this.baseUrl}/repos/${owner}/${repo}/commits/${sha}`;
    const commit = await this.makeRequest(url);
    return commit;
  }

  async processContributorData(commits, owner, repo) {
    const contributors = {};

    console.log("🔄 Processing contributor data with punch card analysis...");

    commits
      .filter((commit) => commit !== null)
      .forEach((commit, index) => {
        if (index % 10 === 0) {
          process.stdout.write(
            `\r📊 Processing commit ${index + 1}/${commits.length}`
          );
        }

        const email = commit.commit?.author?.email || "unknown@unknown.com";
        const name = commit.commit?.author?.name || "Unknown";
        const date = commit.commit?.author?.date;
        const message = commit.commit?.message || "";
        const additions = commit.stats?.additions || 0;
        const deletions = commit.stats?.deletions || 0;

        // Initialize contributor data structure with punch card
        if (!contributors[email]) {
          contributors[email] = {
            email,
            name,
            commitCount: 0,
            linesAdded: 0,
            linesDeleted: 0,
            firstCommit: date,
            lastCommit: date,
            commitMessages: [],
            punchCard: {
              hourlyDistribution: new Array(24).fill(0),
              dailyDistribution: new Array(7).fill(0),
              shiftBreakdown: {
                morning: 0, // 6-12
                afternoon: 0, // 12-18
                evening: 0, // 18-24 + 0-6
              },
            },
          };
        }

        const contributor = contributors[email];
        contributor.commitCount++;
        contributor.linesAdded += additions;
        contributor.linesDeleted += deletions;

        if (new Date(date) < new Date(contributor.firstCommit)) {
          contributor.firstCommit = date;
        }
        if (new Date(date) > new Date(contributor.lastCommit)) {
          contributor.lastCommit = date;
        }

        // Process punch card data
        if (date) {
          const commitDate = new Date(date);
          const hour = commitDate.getUTCHours();
          const dayOfWeek = commitDate.getUTCDay(); // 0 = Sunday, 1 = Monday, etc.

          // Ensure punch card structure exists (defensive programming)
          if (!contributor.punchCard) {
            contributor.punchCard = {
              hourlyDistribution: new Array(24).fill(0),
              dailyDistribution: new Array(7).fill(0),
              shiftBreakdown: { morning: 0, afternoon: 0, evening: 0 },
            };
          }

          contributor.punchCard.hourlyDistribution[hour]++;
          contributor.punchCard.dailyDistribution[dayOfWeek]++;

          // Categorize by shift
          if (hour >= 6 && hour < 12) {
            contributor.punchCard.shiftBreakdown.morning++;
          } else if (hour >= 12 && hour < 18) {
            contributor.punchCard.shiftBreakdown.afternoon++;
          } else {
            contributor.punchCard.shiftBreakdown.evening++;
          }

          contributor.commitMessages.push({
            sha: commit.sha,
            message: message.split("\n")[0], // First line only
            date,
            additions,
            deletions,
            hour,
            dayOfWeek,
          });
        }
      });

    process.stdout.write("\r" + " ".repeat(50) + "\r"); // Clear progress line

    // Sort commit messages by date for each contributor
    Object.values(contributors).forEach((contributor) => {
      if (contributor.commitMessages) {
        contributor.commitMessages.sort(
          (a, b) => new Date(b.date) - new Date(a.date)
        );
      }
    });

    return contributors;
  }

  generatePunchCardAnalysis(contributorData, commits) {
    const contributors = Object.values(contributorData);

    // Repository-wide punch card
    const repoHourly = new Array(24).fill(0);
    const repoDaily = new Array(7).fill(0);
    const shiftTotals = { morning: 0, afternoon: 0, evening: 0 };
    const shiftContributors = {
      morning: new Set(),
      afternoon: new Set(),
      evening: new Set(),
    };

    // Aggregate all contributor punch card data
    contributors.forEach((contributor) => {
      // Defensive null checks
      if (!contributor.punchCard) {
        console.warn(`⚠️ Missing punch card data for ${contributor.email}`);
        return;
      }

      const { hourlyDistribution, dailyDistribution, shiftBreakdown } =
        contributor.punchCard;

      if (hourlyDistribution) {
        hourlyDistribution.forEach((count, hour) => {
          repoHourly[hour] += count;
        });
      }

      if (dailyDistribution) {
        dailyDistribution.forEach((count, day) => {
          repoDaily[day] += count;
        });
      }

      // Track shift preferences with null checks
      if (shiftBreakdown) {
        const shifts = {
          morning: shiftBreakdown.morning || 0,
          afternoon: shiftBreakdown.afternoon || 0,
          evening: shiftBreakdown.evening || 0,
        };

        shiftTotals.morning += shifts.morning;
        shiftTotals.afternoon += shifts.afternoon;
        shiftTotals.evening += shifts.evening;

        // Identify dominant shift for each contributor
        const dominantShift = Object.entries(shifts).reduce((a, b) =>
          shifts[a[0]] > shifts[b[0]] ? a : b
        )[0];

        if (shifts[dominantShift] > 0) {
          shiftContributors[dominantShift].add(contributor.email);
        }
      }
    });

    // Find peak times
    const peakHour = repoHourly.indexOf(Math.max(...repoHourly));
    const peakDay = repoDaily.indexOf(Math.max(...repoDaily));
    const dayNames = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];

    const totalCommits = commits.length || 1; // Avoid division by zero

    return {
      repositoryPunchCard: {
        hourlyDistribution: repoHourly,
        dailyDistribution: repoDaily,
        peakHour,
        peakDay: dayNames[peakDay],
        totalCommits: repoHourly.reduce((sum, count) => sum + count, 0),
      },
      shiftComparison: {
        morning: {
          commits: shiftTotals.morning,
          contributors: Array.from(shiftContributors.morning),
          percentage: Math.round((shiftTotals.morning / totalCommits) * 100),
        },
        afternoon: {
          commits: shiftTotals.afternoon,
          contributors: Array.from(shiftContributors.afternoon),
          percentage: Math.round((shiftTotals.afternoon / totalCommits) * 100),
        },
        evening: {
          commits: shiftTotals.evening,
          contributors: Array.from(shiftContributors.evening),
          percentage: Math.round((shiftTotals.evening / totalCommits) * 100),
        },
      },
      workPatterns: {
        weekdayCommits: repoDaily
          .slice(1, 6)
          .reduce((sum, count) => sum + count, 0),
        weekendCommits: repoDaily[0] + repoDaily[6],
        businessHoursCommits: repoHourly
          .slice(9, 17)
          .reduce((sum, count) => sum + count, 0),
        afterHoursCommits: [
          ...repoHourly.slice(0, 9),
          ...repoHourly.slice(17),
        ].reduce((sum, count) => sum + count, 0),
      },
    };
  }

  generateInsights(contributorData) {
    const contributors = Object.values(contributorData);

    if (contributors.length === 0) {
      return {
        topContributorByCommits: null,
        topContributorByLinesAdded: null,
        averageCommitsPerContributor: 0,
        codeChurnRate: 0,
        totalLinesAdded: 0,
        totalLinesDeleted: 0,
        mostActiveDay: { day: "Unknown", count: 0 },
        mostActiveHour: { hour: 0, count: 0, timeDisplay: "00:00 UTC" },
        contributorDistribution: [],
        shiftPreferences: { morning: [], afternoon: [], evening: [] },
      };
    }

    const topByCommits = contributors.reduce((max, contributor) =>
      contributor.commitCount > max.commitCount ? contributor : max
    );

    const topByLinesAdded = contributors.reduce((max, contributor) =>
      contributor.linesAdded > max.linesAdded ? contributor : max
    );

    const totalCommits = contributors.reduce(
      (sum, contributor) => sum + contributor.commitCount,
      0
    );
    const totalAdditions = contributors.reduce(
      (sum, contributor) => sum + contributor.linesAdded,
      0
    );
    const totalDeletions = contributors.reduce(
      (sum, contributor) => sum + contributor.linesDeleted,
      0
    );

    const averageCommitsPerContributor = Math.round(
      totalCommits / contributors.length
    );
    const codeChurnRate =
      totalAdditions > 0 ? totalDeletions / totalAdditions : 0;

    return {
      topContributorByCommits: topByCommits.email,
      topContributorByLinesAdded: topByLinesAdded.email,
      averageCommitsPerContributor,
      codeChurnRate: Math.round(codeChurnRate * 100) / 100,
      totalLinesAdded: totalAdditions,
      totalLinesDeleted: totalDeletions,
      mostActiveDay: this.findMostActiveDay(contributors),
      mostActiveHour: this.findMostActiveHour(contributors),
      contributorDistribution: this.getContributorDistribution(contributors),
      shiftPreferences: this.analyzeShiftPreferences(contributors),
    };
  }

  findMostActiveDay(contributors) {
    const dayCount = {};
    const dayNames = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];

    contributors.forEach((contributor) => {
      if (contributor.commitMessages) {
        contributor.commitMessages.forEach((commit) => {
          const day = dayNames[commit.dayOfWeek];
          if (day) {
            dayCount[day] = (dayCount[day] || 0) + 1;
          }
        });
      }
    });

    return Object.entries(dayCount).reduce(
      (max, [day, count]) => (count > max.count ? { day, count } : max),
      { day: "Unknown", count: 0 }
    );
  }

  findMostActiveHour(contributors) {
    const hourCount = {};

    contributors.forEach((contributor) => {
      if (contributor.commitMessages) {
        contributor.commitMessages.forEach((commit) => {
          const hour = commit.hour;
          if (hour !== undefined && hour !== null) {
            hourCount[hour] = (hourCount[hour] || 0) + 1;
          }
        });
      }
    });

    const mostActiveHourEntry = Object.entries(hourCount).reduce(
      (max, [hour, count]) =>
        count > max.count ? { hour: parseInt(hour), count } : max,
      { hour: 0, count: 0 }
    );

    return {
      hour: mostActiveHourEntry.hour,
      count: mostActiveHourEntry.count,
      timeDisplay: `${mostActiveHourEntry.hour
        .toString()
        .padStart(2, "0")}:00 UTC`,
    };
  }

  analyzeShiftPreferences(contributors) {
    const shiftPrefs = { morning: [], afternoon: [], evening: [] };

    contributors.forEach((contributor) => {
      // Add null checks to prevent the error
      if (!contributor.punchCard || !contributor.punchCard.shiftBreakdown) {
        console.warn(`⚠️ Missing punch card data for ${contributor.email}`);
        return;
      }

      const shifts = contributor.punchCard.shiftBreakdown;
      const totalCommits =
        (shifts.morning || 0) + (shifts.afternoon || 0) + (shifts.evening || 0);

      if (totalCommits > 0) {
        const morningPct = ((shifts.morning || 0) / totalCommits) * 100;
        const afternoonPct = ((shifts.afternoon || 0) / totalCommits) * 100;
        const eveningPct = ((shifts.evening || 0) / totalCommits) * 100;

        const dominantShift = Math.max(morningPct, afternoonPct, eveningPct);

        if (dominantShift === morningPct && morningPct > 40) {
          shiftPrefs.morning.push({
            email: contributor.email,
            percentage: Math.round(morningPct),
          });
        } else if (dominantShift === afternoonPct && afternoonPct > 40) {
          shiftPrefs.afternoon.push({
            email: contributor.email,
            percentage: Math.round(afternoonPct),
          });
        } else if (dominantShift === eveningPct && eveningPct > 40) {
          shiftPrefs.evening.push({
            email: contributor.email,
            percentage: Math.round(eveningPct),
          });
        }
      }
    });

    return shiftPrefs;
  }

  getContributorDistribution(contributors) {
    const totalCommits = contributors.reduce(
      (sum, c) => sum + c.commitCount,
      0
    );

    if (totalCommits === 0) return [];

    return contributors
      .map((contributor) => ({
        email: contributor.email,
        percentage: Math.round((contributor.commitCount / totalCommits) * 100),
      }))
      .sort((a, b) => b.percentage - a.percentage);
  }

  async makeRequest(url, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await this.checkRateLimit();

        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "GitHub-Analyzer-CLI/1.0",
          },
        });

        // Update rate limit info
        this.rateLimitRemaining = parseInt(
          response.headers.get("x-ratelimit-remaining") || "0"
        );
        this.rateLimitReset = parseInt(
          response.headers.get("x-ratelimit-reset") || "0"
        );
        this.requestCount++;

        if (!response.ok) {
          if (response.status === 401) {
            throw new Error(
              "Authentication failed. Please check your GitHub token format and permissions. Use Bearer token format."
            );
          } else if (response.status === 403) {
            const errorBody = await response.text();
            if (errorBody.includes("rate limit")) {
              throw new Error(
                "Rate limit exceeded. Please wait before retrying."
              );
            } else {
              throw new Error(
                `Access forbidden. The token might lack proper repository access scopes. Status: ${response.status} - ${errorBody}`
              );
            }
          } else if (response.status === 404) {
            throw new Error(
              "Repository not found or access denied. Check repository name and token permissions."
            );
          } else {
            const errorBody = await response.text();
            throw new Error(
              `API request failed: ${response.status} ${response.statusText} - ${errorBody}`
            );
          }
        }

        const data = await response.json();
        return data;
      } catch (error) {
        console.log(
          `\n⚠️  Request attempt ${attempt}/${retries} failed: ${error.message}`
        );

        if (attempt === retries) {
          throw error;
        }

        // Exponential backoff
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`⏳ Retrying in ${delay / 1000}s...`);
        await this.sleep(delay);
      }
    }
  }

  async checkRateLimit() {
    if (this.rateLimitRemaining <= 10 && this.rateLimitReset) {
      const now = Math.floor(Date.now() / 1000);
      const waitTime = (this.rateLimitReset - now + 60) * 1000; // Add 1 minute buffer

      if (waitTime > 0) {
        console.log(
          `\n⏸️  Rate limit nearly exceeded. Waiting ${Math.ceil(
            waitTime / 1000
          )}s...`
        );
        await this.sleep(waitTime);
      }
    }
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// CLI Interface
class GitHubAnalyzerCLI {
  constructor() {
    this.analyzer = new GitHubAnalyzer();
  }

  parseArguments() {
    const args = process.argv.slice(2);
    const options = {
      repo: null,
      owner: null,
      format: "json",
      output: null,
      start: null,
      end: null,
      verbose: false,
      debug: false,
      token: process.env.GITHUB_TOKEN || null,
      fetchLimit: 200, // Default fetch limit
    };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      const next = args[i + 1];

      switch (arg) {
        case "-r":
        case "--repo":
          if (next && next.includes("/")) {
            const [owner, repo] = next.split("/");
            options.owner = owner;
            options.repo = repo;
            i++;
          } else {
            throw new Error('Repository must be in format "owner/repo"');
          }
          break;
        case "-f":
        case "--format":
          if (next && ["json", "csv"].includes(next)) {
            options.format = next;
            i++;
          } else {
            throw new Error('Format must be "json" or "csv"');
          }
          break;
        case "-o":
        case "--output":
          options.output = next;
          i++;
          break;
        case "-s":
        case "--start":
          options.start = next;
          i++;
          break;
        case "-e":
        case "--end":
          options.end = next;
          i++;
          break;
        case "-t":
        case "--token":
          options.token = next;
          i++;
          break;
        case "-l":
        case "--fetchLimit":
          const limitValue = parseInt(next);
          if (isNaN(limitValue) || limitValue < 0) {
            throw new Error(
              "Fetch limit must be a positive number or 0 for infinite"
            );
          }
          options.fetchLimit = limitValue;
          i++;
          break;
        case "-v":
        case "--verbose":
          options.verbose = true;
          break;
        case "-d":
        case "--debug":
          options.debug = true;
          options.verbose = true;
          break;
        case "-h":
        case "--help":
          this.showHelp();
          process.exit(0);
          break;
        default:
          if (arg.startsWith("-")) {
            throw new Error(`Unknown option: ${arg}`);
          }
      }
    }

    return options;
  }

  showHelp() {
    console.log(`
🔍 GitHub Repository Contributor Analysis CLI with Punch Card Analysis

Usage: node main.mjs [options]

Options:
  -r, --repo <owner/repo>     Repository to analyze (required)
  -f, --format <format>       Output format: json (default) or csv
  -o, --output <filename>     Output filename (auto-generated if not provided)
  -s, --start <date>          Start date (ISO format: YYYY-MM-DD) default: -2 days
  -e, --end <date>            End date (ISO format: YYYY-MM-DD) default: today
  -l, --fetchLimit <number>   Fetch limit (default: 200, use 0 for infinite)
  -v, --verbose               Enable verbose logging
  -d, --debug                 Enable debug logging
  -t, --token                 GitHub Token (or use GITHUB_TOKEN env var)
  -h, --help                  Show help message

Features:
  • Contributor analysis with commit patterns
  • Punch card visualization data (hourly/daily patterns)
  • Shift breakdown analysis (morning/afternoon/evening)
  • Work pattern insights (weekdays vs weekends)
  • Time zone and productivity pattern analysis
  • Configurable fetch limits for faster analysis
  • Retry logic and rate limiting
  • Multiple output formats (JSON/CSV)

Examples:
  node main.mjs -r microsoft/typescript -s 2024-01-01 -e 2024-03-31
  node main.mjs -r facebook/react --format csv --fetchLimit 500
  node main.mjs -r owner/repo --fetchLimit 0 --verbose  # Analyze all commits
  node main.mjs -r owner/repo --token ghp_xxxxxxxxxxxx --fetchLimit 100

Environment Variables:
  GITHUB_TOKEN                GitHub personal access token
        `);
  }

  generateOutputFilename(owner, repo, format, start, end, fetchLimit) {
    const timestamp = new Date().toISOString().split("T")[0];
    const dateRange = start && end ? `_${start}_to_${end}` : "";
    const limitSuffix = fetchLimit === 0 ? "_unlimited" : `_limit${fetchLimit}`;
    return `${owner}_${repo}_punchcard${dateRange}${limitSuffix}_${timestamp}.${format}`;
  }

  async formatOutput(data, format) {
    if (format === "json") {
      return JSON.stringify(data, null, 2);
    } else if (format === "csv") {
      return this.convertToCSV(data);
    } else {
      throw new Error(`Unsupported format: ${format}`);
    }
  }

  convertToCSV(data) {
    const headers = [
      "Email",
      "Name",
      "Commit Count",
      "Lines Added",
      "Lines Deleted",
      "First Commit",
      "Last Commit",
      "Morning Commits",
      "Afternoon Commits",
      "Evening Commits",
      "Peak Hour",
      "Peak Day",
      "Percentage of Total Commits",
    ];

    const totalCommits = data.summary.totalCommits || 1;
    const dayNames = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];

    const rows = data.contributors.map((contributor) => {
      const percentage = Math.round(
        (contributor.commitCount / totalCommits) * 100
      );

      // Find peak hour and day for this contributor with null checks
      const hourlyDist =
        contributor.punchCard?.hourlyDistribution || new Array(24).fill(0);
      const dailyDist =
        contributor.punchCard?.dailyDistribution || new Array(7).fill(0);

      const peakHour = hourlyDist.indexOf(Math.max(...hourlyDist));
      const peakDay = dailyDist.indexOf(Math.max(...dailyDist));

      const shiftBreakdown = contributor.punchCard?.shiftBreakdown || {
        morning: 0,
        afternoon: 0,
        evening: 0,
      };

      return [
        contributor.email,
        contributor.name,
        contributor.commitCount,
        contributor.linesAdded,
        contributor.linesDeleted,
        contributor.firstCommit,
        contributor.lastCommit,
        shiftBreakdown.morning,
        shiftBreakdown.afternoon,
        shiftBreakdown.evening,
        `${peakHour.toString().padStart(2, "0")}:00`,
        dayNames[peakDay] || "Unknown",
        `${percentage}%`,
      ];
    });

    const csvContent = [
      `# GitHub Repository Punch Card Analysis: ${data.repository.owner}/${data.repository.name}`,
      `# Date Range: ${data.summary.dateRange}`,
      `# Fetch Limit: ${data.summary.fetchLimit}`,
      `# Generated: ${data.summary.analysisTimestamp}`,
      `# Total Commits: ${data.summary.totalCommits}`,
      `# Total Contributors: ${data.summary.totalContributors}`,
      `# Repository Peak Hour: ${data.punchCardAnalysis.repositoryPunchCard.peakHour}:00 UTC`,
      `# Repository Peak Day: ${data.punchCardAnalysis.repositoryPunchCard.peakDay}`,
      "",
      headers.join(","),
      ...rows.map((row) => row.join(",")),
    ].join("\n");

    return csvContent;
  }

  async run() {
    try {
      console.log("🚀 GitHub Repository Punch Card Analysis CLI\n");

      const options = this.parseArguments();

      // Validate required options
      if (!options.repo || !options.owner) {
        console.error("❌ Error: Repository is required. Use -r owner/repo");
        console.log("\nUse --help for usage information.");
        process.exit(1);
      }

      if (!options.token) {
        console.error(
          "❌ Error: GitHub token is required. Use -t token or set GITHUB_TOKEN environment variable"
        );
        process.exit(1);
      }

      if (options.verbose) {
        console.log("🔧 Configuration:");
        console.log(`   Repository: ${options.owner}/${options.repo}`);
        console.log(`   Format: ${options.format}`);
        console.log(
          `   Start Date: ${options.start || "2 days ago (default)"}`
        );
        console.log(`   End Date: ${options.end || "Today (default)"}`);
        console.log(
          `   Fetch Limit: ${
            options.fetchLimit === 0 ? "Infinite" : options.fetchLimit
          }`
        );
        console.log(
          `   Token: ${options.token ? "***provided***" : "Not provided"}`
        );
        console.log("");
      }

      // Run analysis
      const report = await this.analyzer.analyzeRepository(
        options.repo,
        options.owner,
        options.start,
        options.end,
        options.token,
        options.fetchLimit
      );

      // Generate output filename if not provided
      const outputFilename =
        options.output ||
        this.generateOutputFilename(
          options.owner,
          options.repo,
          options.format,
          options.start,
          options.end,
          options.fetchLimit
        );

      // Format and save output
      const formattedOutput = await this.formatOutput(report, options.format);
      await fs.writeFile(outputFilename, formattedOutput, "utf8");

      console.log(`\n✅ Report saved to: ${outputFilename}`);
      console.log(
        `📁 File size: ${(formattedOutput.length / 1024).toFixed(2)} KB`
      );

      // Show summary with punch card insights
      console.log("\n📊 Summary:");
      console.log(`   Total Contributors: ${report.summary.totalContributors}`);
      console.log(`   Total Commits: ${report.summary.totalCommits}`);
      console.log(`   Fetch Limit: ${report.summary.fetchLimit}`);
      console.log(
        `   Top Contributor: ${
          report.insights.topContributorByCommits || "N/A"
        }`
      );
      console.log(`   Analysis Period: ${report.summary.dateRange}`);

      console.log("\n⏰ Punch Card Insights:");
      console.log(
        `   Peak Hour: ${report.punchCardAnalysis.repositoryPunchCard.peakHour}:00 UTC`
      );
      console.log(
        `   Peak Day: ${report.punchCardAnalysis.repositoryPunchCard.peakDay}`
      );
      console.log(
        `   Morning Shift: ${report.punchCardAnalysis.shiftComparison.morning.percentage}% of commits`
      );
      console.log(
        `   Afternoon Shift: ${report.punchCardAnalysis.shiftComparison.afternoon.percentage}% of commits`
      );
      console.log(
        `   Evening Shift: ${report.punchCardAnalysis.shiftComparison.evening.percentage}% of commits`
      );

      if (options.verbose && report.contributors.length > 0) {
        console.log("\n🏆 Top 3 Contributors by Commits:");
        report.contributors.slice(0, 3).forEach((contributor, index) => {
          const shiftBreakdown = contributor.punchCard?.shiftBreakdown || {};
          const dominantShift = Object.entries(shiftBreakdown).reduce(
            (a, b) => ((a[1] || 0) > (b[1] || 0) ? a : b),
            ["unknown", 0]
          )[0];
          console.log(
            `   ${index + 1}. ${contributor.email} (${
              contributor.commitCount
            } commits, ${dominantShift} shift)`
          );
        });

        console.log("\n🔄 Shift Preferences:");
        const shiftPrefs = report.insights.shiftPreferences;
        console.log(
          `   Morning People: ${shiftPrefs.morning.length} contributors`
        );
        console.log(
          `   Afternoon People: ${shiftPrefs.afternoon.length} contributors`
        );
        console.log(
          `   Evening People: ${shiftPrefs.evening.length} contributors`
        );
      }
    } catch (error) {
      console.error("\n❌ Error:", error.message);
      if (error.stack && process.env.DEBUG) {
        console.error("\nStack trace:", error.stack);
      }
      process.exit(1);
    }
  }
}

// Run the CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const cli = new GitHubAnalyzerCLI();
  cli.run();
}

export { GitHubAnalyzer, GitHubAnalyzerCLI };
