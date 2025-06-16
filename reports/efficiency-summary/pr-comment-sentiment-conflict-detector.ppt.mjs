import PptxGenJS from "pptxgenjs";
import { promises as fs } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * PR Comment Sentiment & Conflict Detector - PowerPoint Generator
 *
 * Generates comprehensive PowerPoint presentations from PR analysis data
 * and ML insights with charts, visualizations, and formatted content.
 */

class PRPresentationGenerator {
  constructor() {
    this.pptx = new PptxGenJS();
    this.setupPresentationDefaults();
  }

  setupPresentationDefaults() {
    // Set presentation properties
    this.pptx.author = "PR Comment Sentiment & Conflict Detector";
    this.pptx.company = "GitHub Analytics";
    this.pptx.subject = "Pull Request Analysis Report";
    this.pptx.title = "PR Sentiment & Conflict Analysis";

    // Define common styles
    this.styles = {
      titleFont: { size: 28, bold: true, color: "363636" },
      headerFont: { size: 20, bold: true, color: "2F4F4F" },
      bodyFont: { size: 14, color: "444444" },
      emphasisFont: { size: 16, bold: true, color: "1F4E79" },
      errorColor: "C5504B",
      successColor: "70AD47",
      warningColor: "E7A116",
    };

    // Define layouts
    this.layouts = {
      titleSlide: "LAYOUT_16x9",
      contentSlide: "LAYOUT_16x9",
    };
  }

  async generatePresentation(data, mlInsights = null, outputPath) {
    console.log("🎨 Generating PowerPoint presentation...");

    try {
      // 1. Title Slide
      this.createTitleSlide(data);

      // 2. Executive Summary
      this.createExecutiveSummary(data);

      // 3. Analysis Overview
      this.createAnalysisOverview(data);

      // 4. Sentiment Analysis
      this.createSentimentSlides(data);

      // 5. Conflict Detection
      this.createConflictSlides(data);

      // 6. Contributor Analysis
      this.createContributorSlides(data);

      // 7. Trends Analysis
      this.createTrendsSlides(data);

      // 8. ML Insights (if available)
      if (mlInsights) {
        this.createMLInsightsSlides(mlInsights);
      }

      // 9. Recommendations
      this.createRecommendationsSlide(data, mlInsights);

      // 10. Appendix
      this.createAppendixSlides(data);

      // Save presentation
      await this.pptx.writeFile({ fileName: outputPath });
      console.log(`✅ PowerPoint presentation saved to: ${outputPath}`);

      return outputPath;
    } catch (error) {
      console.error(`❌ Error generating presentation: ${error.message}`);
      throw error;
    }
  }

  createTitleSlide(data) {
    const slide = this.pptx.addSlide();
    const metadata = data.metadata || {};
    const dateRange = data.date_range || {};

    // Title
    slide.addText("PR Comment Sentiment & Conflict Detection", {
      x: 0.5,
      y: 1.0,
      w: 9,
      h: 1.2,
      ...this.styles.titleFont,
      align: "center",
    });

    // Subtitle
    const target = metadata.target || "Analysis Target";
    slide.addText(`Analysis Report: ${target}`, {
      x: 0.5,
      y: 2.5,
      w: 9,
      h: 0.8,
      ...this.styles.headerFont,
      align: "center",
    });

    // Date range
    const dateText = `Analysis Period: ${dateRange.start_date || "N/A"} to ${
      dateRange.end_date || "N/A"
    }`;
    slide.addText(dateText, {
      x: 0.5,
      y: 3.5,
      w: 9,
      h: 0.6,
      ...this.styles.bodyFont,
      align: "center",
    });

    // Generated timestamp
    const generated = new Date(
      metadata.generated_at || Date.now()
    ).toLocaleString();
    slide.addText(`Generated: ${generated}`, {
      x: 0.5,
      y: 5.5,
      w: 9,
      h: 0.5,
      size: 12,
      color: "666666",
      align: "center",
    });

    // Add decorative background shape
    slide.addShape("rect", {
      x: 0,
      y: 0,
      w: 10,
      h: 7.5,
      fill: { type: "solid", color: "F8F9FA" },
      line: { width: 0 },
    });
  }

