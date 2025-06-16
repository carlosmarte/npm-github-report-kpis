import PptxGenJS from "pptxgenjs";
import { promises as fs } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class MergeReadinessPresentationGenerator {
  constructor() {
    this.pptx = new PptxGenJS();
    this.setupTemplate();
  }

  setupTemplate() {
    // Set presentation properties
    this.pptx.author = "Merge Readiness Analyzer";
    this.pptx.company = "Development Analytics";
    this.pptx.title = "Merge Readiness & Quality Score Report";
    this.pptx.subject = "GitHub Analytics Report";

    // Define color scheme
    this.colors = {
      primary: "#2E86AB",
      secondary: "#A23B72",
      accent: "#F18F01",
      success: "#C73E1D",
      warning: "#FF6B35",
      text: "#2D3748",
      background: "#F7FAFC",
    };
  }

  async loadData(dataPath, insightsPath = null) {
    try {
      // Load main report data
      const reportData = JSON.parse(await fs.readFile(dataPath, "utf8"));

      // Load ML insights if available
      let mlInsights = null;
      if (insightsPath) {
        try {
          mlInsights = JSON.parse(await fs.readFile(insightsPath, "utf8"));
        } catch (e) {
          console.warn(
            "⚠️ ML insights file not found, continuing without ML data"
          );
        }
      }

      return { reportData, mlInsights };
    } catch (error) {
      throw new Error(`Failed to load data: ${error.message}`);
    }
  }

  createTitleSlide(reportData) {
    const slide = this.pptx.addSlide();

    // Background
    slide.background = { color: this.colors.background };

    // Title
    slide.addText("Merge Readiness & Quality Score Analysis", {
      x: 0.5,
      y: 1.5,
      w: 12,
      h: 1.5,
      fontSize: 36,
      bold: true,
      color: this.colors.primary,
      align: "center",
    });

    // Subtitle with date range
    const dateRange = `${reportData.date_range.start_date} to ${reportData.date_range.end_date}`;
    slide.addText(`Analysis Period: ${dateRange}`, {
      x: 0.5,
      y: 3,
      w: 12,
      h: 0.8,
      fontSize: 18,
      color: this.colors.text,
      align: "center",
    });

    // Key metrics preview
    const summary = reportData.summary;
    const previewText = [
      `📊 ${summary.total_repositories} Repositories Analyzed`,
      `🔄 ${summary.total_pull_requests} Pull Requests`,
      `⭐ Merge Readiness Score: ${summary.merge_readiness_score}/100`,
      `💎 Quality Score: ${summary.quality_score}/100`,
    ].join("\n");

    slide.addText(previewText, {
      x: 2,
      y: 4.5,
      w: 9,
      h: 2,
      fontSize: 16,
      color: this.colors.text,
      align: "center",
      lineSpacing: 24,
    });

    // Generated timestamp
    slide.addText(`Generated: ${new Date().toLocaleDateString()}`, {
      x: 0.5,
      y: 7,
      w: 12,
      h: 0.5,
      fontSize: 12,
      color: this.colors.text,
      align: "center",
      italic: true,
    });
  }

  createExecutiveSummarySlide(reportData) {
    const slide = this.pptx.addSlide();
    slide.background = { color: this.colors.background };

    // Title
    slide.addText("Executive Summary", {
      x: 0.5,
      y: 0.5,
      w: 12,
      h: 0.8,
      fontSize: 28,
      bold: true,
      color: this.colors.primary,
    });

    const summary = reportData.summary;

    // Key metrics table
    const metricsData = [
      ["Metric", "Value", "Status"],
      ["Total Repositories", summary.total_repositories.toString(), "📊"],
      ["Pull Requests Analyzed", summary.total_pull_requests.toString(), "🔄"],
      ["Linked Issue-PR Pairs", summary.linked_issue_pr_pairs.toString(), "🔗"],
      [
        "Avg Lead Time",
        `${summary.avg_lead_time_hours}h`,
        summary.avg_lead_time_hours > 72 ? "⚠️" : "✅",
      ],
      [
        "Merge Readiness Score",
        `${summary.merge_readiness_score}/100`,
        this.getScoreStatus(summary.merge_readiness_score),
      ],
      [
        "Quality Score",
        `${summary.quality_score}/100`,
        this.getScoreStatus(summary.quality_score),
      ],
      [
        "Bottlenecks Detected",
        summary.bottlenecks_detected.toString(),
        summary.bottlenecks_detected > 0 ? "⚠️" : "✅",
      ],
    ];

    slide.addTable(metricsData, {
      x: 0.5,
      y: 1.5,
      w: 12,
      h: 4,
      fontSize: 14,
      border: { pt: 1, color: this.colors.text },
      fill: { color: "FFFFFF" },
      color: this.colors.text,
      rowH: 0.5,
      valign: "middle",
    });

    // Key insights
    const insights = this.generateKeyInsights(reportData);
    slide.addText("Key Insights:", {
      x: 0.5,
      y: 6,
      w: 12,
      h: 0.5,
      fontSize: 18,
      bold: true,
      color: this.colors.secondary,
    });

    slide.addText(insights, {
      x: 0.5,
      y: 6.5,
      w: 12,
      h: 1.5,
      fontSize: 14,
      color: this.colors.text,
      bullet: true,
    });
  }

  createLeadTimeAnalysisSlide(reportData) {
    const slide = this.pptx.addSlide();
    slide.background = { color: this.colors.background };

    // Title
    slide.addText("Lead Time Analysis", {
      x: 0.5,
      y: 0.5,
      w: 12,
      h: 0.8,
      fontSize: 28,
      bold: true,
      color: this.colors.primary,
    });

    const leadMetrics = reportData.detailed_analysis.lead_time_metrics;

    // Lead time metrics chart
    const chartData = [
      {
        name: "Lead Time Distribution",
        labels: ["Average", "Median", "75th Percentile", "95th Percentile"],
        values: [
          leadMetrics.avg_lead_time_hours || 0,
          leadMetrics.median_lead_time_hours || 0,
          leadMetrics.p75_lead_time_hours || 0,
          leadMetrics.p95_lead_time_hours || 0,
        ],
      },
    ];

    slide.addChart(this.pptx.ChartType.column, chartData, {
      x: 0.5,
      y: 1.5,
      w: 6,
      h: 4,
      title: "Lead Time Metrics (Hours)",
      showTitle: true,
      chartColors: [
        this.colors.primary,
        this.colors.secondary,
        this.colors.accent,
        this.colors.warning,
      ],
    });

    // Summary statistics
    const statsText = [
      `Total Issue-PR Pairs: ${leadMetrics.total_pairs || 0}`,
      `Minimum Lead Time: ${leadMetrics.min_lead_time_hours || 0}h`,
      `Maximum Lead Time: ${leadMetrics.max_lead_time_hours || 0}h`,
      `Average Lead Time: ${leadMetrics.avg_lead_time_hours || 0}h`,
    ].join("\n");

    slide.addText("Statistics:", {
      x: 7,
      y: 1.5,
      w: 5.5,
      h: 0.5,
      fontSize: 16,
      bold: true,
      color: this.colors.secondary,
    });

    slide.addText(statsText, {
      x: 7,
      y: 2,
      w: 5.5,
      h: 2,
      fontSize: 14,
      color: this.colors.text,
      bullet: true,
    });

    // Recommendations
    const recommendations = this.generateLeadTimeRecommendations(leadMetrics);
    slide.addText("Recommendations:", {
      x: 7,
      y: 4.5,
      w: 5.5,
      h: 0.5,
      fontSize: 16,
      bold: true,
      color: this.colors.secondary,
    });

    slide.addText(recommendations, {
      x: 7,
      y: 5,
      w: 5.5,
      h: 1.5,
      fontSize: 12,
      color: this.colors.text,
      bullet: true,
    });
  }

  createQualityAnalysisSlide(reportData) {
    const slide = this.pptx.addSlide();
    slide.background = { color: this.colors.background };

    // Title
    slide.addText("Quality Analysis", {
      x: 0.5,
      y: 0.5,
      w: 12,
      h: 0.8,
      fontSize: 28,
      bold: true,
      color: this.colors.primary,
    });

    const qualityMetrics = reportData.detailed_analysis.quality_metrics;

    // Quality metrics pie chart
    const qualityData = [
      {
        name: "Pull Request Status",
        labels: ["Merged", "Reverted", "Other"],
        values: [
          qualityMetrics.merged_prs || 0,
          qualityMetrics.reverted_prs || 0,
          (qualityMetrics.total_prs || 0) -
            (qualityMetrics.merged_prs || 0) -
            (qualityMetrics.reverted_prs || 0),
        ],
      },
    ];

    slide.addChart(this.pptx.ChartType.pie, qualityData, {
      x: 0.5,
      y: 1.5,
      w: 5,
      h: 4,
      title: "PR Merge Status Distribution",
      showTitle: true,
      showLegend: true,
      legendPos: "bottom",
    });

    // Quality score gauge (simulated with text)
    slide.addText(`Overall Quality Score`, {
      x: 6,
      y: 1.5,
      w: 6,
      h: 0.5,
      fontSize: 18,
      bold: true,
      color: this.colors.secondary,
      align: "center",
    });

    const scoreColor = this.getScoreColor(qualityMetrics.overall_score);
    slide.addText(`${qualityMetrics.overall_score}/100`, {
      x: 6,
      y: 2.5,
      w: 6,
      h: 1,
      fontSize: 48,
      bold: true,
      color: scoreColor,
      align: "center",
    });

    // Quality metrics details
    const qualityDetails = [
      `Merge Success Rate: ${qualityMetrics.merge_success_rate || 0}%`,
      `Avg Comments per PR: ${qualityMetrics.avg_comments_per_pr || 0}`,
      `Comment to LOC Ratio: ${qualityMetrics.comment_to_loc_ratio || 0}`,
    ].join("\n");

    slide.addText(qualityDetails, {
      x: 6,
      y: 4,
      w: 6,
      h: 1.5,
      fontSize: 14,
      color: this.colors.text,
      bullet: true,
      align: "center",
    });
  }

  createTrendsSlide(reportData) {
    const slide = this.pptx.addSlide();
    slide.background = { color: this.colors.background };

    // Title
    slide.addText("Trends Analysis", {
      x: 0.5,
      y: 0.5,
      w: 12,
      h: 0.8,
      fontSize: 28,
      bold: true,
      color: this.colors.primary,
    });

    const trends = reportData.detailed_analysis.trends;

    if (trends.monthly && trends.monthly.length > 0) {
      // Monthly trends chart
      const trendData = [
        {
          name: "Monthly Lead Time Trend",
          labels: trends.monthly.map((t) => t.period),
          values: trends.monthly.map((t) => t.avg_lead_time),
        },
      ];

      slide.addChart(this.pptx.ChartType.line, trendData, {
        x: 0.5,
        y: 1.5,
        w: 12,
        h: 4,
        title: "Average Lead Time Trend (Hours)",
        showTitle: true,
        chartColors: [this.colors.primary],
      });
    } else {
      slide.addText("Insufficient data for trend analysis", {
        x: 0.5,
        y: 3,
        w: 12,
        h: 1,
        fontSize: 16,
        color: this.colors.text,
        align: "center",
        italic: true,
      });
    }

    // Trend insights
    if (trends.weekly || trends.monthly) {
      const trendInsights = this.generateTrendInsights(trends);
      slide.addText("Trend Insights:", {
        x: 0.5,
        y: 6,
        w: 12,
        h: 0.5,
        fontSize: 16,
        bold: true,
        color: this.colors.secondary,
      });

      slide.addText(trendInsights, {
        x: 0.5,
        y: 6.5,
        w: 12,
        h: 1.5,
        fontSize: 14,
        color: this.colors.text,
        bullet: true,
      });
    }
  }

  createBottlenecksSlide(reportData) {
    const slide = this.pptx.addSlide();
    slide.background = { color: this.colors.background };

    // Title
    slide.addText("Bottleneck Analysis", {
      x: 0.5,
      y: 0.5,
      w: 12,
      h: 0.8,
      fontSize: 28,
      bold: true,
      color: this.colors.primary,
    });

    const bottlenecks = reportData.detailed_analysis.bottleneck_analysis;

    if (bottlenecks && bottlenecks.length > 0) {
      // Bottlenecks table
      const bottleneckData = [["Type", "Severity", "Description", "Impact"]];

      bottlenecks.forEach((bottleneck) => {
        bottleneckData.push([
          bottleneck.type,
          bottleneck.severity,
          bottleneck.description,
          bottleneck.impact,
        ]);
      });

      slide.addTable(bottleneckData, {
        x: 0.5,
        y: 1.5,
        w: 12,
        h: 3,
        fontSize: 12,
        border: { pt: 1, color: this.colors.text },
        fill: { color: "FFFFFF" },
        color: this.colors.text,
        rowH: 0.5,
        valign: "top",
      });

      // Action items
      slide.addText("Recommended Actions:", {
        x: 0.5,
        y: 5,
        w: 12,
        h: 0.5,
        fontSize: 16,
        bold: true,
        color: this.colors.secondary,
      });

      const actions = this.generateBottleneckActions(bottlenecks);
      slide.addText(actions, {
        x: 0.5,
        y: 5.5,
        w: 12,
        h: 2,
        fontSize: 14,
        color: this.colors.text,
        bullet: true,
      });
    } else {
      slide.addText("🎉 No significant bottlenecks detected!", {
        x: 0.5,
        y: 3,
        w: 12,
        h: 1,
        fontSize: 24,
        color: this.colors.success,
        align: "center",
        bold: true,
      });

      slide.addText(
        "Your development process appears to be running smoothly.",
        {
          x: 0.5,
          y: 4,
          w: 12,
          h: 0.5,
          fontSize: 16,
          color: this.colors.text,
          align: "center",
        }
      );
    }
  }

  createMLInsightsSlide(mlInsights) {
    if (!mlInsights) return;

    const slide = this.pptx.addSlide();
    slide.background = { color: this.colors.background };

    // Title
    slide.addText("Machine Learning Insights", {
      x: 0.5,
      y: 0.5,
      w: 12,
      h: 0.8,
      fontSize: 28,
      bold: true,
      color: this.colors.primary,
    });

    // Clustering results
    if (mlInsights.clustering_analysis) {
      slide.addText("Performance Clusters:", {
        x: 0.5,
        y: 1.5,
        w: 6,
        h: 0.5,
        fontSize: 16,
        bold: true,
        color: this.colors.secondary,
      });

      const clusterText = Object.entries(
        mlInsights.clustering_analysis.cluster_labels
      )
        .map(([id, label]) => `Cluster ${id}: ${label}`)
        .join("\n");

      slide.addText(clusterText, {
        x: 0.5,
        y: 2,
        w: 6,
        h: 2,
        fontSize: 14,
        color: this.colors.text,
        bullet: true,
      });
    }

    // Predictions
    if (mlInsights.predictions) {
      slide.addText("Predictions:", {
        x: 6.5,
        y: 1.5,
        w: 5.5,
        h: 0.5,
        fontSize: 16,
        bold: true,
        color: this.colors.secondary,
      });

      const predictionText = Object.entries(mlInsights.predictions)
        .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
        .join("\n");

      slide.addText(predictionText, {
        x: 6.5,
        y: 2,
        w: 5.5,
        h: 2,
        fontSize: 12,
        color: this.colors.text,
        bullet: true,
      });
    }

    // Performance insights
    if (
      mlInsights.performance_insights &&
      mlInsights.performance_insights.length > 0
    ) {
      slide.addText("AI Recommendations:", {
        x: 0.5,
        y: 4.5,
        w: 12,
        h: 0.5,
        fontSize: 16,
        bold: true,
        color: this.colors.secondary,
      });

      const recommendations = mlInsights.performance_insights
        .map((insight) => `${insight.category}: ${insight.recommendation}`)
        .join("\n");

      slide.addText(recommendations, {
        x: 0.5,
        y: 5,
        w: 12,
        h: 2.5,
        fontSize: 12,
        color: this.colors.text,
        bullet: true,
      });
    }
  }

  createConclusionSlide(reportData, mlInsights) {
    const slide = this.pptx.addSlide();
    slide.background = { color: this.colors.background };

    // Title
    slide.addText("Conclusions & Next Steps", {
      x: 0.5,
      y: 0.5,
      w: 12,
      h: 0.8,
      fontSize: 28,
      bold: true,
      color: this.colors.primary,
    });

    // Overall assessment
    const overallScore = reportData.summary.merge_readiness_score;
    const assessment = this.getOverallAssessment(overallScore);

    slide.addText("Overall Assessment:", {
      x: 0.5,
      y: 1.5,
      w: 12,
      h: 0.5,
      fontSize: 18,
      bold: true,
      color: this.colors.secondary,
    });

    slide.addText(assessment.text, {
      x: 0.5,
      y: 2,
      w: 12,
      h: 1,
      fontSize: 16,
      color: assessment.color,
      align: "center",
      bold: true,
    });

    // Priority actions
    const priorities = this.generatePriorityActions(reportData, mlInsights);
    slide.addText("Priority Actions:", {
      x: 0.5,
      y: 3.5,
      w: 12,
      h: 0.5,
      fontSize: 18,
      bold: true,
      color: this.colors.secondary,
    });

    slide.addText(priorities, {
      x: 0.5,
      y: 4,
      w: 12,
      h: 2.5,
      fontSize: 14,
      color: this.colors.text,
      bullet: true,
    });

    // Footer
    slide.addText("Thank you for your attention!", {
      x: 0.5,
      y: 7,
      w: 12,
      h: 0.5,
      fontSize: 16,
      color: this.colors.text,
      align: "center",
      italic: true,
    });
  }

  // Helper methods
  getScoreStatus(score) {
    if (score >= 85) return "🟢";
    if (score >= 70) return "🟡";
    return "🔴";
  }

  getScoreColor(score) {
    if (score >= 85) return this.colors.success;
    if (score >= 70) return this.colors.accent;
    return this.colors.warning;
  }

  generateKeyInsights(reportData) {
    const insights = [];
    const summary = reportData.summary;

    if (summary.avg_lead_time_hours > 72) {
      insights.push("Lead time exceeds 3 days - review assignment process");
    }

    if (summary.quality_score < 70) {
      insights.push("Quality score below target - strengthen review practices");
    }

    if (summary.bottlenecks_detected > 0) {
      insights.push(
        `${summary.bottlenecks_detected} bottlenecks identified requiring attention`
      );
    }

    if (summary.merge_readiness_score >= 85) {
      insights.push("Strong overall performance - maintain current practices");
    }

    return insights.join("\n");
  }

  generateLeadTimeRecommendations(leadMetrics) {
    const recommendations = [];

    if (leadMetrics.avg_lead_time_hours > 72) {
      recommendations.push("Implement faster issue triage process");
      recommendations.push("Consider automated assignment rules");
    }

    if (leadMetrics.p95_lead_time_hours > 168) {
      recommendations.push("Investigate outliers causing extreme delays");
    }

    if (leadMetrics.total_pairs < 10) {
      recommendations.push("Improve issue-PR linking practices");
    }

    return recommendations.join("\n");
  }

  generateTrendInsights(trends) {
    const insights = [];

    if (trends.monthly && trends.monthly.length >= 2) {
      const recent = trends.monthly[trends.monthly.length - 1];
      const previous = trends.monthly[trends.monthly.length - 2];

      if (recent.avg_lead_time > previous.avg_lead_time) {
        insights.push("Lead times increasing - investigate recent changes");
      } else {
        insights.push("Lead times improving - current practices effective");
      }
    }

    return insights.join("\n");
  }

  generateBottleneckActions(bottlenecks) {
    const actions = [];

    bottlenecks.forEach((bottleneck) => {
      if (bottleneck.type === "high_lead_time") {
        actions.push("Review and optimize issue assignment workflow");
      } else if (bottleneck.type === "slow_response") {
        actions.push("Implement SLA monitoring for issue response times");
      } else if (bottleneck.type === "inconsistent_response") {
        actions.push("Establish consistent handoff procedures");
      }
    });

    return actions.join("\n");
  }

  getOverallAssessment(score) {
    if (score >= 85) {
      return {
        text: "🎉 Excellent Performance - Your team demonstrates outstanding merge readiness!",
        color: this.colors.success,
      };
    } else if (score >= 70) {
      return {
        text: "👍 Good Performance - Minor optimizations could yield significant improvements",
        color: this.colors.accent,
      };
    } else if (score >= 50) {
      return {
        text: "⚠️ Needs Improvement - Focus on addressing identified bottlenecks",
        color: this.colors.warning,
      };
    } else {
      return {
        text: "🚨 Critical Issues - Immediate intervention required",
        color: this.colors.warning,
      };
    }
  }

  generatePriorityActions(reportData, mlInsights) {
    const actions = [];
    const summary = reportData.summary;

    // High priority
    if (summary.avg_lead_time_hours > 72) {
      actions.push(
        "🔴 HIGH: Reduce average lead time from issue to PR creation"
      );
    }

    if (summary.quality_score < 50) {
      actions.push("🔴 HIGH: Implement stricter code review processes");
    }

    // Medium priority
    if (summary.merge_readiness_score < 70) {
      actions.push("🟡 MEDIUM: Optimize overall development workflow");
    }

    // Low priority
    if (summary.bottlenecks_detected === 0) {
      actions.push(
        "🟢 LOW: Monitor performance and maintain current practices"
      );
    }

    // Add ML-based recommendations if available
    if (mlInsights?.clustering_analysis?.recommendations) {
      mlInsights.clustering_analysis.recommendations.forEach((rec) => {
        const priority =
          rec.priority === "high"
            ? "🔴 HIGH"
            : rec.priority === "medium"
            ? "🟡 MEDIUM"
            : "🟢 LOW";
        actions.push(`${priority}: ${rec.description}`);
      });
    }

    return actions.join("\n");
  }

  async generatePresentation(dataPath, outputPath, insightsPath = null) {
    try {
      console.log("📊 Loading data for presentation...");
      const { reportData, mlInsights } = await this.loadData(
        dataPath,
        insightsPath
      );

      console.log("🎨 Creating presentation slides...");

      // Create all slides
      this.createTitleSlide(reportData);
      this.createExecutiveSummarySlide(reportData);
      this.createLeadTimeAnalysisSlide(reportData);
      this.createQualityAnalysisSlide(reportData);
      this.createTrendsSlide(reportData);
      this.createBottlenecksSlide(reportData);

      if (mlInsights) {
        this.createMLInsightsSlide(mlInsights);
      }

      this.createConclusionSlide(reportData, mlInsights);

      console.log("💾 Saving presentation...");
      await this.pptx.writeFile(outputPath);

      console.log(`✅ Presentation saved to: ${outputPath}`);
      return outputPath;
    } catch (error) {
      throw new Error(`Failed to generate presentation: ${error.message}`);
    }
  }
}

