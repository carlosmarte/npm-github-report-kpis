Reports

```sh
# Analyze a repository
node pr-lifecycle-analyzer.report.mjs --repo octocat/Hello-World --format both --output ./reports/pr-lifecycle-analyzer

# Analyze user activity
node pr-lifecycle-analyzer.report.mjs --user octocat --start 2024-01-01 --format json --output ./reports/pr-lifecycle-analyzer

# Generate base report
node pr-lifecycle-analyzer.report.mjs --repo octocat/Hello-World --format json --output ./reports/pr-lifecycle-analyzer

node pr-lifecycle-analyzer.report.mjs --debug --verbose --repo octocat/Hello-World

# Analyze user with unlimited fetch
node pr-lifecycle-analyzer.report.mjs --user octocat --fetchLimit infinite --verbose

# Analyze user's recent activity
node pr-lifecycle-analyzer.report.mjs --user gaearon --start 2024-01-01 --format csv

# Last 7 days
node pr-lifecycle-analyzer.report.mjs --repo octocat/Hello-World --start $(date -d '7 days ago' +%Y-%m-%d)

# Last month
node pr-lifecycle-analyzer.report.mjs --repo octocat/Hello-World --start $(date -d '1 month ago' +%Y-%m-%d)

# Year to date
node pr-lifecycle-analyzer.report.mjs --repo octocat/Hello-World --start $(date +%Y)-01-01
```

Analysis

```sh
# Run ML analysis
python pr-lifecycle-analyzer.ml.py --input ./reports/pr-lifecycle-analyzer/pr-lifecycle-octocat-Hello-World-2025-06-12.json --output ./reports/pr-lifecycle-analyzer/analysis --visualize

# Verbose output
python pr-lifecycle-analyzer.ml.py --input ./reports/pr-lifecycle-analyzer/pr-lifecycle-octocat-Hello-World-2025-06-12.json --output ./reports/pr-lifecycle-analyzer/analysis --visualize --verbose

# Generate PowerPoint presentation
node pr-lifecycle-analyzer.ppt.mjs ./reports/pr-lifecycle-analyzer/pr-lifecycle-\*.json ./reports/pr-lifecycle-analyzer/presentation.pptx ./reports/pr-lifecycle-analyzer/pr_ml_analysis.json

# Create Excel report
python pr-lifecycle-analyzer.excel.py --json ./reports/pr-lifecycle-analyzer/pr-lifecycle-octocat-Hello-World-2025-06-12.json --output ./reports/pr-lifecycle-analyzer/pr-lifecycle-octocat-Hello-World-2025-06-12.xlsx

```

========================================================================================================================================


# Time Series Analysis
```sh
#!/bin/bash
# Monthly analysis for a year
for month in {01..12}; do
  node main.report.mjs \
    --repo owner/repo \
    --start "2024-${month}-01" \
    --end "2024-${month}-31" \
    --name "month-${month}" \
    --format json
done
```

# Team Analysis

```sh
# Analyze team members
for user in alice bob charlie; do
  node pr-lifecycle-analyzer.report.mjs --user $user --start 2024-01-01 --output ./reports/$user
done
```

```sh
#!/bin/bash
# Analyze team members
team=("alice" "bob" "charlie" "diana")

for member in "${team[@]}"; do
  node main.report.mjs \
    --user "$member" \
    --start 2024-01-01 \
    --output "./team-analysis/$member"
done
```

```sh
#!/bin/bash
# Analyze team members
team=("alice" "bob" "charlie" "diana")

for member in "${team[@]}"; do
  node main.report.mjs \
    --user "$member" \
    --start 2024-01-01 \
    --output "./team-analysis/$member"
done
```

# Repository Comparison

```sh
# Compare multiple repositories
repos=("org/repo1" "org/repo2" "org/repo3")
for repo in "${repos[@]}"; do
  node pr-lifecycle-analyzer.report.mjs --repo $repo --format both --output ./reports/comparison
done
```

# Automated Reporting

```sh
#!/bin/bash
# Daily report generation
DATE=$(date +%Y-%m-%d)
node pr-lifecycle-analyzer.report.mjs --repo your-org/your-repo --start $DATE --end $DATE --format both
python pr-lifecycle-analyzer.ml.py --input ./reports/pr-lifecycle-*.json --visualize
```

# Programmatic Usage

```js
import { PullRequestLifecycleReporter } from "./main.report.mjs";

const analyzer = new PullRequestLifecycleReporter(process.env.GITHUB_TOKEN);

const report = await analyzer.generateReport({
  repo: "octocat/Hello-World",
  startDate: "2024-01-01",
  endDate: "2024-01-31",
  verbose: true,
});

console.log("Analysis complete:", report.summary);
```

# Custom Metrics

