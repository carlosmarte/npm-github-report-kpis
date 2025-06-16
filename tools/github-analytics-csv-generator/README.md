```mjs
const generator = new GitHubAnalyticsCSVGenerator();
generator.outputDir = './custom-output';
generator.ensureOutputDir();

const generator = new GitHubAnalyticsCSVGenerator();
const summaryPath = generator.generateUserSummaryCSV(data, username);
const productivityPath = generator.generateProductivityCSV(data, username);

const GitHubAnalyticsCSVGenerator = require('./github-analytics-csv-generator');

const generator = new GitHubAnalyticsCSVGenerator();

// From JSON file
generator.generateAllReports('./analytics.json', 'username');

// From data object
const analyticsData = { /_ your data _/ };
generator.generateCSVFromData(analyticsData, 'username');


```

node github-analytics-csv-generator.js ./analytics.json <username>
node github-analytics-csv-generator.js <json-file-path> <username>