  createExecutiveSummary(data) {
    const slide = this.pptx.addSlide();
    const summary = data.summary || {};

    // Title
    slide.addText("Executive Summary", {
      x: 0.5,
      y: 0.3,
      w: 9,
      h: 0.8,
      ...this.styles.headerFont,
    });

    // Key metrics in boxes
    const metrics = [
      {
        label: "Total PRs",
        value: summary.total_prs || 0,
        icon: "📋",
        color: "4472C4",
      },
      {
        label: "Merge Rate",
        value: `${summary.merge_rate || 0}%`,
        icon: "✅",
        color: this.styles.successColor,
      },
      {
        label: "Conflict Rate",
        value: `${summary.conflict_rate || 0}%`,
        icon: "⚠️",
        color: this.styles.warningColor,
      },
      {
        label: "Total Conflicts",
        value: summary.total_conflicts_detected || 0,
        icon: "🔥",
        color: this.styles.errorColor,
      },
    ];

    // Create metric boxes
    metrics.forEach((metric, index) => {
      const x = 0.5 + index * 2.25;

      // Background box
      slide.addShape("rect", {
        x: x,
        y: 1.5,
        w: 2,
        h: 1.5,
        fill: { type: "solid", color: metric.color },
        line: { width: 1, color: "FFFFFF" },
        shadow: { type: "outer", blur: 3, offset: 2, angle: 45 },
      });

      // Icon and value
      slide.addText(`${metric.icon}\n${metric.value}`, {
        x: x,
        y: 1.7,
        w: 2,
        h: 0.7,
        fontSize: 18,
        bold: true,
        color: "FFFFFF",
        align: "center",
      });

      // Label
      slide.addText(metric.label, {
        x: x,
        y: 2.6,
        w: 2,
        h: 0.4,
        fontSize: 12,
        color: "FFFFFF",
        align: "center",
      });
    });

    // Key findings
    slide.addText("Key Findings", {
      x: 0.5,
      y: 3.5,
      w: 9,
      h: 0.5,
      ...this.styles.emphasisFont,
    });

    const sentimentData = data.sentiment_analysis || {};
    const findings = [
      `• Overall sentiment: ${
        sentimentData.overall_sentiment_label || "neutral"
      } (${sentimentData.overall_sentiment_score || 0})`,
      `• Average comments per PR: ${summary.average_comments_per_pr || 0}`,
      `• High severity conflicts: ${summary.high_severity_conflicts || 0}`,
      `• Total contributors analyzed: ${
        data.contributor_metrics?.total_contributors || 0
      }`,
    ];

    slide.addText(findings.join("\n"), {
      x: 0.5,
      y: 4.2,
      w: 9,
      h: 2,
      ...this.styles.bodyFont,
      bullet: false,
    });
  }

  createAnalysisOverview(data) {
    const slide = this.pptx.addSlide();

    slide.addText("Analysis Overview", {
      x: 0.5,
      y: 0.3,
      w: 9,
      h: 0.8,
      ...this.styles.headerFont,
    });

    // Analysis scope
    const metadata = data.metadata || {};
    const dateRange = data.date_range || {};

    const scopeText = [
      `Target: ${metadata.target || "N/A"}`,
      `Repository: ${metadata.repository || "Multiple/User-based"}`,
      `Analysis Period: ${dateRange.duration_days || 0} days`,
      `Data Collection: ${
        metadata.generated_at
          ? new Date(metadata.generated_at).toLocaleDateString()
          : "N/A"
      }`,
    ];

    slide.addText("Analysis Scope", {
      x: 0.5,
      y: 1.2,
      w: 4,
      h: 0.5,
      ...this.styles.emphasisFont,
    });

    slide.addText(scopeText.join("\n"), {
      x: 0.5,
      y: 1.8,
      w: 4,
      h: 2,
      ...this.styles.bodyFont,
    });

    // Methodology
    slide.addText("Methodology", {
      x: 5.5,
      y: 1.2,
      w: 4,
      h: 0.5,
      ...this.styles.emphasisFont,
    });

    const methodologyText = [
      "• Comment sentiment analysis using NLP",
      "• Conflict detection via pattern matching",
      "• Interaction graph construction",
      "• Statistical trend analysis",
      "• Machine learning insights (if available)",
    ];

    slide.addText(methodologyText.join("\n"), {
      x: 5.5,
      y: 1.8,
      w: 4,
      h: 2,
      ...this.styles.bodyFont,
    });

    // Data summary chart
    this.createDataSummaryChart(slide, data);
  }