```js
import { PRLifecycleCalculator } from "./main.report.mjs";

// Custom metric calculation
function calculateCustomMetric(prs) {
  return prs.map((pr) => ({
    ...pr,
    CUSTOM_EFFICIENCY:
      PRLifecycleCalculator.calculateCycleTime(pr) / (pr.REVIEW_COUNT || 1),
  }));
}
```

# Advanced Analysis Workflows

## Complete Analysis Pipeline

```sh
#!/bin/bash
# complete_analysis.sh - Full analysis workflow

REPO="your-org/your-repo"
OUTPUT_DIR="./reports/$(date +%Y-%m-%d)"
REPORT_NAME="pr-analysis-$(date +%Y-%m-%d)"

# Create output directory
mkdir -p "$OUTPUT_DIR"

echo "🚀 Starting complete PR lifecycle analysis for $REPO"

# 1. Generate base report
echo "📊 Generating base report..."
node main.report.mjs \
  --repo "$REPO" \
  --format json \
  --output "$OUTPUT_DIR" \
  --name "$REPORT_NAME" \
  --start "2024-01-01" \
  --verbose

# 2. Run ML analysis
echo "🤖 Running ML analysis..."
python pr-lifecycle-analyzer.ml.py \
  --input "$OUTPUT_DIR/${REPORT_NAME}.json" \
  --output "$OUTPUT_DIR" \
  --visualize

# 3. Generate PowerPoint presentation
echo "📋 Creating presentation..."
node pr-lifecycle-analyzer.ppt.mjs \
  "$OUTPUT_DIR/${REPORT_NAME}.json" \
  "$OUTPUT_DIR/${REPORT_NAME}.pptx" \
  "$OUTPUT_DIR/pr_ml_analysis.json"

# 4. Create Excel report
echo "📈 Generating Excel report..."
python pr-lifecycle-analyzer.excel.py \
  --json "$OUTPUT_DIR/${REPORT_NAME}.json" \
  --output "$OUTPUT_DIR/${REPORT_NAME}.xlsx"

echo "✅ Analysis complete! Check $OUTPUT_DIR for all reports."
```

# Team Performance Analysis
```sh
#!/bin/bash
# team_analysis.sh - Analyze multiple team members

TEAM_MEMBERS=("alice" "bob" "charlie" "diana")
START_DATE="2024-01-01"
END_DATE="2024-03-31"
OUTPUT_BASE="./reports/team-analysis"

mkdir -p "$OUTPUT_BASE"

echo "👥 Analyzing team performance from $START_DATE to $END_DATE"

for member in "${TEAM_MEMBERS[@]}"; do
  echo "📊 Analyzing $member..."
  
  # Individual analysis
  node main.report.mjs \
    --user "$member" \
    --start "$START_DATE" \
    --end "$END_DATE" \
    --format both \
    --output "$OUTPUT_BASE/$member" \
    --name "pr-analysis-$member"
  
  # Quick ML insights
  python pr-lifecycle-analyzer.ml.py \
    --input "$OUTPUT_BASE/$member/pr-analysis-$member.json" \
    --output "$OUTPUT_BASE/$member"
done

echo "✅ Team analysis complete!"
```

# Repository Comparison
```sh
#!/bin/bash
# repo_comparison.sh - Compare multiple repositories

REPOSITORIES=(
  "facebook/react"
  "vuejs/vue"
  "angular/angular"
  "sveltejs/svelte"
)

COMPARISON_DIR="./reports/framework-comparison"
mkdir -p "$COMPARISON_DIR"

echo "🔍 Comparing JavaScript frameworks..."

for repo in "${repositories[@]}"; do
  repo_name=$(echo "$repo" | tr '/' '-')
  echo "📊 Analyzing $repo..."
  
  node main.report.mjs \
    --repo "$repo" \
    --start "2024-01-01" \
    --end "2024-03-31" \
    --format json \
    --output "$COMPARISON_DIR" \
    --name "$repo_name" \
    --fetchLimit 100
done

echo "✅ Repository comparison data collected!"
```

# Release Cycle Analysis
```sh
# Analyze PRs around a specific release
node main.report.mjs \
  --repo kubernetes/kubernetes \
  --start 2024-02-01 \
  --end 2024-02-28 \
  --format both \
  --name "release-v1.30-analysis" \
  --verbose
```

#  Onboarding Impact Assessment
```sh
# Analyze new team member's first month
node main.report.mjs \
  --user new-developer \
  --start 2024-01-15 \
  --end 2024-02-15 \
  --format both \
  --name "onboarding-impact"
```

# Process Improvement Tracking
```sh
# Before process change
node main.report.mjs \
  --repo company/product \
  --start 2023-11-01 \
  --end 2023-12-31 \
  --name "before-process-change"

# After process change
node main.report.mjs \
  --repo company/product \
  --start 2024-01-01 \
  --end 2024-02-28 \
  --name "after-process-change"
```

