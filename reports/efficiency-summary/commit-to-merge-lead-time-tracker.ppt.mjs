import PptxGenJS from "pptxgenjs";
import { promises as fs } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class CommitMergeLeadTimePresentationGenerator {
  constructor() {
    this.pptx = new PptxGenJS();
    this.setupPresentation();
  }

  setupPresentation() {
    // Set presentation properties
    this.pptx.author = "Commit-to-Merge Lead Time Tracker";
    this.pptx.company = "GitHub Analytics";
    this.pptx.revision = "1.0";
    this.pptx.subject = "Lead Time Analysis Report";
    this.pptx.title = "Commit-to-Merge Lead Time Analysis";

    // Define layout
    this.pptx.defineLayout({ name: "LAYOUT_16x9", width: 10, height: 5.625 });
    this.pptx.layout = "LAYOUT_16x9";

    // Define color scheme
    this.colors = {
      primary: "2E86AB",
      secondary: "A23B72",
      accent: "F18F01",
      success: "6A994E",
      warning: "F77F00",
      danger: "C9184A",
      background: "F8F9FA",
      text: "2D3436",
    };
  }

  async loadData(jsonPath, insightsPath = null) {
    try {
      const reportData = JSON.parse(await fs.readFile(jsonPath, "utf8"));
      this.reportData = reportData;

      if (insightsPath) {
        const insightsData = JSON.parse(
          await fs.readFile(insightsPath, "utf8")
        );
        this.insightsData = insightsData;
      }

      return { report: reportData, insights: this.insightsData };
    } catch (error) {
      throw new Error(`Failed to load data: ${error.message}`);
    }
  }

  createTitleSlide() {
    const slide = this.pptx.addSlide();

    // Background
    slide.background = { color: this.colors.background };

    // Title
    slide.addText("Commit-to-Merge Lead Time Analysis", {
      x: 1,
      y: 1.5,
      w: 8,
      h: 1,
      fontSize: 36,
      bold: true,
      color: this.colors.primary,
      align: "center",
    });

    // Subtitle with analysis period
    const dateRange = this.reportData.date_range;
    const subtitle =
      dateRange.start_date && dateRange.end_date
        ? `Analysis Period: ${dateRange.start_date} to ${dateRange.end_date}`
        : "Complete Repository Analysis";

    slide.addText(subtitle, {
      x: 1,
      y: 2.5,
      w: 8,
      h: 0.5,
      fontSize: 18,
      color: this.colors.text,
      align: "center",
    });

    // Key metrics preview
    const summary = this.reportData.summary;
    slide.addText(`${summary.TOTAL_PRS} Pull Requests Analyzed`, {
      x: 1,
      y: 3.5,
      w: 8,
      h: 0.5,
      fontSize: 16,
      color: this.colors.secondary,
      align: "center",
    });

    // Generated timestamp
    slide.addText(`Generated: ${new Date().toLocaleDateString()}`, {
      x: 7,
      y: 5,
      w: 2,
      h: 0.3,
      fontSize: 10,
      color: this.colors.text,
      align: "right",
    });
  }

  createExecutiveSummarySlide() {
    const slide = this.pptx.addSlide();
    slide.background = { color: this.colors.background };

    // Title
    slide.addText("Executive Summary", {
      x: 0.5,
      y: 0.3,
      w: 9,
      h: 0.6,
      fontSize: 28,
      bold: true,
      color: this.colors.primary,
    });

    const summary = this.reportData.summary;
    const total = this.reportData.total;

    // Key metrics in a grid
    const metrics = [
      {
        label: "Total PRs",
        value: summary.TOTAL_PRS,
        color: this.colors.primary,
      },
      {
        label: "Avg Lead Time",
        value: `${summary.AVG_LEAD_TIME_DAYS.toFixed(1)} days`,
        color: this.colors.secondary,
      },
      {
        label: "Median Lead Time",
        value: `${summary.MEDIAN_LEAD_TIME_DAYS.toFixed(1)} days`,
        color: this.colors.accent,
      },
      {
        label: "Contributors",
        value: total.CONTRIBUTORS,
        color: this.colors.success,
      },
    ];

    metrics.forEach((metric, index) => {
      const x = 0.5 + (index % 2) * 4.5;
      const y = 1.2 + Math.floor(index / 2) * 1.2;

      // Metric box
      slide.addShape(this.pptx.ShapeType.rect, {
        x: x,
        y: y,
        w: 4,
        h: 1,
        fill: { color: metric.color, transparency: 90 },
        line: { color: metric.color, width: 2 },
      });

      // Metric value
      slide.addText(metric.value, {
        x: x + 0.2,
        y: y + 0.1,
        w: 3.6,
        h: 0.4,
        fontSize: 24,
        bold: true,
        color: metric.color,
        align: "center",
      });

      // Metric label
      slide.addText(metric.label, {
        x: x + 0.2,
        y: y + 0.5,
        w: 3.6,
        h: 0.3,
        fontSize: 14,
        color: this.colors.text,
        align: "center",
      });
    });

    // Performance indicators
    slide.addText("Performance Indicators", {
      x: 0.5,
      y: 3.8,
      w: 9,
      h: 0.4,
      fontSize: 18,
      bold: true,
      color: this.colors.text,
    });

    // Speed assessment
    let speedAssessment = "Good";
    let speedColor = this.colors.success;

    if (summary.AVG_LEAD_TIME_DAYS > 7) {
      speedAssessment = "Needs Improvement";
      speedColor = this.colors.danger;
    } else if (summary.AVG_LEAD_TIME_DAYS > 3) {
      speedAssessment = "Fair";
      speedColor = this.colors.warning;
    }

    slide.addText(`Delivery Speed: ${speedAssessment}`, {
      x: 0.5,
      y: 4.3,
      w: 4,
      h: 0.3,
      fontSize: 14,
      color: speedColor,
    });

    // Consistency assessment
    const variance = summary.MAX_LEAD_TIME_DAYS - summary.MIN_LEAD_TIME_DAYS;
    let consistencyAssessment =
      variance < 7 ? "Consistent" : variance < 14 ? "Moderate" : "Variable";
    let consistencyColor =
      variance < 7
        ? this.colors.success
        : variance < 14
        ? this.colors.warning
        : this.colors.danger;

    slide.addText(`Consistency: ${consistencyAssessment}`, {
      x: 5,
      y: 4.3,
      w: 4,
      h: 0.3,
      fontSize: 14,
      color: consistencyColor,
    });
  }

  createLeadTimeDistributionSlide() {
    const slide = this.pptx.addSlide();
    slide.background = { color: this.colors.background };

    // Title
    slide.addText("Lead Time Distribution Analysis", {
      x: 0.5,
      y: 0.3,
      w: 9,
      h: 0.6,
      fontSize: 24,
      bold: true,
      color: this.colors.primary,
    });

    const summary = this.reportData.summary;

    // Create distribution chart data
    const chartData = [
      {
        name: "Lead Time Statistics",
        labels: ["Min", "P75", "Median", "Mean", "Max"],
        values: [
          summary.MIN_LEAD_TIME_DAYS,
          summary.P75_LEAD_TIME_DAYS,
          summary.MEDIAN_LEAD_TIME_DAYS,
          summary.AVG_LEAD_TIME_DAYS,
          summary.MAX_LEAD_TIME_DAYS,
        ],
      },
    ];

    // Add chart
    slide.addChart(this.pptx.ChartType.column, chartData, {
      x: 1,
      y: 1.2,
      w: 8,
      h: 3,
      title: "Lead Time Distribution (Days)",
      titleColor: this.colors.text,
      titleFontSize: 16,
      showValue: true,
      valueFormatCode: "#.#",
      colors: [
        this.colors.success,
        this.colors.accent,
        this.colors.primary,
        this.colors.secondary,
        this.colors.warning,
      ],
    });

    // Add insights box
    slide.addShape(this.pptx.ShapeType.rect, {
      x: 0.5,
      y: 4.5,
      w: 9,
      h: 0.8,
      fill: { color: this.colors.primary, transparency: 95 },
      line: { color: this.colors.primary, width: 1 },
    });

    const insights = [
      `• Fastest delivery: ${summary.MIN_LEAD_TIME_DAYS.toFixed(1)} days`,
      `• 75% of PRs completed within: ${summary.P75_LEAD_TIME_DAYS.toFixed(
        1
      )} days`,
      `• Longest delivery: ${summary.MAX_LEAD_TIME_DAYS.toFixed(1)} days`,
    ];

    slide.addText(insights.join("\n"), {
      x: 0.8,
      y: 4.6,
      w: 8.4,
      h: 0.6,
      fontSize: 12,
      color: this.colors.text,
      lineSpacing: 18,
    });
  }

  createTrendsAnalysisSlide() {
    const slide = this.pptx.addSlide();
    slide.background = { color: this.colors.background };

    // Title
    slide.addText("Trends & Patterns Analysis", {
      x: 0.5,
      y: 0.3,
      w: 9,
      h: 0.6,
      fontSize: 24,
      bold: true,
      color: this.colors.primary,
    });

    const trends = this.reportData.detailed_analysis.trends;

    if (trends && trends.weekly && Object.keys(trends.weekly).length > 0) {
      // Prepare weekly trend data
      const weeklyData = Object.entries(trends.weekly)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-8); // Last 8 weeks

      const chartData = [
        {
          name: "Weekly Average Lead Time",
          labels: weeklyData.map(([week]) => week.replace("2024-W", "W")),
          values: weeklyData.map(([, data]) => data.MEAN || 0),
        },
      ];

      slide.addChart(this.pptx.ChartType.line, chartData, {
        x: 0.5,
        y: 1.2,
        w: 4.5,
        h: 2.5,
        title: "Weekly Trend",
        titleColor: this.colors.text,
        titleFontSize: 14,
        showValue: false,
        colors: [this.colors.primary],
      });
    }

    if (trends && trends.monthly && Object.keys(trends.monthly).length > 0) {
      // Prepare monthly trend data
      const monthlyData = Object.entries(trends.monthly)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-6); // Last 6 months

      const chartData = [
        {
          name: "Monthly Average Lead Time",
          labels: monthlyData.map(([month]) => month),
          values: monthlyData.map(([, data]) => data.MEAN || 0),
        },
      ];

      slide.addChart(this.pptx.ChartType.line, chartData, {
        x: 5,
        y: 1.2,
        w: 4.5,
        h: 2.5,
        title: "Monthly Trend",
        titleColor: this.colors.text,
        titleFontSize: 14,
        showValue: false,
        colors: [this.colors.secondary],
      });
    }

    // Key insights
    slide.addText("Key Observations", {
      x: 0.5,
      y: 4,
      w: 9,
      h: 0.4,
      fontSize: 16,
      bold: true,
      color: this.colors.text,
    });

    // Add trend insights if available from ML analysis
    let trendInsights = ["• Trend analysis requires more historical data"];

    if (
      this.insightsData &&
      this.insightsData.predictive_insights &&
      this.insightsData.predictive_insights.trend_analysis
    ) {
      const trendAnalysis =
        this.insightsData.predictive_insights.trend_analysis;
      trendInsights = [
        `• Overall trend: ${trendAnalysis.trend_direction}`,
        `• Weekly slope: ${trendAnalysis.weekly_slope.toFixed(
          2
        )} hours per week`,
      ];
    }

    slide.addText(trendInsights.join("\n"), {
      x: 0.5,
      y: 4.5,
      w: 9,
      h: 0.8,
      fontSize: 12,
      color: this.colors.text,
      lineSpacing: 20,
    });
  }

  createContributorAnalysisSlide() {
    const slide = this.pptx.addSlide();
    slide.background = { color: this.colors.background };

    // Title
    slide.addText("Contributor Performance Analysis", {
      x: 0.5,
      y: 0.3,
      w: 9,
      h: 0.6,
      fontSize: 24,
      bold: true,
      color: this.colors.primary,
    });

    const contributors = this.reportData.detailed_analysis.contributor_metrics;

    if (contributors && Object.keys(contributors).length > 0) {
      // Get top contributors by PR count
      const topContributors = Object.entries(contributors)
        .sort(([, a], [, b]) => (b.TOTAL_PRS || 0) - (a.TOTAL_PRS || 0))
        .slice(0, 10);

      // Create chart data for top contributors
      const chartData = [
        {
          name: "PR Count",
          labels: topContributors.map(([name]) =>
            name.length > 15 ? name.substring(0, 12) + "..." : name
          ),
          values: topContributors.map(([, data]) => data.TOTAL_PRS || 0),
        },
      ];

      slide.addChart(this.pptx.ChartType.bar, chartData, {
        x: 0.5,
        y: 1.2,
        w: 4.5,
        h: 2.8,
        title: "Top Contributors by PR Count",
        titleColor: this.colors.text,
        titleFontSize: 14,
        showValue: true,
        colors: [this.colors.accent],
      });

      // Performance metrics table
      slide.addText("Top Performers (by PR count)", {
        x: 5.2,
        y: 1.2,
        w: 4.3,
        h: 0.4,
        fontSize: 14,
        bold: true,
        color: this.colors.text,
      });

      // Table data
      const tableData = [["Contributor", "PRs", "Avg Lead Time"]];

      topContributors.slice(0, 8).forEach(([name, data]) => {
        tableData.push([
          name.length > 20 ? name.substring(0, 17) + "..." : name,
          (data.TOTAL_PRS || 0).toString(),
          `${(data.MEAN || 0).toFixed(1)}d`,
        ]);
      });

      slide.addTable(tableData, {
        x: 5.2,
        y: 1.7,
        w: 4.3,
        h: 2.3,
        fontSize: 10,
        colW: [2.5, 0.7, 1.1],
        color: this.colors.text,
        fill: this.colors.background,
        border: { color: this.colors.primary, width: 1 },
      });
    }

    // Team insights
    const totalContributors = this.reportData.total.CONTRIBUTORS;
    slide.addText("Team Insights", {
      x: 0.5,
      y: 4.3,
      w: 9,
      h: 0.4,
      fontSize: 16,
      bold: true,
      color: this.colors.text,
    });

    const teamInsights = [
      `• Total active contributors: ${totalContributors}`,
      `• Average PRs per contributor: ${(
        this.reportData.summary.TOTAL_PRS / totalContributors
      ).toFixed(1)}`,
      `• Team collaboration level: ${
        totalContributors > 10
          ? "High"
          : totalContributors > 5
          ? "Medium"
          : "Small Team"
      }`,
    ];

    slide.addText(teamInsights.join("\n"), {
      x: 0.5,
      y: 4.8,
      w: 9,
      h: 0.6,
      fontSize: 12,
      color: this.colors.text,
      lineSpacing: 18,
    });
  }

  createMLInsightsSlide() {
    if (!this.insightsData) {
      return; // Skip if no ML insights available
    }

    const slide = this.pptx.addSlide();
    slide.background = { color: this.colors.background };

    // Title
    slide.addText("Machine Learning Insights", {
      x: 0.5,
      y: 0.3,
      w: 9,
      h: 0.6,
      fontSize: 24,
      bold: true,
      color: this.colors.primary,
    });

    const insights = this.insightsData;

    // Clustering results
    if (insights.clustering_analysis) {
      slide.addText("Process Patterns Identified", {
        x: 0.5,
        y: 1,
        w: 9,
        h: 0.4,
        fontSize: 16,
        bold: true,
        color: this.colors.text,
      });

      const clusters = Object.entries(insights.clustering_analysis);
      const clusterTexts = clusters.map(
        ([clusterId, data]) =>
          `• ${data.characteristics}: ${
            data.count
          } PRs (avg: ${data.avg_lead_time_days.toFixed(1)} days)`
      );

      slide.addText(clusterTexts.join("\n"), {
        x: 0.5,
        y: 1.4,
        w: 9,
        h: 1.2,
        fontSize: 12,
        color: this.colors.text,
        lineSpacing: 20,
      });
    }

    // Anomaly detection
    if (
      insights.predictive_insights &&
      insights.predictive_insights.anomalies
    ) {
      const anomalies = insights.predictive_insights.anomalies;

      slide.addText("Anomaly Detection", {
        x: 0.5,
        y: 2.8,
        w: 9,
        h: 0.4,
        fontSize: 16,
        bold: true,
        color: this.colors.text,
      });

      const anomalyText = [
        `• ${
          anomalies.count
        } outlier PRs detected (${anomalies.percentage.toFixed(1)}% of total)`,
        `• Threshold for outliers: ${(anomalies.threshold_hours / 24).toFixed(
          1
        )} days`,
        `• These PRs may require special attention or process improvements`,
      ];

      slide.addText(anomalyText.join("\n"), {
        x: 0.5,
        y: 3.2,
        w: 9,
        h: 0.8,
        fontSize: 12,
        color: this.colors.text,
        lineSpacing: 18,
      });
    }

    // Recommendations
    if (insights.recommendations && insights.recommendations.length > 0) {
      slide.addText("AI Recommendations", {
        x: 0.5,
        y: 4.2,
        w: 9,
        h: 0.4,
        fontSize: 16,
        bold: true,
        color: this.colors.secondary,
      });

      const topRecommendations = insights.recommendations.slice(0, 3);
      const recText = topRecommendations.map(
        (rec, index) => `${index + 1}. ${rec}`
      );

      slide.addText(recText.join("\n"), {
        x: 0.5,
        y: 4.6,
        w: 9,
        h: 0.8,
        fontSize: 11,
        color: this.colors.text,
        lineSpacing: 18,
      });
    }
  }

  createRecommendationsSlide() {
    const slide = this.pptx.addSlide();
    slide.background = { color: this.colors.background };

    // Title
    slide.addText("Recommendations & Action Items", {
      x: 0.5,
      y: 0.3,
      w: 9,
      h: 0.6,
      fontSize: 24,
      bold: true,
      color: this.colors.primary,
    });

    // Process recommendations based on data
    const summary = this.reportData.summary;
    const bottlenecks = this.reportData.detailed_analysis.bottlenecks || [];

    let recommendations = [];

    // Performance-based recommendations
    if (summary.AVG_LEAD_TIME_DAYS > 7) {
      recommendations.push(
        "🚨 Implement faster review processes - average lead time exceeds 7 days"
      );
    } else if (summary.AVG_LEAD_TIME_DAYS > 3) {
      recommendations.push(
        "⚠️ Consider optimizing workflow - lead times could be improved"
      );
    } else {
      recommendations.push("✅ Lead times are within acceptable range");
    }

    // Consistency recommendations
    const variance = summary.MAX_LEAD_TIME_DAYS - summary.MIN_LEAD_TIME_DAYS;
    if (variance > 14) {
      recommendations.push(
        "📊 High variability detected - standardize review processes"
      );
    }

    // Add bottleneck-specific recommendations
    bottlenecks.forEach((bottleneck) => {
      recommendations.push(
        `🔍 ${bottleneck.description} - ${bottleneck.impact}`
      );
    });

    // Add ML recommendations if available
    if (this.insightsData && this.insightsData.recommendations) {
      recommendations.push(...this.insightsData.recommendations.slice(0, 2));
    }

    // Best practices
    recommendations.push("📋 Establish clear PR size guidelines");
    recommendations.push("👥 Implement code review assignment rotation");
    recommendations.push("📈 Set up automated lead time monitoring");

    // Display recommendations
    slide.addText("Immediate Actions", {
      x: 0.5,
      y: 1,
      w: 4.5,
      h: 0.4,
      fontSize: 16,
      bold: true,
      color: this.colors.secondary,
    });

    const immediateActions = recommendations.slice(0, 4);
    slide.addText(immediateActions.join("\n\n"), {
      x: 0.5,
      y: 1.4,
      w: 4.5,
      h: 2.5,
      fontSize: 11,
      color: this.colors.text,
      lineSpacing: 22,
    });

    slide.addText("Process Improvements", {
      x: 5.2,
      y: 1,
      w: 4.3,
      h: 0.4,
      fontSize: 16,
      bold: true,
      color: this.colors.secondary,
    });

    const processImprovements = recommendations.slice(4);
    slide.addText(processImprovements.join("\n\n"), {
      x: 5.2,
      y: 1.4,
      w: 4.3,
      h: 2.5,
      fontSize: 11,
      color: this.colors.text,
      lineSpacing: 22,
    });

    // Next steps
    slide.addText("Next Steps", {
      x: 0.5,
      y: 4.2,
      w: 9,
      h: 0.4,
      fontSize: 16,
      bold: true,
      color: this.colors.primary,
    });

    const nextSteps = [
      "1. Review and discuss recommendations with the team",
      "2. Implement priority improvements based on impact assessment",
      "3. Set up regular monitoring and reporting schedule",
      "4. Re-analyze after process changes to measure improvement",
    ];

    slide.addText(nextSteps.join("\n"), {
      x: 0.5,
      y: 4.6,
      w: 9,
      h: 0.8,
      fontSize: 12,
      color: this.colors.text,
      lineSpacing: 18,
    });
  }

  async generatePresentation(outputPath) {
    try {
      // Create all slides
      this.createTitleSlide();
      this.createExecutiveSummarySlide();
      this.createLeadTimeDistributionSlide();
      this.createTrendsAnalysisSlide();
      this.createContributorAnalysisSlide();

      // Add ML insights slide if data is available
      if (this.insightsData) {
        this.createMLInsightsSlide();
      }

      this.createRecommendationsSlide();

      // Save presentation
      await this.pptx.writeFile({ fileName: outputPath });

      console.log(`✅ Presentation generated successfully: ${outputPath}`);
      return outputPath;
    } catch (error) {
      throw new Error(`Failed to generate presentation: ${error.message}`);
    }
  }
}