// CLI functionality
async function parseArguments() {
  const args = process.argv.slice(2);
  const config = {
    input: null,
    output: null,
    insights: null,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "-i":
      case "--input":
        config.input = args[++i];
        break;
      case "-o":
      case "--output":
        config.output = args[++i];
        break;
      case "--insights":
        config.insights = args[++i];
        break;
      case "-h":
      case "--help":
        config.help = true;
        break;
      default:
        console.warn(`⚠️ Unknown argument: ${arg}`);
    }
  }

  return config;
}

function showHelp() {
  console.log(`📊 Merge Readiness PowerPoint Generator

USAGE:
    node main.ppt.mjs --input <report.json> --output <presentation.pptx> [options]

OPTIONS:
    -i, --input <file>      Input JSON report file (required)
    -o, --output <file>     Output PowerPoint file path (required)
    --insights <file>       ML insights JSON file (optional)
    -h, --help              Show this help message

EXAMPLES:
    # Basic presentation generation
    node main.ppt.mjs --input ./reports/data.json --output ./reports/presentation.pptx
    
    # Include ML insights
    node main.ppt.mjs --input ./reports/data.json --output ./reports/presentation.pptx --insights ./reports/ml_insights.json`);
}

async function main() {
  try {
    const config = await parseArguments();

    if (config.help) {
      showHelp();
      return;
    }

    if (!config.input || !config.output) {
      console.error("❌ Both input and output files are required");
      showHelp();
      process.exit(1);
    }

    const generator = new MergeReadinessPresentationGenerator();
    await generator.generatePresentation(
      config.input,
      config.output,
      config.insights
    );
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
}

// Execute if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { MergeReadinessPresentationGenerator };