  createSentimentSlides(data) {
    const sentimentData = data.sentiment_analysis || {};

    // Slide 1: Sentiment Overview
    const slide1 = this.pptx.addSlide();

    slide1.addText("Sentiment Analysis Overview", {
      x: 0.5,
      y: 0.3,
      w: 9,
      h: 0.8,
      ...this.styles.headerFont,
    });

    // Overall sentiment display
    const overallScore = sentimentData.overall_sentiment_score || 0;
    const overallLabel = sentimentData.overall_sentiment_label || "neutral";

    const sentimentColor =
      overallScore > 0.05
        ? this.styles.successColor
        : overallScore < -0.05
        ? this.styles.errorColor
        : "FFA500";

    slide1.addShape("rect", {
      x: 1,
      y: 1.5,
      w: 3,
      h: 2,
      fill: { type: "solid", color: sentimentColor },
      line: { width: 2, color: "FFFFFF" },
    });

    slide1.addText(
      `${overallLabel.toUpperCase()}\n${overallScore.toFixed(3)}`,
      {
        x: 1,
        y: 2,
        w: 3,
        h: 1,
        fontSize: 20,
        bold: true,
        color: "FFFFFF",
        align: "center",
      }
    );

    // Sentiment distribution pie chart
    this.createSentimentDistributionChart(slide1, sentimentData);

    // Slide 2: Sentiment Trends (if data available)
    if (sentimentData.pr_sentiments && sentimentData.pr_sentiments.length > 0) {
      this.createSentimentTrendsSlide(sentimentData);
    }
  }

  createConflictSlides(data) {
    const conflictData = data.conflict_detection || {};

    const slide = this.pptx.addSlide();

    slide.addText("Conflict Detection Analysis", {
      x: 0.5,
      y: 0.3,
      w: 9,
      h: 0.8,
      ...this.styles.headerFont,
    });

    // Conflict statistics
    const totalConflicts = conflictData.total_conflicts || 0;
    const severityDist = conflictData.severity_distribution || {};

    slide.addText("Conflict Statistics", {
      x: 0.5,
      y: 1.2,
      w: 4,
      h: 0.5,
      ...this.styles.emphasisFont,
    });

    const conflictStats = [
      `Total Conflicts Detected: ${totalConflicts}`,
      `High Severity: ${severityDist.high || 0}`,
      `Medium Severity: ${severityDist.medium || 0}`,
      `Low Severity: ${severityDist.low || 0}`,
    ];

    slide.addText(conflictStats.join("\n"), {
      x: 0.5,
      y: 1.8,
      w: 4,
      h: 2,
      ...this.styles.bodyFont,
    });

    // Conflict severity chart
    this.createConflictSeverityChart(slide, severityDist);

    // Most conflict-prone PRs
    const conflictPronePRs = conflictData.most_conflict_prone_prs || [];
    if (conflictPronePRs.length > 0) {
      slide.addText("Most Conflict-Prone PRs", {
        x: 0.5,
        y: 4.2,
        w: 9,
        h: 0.5,
        ...this.styles.emphasisFont,
      });

      const prList = conflictPronePRs
        .slice(0, 5)
        .map(
          (pr) =>
            `• PR #${pr.pr_id}: ${
              pr.title?.substring(0, 50) || "No title"
            }... (${pr.conflict_count} conflicts)`
        );

      slide.addText(prList.join("\n"), {
        x: 0.5,
        y: 4.8,
        w: 9,
        h: 1.5,
        ...this.styles.bodyFont,
      });
    }
  }

