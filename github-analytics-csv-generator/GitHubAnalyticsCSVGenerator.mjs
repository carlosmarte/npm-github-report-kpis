const fs = require("fs");
const path = require("path");

class GitHubAnalyticsCSVGenerator {
  constructor() {
    this.outputDir = "./output";
    this.ensureOutputDir();
  }

  ensureOutputDir() {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * Generate CSV files from GitHub analytics JSON data
   * @param {string} jsonFilePath - Path to the JSON file containing analytics data
   * @param {string} username - Username to filter data for
   */
  async generateCSVFromFile(jsonFilePath, username) {
    try {
      const jsonData = JSON.parse(fs.readFileSync(jsonFilePath, "utf8"));
      return this.generateCSVFromData(jsonData, username);
    } catch (error) {
      console.error("Error reading JSON file:", error.message);
      throw error;
    }
  }

  /**
   * Generate CSV files from GitHub analytics data object
   * @param {Object} analyticsData - The analytics data object
   * @param {string} username - Username to filter data for
   */
  generateCSVFromData(analyticsData, username) {
    const results = {};

    // Generate different CSV reports
    results.summary = this.generateUserSummaryCSV(analyticsData, username);
    results.commitActivity = this.generateCommitActivityCSV(
      analyticsData,
      username
    );
    results.productivity = this.generateProductivityCSV(
      analyticsData,
      username
    );
    results.collaboration = this.generateCollaborationCSV(
      analyticsData,
      username
    );
    results.codeMetrics = this.generateCodeMetricsCSV(analyticsData, username);

    return results;
  }

  /**
   * Generate user summary CSV
   */
  generateUserSummaryCSV(data, username) {
    const userData = data.User;
    if (!userData) return null;

    const summary = {
      username: userData.identity.username,
      email: userData.identity.email,
      name: userData.identity.name,
      analysisDate: userData.identity.analysisDate,
      dateRange: userData.identity.dateRange,
      totalCommits:
        userData.commitActivityAndCodeContribution.metrics.totalCommits,
      totalAdditions:
        userData.commitActivityAndCodeContribution.metrics.totalAdditions,
      totalDeletions:
        userData.commitActivityAndCodeContribution.metrics.totalDeletions,
      netContribution:
        userData.commitActivityAndCodeContribution.metrics.netContribution,
      averageCommitSize:
        userData.commitActivityAndCodeContribution.metrics.averageCommitSize,
      productivityLevel:
        userData.commitActivityAndCodeContribution.insights.productivity
          .productivityLevel,
      productivityScore:
        userData.developerProductivityAndParticipation.metrics.productivityScore
          .score,
      productivityRating:
        userData.developerProductivityAndParticipation.metrics.productivityScore
          .rating,
      conventionalCommitPercentage:
        userData.commitActivityAndCodeContribution.metrics.qualityMetrics
          .conventionalCommits.percentage,
      codeQualityRating:
        userData.commitActivityAndCodeContribution.insights.codeQuality.rating,
      overallParticipation:
        userData.developerProductivityAndParticipation.metrics
          .participationLevel.overallParticipation,
      collaborationBreadth:
        userData.collaborationAndEngagementMetrics.metrics.collaborationBreadth,
      teamRole: userData.collaborationAndEngagementMetrics.insights.teamRole,
      leadershipPotential:
        userData.collaborationAndEngagementMetrics.insights.leadershipPotential
          .rating,
      workLifeBalanceAssessment:
        userData.commitActivityAndCodeContribution.insights.workLifeBalance
          .assessment,
      businessHoursPercentage:
        userData.commitActivityAndCodeContribution.metrics.timePatterns
          .workPatterns.businessHoursPercentage,
      peakHour:
        userData.commitActivityAndCodeContribution.metrics.timePatterns
          .workPatterns.peakHour,
      peakDay:
        userData.commitActivityAndCodeContribution.metrics.timePatterns
          .workPatterns.peakDay,
    };

    return this.writeCSV("user_summary", [summary], username);
  }

  /**
   * Generate commit activity CSV
   */
  generateCommitActivityCSV(data, username) {
    const commitData = data.User.commitActivityAndCodeContribution;
    if (!commitData) return null;

    const activities = [];
    const commitsByDay = commitData.metrics.commitsByDay;

    for (const [date, commits] of Object.entries(commitsByDay)) {
      activities.push({
        username,
        date,
        commits,
        dayOfWeek: new Date(date).toLocaleDateString("en-US", {
          weekday: "long",
        }),
      });
    }

    // Add hourly distribution
    const hourlyData = commitData.metrics.timePatterns.hourlyDistribution
      .map((commits, hour) => ({
        username,
        hour,
        commits,
        timeOfDay: this.getTimeOfDay(hour),
      }))
      .filter((item) => item.commits > 0);

    return {
      daily: this.writeCSV("commit_activity_daily", activities, username),
      hourly: this.writeCSV("commit_activity_hourly", hourlyData, username),
    };
  }

  /**
   * Generate productivity metrics CSV
   */
  generateProductivityCSV(data, username) {
    const productivityData = data.User.developerProductivityAndParticipation;
    const velocityData = data.User.codeVelocityAndChurnAnalysis;

    if (!productivityData || !velocityData) return null;

    const productivity = [
      {
        username,
        productivityScore: productivityData.metrics.productivityScore.score,
        productivityPercentage:
          productivityData.metrics.productivityScore.percentage,
        productivityRating: productivityData.metrics.productivityScore.rating,
        codeContribution:
          productivityData.metrics.participationLevel.codeContribution,
        prContribution:
          productivityData.metrics.participationLevel.prContribution,
        reviewContribution:
          productivityData.metrics.participationLevel.reviewContribution,
        codeVolumeImpact:
          productivityData.metrics.impactAssessment.codeVolumeImpact,
        deliveryImpact:
          productivityData.metrics.impactAssessment.deliveryImpact,
        qualityImpact: productivityData.metrics.impactAssessment.qualityImpact,
        overallImpact: productivityData.metrics.impactAssessment.overallImpact,
        linesPerDay: velocityData.metrics.velocityMetrics.linesPerDay,
        commitsPerDay: velocityData.metrics.velocityMetrics.commitsPerDay,
        averageLinesPerCommit:
          velocityData.metrics.velocityMetrics.averageLinesPerCommit,
        velocityRating: velocityData.metrics.velocityMetrics.velocityRating,
        churnRate: velocityData.metrics.churnAnalysis.churnRate,
        efficiency: velocityData.metrics.churnAnalysis.efficiency,
        stabilityRating: velocityData.metrics.churnAnalysis.stability,
      },
    ];

    return this.writeCSV("productivity_metrics", productivity, username);
  }

  /**
   * Generate collaboration metrics CSV
   */
  generateCollaborationCSV(data, username) {
    const collaborationData = data.User.collaborationAndEngagementMetrics;
    if (!collaborationData) return null;

    const collaboration = [
      {
        username,
        collaborationBreadth: collaborationData.metrics.collaborationBreadth,
        mentorshipScore: collaborationData.metrics.mentorshipIndicators.score,
        mentorshipRating: collaborationData.metrics.mentorshipIndicators.rating,
        knowledgeSharingScore: collaborationData.metrics.knowledgeSharing.score,
        knowledgeSharingRating:
          collaborationData.metrics.knowledgeSharing.rating,
        codeContributionSharing:
          collaborationData.metrics.knowledgeSharing.areas.codeContribution,
        reviewContributionSharing:
          collaborationData.metrics.knowledgeSharing.areas.reviewContribution,
        teamRole: collaborationData.insights.teamRole,
        collaborationHealth: collaborationData.insights.collaborationHealth,
        leadershipPotentialScore:
          collaborationData.insights.leadershipPotential.score,
        leadershipPotentialPercentage:
          collaborationData.insights.leadershipPotential.percentage,
        leadershipPotentialRating:
          collaborationData.insights.leadershipPotential.rating,
      },
    ];

    return this.writeCSV("collaboration_metrics", collaboration, username);
  }

  /**
   * Generate code metrics CSV
   */
  generateCodeMetricsCSV(data, username) {
    const codeData = data.User.codeVelocityAndChurnAnalysis;
    if (!codeData) return null;

    const metrics = [
      {
        username,
        totalAdditions: codeData.metrics.churnAnalysis.additions,
        totalDeletions: codeData.metrics.churnAnalysis.deletions,
        netContribution: codeData.metrics.churnAnalysis.netContribution,
        churnRate: codeData.metrics.churnAnalysis.churnRate,
        stabilityScore: codeData.insights.codeStability.stabilityScore,
        stabilityRating: codeData.insights.codeStability.rating,
        efficiencyScore: codeData.insights.efficiencyAssessment.score,
        efficiencyPercentage: codeData.insights.efficiencyAssessment.percentage,
        efficiencyRating: codeData.insights.efficiencyAssessment.rating,
        conventionalCommitRate:
          data.User.commitActivityAndCodeContribution.metrics.qualityMetrics
            .conventionalCommits.percentage,
        commitQualityRating:
          data.User.commitActivityAndCodeContribution.insights.codeQuality
            .rating,
      },
    ];

    return this.writeCSV("code_metrics", metrics, username);
  }

  /**
   * Write data to CSV file
   */
  writeCSV(reportType, data, username) {
    if (!data || data.length === 0) {
      console.warn(`No data available for ${reportType}`);
      return null;
    }

    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
    const filename = `${username}_${reportType}_${timestamp}.csv`;
    const filepath = path.join(this.outputDir, filename);

    // Generate CSV headers
    const headers = Object.keys(data[0]);
    const csvContent = [
      headers.join(","),
      ...data.map((row) =>
        headers
          .map((header) => {
            const value = row[header];
            // Handle values that might contain commas or quotes
            if (
              typeof value === "string" &&
              (value.includes(",") || value.includes('"'))
            ) {
              return `"${value.replace(/"/g, '""')}"`;
            }
            return value ?? "";
          })
          .join(",")
      ),
    ].join("\n");

    try {
      fs.writeFileSync(filepath, csvContent, "utf8");
      console.log(`✅ Generated: ${filename}`);
      return filepath;
    } catch (error) {
      console.error(`❌ Error writing ${filename}:`, error.message);
      return null;
    }
  }

  /**
   * Helper function to determine time of day
   */
  getTimeOfDay(hour) {
    if (hour >= 6 && hour < 12) return "Morning";
    if (hour >= 12 && hour < 18) return "Afternoon";
    if (hour >= 18 && hour < 22) return "Evening";
    return "Night";
  }

  /**
   * Generate all reports for a user
   */
  generateAllReports(dataSource, username) {
    console.log(`🚀 Generating GitHub Analytics CSV reports for: ${username}`);
    console.log(`📁 Output directory: ${path.resolve(this.outputDir)}`);

    let results;

    if (typeof dataSource === "string") {
      // Assume it's a file path
      results = this.generateCSVFromFile(dataSource, username);
    } else {
      // Assume it's data object
      results = this.generateCSVFromData(dataSource, username);
    }

    console.log("\n📊 Report Generation Summary:");
    Object.entries(results).forEach(([reportType, result]) => {
      if (result) {
        if (typeof result === "object" && result.daily) {
          console.log(`  ${reportType}: Multiple files generated`);
        } else {
          console.log(`  ${reportType}: ✅ Generated`);
        }
      } else {
        console.log(`  ${reportType}: ⚠️  No data available`);
      }
    });

    return results;
  }
}

// CLI Usage
if (require.main === module) {
  const generator = new GitHubAnalyticsCSVGenerator();

  // Get command line arguments
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log("Usage: node script.js <json-file-path> <username>");
    console.log("Example: node script.js ./analytics.json kgarg1");
    process.exit(1);
  }

  const [jsonFilePath, username] = args;

  try {
    generator.generateAllReports(jsonFilePath, username);
  } catch (error) {
    console.error("❌ Error generating reports:", error.message);
    process.exit(1);
  }
}

module.exports = GitHubAnalyticsCSVGenerator;