# GitHub Actions Workflow
```yaml
# .github/workflows/pr-analysis.yml
name: PR Lifecycle Analysis

on:
  schedule:
    - cron: '0 9 * * 1'  # Weekly on Monday at 9 AM
  workflow_dispatch:

jobs:
  analyze:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
    
    - name: Setup Python
      uses: actions/setup-python@v4
      with:
        python-version: '3.9'
    
    - name: Install dependencies
      run: |
        npm install
        pip install -r requirements.txt
    
    - name: Run PR Analysis
      env:
        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      run: |
        # Last 30 days
        node main.report.mjs \
          --repo ${{ github.repository }} \
          --start $(date -d '30 days ago' +%Y-%m-%d) \
          --format both \
          --output ./reports
        
        # Generate ML insights
        python pr-lifecycle-analyzer.ml.py \
          --input ./reports/pr-lifecycle-*.json \
          --output ./reports \
          --visualize
    
    - name: Upload Reports
      uses: actions/upload-artifact@v3
      with:
        name: pr-analysis-reports
        path: ./reports/
```

# Docker Usage
```md
# Dockerfile
FROM node:18-alpine

WORKDIR /app

# Install Python
RUN apk add --no-cache python3 py3-pip

# Copy files
COPY package.json requirements.txt ./
COPY *.mjs *.py ./

# Install dependencies
RUN npm install && pip3 install -r requirements.txt

# Set entrypoint
ENTRYPOINT ["node", "main.report.mjs"]

# Build and run
docker build -t pr-analyzer .

# Analyze repository
docker run --rm \
  -e GITHUB_TOKEN="$GITHUB_TOKEN" \
  -v $(pwd)/reports:/app/reports \
  pr-analyzer --repo octocat/Hello-World --format both
```

# Node.js Integration
```js
// analysis-service.js
import { PullRequestLifecycleReporter } from './main.report.mjs';

class AnalysisService {
  constructor(githubToken) {
    this.analyzer = new PullRequestLifecycleReporter(githubToken);
  }

  async analyzeRepository(repo, options = {}) {
    try {
      const report = await this.analyzer.generateReport({
        repo,
        startDate: options.startDate || this.getDefaultStartDate(),
        endDate: options.endDate || new Date().toISOString().split('T')[0],
        verbose: options.verbose || false
      });

      return {
        success: true,
        data: report,
        metrics: this.extractKeyMetrics(report)
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  extractKeyMetrics(report) {
    return {
      totalPRs: report.summary.TOTAL_PULL_REQUESTS,
      mergeRate: report.summary.MERGE_SUCCESS_RATE_PERCENT,
      avgCycleTime: report.summary.AVERAGE_CYCLE_TIME_HOURS,
      bottlenecks: report.summary.IDENTIFIED_BOTTLENECKS
    };
  }

  getDefaultStartDate() {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return date.toISOString().split('T')[0];
  }
}

// Usage
const service = new AnalysisService(process.env.GITHUB_TOKEN);
const result = await service.analyzeRepository('octocat/Hello-World');
console.log(result);
```

# Memory-Efficient Processing
```sh
# Process in smaller chunks for memory efficiency
for month in {01..12}; do
  node main.report.mjs \
    --repo memory-intensive/repo \
    --start "2024-${month}-01" \
    --end "2024-${month}-31" \
    --fetchLimit 25 \
    --output "./reports/monthly" \
    --name "month-${month}"
done
```

# Regular Monitoring
```sh
# Weekly team health check
#!/bin/bash
# team_health_check.sh

WEEK_START=$(date -d 'last monday' +%Y-%m-%d)
WEEK_END=$(date -d 'last sunday' +%Y-%m-%d)

node main.report.mjs \
  --repo team/main-repo \
  --start "$WEEK_START" \
  --end "$WEEK_END" \
  --format both \
  --output "./reports/weekly" \
  --name "week-$(date +%U)"

# Send alert if bottlenecks detected
python check_bottlenecks.py "./reports/weekly/week-$(date +%U).json"
```

# Baseline Establishment
```sh
# Establish baseline metrics
node main.report.mjs \
  --repo company/product \
  --start 2023-10-01 \
  --end 2023-12-31 \
  --format json \
  --name "baseline-q4-2023"
```

# Continuous Improvement Tracking
```
# Before/after analysis for process changes
# Before
node main.report.mjs \
  --repo team/repo \
  --start 2024-01-01 \
  --end 2024-01-31 \
  --name "before-new-process"

# After (wait for process implementation)
node main.report.mjs \
  --repo team/repo \
  --start 2024-03-01 \
  --end 2024-03-31 \
  --name "after-new-process"

# Compare results
python compare_reports.py \
  before-new-process.json \
  after-new-process.json
```

# Regular Backups
tar -czf reports-$(date +%Y-%m).tar.gz ./reports/