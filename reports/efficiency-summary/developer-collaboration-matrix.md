```sh
rm -rf ./reports/developer-collaboration-matrix
```

Reports

```sh
# Analyze a repository
node developer-collaboration-matrix.report.mjs --repo octocat/Hello-World --format both --output ./reports/developer-collaboration-matrix

# Analyze user activity
node developer-collaboration-matrix.report.mjs --user octocat --start 2024-01-01 --format json --output ./reports/developer-collaboration-matrix

# Generate base report
node developer-collaboration-matrix.report.mjs --repo octocat/Hello-World --format json --output ./reports/developer-collaboration-matrix

node developer-collaboration-matrix.report.mjs --debug --verbose --repo octocat/Hello-World

# Analyze user with unlimited fetch
node developer-collaboration-matrix.report.mjs --user octocat --fetchLimit infinite --verbose

# Analyze user's recent activity
node developer-collaboration-matrix.report.mjs --user gaearon --start 2024-01-01 --format csv

# Last 7 days
node developer-collaboration-matrix.report.mjs --repo octocat/Hello-World --start $(date -d '7 days ago' +%Y-%m-%d)

# Last month
node developer-collaboration-matrix.report.mjs --repo octocat/Hello-World --start $(date -d '1 month ago' +%Y-%m-%d)

# Year to date
node developer-collaboration-matrix.report.mjs --repo octocat/Hello-World --start $(date +%Y)-01-01
```

Analysis

```sh
# Run ML analysis
python developer-collaboration-matrix.ml.py --input ./reports/developer-collaboration-matrix/collaboration-matrix-octocat-Hello-World-2025-06-12.json --output ./reports/developer-collaboration-matrix

# Verbose output
python developer-collaboration-matrix.ml.py --input ./reports/developer-collaboration-matrix/collaboration-matrix-octocat-Hello-World-2025-06-12.json --output ./reports/developer-collaboration-matrix --visualize --verbose
```

PPT

```sh
node developer-collaboration-matrix.ppt.mjs --input ./reports/developer-collaboration-matrix/collaboration-matrix-octocat-Hello-World-2025-06-12.json --output ./reports/developer-collaboration-matrix/presentation.pptx

node developer-collaboration-matrix.ppt.mjs --input ./reports/developer-collaboration-matrix/collaboration-matrix-octocat-Hello-World-2025-06-12.json --output ./reports/developer-collaboration-matrix/presentation-ml.pptx --insights ./reports/developer-collaboration-matrix/ml_insights.json
```

Excel

```sh
# Create interactive Excel workbook
python developer-collaboration-matrix.excel.py --input ./reports/developer-collaboration-matrix/collaboration-matrix-octocat-Hello-World-2025-06-12.json --output ./reports/developer-collaboration-matrix/analysis.xlsx

# Include ML insights
python developer-collaboration-matrix.excel.py --input ./reports/developer-collaboration-matrix/collaboration-matrix-octocat-Hello-World-2025-06-12.json --output ./reports/developer-collaboration-matrix/analysis-ml.xlsx --insights ./reports/developer-collaboration-matrix/ml_insights.json
```

========================================================================================================================================
