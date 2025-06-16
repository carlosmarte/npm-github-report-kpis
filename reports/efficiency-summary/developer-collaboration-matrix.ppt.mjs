#!/usr/bin/env node

/**
 * Developer Collaboration Matrix - PowerPoint Generator
 *
 * Generates professional PowerPoint presentations from collaboration analysis data
 * and ML insights using PptxGenJS library.
 */

import PptxGenJS from "pptxgenjs";
import { promises as fs } from "fs";
import { dirname, join, basename } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class CollaborationPresentationGenerator {
  constructor(options = {}) {
    this.pptx = new PptxGenJS();
    this.theme = options.theme || "corporate";
    this.verbose = options.verbose || false;

    // Configure presentation properties
    this.pptx.author = "Developer Collaboration Matrix";
    this.pptx.company = "GitHub Insights";
    this.pptx.subject = "Collaboration Analysis Report";
    this.pptx.title = "Developer Collaboration Matrix Analysis";

    // Define theme colors and styles
    this.colors = this.getThemeColors();
    this.fonts = this.getThemeFonts();
  }

  getThemeColors() {
    const themes = {
      corporate: {
        primary: "1F4E79",
        secondary: "4472C4",
        accent: "70AD47",
        text: "2F4F4F",
        background: "FFFFFF",
        chart: ["4472C4", "70AD47", "FFC000", "C55A5A", "843C0C", "7030A0"],
      },
      modern: {
        primary: "2E86AB",
        secondary: "A23B72",
        accent: "F18F01",
        text: "2D3436",
        background: "FFFFFF",
        chart: ["2E86AB", "A23B72", "F18F01", "C0392B", "8E44AD", "27AE60"],
      },
      dark: {
        primary: "BB86FC",
        secondary: "03DAC6",
        accent: "CF6679",
        text: "FFFFFF",
        background: "121212",
        chart: ["BB86FC", "03DAC6", "CF6679", "FDD835", "FF8A65", "81C784"],
      },
    };

    return themes[this.theme] || themes.corporate;
  }

  getThemeFonts() {
    return {
      title: {
        face: "Segoe UI",
        size: 32,
        bold: true,
        color: this.colors.primary,
      },
      subtitle: {
        face: "Segoe UI",
        size: 24,
        bold: true,
        color: this.colors.secondary,
      },
      heading: {
        face: "Segoe UI",
        size: 20,
        bold: true,
        color: this.colors.text,
      },
      body: { face: "Segoe UI", size: 14, color: this.colors.text },
      caption: { face: "Segoe UI", size: 12, color: this.colors.text },
    };
  }

  async loadData(reportPath, insightsPath = null) {
    try {
      // Load main report data
      const reportData = JSON.parse(await fs.readFile(reportPath, "utf8"));

      // Load ML insights if provided
      let insightsData = null;
      if (insightsPath) {
        try {
          insightsData = JSON.parse(await fs.readFile(insightsPath, "utf8"));
        } catch (error) {
          if (this.verbose) {
            console.log(`⚠️ Could not load insights file: ${error.message}`);
          }
        }
      }

      if (this.verbose) {
        console.log(`✅ Loaded report data from ${reportPath}`);
        if (insightsData) {
          console.log(`✅ Loaded ML insights from ${insightsPath}`);
        }
      }

      return { reportData, insightsData };
    } catch (error) {
      throw new Error(`Failed to load data: ${error.message}`);
    }
  }

  generatePresentation(reportData, insightsData = null) {
    if (this.verbose) {
      console.log("🎨 Generating PowerPoint presentation...");
    }

    // Title slide
    this.createTitleSlide(reportData);

    // Executive summary
    this.createExecutiveSummarySlide(reportData);

    // Key metrics overview
    this.createKeyMetricsSlide(reportData);

    // Collaboration matrix analysis
    this.createCollaborationMatrixSlide(reportData);

    // Top contributors
    this.createTopContributorsSlide(reportData);

    // Temporal patterns
    this.createTemporalPatternsSlide(reportData);

    // ML insights (if available)
    if (insightsData) {
      this.createMLInsightsSlides(insightsData);
    }

    // Recommendations
    this.createRecommendationsSlide(reportData, insightsData);

    // Conclusion
    this.createConclusionSlide(reportData);

    if (this.verbose) {
      console.log(
        `📊 Generated presentation with ${this.pptx.slides.length} slides`
      );
    }
  }

  createTitleSlide(data) {
    const slide = this.pptx.addSlide();

    // Background
    slide.background = { color: this.colors.background };

    // Title
    slide.addText("Developer Collaboration Matrix", {
      x: 1,
      y: 2,
      w: 8,
      h: 1.5,
      ...this.fonts.title,
      align: "center",
    });

    // Subtitle
    const target = data.date_range?.analysis_target || "GitHub Repository";
    const mode = data.date_range?.analysis_mode || "analysis";
    slide.addText(
      `${target} (${mode.charAt(0).toUpperCase() + mode.slice(1)} Analysis)`,
      {
        x: 1,
        y: 3.5,
        w: 8,
        h: 0.8,
        ...this.fonts.subtitle,
        align: "center",
      }
    );

    // Date range
    const startDate = data.date_range?.start_date || "N/A";
    const endDate = data.date_range?.end_date || "N/A";
    slide.addText(`Analysis Period: ${startDate} to ${endDate}`, {
      x: 1,
      y: 4.5,
      w: 8,
      h: 0.6,
      ...this.fonts.body,
      align: "center",
    });

    // Summary stats
    const totalPRs = data.summary?.total_pull_requests || 0;
    const totalCollaborators = data.summary?.total_collaborators || 0;
    const totalInteractions = data.summary?.total_interactions || 0;

    slide.addText(
      `${totalPRs} Pull Requests • ${totalCollaborators} Collaborators • ${totalInteractions} Interactions`,
      {
        x: 1,
        y: 5.5,
        w: 8,
        h: 0.6,
        ...this.fonts.body,
        align: "center",
        color: this.colors.secondary,
      }
    );

    // Footer
    slide.addText("Generated by Developer Collaboration Matrix", {
      x: 1,
      y: 6.8,
      w: 8,
      h: 0.4,
      ...this.fonts.caption,
      align: "center",
    });
  }

  createExecutiveSummarySlide(data) {
    const slide = this.pptx.addSlide();
    slide.background = { color: this.colors.background };

    // Title
    slide.addText("Executive Summary", {
      x: 0.5,
      y: 0.5,
      w: 9,
      h: 0.8,
      ...this.fonts.title,
    });

    // Key findings
    const summary = data.summary || {};
    const findings = [
      `📊 Analyzed ${summary.total_pull_requests || 0} pull requests across ${
        summary.total_collaborators || 0
      } collaborators`,
      `🤝 Generated ${
        summary.total_interactions || 0
      } collaboration interactions`,
      `📈 Average collaboration score: ${
        summary.average_collaboration_score || 0
      }`,
      `🏆 Most active collaborator: ${
        summary.most_active_collaborator || "N/A"
      }`,
      `🌐 Most diverse collaborator: ${
        summary.most_diverse_collaborator || "N/A"
      }`,
      `⚠️  Identified ${
        summary.collaboration_bottlenecks || 0
      } potential bottlenecks`,
    ];

    findings.forEach((finding, index) => {
      slide.addText(finding, {
        x: 1,
        y: 1.8 + index * 0.7,
        w: 8,
        h: 0.6,
        ...this.fonts.body,
        bullet: { type: "number" },
      });
    });

    // Processing info
    slide.addText(
      `Analysis completed in ${Math.round(
        (summary.processing_time_ms || 0) / 1000
      )}s`,
      {
        x: 1,
        y: 6.5,
        w: 8,
        h: 0.4,
        ...this.fonts.caption,
        italic: true,
      }
    );
  }

  createKeyMetricsSlide(data) {
    const slide = this.pptx.addSlide();
    slide.background = { color: this.colors.background };

    // Title
    slide.addText("Key Collaboration Metrics", {
      x: 0.5,
      y: 0.5,
      w: 9,
      h: 0.8,
      ...this.fonts.title,
    });

    // Create metrics grid
    const summary = data.summary || {};
    const total = data.total || {};

    const metrics = [
      {
        label: "Pull Requests",
        value: summary.total_pull_requests || 0,
        color: this.colors.chart[0],
      },
      {
        label: "Collaborators",
        value: summary.total_collaborators || 0,
        color: this.colors.chart[1],
      },
      {
        label: "Reviews Given",
        value: total.reviews_given || 0,
        color: this.colors.chart[2],
      },
      {
        label: "Comments Made",
        value: total.comments_made || 0,
        color: this.colors.chart[3],
      },
      {
        label: "Discussion Threads",
        value: summary.total_discussion_threads || 0,
        color: this.colors.chart[4],
      },
      {
        label: "Avg. Collaboration Score",
        value: summary.average_collaboration_score || 0,
        color: this.colors.chart[5],
      },
    ];

    // Create metric cards
    metrics.forEach((metric, index) => {
      const row = Math.floor(index / 3);
      const col = index % 3;
      const x = 0.5 + col * 3;
      const y = 2 + row * 2;

      // Card background
      slide.addShape(this.pptx.ShapeType.rect, {
        x: x,
        y: y,
        w: 2.5,
        h: 1.5,
        fill: { color: metric.color, transparency: 90 },
        line: { color: metric.color, width: 2 },
      });

      // Value
      slide.addText(metric.value.toString(), {
        x: x,
        y: y + 0.2,
        w: 2.5,
        h: 0.8,
        fontSize: 24,
        bold: true,
        color: metric.color,
        align: "center",
      });

      // Label
      slide.addText(metric.label, {
        x: x,
        y: y + 0.9,
        w: 2.5,
        h: 0.4,
        ...this.fonts.caption,
        align: "center",
      });
    });
  }

  createCollaborationMatrixSlide(data) {
    const slide = this.pptx.addSlide();
    slide.background = { color: this.colors.background };

    // Title
    slide.addText("Collaboration Matrix Analysis", {
      x: 0.5,
      y: 0.5,
      w: 9,
      h: 0.8,
      ...this.fonts.title,
    });

    const collaborationMatrix =
      data.detailed_analysis?.collaboration_matrix || {};
    const userStats = collaborationMatrix.user_stats || {};
    const interactions = collaborationMatrix.interactions || [];

    // Interaction types chart data
    const interactionTypes = {};
    interactions.forEach((interaction) => {
      const type = interaction.type;
      interactionTypes[type] = (interactionTypes[type] || 0) + 1;
    });

    if (Object.keys(interactionTypes).length > 0) {
      const chartData = Object.entries(interactionTypes).map(
        ([type, count]) => ({
          name: type.charAt(0).toUpperCase() + type.slice(1),
          labels: [type.charAt(0).toUpperCase() + type.slice(1)],
          values: [count],
        })
      );

      slide.addChart(this.pptx.ChartType.pie, chartData, {
        x: 0.5,
        y: 1.8,
        w: 4,
        h: 3,
        showTitle: true,
        title: "Interaction Types",
        titleFontSize: 16,
        showLegend: true,
        legendPos: "r",
      });
    }

    // Top collaborators table
    const topUsers = Object.entries(userStats)
      .sort(([, a], [, b]) => b.collaborators - a.collaborators)
      .slice(0, 5);

    if (topUsers.length > 0) {
      const tableData = [
        [
          { text: "User", options: { ...this.fonts.heading, fontSize: 12 } },
          { text: "PRs", options: { ...this.fonts.heading, fontSize: 12 } },
          { text: "Reviews", options: { ...this.fonts.heading, fontSize: 12 } },
          {
            text: "Comments",
            options: { ...this.fonts.heading, fontSize: 12 },
          },
          {
            text: "Collaborators",
            options: { ...this.fonts.heading, fontSize: 12 },
          },
        ],
      ];

      topUsers.forEach(([user, stats]) => {
        tableData.push([
          { text: user, options: this.fonts.body },
          { text: stats.prs_created.toString(), options: this.fonts.body },
          { text: stats.reviews_given.toString(), options: this.fonts.body },
          { text: stats.comments_made.toString(), options: this.fonts.body },
          { text: stats.collaborators.toString(), options: this.fonts.body },
        ]);
      });

      slide.addTable(tableData, {
        x: 5,
        y: 1.8,
        w: 4,
        h: 3,
        border: { pt: 1, color: this.colors.text },
        fill: { color: this.colors.background },
      });
    }

    // Summary text
    slide.addText(
      `Matrix includes ${Object.keys(userStats).length} users with ${
        interactions.length
      } total interactions`,
      {
        x: 0.5,
        y: 5.5,
        w: 9,
        h: 0.5,
        ...this.fonts.body,
        align: "center",
      }
    );
  }

  createTopContributorsSlide(data) {
    const slide = this.pptx.addSlide();
    slide.background = { color: this.colors.background };

    // Title
    slide.addText("Top Contributors", {
      x: 0.5,
      y: 0.5,
      w: 9,
      h: 0.8,
      ...this.fonts.title,
    });

    const collaborationScores =
      data.detailed_analysis?.collaboration_scores || {};

    if (Object.keys(collaborationScores).length > 0) {
      // Get top 10 contributors
      const topContributors = Object.entries(collaborationScores)
        .sort(([, a], [, b]) => b.collaboration_score - a.collaboration_score)
        .slice(0, 10);

      // Create chart data
      const chartData = [
        {
          name: "Collaboration Score",
          labels: topContributors.map(([user]) => user),
          values: topContributors.map(
            ([, scores]) => Math.round(scores.collaboration_score * 100) / 100
          ),
        },
      ];

      slide.addChart(this.pptx.ChartType.bar, chartData, {
        x: 0.5,
        y: 1.5,
        w: 9,
        h: 4,
        showTitle: true,
        title: "Top Contributors by Collaboration Score",
        titleFontSize: 16,
        showLegend: false,
        catAxisLabelRotate: 45,
        barColors: [this.colors.primary],
      });

      // Add insights
      const insights = [
        `🏆 Top performer: ${topContributors[0]?.[0] || "N/A"} (Score: ${
          topContributors[0]?.[1]?.collaboration_score?.toFixed(2) || "N/A"
        })`,
        `📊 Average score among top 10: ${(
          topContributors.reduce(
            (sum, [, scores]) => sum + scores.collaboration_score,
            0
          ) / topContributors.length
        ).toFixed(2)}`,
        `📈 Score range: ${
          topContributors[
            topContributors.length - 1
          ]?.[1]?.collaboration_score?.toFixed(2) || "N/A"
        } - ${
          topContributors[0]?.[1]?.collaboration_score?.toFixed(2) || "N/A"
        }`,
      ];

      insights.forEach((insight, index) => {
        slide.addText(insight, {
          x: 1,
          y: 6 + index * 0.4,
          w: 8,
          h: 0.3,
          ...this.fonts.body,
        });
      });
    } else {
      slide.addText("No collaboration score data available", {
        x: 1,
        y: 3,
        w: 8,
        h: 1,
        ...this.fonts.body,
        align: "center",
      });
    }
  }

  createTemporalPatternsSlide(data) {
    const slide = this.pptx.addSlide();
    slide.background = { color: this.colors.background };

    // Title
    slide.addText("Temporal Collaboration Patterns", {
      x: 0.5,
      y: 0.5,
      w: 9,
      h: 0.8,
      ...this.fonts.title,
    });

    const temporalData = data.detailed_analysis?.temporal_analysis || {};

    // Weekly patterns chart
    const weeklyData = temporalData.by_day_of_week || {};
    if (Object.keys(weeklyData).length > 0) {
      const dayOrder = [
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
        "Sunday",
      ];
      const chartData = [
        {
          name: "Activity",
          labels: dayOrder.filter((day) => weeklyData[day] !== undefined),
          values: dayOrder
            .filter((day) => weeklyData[day] !== undefined)
            .map((day) => weeklyData[day]),
        },
      ];

      slide.addChart(this.pptx.ChartType.line, chartData, {
        x: 0.5,
        y: 1.5,
        w: 4.5,
        h: 2.5,
        showTitle: true,
        title: "Activity by Day of Week",
        titleFontSize: 14,
        showLegend: false,
        lineColor: this.colors.primary,
      });
    }

    // Monthly trends chart
    const monthlyData = temporalData.by_month || {};
    if (Object.keys(monthlyData).length > 0) {
      const sortedMonths = Object.keys(monthlyData).sort();
      const chartData = [
        {
          name: "PRs",
          labels: sortedMonths,
          values: sortedMonths.map((month) => monthlyData[month]),
        },
      ];

      slide.addChart(this.pptx.ChartType.line, chartData, {
        x: 5,
        y: 1.5,
        w: 4.5,
        h: 2.5,
        showTitle: true,
        title: "Monthly Trends",
        titleFontSize: 14,
        showLegend: false,
        lineColor: this.colors.secondary,
      });
    }

    // Insights
    const insights = [];
    const weeklyPattern = temporalData.by_day_of_week;
    if (weeklyPattern) {
      const mostActive = Object.entries(weeklyPattern).sort(
        ([, a], [, b]) => b - a
      )[0];
      if (mostActive) {
        insights.push(
          `📅 Most active day: ${mostActive[0]} (${mostActive[1]} PRs)`
        );
      }

      const weekendActivity =
        (weeklyPattern.Saturday || 0) + (weeklyPattern.Sunday || 0);
      const totalActivity = Object.values(weeklyPattern).reduce(
        (sum, val) => sum + val,
        0
      );
      const weekendPercentage =
        totalActivity > 0
          ? Math.round((weekendActivity / totalActivity) * 100)
          : 0;
      insights.push(`🏖️ Weekend activity: ${weekendPercentage}% of total`);
    }

    const hourlyData = temporalData.by_hour || {};
    if (Object.keys(hourlyData).length > 0) {
      const peakHour = Object.entries(hourlyData).sort(
        ([, a], [, b]) => b - a
      )[0];
      if (peakHour) {
        insights.push(`⏰ Peak hour: ${peakHour[0]}:00 (${peakHour[1]} PRs)`);
      }
    }

    insights.forEach((insight, index) => {
      slide.addText(insight, {
        x: 1,
        y: 4.5 + index * 0.4,
        w: 8,
        h: 0.3,
        ...this.fonts.body,
      });
    });
  }

  createMLInsightsSlides(insightsData) {
    // Clustering insights slide
    this.createClusteringSlide(insightsData);

    // Recommendations slide
    this.createMLRecommendationsSlide(insightsData);
  }

  createClusteringSlide(insightsData) {
    const slide = this.pptx.addSlide();
    slide.background = { color: this.colors.background };

    // Title
    slide.addText("ML Clustering Analysis", {
      x: 0.5,
      y: 0.5,
      w: 9,
      h: 0.8,
      ...this.fonts.title,
    });

    const clusteringData = insightsData.clustering_analysis || {};
    const clusters = clusteringData.clusters || [];

    if (clusters.length > 0) {
      // Cluster distribution chart
      const chartData = [
        {
          name: "Users",
          labels: clusters.map((c) => `Cluster ${c.cluster_id}`),
          values: clusters.map((c) => c.size),
        },
      ];

      slide.addChart(this.pptx.ChartType.pie, chartData, {
        x: 0.5,
        y: 1.5,
        w: 4,
        h: 3,
        showTitle: true,
        title: "User Distribution by Cluster",
        titleFontSize: 14,
        showLegend: true,
        legendPos: "r",
      });

      // Cluster characteristics
      slide.addText("Cluster Characteristics:", {
        x: 5,
        y: 1.8,
        w: 4,
        h: 0.5,
        ...this.fonts.heading,
      });

      clusters.forEach((cluster, index) => {
        const characteristics = cluster.characteristics || {};
        const description = `Cluster ${cluster.cluster_id}: ${
          characteristics.collaboration_level || "Unknown"
        } (${cluster.size} users)`;

        slide.addText(description, {
          x: 5,
          y: 2.3 + index * 0.4,
          w: 4,
          h: 0.3,
          ...this.fonts.body,
          bullet: true,
        });
      });

      // Quality metrics
      const silhouetteScore = clusteringData.silhouette_score || 0;
      slide.addText(
        `Clustering Quality (Silhouette Score): ${silhouetteScore.toFixed(3)}`,
        {
          x: 0.5,
          y: 5.5,
          w: 9,
          h: 0.4,
          ...this.fonts.body,
          align: "center",
          italic: true,
        }
      );
    } else {
      slide.addText("No clustering data available", {
        x: 1,
        y: 3,
        w: 8,
        h: 1,
        ...this.fonts.body,
        align: "center",
      });
    }
  }

  createMLRecommendationsSlide(insightsData) {
    const slide = this.pptx.addSlide();
    slide.background = { color: this.colors.background };

    // Title
    slide.addText("ML-Generated Recommendations", {
      x: 0.5,
      y: 0.5,
      w: 9,
      h: 0.8,
      ...this.fonts.title,
    });

    const recommendations = insightsData.collaboration_recommendations || [];

    if (recommendations.length > 0) {
      recommendations.slice(0, 6).forEach((rec, index) => {
        const priorityIcon =
          rec.priority === "high"
            ? "🔴"
            : rec.priority === "medium"
            ? "🟡"
            : "🟢";
        const title = `${priorityIcon} ${rec.type
          .replace(/_/g, " ")
          .toUpperCase()}`;

        slide.addText(title, {
          x: 1,
          y: 1.5 + index * 1,
          w: 8,
          h: 0.4,
          ...this.fonts.heading,
          fontSize: 16,
        });

        slide.addText(rec.description, {
          x: 1.5,
          y: 1.9 + index * 1,
          w: 7.5,
          h: 0.4,
          ...this.fonts.body,
        });
      });
    } else {
      slide.addText("No specific recommendations generated", {
        x: 1,
        y: 3,
        w: 8,
        h: 1,
        ...this.fonts.body,
        align: "center",
      });
    }

    // ML metadata
    const metadata = insightsData.metadata || {};
    slide.addText(
      `Analysis based on ${metadata.total_users_analyzed || 0} users using ${
        metadata.ml_model_info?.clustering_algorithm || "ML"
      } algorithm`,
      {
        x: 0.5,
        y: 6.5,
        w: 9,
        h: 0.4,
        ...this.fonts.caption,
        align: "center",
        italic: true,
      }
    );
  }

  createRecommendationsSlide(reportData, insightsData) {
    const slide = this.pptx.addSlide();
    slide.background = { color: this.colors.background };

    // Title
    slide.addText("Action Items & Recommendations", {
      x: 0.5,
      y: 0.5,
      w: 9,
      h: 0.8,
      ...this.fonts.title,
    });

    const recommendations = [];

    // From report bottlenecks
    const bottlenecks = reportData.detailed_analysis?.bottlenecks || [];
    bottlenecks.forEach((bottleneck) => {
      recommendations.push({
        type: "bottleneck",
        priority: bottleneck.severity || "medium",
        description: bottleneck.description,
      });
    });

    // From ML insights
    if (insightsData?.collaboration_recommendations) {
      recommendations.push(...insightsData.collaboration_recommendations);
    }

    // General recommendations based on data
    const summary = reportData.summary || {};
    if (summary.collaboration_bottlenecks > 0) {
      recommendations.push({
        type: "process_improvement",
        priority: "high",
        description: `Address ${summary.collaboration_bottlenecks} identified collaboration bottlenecks`,
      });
    }

    if (summary.average_collaboration_score < 5) {
      recommendations.push({
        type: "team_building",
        priority: "medium",
        description:
          "Consider team-building activities to improve collaboration scores",
      });
    }

    // Display recommendations
    if (recommendations.length > 0) {
      const topRecommendations = recommendations.slice(0, 8);

      topRecommendations.forEach((rec, index) => {
        const row = Math.floor(index / 2);
        const col = index % 2;
        const x = 0.5 + col * 4.5;
        const y = 1.5 + row * 1.2;

        const priorityColor =
          rec.priority === "high"
            ? this.colors.chart[3]
            : rec.priority === "medium"
            ? this.colors.chart[2]
            : this.colors.chart[0];

        // Recommendation box
        slide.addShape(this.pptx.ShapeType.rect, {
          x: x,
          y: y,
          w: 4,
          h: 1,
          fill: { color: priorityColor, transparency: 90 },
          line: { color: priorityColor, width: 1 },
        });

        // Priority badge
        slide.addText(rec.priority.toUpperCase(), {
          x: x + 0.1,
          y: y + 0.1,
          w: 1,
          h: 0.3,
          fontSize: 10,
          bold: true,
          color: priorityColor,
        });

        // Description
        slide.addText(rec.description, {
          x: x + 0.1,
          y: y + 0.4,
          w: 3.8,
          h: 0.5,
          ...this.fonts.body,
          fontSize: 11,
        });
      });
    } else {
      slide.addText(
        "No specific recommendations at this time. Continue monitoring collaboration patterns.",
        {
          x: 1,
          y: 3,
          w: 8,
          h: 1,
          ...this.fonts.body,
          align: "center",
        }
      );
    }
  }

  createConclusionSlide(data) {
    const slide = this.pptx.addSlide();
    slide.background = { color: this.colors.background };

    // Title
    slide.addText("Conclusion & Next Steps", {
      x: 0.5,
      y: 0.5,
      w: 9,
      h: 0.8,
      ...this.fonts.title,
    });

    const summary = data.summary || {};

    // Key takeaways
    slide.addText("Key Takeaways:", {
      x: 1,
      y: 1.5,
      w: 8,
      h: 0.5,
      ...this.fonts.heading,
    });

    const takeaways = [
      `Analyzed ${summary.total_collaborators || 0} collaborators across ${
        summary.total_pull_requests || 0
      } pull requests`,
      `Generated ${
        summary.total_interactions || 0
      } collaboration interactions with ${
        summary.total_discussion_threads || 0
      } discussion threads`,
      `Average collaboration score of ${
        summary.average_collaboration_score || 0
      } indicates ${this.getCollaborationLevel(
        summary.average_collaboration_score || 0
      )} team collaboration`,
      summary.collaboration_bottlenecks > 0
        ? `Identified ${summary.collaboration_bottlenecks} areas for improvement`
        : "No major collaboration bottlenecks detected",
    ];

    takeaways.forEach((takeaway, index) => {
      slide.addText(takeaway, {
        x: 1.5,
        y: 2 + index * 0.5,
        w: 7.5,
        h: 0.4,
        ...this.fonts.body,
        bullet: true,
      });
    });

    // Next steps
    slide.addText("Next Steps:", {
      x: 1,
      y: 4.5,
      w: 8,
      h: 0.5,
      ...this.fonts.heading,
    });

    const nextSteps = [
      "Continue monitoring collaboration patterns monthly",
      "Implement recommended improvements",
      "Focus on expanding collaboration networks for isolated contributors",
      "Track progress using these metrics as baseline",
    ];

    nextSteps.forEach((step, index) => {
      slide.addText(step, {
        x: 1.5,
        y: 5 + index * 0.4,
        w: 7.5,
        h: 0.3,
        ...this.fonts.body,
        bullet: { type: "number" },
      });
    });

    // Footer
    slide.addText("Thank you for using Developer Collaboration Matrix", {
      x: 1,
      y: 6.8,
      w: 8,
      h: 0.4,
      ...this.fonts.caption,
      align: "center",
      italic: true,
    });
  }

  getCollaborationLevel(score) {
    if (score >= 15) return "excellent";
    if (score >= 10) return "good";
    if (score >= 5) return "moderate";
    return "developing";
  }

  async savePresentation(outputPath) {
    try {
      await this.pptx.writeFile({ fileName: outputPath });

      if (this.verbose) {
        console.log(`✅ PowerPoint presentation saved: ${outputPath}`);
      }

      return outputPath;
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
    theme: "corporate",
    verbose: false,
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
      case "--theme":
        config.theme = args[++i];
        break;
      case "-v":
      case "--verbose":
        config.verbose = true;
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
  console.log(`Developer Collaboration Matrix - PowerPoint Generator

USAGE:
    node main.ppt.mjs --input <report.json> --output <presentation.pptx> [options]

OPTIONS:
    -i, --input <file>        Input JSON report file (required)
    -o, --output <file>       Output PowerPoint file path (required)
    --insights <file>         ML insights JSON file (optional)
    --theme <theme>          Presentation theme: corporate, modern, dark [default: corporate]
    -v, --verbose            Enable verbose output
    -h, --help               Show this help message

EXAMPLES:
    # Basic presentation generation
    node main.ppt.mjs --input ./reports/data.json --output ./reports/presentation.pptx
    
    # Include ML insights
    node main.ppt.mjs --input ./reports/data.json --output ./reports/presentation.pptx --insights ./reports/ml_insights.json
    
    # Use modern theme
    node main.ppt.mjs --input data.json --output presentation.pptx --theme modern --verbose

THEMES:
    corporate     Professional blue theme (default)
    modern        Contemporary colors  
    dark          Dark mode theme`);
}

async function main() {
  try {
    const config = await parseArguments();

    // Validation
    if (!config.input) {
      console.error("❌ Error: Input file is required");
      console.log("Use --help for usage information");
      process.exit(1);
    }

    if (!config.output) {
      console.error("❌ Error: Output file is required");
      console.log("Use --help for usage information");
      process.exit(1);
    }

    // Initialize generator
    const generator = new CollaborationPresentationGenerator({
      theme: config.theme,
      verbose: config.verbose,
    });

    if (config.verbose) {
      console.log("🚀 Starting PowerPoint generation...");
      console.log(`📄 Input: ${config.input}`);
      console.log(`💾 Output: ${config.output}`);
      if (config.insights) {
        console.log(`🧠 Insights: ${config.insights}`);
      }
      console.log(`🎨 Theme: ${config.theme}`);
    }

    // Load data
    const { reportData, insightsData } = await generator.loadData(
      config.input,
      config.insights
    );

    // Generate presentation
    generator.generatePresentation(reportData, insightsData);

    // Save presentation
    await generator.savePresentation(config.output);

    console.log("\n📊 POWERPOINT GENERATION SUMMARY:");
    console.log(`📄 Input report: ${config.input}`);
    if (insightsData) {
      console.log(`🧠 ML insights: ${config.insights}`);
    }
    console.log(`💾 Output file: ${config.output}`);
    console.log(`🎨 Theme: ${config.theme}`);
    console.log(`📋 Slides: ${generator.pptx.slides.length}`);
    console.log("\n✅ PowerPoint presentation generated successfully!");
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    if (config?.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Execute if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { CollaborationPresentationGenerator };