  createContributorSlides(data) {
    const contributorData = data.contributor_metrics || {};
    const contributors = contributorData.contributors || [];

    const slide = this.pptx.addSlide();

    slide.addText("Contributor Analysis", {
      x: 0.5,
      y: 0.3,
      w: 9,
      h: 0.8,
      ...this.styles.headerFont,
    });

    // Top contributors
    slide.addText("Top Contributors by Activity", {
      x: 0.5,
      y: 1.2,
      w: 4.5,
      h: 0.5,
      ...this.styles.emphasisFont,
    });

    if (contributors.length > 0) {
      const topContributors = contributors.slice(0, 5);
      const contributorList = topContributors.map(
        (contributor, index) =>
          `${index + 1}. ${contributor.username} (${
            contributor.prs_authored +
            contributor.reviews_given +
            contributor.comments_made
          } activities)`
      );

      slide.addText(contributorList.join("\n"), {
        x: 0.5,
        y: 1.8,
        w: 4.5,
        h: 2,
        ...this.styles.bodyFont,
      });

      // Contributor activity chart
      this.createContributorActivityChart(slide, topContributors);
    }

    // Contributor statistics
    slide.addText("Contributor Metrics", {
      x: 0.5,
      y: 4.2,
      w: 9,
      h: 0.5,
      ...this.styles.emphasisFont,
    });

    const stats = [
      `Total Contributors: ${contributorData.total_contributors || 0}`,
      `Average PRs per Contributor: ${
        contributors.length > 0
          ? (
              contributors.reduce((sum, c) => sum + c.prs_authored, 0) /
              contributors.length
            ).toFixed(1)
          : 0
      }`,
      `Average Reviews per Contributor: ${
        contributors.length > 0
          ? (
              contributors.reduce((sum, c) => sum + c.reviews_given, 0) /
              contributors.length
            ).toFixed(1)
          : 0
      }`,
    ];

    slide.addText(stats.join("\n"), {
      x: 0.5,
      y: 4.8,
      w: 9,
      h: 1,
      ...this.styles.bodyFont,
    });
  }

  createTrendsSlides(data) {
    const trendsData = data.trends || {};

    const slide = this.pptx.addSlide();

    slide.addText("Trends Analysis", {
      x: 0.5,
      y: 0.3,
      w: 9,
      h: 0.8,
      ...this.styles.headerFont,
    });

    // Weekly trends
    const weeklyTrends = trendsData.weekly_trends || [];
    if (weeklyTrends.length > 0) {
      slide.addText("Weekly Activity Trends", {
        x: 0.5,
        y: 1.2,
        w: 4.5,
        h: 0.5,
        ...this.styles.emphasisFont,
      });

      this.createWeeklyTrendsChart(slide, weeklyTrends);
    }

    // Monthly trends
    const monthlyTrends = trendsData.monthly_trends || [];
    if (monthlyTrends.length > 0) {
      slide.addText("Monthly Patterns", {
        x: 5.5,
        y: 1.2,
        w: 4,
        h: 0.5,
        ...this.styles.emphasisFont,
      });

      // Create simple trend summary
      const avgPRsPerMonth =
        monthlyTrends.reduce((sum, month) => sum + month.pr_count, 0) /
        monthlyTrends.length;
      const trendSummary = [
        `Average PRs per month: ${avgPRsPerMonth.toFixed(1)}`,
        `Peak month: ${
          monthlyTrends.reduce(
            (max, month) => (month.pr_count > max.pr_count ? month : max),
            monthlyTrends[0]
          )?.month || "N/A"
        }`,
        `Total months analyzed: ${monthlyTrends.length}`,
      ];

      slide.addText(trendSummary.join("\n"), {
        x: 5.5,
        y: 1.8,
        w: 4,
        h: 1.5,
        ...this.styles.bodyFont,
      });
    }
  }

