import PptxGenJS from "pptxgenjs";
import { promises as fs } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class StalePRPresentationGenerator {
  constructor() {
    this.pres = new PptxGenJS();
    this.setupPresentation();
  }

  setupPresentation() {
    // Set presentation properties
    this.pres.author = "Stale PR Audit System";
    this.pres.company = "GitHub Analytics";
    this.pres.subject = "Stale PR Analysis Report";
    this.pres.title = "Abandoned & Stale Pull Request Audit";

    // Define layout
    this.pres.layout = "LAYOUT_WIDE";
  }

  async generatePresentation(reportData, mlInsights = null, outputPath) {
    try {
      // Title slide
      this.createTitleSlide(reportData);

      // Executive summary
      this.createExecutiveSummary(reportData);

      // Detailed analysis slides
      this.createInactivityBreakdown(reportData);
      this.createContributorAnalysis(reportData);
      this.createTrendAnalysis(reportData);

      // ML insights (if available)
      if (mlInsights) {
        this.createMLInsights(mlInsights);
        this.createRiskAnalysis(mlInsights);
        this.createRecommendations(mlInsights);
      }

      // Action items
      this.createActionItems(reportData, mlInsights);

      // Save presentation
      await this.savePresentation(outputPath);

      console.log(`✅ PowerPoint presentation created: ${outputPath}`);
      return outputPath;
    } catch (error) {
      throw new Error(`Failed to generate presentation: ${error.message}`);
    }
  }

  createTitleSlide(reportData) {
    const slide = this.pres.addSlide();

    // Background
    slide.background = "F8F9FA";

    // Main title
    slide.addText("Stale PR Audit Report", {
      x: 1,
      y: 1.5,
      w: 11.33,
      h: 1.5,
      fontSize: 44,
      fontFace: "Calibri",
      color: "2E3440",
      bold: true,
      align: "center",
    });

    // Subtitle with target info
    const targetText =
      reportData.date_range?.target_type === "repository"
        ? `Repository: ${reportData.date_range.analysis_target}`
        : `User: ${reportData.date_range?.analysis_target || "Unknown"}`;

    slide.addText(targetText, {
      x: 1,
      y: 3,
      w: 11.33,
      h: 0.8,
      fontSize: 24,
      fontFace: "Calibri",
      color: "5E81AC",
      align: "center",
    });

    // Date range
    slide.addText(
      `Analysis Period: ${reportData.date_range?.start_date || "N/A"} to ${
        reportData.date_range?.end_date || "N/A"
      }`,
      {
        x: 1,
        y: 4,
        w: 11.33,
        h: 0.6,
        fontSize: 18,
        fontFace: "Calibri",
        color: "646464",
        align: "center",
      }
    );

    // Summary metrics box
    slide.addShape(this.pres.ShapeType.rect, {
      x: 3,
      y: 5,
      w: 7.33,
      h: 1.5,
      fill: "FFFFFF",
      line: { color: "D8DEE9", width: 1 },
    });

    const summaryText = `${reportData.summary?.total_prs || 0} Total PRs | ${
      reportData.summary?.inactive_prs || 0
    } Inactive | ${
      reportData.summary?.abandonment_rate || 0
    }% Abandonment Rate`;
    slide.addText(summaryText, {
      x: 3,
      y: 5.3,
      w: 7.33,
      h: 0.9,
      fontSize: 16,
      fontFace: "Calibri",
      color: "2E3440",
      bold: true,
      align: "center",
    });
  }

  createExecutiveSummary(reportData) {
    const slide = this.pres.addSlide();
    slide.addText("Executive Summary", {
      x: 0.5,
      y: 0.3,
      w: 12.33,
      h: 0.8,
      fontSize: 32,
      fontFace: "Calibri",
      color: "2E3440",
      bold: true,
    });

    // Key metrics in a grid
    const metrics = [
      {
        label: "Total PRs",
        value: reportData.summary?.total_prs || 0,
        color: "5E81AC",
      },
      {
        label: "Open PRs",
        value: reportData.summary?.open_prs || 0,
        color: "88C0D0",
      },
      {
        label: "Inactive PRs",
        value: reportData.summary?.inactive_prs || 0,
        color: "D08770",
      },
      {
        label: "Abandonment Rate",
        value: `${reportData.summary?.abandonment_rate || 0}%`,
        color: "BF616A",
      },
    ];

    metrics.forEach((metric, index) => {
      const x = 1 + (index % 2) * 5.5;
      const y = 1.5 + Math.floor(index / 2) * 1.2;

      // Metric box
      slide.addShape(this.pres.ShapeType.rect, {
        x: x,
        y: y,
        w: 4.5,
        h: 1,
        fill: "FFFFFF",
        line: { color: metric.color, width: 2 },
      });

      // Value
      slide.addText(metric.value.toString(), {
        x: x + 0.2,
        y: y + 0.1,
        w: 4.1,
        h: 0.5,
        fontSize: 28,
        fontFace: "Calibri",
        color: metric.color,
        bold: true,
        align: "center",
      });

      // Label
      slide.addText(metric.label, {
        x: x + 0.2,
        y: y + 0.55,
        w: 4.1,
        h: 0.35,
        fontSize: 14,
        fontFace: "Calibri",
        color: "646464",
        align: "center",
      });
    });

    // Key findings
    if (
      reportData.summary?.key_findings &&
      reportData.summary.key_findings.length > 0
    ) {
      slide.addText("Key Findings:", {
        x: 1,
        y: 4.2,
        w: 11.33,
        h: 0.5,
        fontSize: 18,
        fontFace: "Calibri",
        color: "2E3440",
        bold: true,
      });

      const findingsText = reportData.summary.key_findings
        .slice(0, 3)
        .map((finding, index) => `• ${finding}`)
        .join("\n");

      slide.addText(findingsText, {
        x: 1,
        y: 4.8,
        w: 11.33,
        h: 2,
        fontSize: 14,
        fontFace: "Calibri",
        color: "3B4252",
        lineSpacing: 18,
      });
    }
  }

  createInactivityBreakdown(reportData) {
    const slide = this.pres.addSlide();
    slide.addText("Inactivity Analysis", {
      x: 0.5,
      y: 0.3,
      w: 12.33,
      h: 0.8,
      fontSize: 32,
      fontFace: "Calibri",
      color: "2E3440",
      bold: true,
    });

    const categories =
      reportData.detailed_analysis?.inactivity_categories || {};
    const chartData = [
      {
        name: "Inactivity Categories",
        labels: [],
        values: [],
      },
    ];

    Object.entries(categories).forEach(([category, data]) => {
      if (data.count > 0) {
        chartData[0].labels.push(category.replace("_", " ").toUpperCase());
        chartData[0].values.push(data.count);
      }
    });

    // Create pie chart
    if (chartData[0].labels.length > 0) {
      slide.addChart(this.pres.ChartType.pie, chartData, {
        x: 1,
        y: 1.5,
        w: 6,
        h: 4.5,
        showLegend: true,
        legendPos: "r",
        showValue: true,
        title: "PRs by Inactivity Reason",
      });
    }

    // Details table
    const tableData = [["Category", "Count", "Sample PRs"]];

    Object.entries(categories).forEach(([category, data]) => {
      const samplePRs = (data.prs || [])
        .slice(0, 2)
        .map((pr) => `#${pr.number}`)
        .join(", ");

      tableData.push([
        category.replace("_", " ").toUpperCase(),
        data.count.toString(),
        samplePRs || "None",
      ]);
    });

    slide.addTable(tableData, {
      x: 8,
      y: 1.5,
      w: 4.5,
      h: 4.5,
      colW: [2.2, 0.8, 1.5],
      fontSize: 12,
      color: "2E3440",
      fill: "F8F9FA",
      border: { pt: 1, color: "D8DEE9" },
    });
  }

  createContributorAnalysis(reportData) {
    const slide = this.pres.addSlide();
    slide.addText("Contributor Analysis", {
      x: 0.5,
      y: 0.3,
      w: 12.33,
      h: 0.8,
      fontSize: 32,
      fontFace: "Calibri",
      color: "2E3440",
      bold: true,
    });

    const contributors =
      reportData.detailed_analysis?.contributor_metrics || {};

    if (Object.keys(contributors).length > 0) {
      // Top contributors by abandonment rate
      const topAbandonmentContributors = Object.entries(contributors)
        .filter(([_, stats]) => stats.total_prs >= 2)
        .sort((a, b) => b[1].abandonment_rate - a[1].abandonment_rate)
        .slice(0, 10);

      const tableData = [
        [
          "Contributor",
          "Total PRs",
          "Inactive PRs",
          "Abandonment Rate",
          "Avg Inactive Days",
        ],
      ];

      topAbandonmentContributors.forEach(([contributor, stats]) => {
        tableData.push([
          contributor,
          stats.total_prs.toString(),
          stats.inactive_prs.toString(),
          `${stats.abandonment_rate}%`,
          stats.avg_inactive_days.toString(),
        ]);
      });

      slide.addTable(tableData, {
        x: 1,
        y: 1.5,
        w: 11.33,
        h: 5,
        fontSize: 11,
        color: "2E3440",
        fill: "FFFFFF",
        border: { pt: 1, color: "D8DEE9" },
        rowH: 0.4,
      });
    } else {
      slide.addText("No contributor data available for analysis", {
        x: 1,
        y: 3,
        w: 11.33,
        h: 1,
        fontSize: 16,
        fontFace: "Calibri",
        color: "646464",
        align: "center",
      });
    }
  }

  createTrendAnalysis(reportData) {
    const slide = this.pres.addSlide();
    slide.addText("Trend Analysis", {
      x: 0.5,
      y: 0.3,
      w: 12.33,
      h: 0.8,
      fontSize: 32,
      fontFace: "Calibri",
      color: "2E3440",
      bold: true,
    });

    const trends = reportData.detailed_analysis?.trends;

    // Monthly trends chart
    if (trends?.monthly && Object.keys(trends.monthly).length > 0) {
      const monthlyData = Object.entries(trends.monthly)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-6); // Last 6 months

      const chartData = [
        {
          name: "Total PRs",
          labels: monthlyData.map(([month]) => month),
          values: monthlyData.map(([_, data]) => data.total),
        },
        {
          name: "Inactive PRs",
          labels: monthlyData.map(([month]) => month),
          values: monthlyData.map(([_, data]) => data.inactive),
        },
      ];

      slide.addChart(this.pres.ChartType.line, chartData, {
        x: 1,
        y: 1.5,
        w: 11.33,
        h: 4.5,
        title: "Monthly PR Trends (Last 6 Months)",
        showLegend: true,
        legendPos: "b",
      });
    } else {
      slide.addText("Insufficient data for trend analysis", {
        x: 1,
        y: 3,
        w: 11.33,
        h: 1,
        fontSize: 16,
        fontFace: "Calibri",
        color: "646464",
        align: "center",
      });
    }
  }

  createMLInsights(mlInsights) {
    const slide = this.pres.addSlide();
    slide.addText("ML Analysis Insights", {
      x: 0.5,
      y: 0.3,
      w: 12.33,
      h: 0.8,
      fontSize: 32,
      fontFace: "Calibri",
      color: "2E3440",
      bold: true,
    });

    // Clustering results
    if (mlInsights.clustering) {
      slide.addText("PR Clustering Analysis:", {
        x: 1,
        y: 1.3,
        w: 11.33,
        h: 0.5,
        fontSize: 18,
        fontFace: "Calibri",
        color: "2E3440",
        bold: true,
      });

      const clusterData = Object.entries(mlInsights.clustering).map(
        ([cluster, info]) => [
          cluster.replace("cluster_", "Cluster ").toUpperCase(),
          info.size.toString(),
          `${info.avg_inactive_days.toFixed(1)} days`,
          `${(info.abandonment_rate * 100).toFixed(1)}%`,
          (info.characteristics || []).join(", "),
        ]
      );

      const tableData = [
        [
          "Cluster",
          "Size",
          "Avg Inactive Days",
          "Abandonment Rate",
          "Characteristics",
        ],
        ...clusterData,
      ];

      slide.addTable(tableData, {
        x: 1,
        y: 1.8,
        w: 11.33,
        h: 3,
        fontSize: 10,
        color: "2E3440",
        fill: "FFFFFF",
        border: { pt: 1, color: "D8DEE9" },
      });
    }

    // Pattern insights
    if (mlInsights.abandonment_patterns) {
      slide.addText("Key Patterns Discovered:", {
        x: 1,
        y: 5.2,
        w: 11.33,
        h: 0.5,
        fontSize: 16,
        fontFace: "Calibri",
        color: "2E3440",
        bold: true,
      });

      const patterns = mlInsights.abandonment_patterns;
      let insightText = "";

      if (patterns.author_insights?.high_abandonment_authors?.length > 0) {
        insightText += `• ${patterns.author_insights.high_abandonment_authors.length} authors with high abandonment rates\n`;
      }

      if (patterns.repository_insights?.problematic_repos?.length > 0) {
        insightText += `• ${patterns.repository_insights.problematic_repos.length} repositories need attention\n`;
      }

      if (insightText) {
        slide.addText(insightText, {
          x: 1,
          y: 5.7,
          w: 11.33,
          h: 1,
          fontSize: 12,
          fontFace: "Calibri",
          color: "3B4252",
        });
      }
    }
  }

  createRiskAnalysis(mlInsights) {
    const slide = this.pres.addSlide();
    slide.addText("Risk Analysis", {
      x: 0.5,
      y: 0.3,
      w: 12.33,
      h: 0.8,
      fontSize: 32,
      fontFace: "Calibri",
      color: "2E3440",
      bold: true,
    });

    if (mlInsights.risk_analysis) {
      const riskData = mlInsights.risk_analysis;

      // Risk distribution pie chart
      if (riskData.risk_distribution) {
        const chartData = [
          {
            name: "Risk Distribution",
            labels: Object.keys(riskData.risk_distribution),
            values: Object.values(riskData.risk_distribution),
          },
        ];

        slide.addChart(this.pres.ChartType.pie, chartData, {
          x: 1,
          y: 1.5,
          w: 5.5,
          h: 4,
          title: "Risk Level Distribution",
          showLegend: true,
          legendPos: "r",
        });
      }

      // High-risk PRs table
      if (riskData.high_risk_prs && riskData.high_risk_prs.length > 0) {
        const tableData = [["PR Number", "Risk Score", "Category"]];

        riskData.high_risk_prs.slice(0, 10).forEach((pr) => {
          tableData.push([
            `#${pr.pr_number}`,
            pr.risk_score.toFixed(1),
            pr.reason_category || "Unknown",
          ]);
        });

        slide.addTable(tableData, {
          x: 7,
          y: 1.5,
          w: 5.33,
          h: 4,
          fontSize: 11,
          color: "2E3440",
          fill: "FFFFFF",
          border: { pt: 1, color: "D8DEE9" },
        });
      }
    }
  }

  createRecommendations(mlInsights) {
    const slide = this.pres.addSlide();
    slide.addText("Recommendations", {
      x: 0.5,
      y: 0.3,
      w: 12.33,
      h: 0.8,
      fontSize: 32,
      fontFace: "Calibri",
      color: "2E3440",
      bold: true,
    });

    if (mlInsights.recommendations && mlInsights.recommendations.length > 0) {
      const recommendations = mlInsights.recommendations.slice(0, 8);

      recommendations.forEach((rec, index) => {
        const y = 1.5 + index * 0.7;
        const priorityColor =
          {
            Critical: "BF616A",
            High: "D08770",
            Medium: "EBCB8B",
            Low: "A3BE8C",
          }[rec.priority] || "646464";

        // Priority badge
        slide.addShape(this.pres.ShapeType.rect, {
          x: 1,
          y: y,
          w: 1.2,
          h: 0.4,
          fill: priorityColor,
          line: { color: priorityColor },
        });

        slide.addText(rec.priority, {
          x: 1,
          y: y + 0.05,
          w: 1.2,
          h: 0.3,
          fontSize: 10,
          fontFace: "Calibri",
          color: "FFFFFF",
          bold: true,
          align: "center",
        });

        // Category and suggestion
        slide.addText(`${rec.category}: ${rec.suggestion}`, {
          x: 2.5,
          y: y,
          w: 9.83,
          h: 0.6,
          fontSize: 12,
          fontFace: "Calibri",
          color: "2E3440",
          lineSpacing: 14,
        });
      });
    }
  }

  createActionItems(reportData, mlInsights) {
    const slide = this.pres.addSlide();
    slide.addText("Action Items", {
      x: 0.5,
      y: 0.3,
      w: 12.33,
      h: 0.8,
      fontSize: 32,
      fontFace: "Calibri",
      color: "2E3440",
      bold: true,
    });

    const actions = [];

    // Generate action items based on analysis
    if ((reportData.summary?.inactive_prs || 0) > 10) {
      actions.push({
        priority: "High",
        action: `Review and triage ${reportData.summary.inactive_prs} inactive PRs`,
        owner: "Team Leads",
      });
    }

    if ((reportData.summary?.abandonment_rate || 0) > 30) {
      actions.push({
        priority: "High",
        action: "Investigate causes of high abandonment rate",
        owner: "Engineering Manager",
      });
    }

    // Add ML-based actions
    if ((mlInsights?.risk_analysis?.high_risk_prs?.length || 0) > 5) {
      actions.push({
        priority: "Critical",
        action: `Address ${mlInsights.risk_analysis.high_risk_prs.length} high-risk PRs immediately`,
        owner: "Development Team",
      });
    }

    if (
      (mlInsights?.abandonment_patterns?.repository_insights?.problematic_repos
        ?.length || 0) > 0
    ) {
      actions.push({
        priority: "Medium",
        action: "Review CI/CD processes in problematic repositories",
        owner: "DevOps Team",
      });
    }

    // Display actions
    if (actions.length > 0) {
      const tableData = [["Priority", "Action Item", "Owner"]];
      actions.forEach((action) => {
        tableData.push([action.priority, action.action, action.owner]);
      });

      slide.addTable(tableData, {
        x: 1,
        y: 1.5,
        w: 11.33,
        h: 4.5,
        fontSize: 12,
        color: "2E3440",
        fill: "FFFFFF",
        border: { pt: 1, color: "D8DEE9" },
        colW: [1.5, 7.33, 2.5],
      });
    } else {
      slide.addText("No immediate action items identified", {
        x: 1,
        y: 3,
        w: 11.33,
        h: 1,
        fontSize: 16,
        fontFace: "Calibri",
        color: "646464",
        align: "center",
      });
    }
  }

  async savePresentation(outputPath) {
    try {
      await this.pres.writeFile(outputPath);
    } catch (error) {
      throw new Error(`Failed to save presentation: ${error.message}`);
    }
  }
}

// CLI Implementation
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
    }
  }

  return config;
}

function showHelp() {
  console.log(`
🎨 Stale PR Audit PowerPoint Generator

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

    if (config.help) {
      showHelp();
      return;
    }

    if (!config.input || !config.output) {
      console.error("❌ Error: Both input and output files are required\n");
      showHelp();
      process.exit(1);
    }

    console.log("📊 Loading report data...");
    const reportData = JSON.parse(await fs.readFile(config.input, "utf8"));

    let mlInsights = null;
    if (config.insights) {
      console.log("🤖 Loading ML insights...");
      mlInsights = JSON.parse(await fs.readFile(config.insights, "utf8"));
    }

    console.log("🎨 Generating PowerPoint presentation...");
    const generator = new StalePRPresentationGenerator();
    await generator.generatePresentation(reportData, mlInsights, config.output);

    console.log("✅ PowerPoint presentation created successfully!");
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { StalePRPresentationGenerator };