// CLI implementation
async function parseArguments() {
  const args = process.argv.slice(2);
  const config = {
    input: null,
    output: null,
    insights: null,
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
        showHelp();
        process.exit(0);
        break;
    }
  }

  return config;
}

function showHelp() {
  console.log(`
Commit-to-Merge Lead Time Presentation Generator

USAGE:
  node main.ppt.mjs --input <report.json> --output <presentation.pptx> [options]

OPTIONS:
  -i, --input <file>     Input JSON report file (required)
  -o, --output <file>    Output PowerPoint file path (required)
  --insights <file>      ML insights JSON file (optional)
  -h, --help             Show this help message

EXAMPLES:
  # Basic presentation generation
  node main.ppt.mjs --input ./reports/data.json --output ./reports/presentation.pptx
  
  # Include ML insights
  node main.ppt.mjs --input ./reports/data.json --output ./reports/presentation.pptx --insights ./reports/ml_insights.json
`);
}

async function main() {
  try {
    const config = await parseArguments();

    if (!config.input || !config.output) {
      console.error("❌ Error: Both input and output files are required");
      showHelp();
      process.exit(1);
    }

    console.log("🎯 Generating PowerPoint presentation...");

    const generator = new CommitMergeLeadTimePresentationGenerator();

    // Load data
    console.log(`📊 Loading data from ${config.input}...`);
    await generator.loadData(config.input, config.insights);

    // Generate presentation
    console.log("📈 Creating slides...");
    await generator.generatePresentation(config.output);

    console.log("✅ Presentation generation completed successfully!");
  } catch (error) {
    console.error("❌ Failed to generate presentation:", error.message);
    process.exit(1);
  }
}

// Execute if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { CommitMergeLeadTimePresentationGenerator };