  createMLInsightsSlides(mlInsights) {
    const insights = mlInsights.insights || {};

    const slide = this.pptx.addSlide();

    slide.addText("Machine Learning Insights", {
      x: 0.5,
      y: 0.3,
      w: 9,
      h: 0.8,
      ...this.styles.headerFont,
    });

    // ML Summary
    const summary = insights.summary || {};
    slide.addText("ML Analysis Summary", {
      x: 0.5,
      y: 1.2,
      w: 4.5,
      h: 0.5,
      ...this.styles.emphasisFont,
    });

    const summaryStats = [
      `PRs Analyzed: ${summary.total_prs_analyzed || 0}`,
      `Conflict Prediction Accuracy: ${
        mlInsights.conflict_prediction?.accuracy
          ? (mlInsights.conflict_prediction.accuracy * 100).toFixed(1) + "%"
          : "N/A"
      }`,
      `Average Risk Score: ${
        summary.avg_risk_score ? summary.avg_risk_score.toFixed(3) : "N/A"
      }`,
    ];

    slide.addText(summaryStats.join("\n"), {
      x: 0.5,
      y: 1.8,
      w: 4.5,
      h: 1.5,
      ...this.styles.bodyFont,
    });

    // Collaboration patterns
    const collabInsights = insights.collaboration_insights || {};
    if (collabInsights.most_efficient_pattern) {
      slide.addText("Most Efficient Collaboration Pattern", {
        x: 5.5,
        y: 1.2,
        w: 4,
        h: 0.5,
        ...this.styles.emphasisFont,
      });

      const efficient = collabInsights.most_efficient_pattern;
      slide.addText(
        `Pattern: ${efficient.name}\nMerge Rate: ${(
          efficient.characteristics?.merge_rate * 100 || 0
        ).toFixed(1)}%\nConflict Rate: ${(
          efficient.characteristics?.conflict_rate * 100 || 0
        ).toFixed(1)}%`,
        {
          x: 5.5,
          y: 1.8,
          w: 4,
          h: 1.5,
          ...this.styles.bodyFont,
        }
      );
    }

    // Risk insights
    const riskInsights = insights.risk_insights || {};
    if (Object.keys(riskInsights).length > 0) {
      slide.addText("Risk Assessment", {
        x: 0.5,
        y: 3.5,
        w: 9,
        h: 0.5,
        ...this.styles.emphasisFont,
      });

      const riskStats = [
        `High Risk PRs: ${riskInsights.high_risk_prs || 0}`,
        `Medium Risk PRs: ${riskInsights.medium_risk_prs || 0}`,
        `Low Risk PRs: ${riskInsights.low_risk_prs || 0}`,
      ];

      slide.addText(riskStats.join("\n"), {
        x: 0.5,
        y: 4.1,
        w: 9,
        h: 1,
        ...this.styles.bodyFont,
      });
    }
  }

  createRecommendationsSlide(data, mlInsights) {
    const slide = this.pptx.addSlide();

    slide.addText("Recommendations", {
      x: 0.5,
      y: 0.3,
      w: 9,
      h: 0.8,
      ...this.styles.headerFont,
    });

    // Generate recommendations based on data
    const recommendations = this.generateRecommendations(data, mlInsights);

    recommendations.forEach((rec, index) => {
      const y = 1.5 + index * 1.2;
      const priorityColor =
        rec.priority === "High"
          ? this.styles.errorColor
          : rec.priority === "Medium"
          ? this.styles.warningColor
          : this.styles.successColor;

      // Priority indicator
      slide.addShape("rect", {
        x: 0.5,
        y: y,
        w: 0.3,
        h: 0.3,
        fill: { type: "solid", color: priorityColor },
        line: { width: 0 },
      });

      // Recommendation text
      slide.addText(`${rec.title}`, {
        x: 1,
        y: y,
        w: 8.5,
        h: 0.4,
        ...this.styles.emphasisFont,
      });

      slide.addText(rec.description, {
        x: 1,
        y: y + 0.4,
        w: 8.5,
        h: 0.6,
        ...this.styles.bodyFont,
      });
    });
  }

