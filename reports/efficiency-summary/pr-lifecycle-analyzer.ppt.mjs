#!/usr/bin/env node

import PptxGenJS from "pptxgenjs";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class PRLifecyclePresentationGenerator {
  constructor() {
    this.pptx = new PptxGenJS();
    this.setupPresentation();
  }

  setupPresentation() {
    this.pptx.author = "PR Lifecycle Analyzer";
    this.pptx.company = "DevOps Analytics";
    this.pptx.title = "Pull Request Lifecycle Analysis Report";
    this.pptx.subject = "GitHub Repository Analysis";
  }

  loadReportData(jsonPath) {
    try {
      const data = readFileSync(jsonPath, "utf8");
      return JSON.parse(data);
    } catch (error) {
      throw new Error(
        `Failed to load report data from ${jsonPath}: ${error.message}`
      );
    }
  }

  loadMLData(mlJsonPath) {
    try {
      if (existsSync(mlJsonPath)) {
        const data = readFileSync(mlJsonPath, "utf8");
        return JSON.parse(data);
      }
      return null;
    } catch (error) {
      console.warn(`Warning: Could not load ML data: ${error.message}`);
      return null;
    }
  }

  createTitleSlide(reportData) {
    const slide = this.pptx.addSlide();
    slide.background = { color: "1f4e79" };

    // Title
    slide.addText("Pull Request Lifecycle Analysis", {
      x: 1,
      y: 1.5,
      w: 8,
      h: 1.5,
      fontSize: 44,
      bold: true,
      color: "FFFFFF",
      align: "center",
    });

    // Subtitle with repository/user info
    const target = reportData.detailed_analysis.repository_info
      ? `Repository: ${reportData.detailed_analysis.repository_info.full_name}`
      : `User: ${reportData.detailed_analysis.user_info?.login || "Unknown"}`;

    slide.addText(target, {
      x: 1,
      y: 3,
      w: 8,
      h: 0.8,
      fontSize: 24,
      color: "FFFFFF",
      align: "center",
    });

    // Date range
    slide.addText(
      `Analysis Period: ${reportData.date_range.start_date} to ${reportData.date_range.end_date}`,
      {
        x: 1,
        y: 3.8,
        w: 8,
        h: 0.6,
        fontSize: 18,
        color: "CCCCCC",
        align: "center",
      }
    );

    // Generated date
    slide.addText(
      `Generated: ${new Date(
        reportData.date_range.analysis_date
      ).toLocaleDateString()}`,
      {
        x: 1,
        y: 6,
        w: 8,
        h: 0.5,
        fontSize: 14,
        color: "AAAAAA",
        align: "center",
      }
    );
  }

  createExecutiveSummarySlide(reportData) {
    const slide = this.pptx.addSlide();
    slide.background = { color: "F8F9FA" };

    // Title
    slide.addText("Executive Summary", {
      x: 0.5,
      y: 0.3,
      w: 9,
      h: 0.8,
      fontSize: 32,
      bold: true,
      color: "1f4e79",
    });

    // Key metrics in a grid layout
    const metrics = [
      ["Total PRs", reportData.summary.TOTAL_PULL_REQUESTS],
      ["Merge Rate", `${reportData.summary.MERGE_SUCCESS_RATE_PERCENT}%`],
      ["Avg Cycle Time", `${reportData.summary.AVERAGE_CYCLE_TIME_HOURS}h`],
      [
        "Avg Review Time",
        `${reportData.summary.AVERAGE_REVIEW_TIME_HOURS || "N/A"}h`,
      ],
    ];

    metrics.forEach((metric, index) => {
      const x = 0.5 + (index % 2) * 4.5;
      const y = 1.5 + Math.floor(index / 2) * 1.5;

      slide.addShape("rect", {
        x: x,
        y: y,
        w: 4,
        h: 1.2,
        fill: { color: "FFFFFF" },
        line: { color: "E1E5E9", width: 1 },
      });

      slide.addText(metric[0], {
        x: x + 0.2,
        y: y + 0.1,
        w: 3.6,
        h: 0.5,
        fontSize: 14,
        color: "666666",
      });

      slide.addText(String(metric[1]), {
        x: x + 0.2,
        y: y + 0.5,
        w: 3.6,
        h: 0.6,
        fontSize: 24,
        bold: true,
        color: "1f4e79",
      });
    });

    // Key insights
    slide.addText("Key Insights:", {
      x: 0.5,
      y: 4.5,
      w: 9,
      h: 0.5,
      fontSize: 18,
      bold: true,
      color: "1f4e79",
    });

    const insights = [
      `${
        reportData.summary.IDENTIFIED_BOTTLENECKS.length > 0
          ? `Identified bottlenecks: ${reportData.summary.IDENTIFIED_BOTTLENECKS.join(
              ", "
            )}`
          : "No significant bottlenecks identified"
      }`,
      `Median cycle time: ${reportData.summary.MEDIAN_CYCLE_TIME_HOURS} hours`,
      `Total reviews conducted: ${reportData.total.TOTAL_REVIEWS}`,
      `Average idle time: ${reportData.summary.AVERAGE_IDLE_TIME_HOURS} hours`,
    ];

    insights.forEach((insight, index) => {
      slide.addText(`• ${insight}`, {
        x: 0.8,
        y: 5 + index * 0.4,
        w: 8.5,
        h: 0.4,
        fontSize: 14,
        color: "333333",
      });
    });
  }

  createMetricsBreakdownSlide(reportData) {
    const slide = this.pptx.addSlide();

    slide.addText("Detailed Metrics Breakdown", {
      x: 0.5,
      y: 0.3,
      w: 9,
      h: 0.8,
      fontSize: 28,
      bold: true,
      color: "1f4e79",
    });

    // Create table data
    const tableData = [
      ["Metric", "Value", "Description"],
      [
        "Total Pull Requests",
        reportData.summary.TOTAL_PULL_REQUESTS,
        "All PRs in analysis period",
      ],
      [
        "Merged PRs",
        reportData.summary.MERGED_PULL_REQUESTS,
        "Successfully merged PRs",
      ],
      [
        "Closed PRs",
        reportData.summary.CLOSED_PULL_REQUESTS,
        "Closed without merging",
      ],
      ["Open PRs", reportData.summary.OPEN_PULL_REQUESTS, "Currently open PRs"],
      [
        "Avg Cycle Time",
        `${reportData.summary.AVERAGE_CYCLE_TIME_HOURS}h`,
        "Time from creation to close",
      ],
      [
        "Median Cycle Time",
        `${reportData.summary.MEDIAN_CYCLE_TIME_HOURS}h`,
        "Middle value of cycle times",
      ],
      [
        "Avg Review Time",
        `${reportData.summary.AVERAGE_REVIEW_TIME_HOURS || "N/A"}h`,
        "Time to first review",
      ],
      [
        "Avg Idle Time",
        `${reportData.summary.AVERAGE_IDLE_TIME_HOURS}h`,
        "Time without activity",
      ],
    ];

    slide.addTable(tableData, {
      x: 0.5,
      y: 1.2,
      w: 9,
      h: 5,
      fontSize: 12,
      border: { pt: 1, color: "CFCFCF" },
      fill: { color: "F7F7F7" },
      color: "333333",
    });
  }

  createTrendsSlide(reportData) {
    const slide = this.pptx.addSlide();

    slide.addText("Trends Analysis", {
      x: 0.5,
      y: 0.3,
      w: 9,
      h: 0.8,
      fontSize: 28,
      bold: true,
      color: "1f4e79",
    });

    if (
      reportData.detailed_analysis.trends &&
      reportData.detailed_analysis.trends.length > 0
    ) {
      // Create chart data for trends
      const chartData = reportData.detailed_analysis.trends.map((trend) => ({
        name: trend.period,
        values: [
          { category: "Count", value: trend.count },
          { category: "Avg Cycle Time", value: Math.round(trend.avgCycleTime) },
          { category: "Merge Rate %", value: Math.round(trend.mergeRate) },
        ],
      }));

      // Add trend summary table
      const trendTableData = [
        ["Period", "PR Count", "Avg Cycle Time (h)", "Merge Rate (%)"],
        ...reportData.detailed_analysis.trends
          .slice(-10)
          .map((trend) => [
            trend.period,
            trend.count,
            Math.round(trend.avgCycleTime),
            Math.round(trend.mergeRate),
          ]),
      ];

      slide.addTable(trendTableData, {
        x: 0.5,
        y: 1.5,
        w: 9,
        h: 4,
        fontSize: 11,
        border: { pt: 1, color: "CFCFCF" },
        fill: { color: "F7F7F7" },
      });
    } else {
      slide.addText("No trend data available for the selected period.", {
        x: 0.5,
        y: 3,
        w: 9,
        h: 1,
        fontSize: 16,
        color: "666666",
        align: "center",
      });
    }
  }

  createContributorAnalysisSlide(reportData) {
    const slide = this.pptx.addSlide();

    slide.addText("Top Contributors Analysis", {
      x: 0.5,
      y: 0.3,
      w: 9,
      h: 0.8,
      fontSize: 28,
      bold: true,
      color: "1f4e79",
    });

    const contributors = Object.entries(
      reportData.detailed_analysis.contributor_metrics
    )
      .sort((a, b) => b[1].TOTAL_PRS - a[1].TOTAL_PRS)
      .slice(0, 10);

    if (contributors.length > 0) {
      const contributorTableData = [
        [
          "Contributor",
          "Total PRs",
          "Merged PRs",
          "Success Rate (%)",
          "Avg Cycle Time (h)",
        ],
        ...contributors.map(([name, metrics]) => [
          name,
          metrics.TOTAL_PRS,
          metrics.MERGED_PRS,
          metrics.MERGE_SUCCESS_RATE_PERCENT,
          metrics.AVERAGE_CYCLE_TIME_HOURS,
        ]),
      ];

      slide.addTable(contributorTableData, {
        x: 0.5,
        y: 1.5,
        w: 9,
        h: 4.5,
        fontSize: 11,
        border: { pt: 1, color: "CFCFCF" },
        fill: { color: "F7F7F7" },
      });
    } else {
      slide.addText("No contributor data available.", {
        x: 0.5,
        y: 3,
        w: 9,
        h: 1,
        fontSize: 16,
        color: "666666",
        align: "center",
      });
    }
  }

  createMLInsightsSlide(mlData) {
    const slide = this.pptx.addSlide();

    slide.addText("Machine Learning Insights", {
      x: 0.5,
      y: 0.3,
      w: 9,
      h: 0.8,
      fontSize: 28,
      bold: true,
      color: "1f4e79",
    });

    if (mlData && mlData.insights) {
      const insights = mlData.insights.slice(0, 4); // Take first 4 insights

      insights.forEach((insight, index) => {
        const y = 1.5 + index * 1.2;

        slide.addText(insight.title, {
          x: 0.5,
          y: y,
          w: 9,
          h: 0.4,
          fontSize: 16,
          bold: true,
          color: "1f4e79",
        });

        slide.addText(insight.interpretation, {
          x: 0.5,
          y: y + 0.4,
          w: 9,
          h: 0.6,
          fontSize: 12,
          color: "333333",
        });
      });
    } else {
      slide.addText(
        "ML analysis data not available. Run main.ml.py first to generate insights.",
        {
          x: 0.5,
          y: 3,
          w: 9,
          h: 1,
          fontSize: 16,
          color: "666666",
          align: "center",
          italic: true,
        }
      );
    }
  }

  createBottlenecksSlide(reportData) {
    const slide = this.pptx.addSlide();

    slide.addText("Bottleneck Analysis", {
      x: 0.5,
      y: 0.3,
      w: 9,
      h: 0.8,
      fontSize: 28,
      bold: true,
      color: "1f4e79",
    });

    const bottlenecks = reportData.summary.IDENTIFIED_BOTTLENECKS;
    const stageAnalysis = reportData.detailed_analysis.stage_analysis;

    if (bottlenecks.length > 0) {
      slide.addText("Identified Issues:", {
        x: 0.5,
        y: 1.5,
        w: 9,
        h: 0.5,
        fontSize: 18,
        bold: true,
        color: "D73502",
      });

      bottlenecks.forEach((bottleneck, index) => {
        slide.addText(`• ${bottleneck.replace("_", " ").toUpperCase()}`, {
          x: 0.8,
          y: 2 + index * 0.4,
          w: 8.5,
          h: 0.4,
          fontSize: 14,
          color: "D73502",
        });
      });
    }

    // Percentile analysis
    slide.addText("Performance Percentiles:", {
      x: 0.5,
      y: 3.5,
      w: 9,
      h: 0.5,
      fontSize: 18,
      bold: true,
      color: "1f4e79",
    });

    const percentileData = [
      ["Metric", "P50", "P75", "P95"],
      [
        "Cycle Time (h)",
        stageAnalysis.percentiles.P50_CYCLE_TIME_HOURS,
        stageAnalysis.percentiles.P75_CYCLE_TIME_HOURS,
        stageAnalysis.percentiles.P95_CYCLE_TIME_HOURS,
      ],
      [
        "Review Time (h)",
        stageAnalysis.percentiles.P50_REVIEW_TIME_HOURS,
        stageAnalysis.percentiles.P75_REVIEW_TIME_HOURS,
        stageAnalysis.percentiles.P95_REVIEW_TIME_HOURS,
      ],
    ];

    slide.addTable(percentileData, {
      x: 0.5,
      y: 4,
      w: 9,
      h: 1.5,
      fontSize: 12,
      border: { pt: 1, color: "CFCFCF" },
      fill: { color: "F7F7F7" },
    });
  }

  createRecommendationsSlide(reportData, mlData) {
    const slide = this.pptx.addSlide();

    slide.addText("Recommendations", {
      x: 0.5,
      y: 0.3,
      w: 9,
      h: 0.8,
      fontSize: 28,
      bold: true,
      color: "1f4e79",
    });

    const recommendations = [];

    // Based on bottlenecks
    if (reportData.summary.IDENTIFIED_BOTTLENECKS.includes("review_delay")) {
      recommendations.push(
        "Implement automated reviewer assignment to reduce review delays"
      );
    }
    if (
      reportData.summary.IDENTIFIED_BOTTLENECKS.includes("excessive_idle_time")
    ) {
      recommendations.push("Set up PR staleness alerts to reduce idle time");
    }

    // Based on metrics
    if (reportData.summary.MERGE_SUCCESS_RATE_PERCENT < 80) {
      recommendations.push(
        "Improve PR quality with pre-commit hooks and templates"
      );
    }
    if (reportData.summary.AVERAGE_CYCLE_TIME_HOURS > 168) {
      // 1 week
      recommendations.push("Break down large PRs and implement feature flags");
    }

    // General recommendations
    recommendations.push(
      "Consider implementing PR size limits to improve review efficiency"
    );
    recommendations.push(
      "Use automated testing to catch issues early in the cycle"
    );

    if (mlData && mlData.insights) {
      const temporalInsight = mlData.insights.find(
        (i) => i.type === "temporal_patterns"
      );
      if (temporalInsight) {
        recommendations.push(
          `Encourage PR creation on ${temporalInsight.data.best_day_for_prs} for better success rates`
        );
      }
    }

    recommendations.slice(0, 6).forEach((rec, index) => {
      slide.addText(`${index + 1}. ${rec}`, {
        x: 0.5,
        y: 1.5 + index * 0.7,
        w: 9,
        h: 0.6,
        fontSize: 14,
        color: "333333",
        bullet: false,
      });
    });
  }

  async generatePresentation(jsonPath, outputPath, mlJsonPath = null) {
    console.log("📊 Generating PowerPoint presentation...");

    // Load data
    const reportData = this.loadReportData(jsonPath);
    const mlData = mlJsonPath ? this.loadMLData(mlJsonPath) : null;

    // Create slides
    this.createTitleSlide(reportData);
    this.createExecutiveSummarySlide(reportData);
    this.createMetricsBreakdownSlide(reportData);
    this.createTrendsSlide(reportData);
    this.createContributorAnalysisSlide(reportData);
    if (mlData) {
      this.createMLInsightsSlide(mlData);
    }
    this.createBottlenecksSlide(reportData);
    this.createRecommendationsSlide(reportData, mlData);

    // Save presentation
    await this.pptx.writeFile({ fileName: outputPath });
    console.log(`✅ PowerPoint presentation saved to: ${outputPath}`);

    return outputPath;
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log(`
Usage: node main.ppt.mjs <input_json> <output_pptx> [ml_json]

Examples:
  node main.ppt.mjs ./reports/pr-lifecycle-2024-01-15.json ./reports/presentation.pptx
  node main.ppt.mjs ./reports/pr-lifecycle-2024-01-15.json ./reports/presentation.pptx ./reports/pr_ml_analysis.json
        `);
    process.exit(1);
  }

  const [inputJson, outputPptx, mlJson] = args;

  try {
    const generator = new PRLifecyclePresentationGenerator();
    await generator.generatePresentation(inputJson, outputPptx, mlJson);
  } catch (error) {
    console.error(`❌ Error generating presentation: ${error.message}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { PRLifecyclePresentationGenerator };
