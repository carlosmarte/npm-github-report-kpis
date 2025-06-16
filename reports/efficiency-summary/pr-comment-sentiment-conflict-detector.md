```sh
rm -rf ./reports/pr-comment-sentiment-conflict-detector
```

Reports

```sh
# Analyze a repository
node pr-comment-sentiment-conflict-detector.report.mjs --repo octocat/Hello-World --format both --output ./reports/pr-comment-sentiment-conflict-detector

# Analyze user activity
node pr-comment-sentiment-conflict-detector.report.mjs --user octocat --start 2024-01-01 --format json --output ./reports/pr-comment-sentiment-conflict-detector

# Generate base report
node pr-comment-sentiment-conflict-detector.report.mjs --repo octocat/Hello-World --format json --output ./reports/pr-comment-sentiment-conflict-detector

node pr-comment-sentiment-conflict-detector.report.mjs --debug --verbose --repo octocat/Hello-World

# Analyze user with unlimited fetch
node pr-comment-sentiment-conflict-detector.report.mjs --user octocat --fetchLimit infinite --verbose

# Analyze user's recent activity
node pr-comment-sentiment-conflict-detector.report.mjs --user gaearon --start 2024-01-01 --format csv

# Last 7 days
node pr-comment-sentiment-conflict-detector.report.mjs --repo octocat/Hello-World --start $(date -d '7 days ago' +%Y-%m-%d)

# Last month
node pr-comment-sentiment-conflict-detector.report.mjs --repo octocat/Hello-World --start $(date -d '1 month ago' +%Y-%m-%d)

# Year to date
node pr-comment-sentiment-conflict-detector.report.mjs --repo octocat/Hello-World --start $(date +%Y)-01-01
```

Analysis

```sh
# Run ML analysis
python pr-comment-sentiment-conflict-detector.ml.py --input ./reports/pr-comment-sentiment-conflict-detector/pr-conflict-analysis-octocat-Hello-World-2025-06-12.json --output ./reports/pr-comment-sentiment-conflict-detector --verbose

# Verbose output
python pr-comment-sentiment-conflict-detector.ml.py --input ./reports/pr-comment-sentiment-conflict-detector/pr-conflict-analysis-octocat-Hello-World-2025-06-12.json --output ./reports/pr-comment-sentiment-conflict-detector --visualize --verbose


# Adjust clustering parameters
python -m pr_ml_analyzer --input data.json --clusters 5

```

PPT

```sh
node pr-comment-sentiment-conflict-detector.ppt.mjs --input ./reports/pr-comment-sentiment-conflict-detector/pr-conflict-analysis-octocat-Hello-World-2025-06-12.json --output ./reports/pr-comment-sentiment-conflict-detector/presentation.pptx

node pr-comment-sentiment-conflict-detector.ppt.mjs --input ./reports/pr-comment-sentiment-conflict-detector/pr-conflict-analysis-octocat-Hello-World-2025-06-12.json --output ./reports/pr-comment-sentiment-conflict-detector/presentation-ml.pptx --insights ./reports/pr-comment-sentiment-conflict-detector/ml_insights.json

```

Excel

```sh
# Create interactive Excel workbook
python pr-comment-sentiment-conflict-detector.excel.py --input ./reports/pr-comment-sentiment-conflict-detector/pr-conflict-analysis-octocat-Hello-World-2025-06-12.json --output ./reports/pr-comment-sentiment-conflict-detector/analysis.xlsx  --verbose

# Include ML insights
python pr-comment-sentiment-conflict-detector.excel.py --input ./reports/pr-comment-sentiment-conflict-detector/pr-conflict-analysis-octocat-Hello-World-2025-06-12.json --output ./reports/pr-comment-sentiment-conflict-detector/analysis-ml.xlsx --insights ./reports/pr-comment-sentiment-conflict-detector/ml_insights.json
```

========================================================================================================================================