  createAppendixSlides(data) {
    const slide = this.pptx.addSlide();

    slide.addText("Appendix: Technical Details", {
      x: 0.5,
      y: 0.3,
      w: 9,
      h: 0.8,
      ...this.styles.headerFont,
    });

    // Formulas used
    slide.addText("Key Formulas", {
      x: 0.5,
      y: 1.2,
      w: 4.5,
      h: 0.5,
      ...this.styles.emphasisFont,
    });

    const formulas = data.formulas || {};
    const formulaList = Object.entries(formulas)
      .slice(0, 6)
      .map(([name, formula]) => `• ${name.replace(/_/g, " ")}: ${formula}`);

    slide.addText(formulaList.join("\n"), {
      x: 0.5,
      y: 1.8,
      w: 4.5,
      h: 3,
      fontSize: 10,
      color: "444444",
    });

    // Data quality metrics
    slide.addText("Data Quality", {
      x: 5.5,
      y: 1.2,
      w: 4,
      h: 0.5,
      ...this.styles.emphasisFont,
    });

    const summary = data.summary || {};
    const qualityMetrics = [
      `Total Data Points: ${summary.total_prs || 0} PRs`,
      `Comment Coverage: ${summary.total_comments || 0} comments`,
      `Review Coverage: ${summary.total_reviews || 0} reviews`,
      `Analysis Completeness: High`,
    ];

    slide.addText(qualityMetrics.join("\n"), {
      x: 5.5,
      y: 1.8,
      w: 4,
      h: 2,
      ...this.styles.bodyFont,
    });
  }

  // Chart creation methods
  createDataSummaryChart(slide, data) {
    const summary = data.summary || {};

    const chartData = [
      {
        name: "PR Metrics",
        labels: ["Total PRs", "Merged", "Closed", "Open"],
        values: [
          summary.total_prs || 0,
          summary.merged_prs || 0,
          summary.closed_prs || 0,
          summary.open_prs || 0,
        ],
      },
    ];

    slide.addChart("bar", chartData, {
      x: 0.5,
      y: 4.2,
      w: 9,
      h: 2.5,
      title: "PR Distribution",
      titleFontSize: 14,
    });
  }

  createSentimentDistributionChart(slide, sentimentData) {
    const distribution = sentimentData.sentiment_distribution || {};

    const chartData = [
      {
        name: "Sentiment Distribution",
        labels: ["Positive", "Neutral", "Negative"],
        values: [
          distribution.positive || 0,
          distribution.neutral || 0,
          distribution.negative || 0,
        ],
      },
    ];

    slide.addChart("pie", chartData, {
      x: 5,
      y: 1.5,
      w: 4.5,
      h: 3,
      title: "Sentiment Distribution",
      titleFontSize: 14,
    });
  }

  createConflictSeverityChart(slide, severityDist) {
    const chartData = [
      {
        name: "Conflict Severity",
        labels: ["High", "Medium", "Low"],
        values: [
          severityDist.high || 0,
          severityDist.medium || 0,
          severityDist.low || 0,
        ],
      },
    ];

    slide.addChart("bar", chartData, {
      x: 5.5,
      y: 1.5,
      w: 4,
      h: 2.5,
      title: "Conflict Severity Distribution",
      titleFontSize: 14,
    });
  }

  createContributorActivityChart(slide, contributors) {
    const chartData = [
      {
        name: "Contributor Activity",
        labels: contributors.map((c) => c.username),
        values: contributors.map(
          (c) => c.prs_authored + c.reviews_given + c.comments_made
        ),
      },
    ];

    slide.addChart("bar", chartData, {
      x: 5.5,
      y: 1.8,
      w: 4,
      h: 2.5,
      title: "Top Contributors",
      titleFontSize: 12,
    });
  }

  createWeeklyTrendsChart(slide, weeklyTrends) {
    const chartData = [
      {
        name: "Weekly PR Count",
        labels: weeklyTrends.map((w) => w.week),
        values: weeklyTrends.map((w) => w.pr_count),
      },
    ];

    slide.addChart("line", chartData, {
      x: 0.5,
      y: 1.8,
      w: 4.5,
      h: 2.5,
      title: "Weekly Activity",
      titleFontSize: 12,
    });
  }

