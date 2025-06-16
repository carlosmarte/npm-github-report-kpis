```sh
rm -rf ./reports/abandoned_stale_pr_audit
```

Reports

```sh
# Analyze a repository
node abandoned_stale_pr_audit.report.mjs --repo octocat/Hello-World --format both --output ./reports/abandoned_stale_pr_audit --start 2025-06-09

node abandoned_stale_pr_audit.report.mjs --repo facebook/react --start 2025-06-05 --format json --output ./reports/abandoned_stale_pr_audit

# Analyze user activity
node abandoned_stale_pr_audit.report.mjs --user octocat --start 2025-06-09 --format json --output ./reports/abandoned_stale_pr_audit

# Generate base report
node abandoned_stale_pr_audit.report.mjs --repo octocat/Hello-World --format json --output ./reports/abandoned_stale_pr_audit

node abandoned_stale_pr_audit.report.mjs --debug --verbose --repo octocat/Hello-World

# Analyze user with unlimited fetch
node abandoned_stale_pr_audit.report.mjs --user octocat --fetchLimit infinite --verbose

# Analyze user's recent activity
node abandoned_stale_pr_audit.report.mjs --user gaearon --start 2024-01-01 --format csv

# Last 3 days
node abandoned_stale_pr_audit.report.mjs --repo octocat/Hello-World --start $(date -d '3 days ago' +%Y-%m-%d)  --format json --output ./reports/abandoned_stale_pr_audit

# Last 7 days
node abandoned_stale_pr_audit.report.mjs --repo octocat/Hello-World --start $(date -d '7 days ago' +%Y-%m-%d)  --format json --output ./reports/abandoned_stale_pr_audit

# Last month
node abandoned_stale_pr_audit.report.mjs --repo octocat/Hello-World --start $(date -d '1 month ago' +%Y-%m-%d)  --format json --output ./reports/abandoned_stale_pr_audit

# Year to date
node abandoned_stale_pr_audit.report.mjs --repo octocat/Hello-World --start $(date +%Y)-01-01  --format json --output ./reports/abandoned_stale_pr_audit
```

Analysis

```sh
# Run ML analysis
python abandoned_stale_pr_audit.ml.py --input ./reports/abandoned_stale_pr_audit/stale-pr-audit-octocat-Hello-World-2025-06-13.json --output ./reports/abandoned_stale_pr_audit --verbose

# Verbose output
python abandoned_stale_pr_audit.ml.py --input ./reports/abandoned_stale_pr_audit/stale-pr-audit-octocat-Hello-World-2025-06-13.json --output ./reports/abandoned_stale_pr_audit --visualize --verbose
```

PPT

```sh
node abandoned_stale_pr_audit.ppt.mjs --input ./reports/abandoned_stale_pr_audit/stale-pr-audit-octocat-Hello-World-2025-06-13.json --output ./reports/abandoned_stale_pr_audit/presentation.pptx

node abandoned_stale_pr_audit.ppt.mjs --input ./reports/abandoned_stale_pr_audit/stale-pr-audit-octocat-Hello-World-2025-06-13.json --output ./reports/abandoned_stale_pr_audit/presentation-ml.pptx --insights ./reports/abandoned_stale_pr_audit/ml_insights.json
```

Excel

```sh
# Create interactive Excel workbook
python abandoned_stale_pr_audit.excel.py --input ./reports/abandoned_stale_pr_audit/stale-pr-audit-octocat-Hello-World-2025-06-13.json --output ./reports/abandoned_stale_pr_audit/analysis.xlsx

# Include ML insights
python abandoned_stale_pr_audit.excel.py --input ./reports/abandoned_stale_pr_audit/stale-pr-audit-octocat-Hello-World-2025-06-13.json --output ./reports/abandoned_stale_pr_audit/analysis-ml.xlsx --insights ./reports/abandoned_stale_pr_audit/ml_insights.json
```

========================================================================================================================================
