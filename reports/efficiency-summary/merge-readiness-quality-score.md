```sh
rm -rf ./reports/merge-readiness-quality-score
```

Reports

```sh
# Analyze a repository
node merge-readiness-quality-score.report.mjs --repo octocat/Hello-World --format both --output ./reports/merge-readiness-quality-score

# Analyze user activity
node merge-readiness-quality-score.report.mjs --user octocat --start 2024-01-01 --format json --output ./reports/merge-readiness-quality-score

# Generate base report
node merge-readiness-quality-score.report.mjs --repo octocat/Hello-World --format json --output ./reports/merge-readiness-quality-score

node merge-readiness-quality-score.report.mjs --debug --verbose --repo octocat/Hello-World

# Analyze user with unlimited fetch
node merge-readiness-quality-score.report.mjs --user octocat --fetchLimit infinite --verbose

# Analyze user's recent activity
node merge-readiness-quality-score.report.mjs --user gaearon --start 2024-01-01 --format csv

# Last 7 days
node merge-readiness-quality-score.report.mjs --repo octocat/Hello-World --start $(date -d '7 days ago' +%Y-%m-%d)

# Last month
node merge-readiness-quality-score.report.mjs --repo octocat/Hello-World --start $(date -d '1 month ago' +%Y-%m-%d)

# Year to date
node merge-readiness-quality-score.report.mjs --repo octocat/Hello-World --start $(date +%Y)-01-01
```

Analysis

```sh
python merge-readiness-quality-score.ml.py --input ./reports/merge-readiness-quality-score/merge-readiness-octocat-Hello-World-2025-06-12.json --output ./reports

# Run ML analysis
python merge-readiness-quality-score.ml.py --input ./reports/merge-readiness-quality-score/issue-to-pr-lag-octocat-Hello-World-2025-06-12.json --output ./reports/merge-readiness-quality-score/analysis

# Verbose output
python merge-readiness-quality-score.ml.py --input ./reports/merge-readiness-quality-score/issue-to-pr-lag-octocat-Hello-World-2025-06-12.json --output ./reports/merge-readiness-quality-score/analysis --visualize --verbose
```

PPT

```sh
node merge-readiness-quality-score.ppt.mjs --input ./reports/merge-readiness-quality-score/merge-readiness-octocat-Hello-World-2025-06-12.json --output ./reports/merge-readiness-quality-score/presentation.pptx
node merge-readiness-quality-score.ppt.mjs --input ./reports/merge-readiness-quality-score/merge-readiness-octocat-Hello-World-2025-06-12.json --output ./reports/merge-readiness-quality-score/presentation-ml.pptx --insights ./reports/merge-readiness-quality-score/ml_insights.json;
```

Excel

```sh
# Create Excel workbook
python merge-readiness-quality-score.excel.py --json ./reports/merge-readiness-quality-score/merge-readiness-octocat-Hello-World-2025-06-12.json --output ./reports/merge-readiness-quality-score/analysis.xlsx

# Include CSV data
python merge-readiness-quality-score.excel.py --json ./reports/merge-readiness-quality-score/merge-readiness-octocat-Hello-World-2025-06-12.json --csv ./reports/merge-readiness-quality-score/merge-readiness-octocat-Hello-World-2025-06-12.csv --output ./reports/merge-readiness-quality-score/analysis.xlsx
```

========================================================================================================================================