  createSentimentTrendsSlide(sentimentData) {
    const slide = this.pptx.addSlide();

    slide.addText("Sentiment Trends Over Time", {
      x: 0.5,
      y: 0.3,
      w: 9,
      h: 0.8,
      ...this.styles.headerFont,
    });

    const prSentiments = sentimentData.pr_sentiments || [];

    if (prSentiments.length > 0) {
      // Group by date for trending
      const sentimentByDate = {};
      prSentiments.forEach((pr) => {
        const date = new Date(pr.created_at).toDateString();
        if (!sentimentByDate[date]) {
          sentimentByDate[date] = [];
        }
        sentimentByDate[date].push(pr.sentiment_score);
      });

      const dates = Object.keys(sentimentByDate).sort();
      const avgSentiments = dates.map(
        (date) =>
          sentimentByDate[date].reduce((sum, score) => sum + score, 0) /
          sentimentByDate[date].length
      );

      const chartData = [
        {
          name: "Average Daily Sentiment",
          labels: dates.map((date) => new Date(date).toLocaleDateString()),
          values: avgSentiments,
        },
      ];

      slide.addChart("line", chartData, {
        x: 1,
        y: 1.5,
        w: 8,
        h: 4,
        title: "Sentiment Trends",
        titleFontSize: 14,
      });
    }
  }

  generateRecommendations(data, mlInsights) {
    const recommendations = [];
    const summary = data.summary || {};
    const conflictData = data.conflict_detection || {};
    const sentimentData = data.sentiment_analysis || {};

    // High conflict rate
    if (parseFloat(summary.conflict_rate || 0) > 20) {
      recommendations.push({
        priority: "High",
        title: "Reduce Conflict Rate",
        description:
          "Implement conflict resolution training and establish clear review guidelines to reduce conflicts.",
      });
    }

    // Low merge rate
    if (parseFloat(summary.merge_rate || 0) < 70) {
      recommendations.push({
        priority: "Medium",
        title: "Improve Merge Success Rate",
        description:
          "Review PR approval processes and provide better guidance to increase successful merges.",
      });
    }

    // Negative sentiment
    if (sentimentData.overall_sentiment_score < -0.1) {
      recommendations.push({
        priority: "High",
        title: "Address Team Communication",
        description:
          "Focus on positive communication patterns and constructive feedback in code reviews.",
      });
    }

    // High severity conflicts
    if (conflictData.severity_distribution?.high > 5) {
      recommendations.push({
        priority: "High",
        title: "Priority Conflict Resolution",
        description:
          "Address high-severity conflicts immediately and establish escalation procedures.",
      });
    }

    // Low activity
    if ((summary.average_comments_per_pr || 0) < 2) {
      recommendations.push({
        priority: "Low",
        title: "Increase Review Engagement",
        description:
          "Encourage more thorough code reviews and active participation in discussions.",
      });
    }

    return recommendations.slice(0, 4); // Limit to 4 recommendations for the slide
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
      default:
        console.warn(`Unknown argument: ${arg}`);
    }
  }

  return config;
}

function showHelp() {
  console.log(`
PR Comment Sentiment & Conflict Detector - PowerPoint Generator

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
      throw new Error("Both --input and --output are required");
    }

    // Load main data
    console.log(`📊 Loading data from ${config.input}`);
    const data = JSON.parse(await fs.readFile(config.input, "utf-8"));

    // Load ML insights if provided
    let mlInsights = null;
    if (config.insights) {
      console.log(`🤖 Loading ML insights from ${config.insights}`);
      mlInsights = JSON.parse(await fs.readFile(config.insights, "utf-8"));
    }

    // Generate presentation
    const generator = new PRPresentationGenerator();
    await generator.generatePresentation(data, mlInsights, config.output);

    // Summary
    console.log(`\n🎨 PowerPoint Presentation Generated:`);
    console.log(`   📄 File: ${config.output}`);
    console.log(
      `   📋 Slides: Title, Summary, Analysis, Sentiment, Conflicts, Contributors, Trends`
    );
    if (mlInsights) {
      console.log(`   🤖 ML Insights: Included`);
    }
    console.log(`   📊 Charts: Multiple interactive charts and visualizations`);
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    if (error.stack && process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Execute if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { PRPresentationGenerator };
