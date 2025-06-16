```sh
rm -rf ./reports/commit-to-merge-lead-time-tracker
```

Reports

```sh
# Analyze a repository
node commit-to-merge-lead-time-tracker.report.mjs --repo octocat/Hello-World --format both --output ./reports/commit-to-merge-lead-time-tracker --start 2025-06-09

node commit-to-merge-lead-time-tracker.report.mjs --repo facebook/react --start 2025-06-05 --format json --output ./reports/commit-to-merge-lead-time-tracker

# Analyze user activity
node commit-to-merge-lead-time-tracker.report.mjs --user octocat --start 2025-06-09 --format json --output ./reports/commit-to-merge-lead-time-tracker

# Generate base report
node commit-to-merge-lead-time-tracker.report.mjs --repo octocat/Hello-World --format json --output ./reports/commit-to-merge-lead-time-tracker

node commit-to-merge-lead-time-tracker.report.mjs --debug --verbose --repo octocat/Hello-World

# Analyze user with unlimited fetch
node commit-to-merge-lead-time-tracker.report.mjs --user octocat --fetchLimit infinite --verbose

# Analyze user's recent activity
node commit-to-merge-lead-time-tracker.report.mjs --user gaearon --start 2024-01-01 --format csv

# Last 3 days
node commit-to-merge-lead-time-tracker.report.mjs --repo octocat/Hello-World --start $(date -d '3 days ago' +%Y-%m-%d)  --format json --output ./reports/commit-to-merge-lead-time-tracker

# Last 7 days
node commit-to-merge-lead-time-tracker.report.mjs --repo octocat/Hello-World --start $(date -d '7 days ago' +%Y-%m-%d)  --format json --output ./reports/commit-to-merge-lead-time-tracker

# Last month
node commit-to-merge-lead-time-tracker.report.mjs --repo octocat/Hello-World --start $(date -d '1 month ago' +%Y-%m-%d)  --format json --output ./reports/commit-to-merge-lead-time-tracker

# Year to date
node commit-to-merge-lead-time-tracker.report.mjs --repo octocat/Hello-World --start $(date +%Y)-01-01  --format json --output ./reports/commit-to-merge-lead-time-tracker
```

Analysis

```sh
# Run ML analysis
python commit-to-merge-lead-time-tracker.ml.py --input ./reports/commit-to-merge-lead-time-tracker/commit-merge-leadtime-facebook-2025-06-12.json --output ./reports/commit-to-merge-lead-time-tracker --verbose

# Verbose output
python commit-to-merge-lead-time-tracker.ml.py --input ./reports/commit-to-merge-lead-time-tracker/commit-merge-leadtime-facebook-2025-06-12.json --output ./reports/commit-to-merge-lead-time-tracker --visualize --verbose
```

PPT

```sh
node commit-to-merge-lead-time-tracker.ppt.mjs --input ./reports/commit-to-merge-lead-time-tracker/commit-merge-leadtime-facebook-2025-06-12.json --output ./reports/commit-to-merge-lead-time-tracker/presentation.pptx

node commit-to-merge-lead-time-tracker.ppt.mjs --input ./reports/commit-to-merge-lead-time-tracker/commit-merge-leadtime-facebook-2025-06-12.json --output ./reports/commit-to-merge-lead-time-tracker/presentation-ml.pptx --insights ./reports/commit-to-merge-lead-time-tracker/ml_insights.json
```

Excel

```sh
# Create interactive Excel workbook
python commit-to-merge-lead-time-tracker.excel.py --input ./reports/commit-to-merge-lead-time-tracker/commit-merge-leadtime-facebook-2025-06-12.json --output ./reports/commit-to-merge-lead-time-tracker/analysis.xlsx

# Include ML insights
python commit-to-merge-lead-time-tracker.excel.py --input ./reports/commit-to-merge-lead-time-tracker/commit-merge-leadtime-facebook-2025-06-12.json --output ./reports/commit-to-merge-lead-time-tracker/analysis-ml.xlsx --insights ./reports/commit-to-merge-lead-time-tracker/ml_insights.json
```

========================================================================================================================================
