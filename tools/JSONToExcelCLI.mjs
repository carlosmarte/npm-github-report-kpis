/*
JSON Report Structure Output:
{
  "summary": {
    "totalRecords": number,
    "totalFields": number,
    "numericFields": number,
    "categoricalFields": number,
    "dateFields": number
  },
  "fieldAnalysis": {
    "fieldName": {
      "type": "numeric|categorical|date|empty",
      "values": array,
      "statistics": object
    }
  },
  "charts": {
    "barCharts": array,
    "pieCharts": array,
    "lineCharts": array
  }
}

Use Cases:
1. Sales Data Analysis: Convert JSON sales records to Excel with revenue charts
2. User Analytics: Transform user behavior JSON to visual reports
3. IoT Data Processing: Convert sensor data to trend analysis
4. Survey Results: Transform survey JSON to categorical distribution charts
5. Financial Reports: Convert transaction JSON to comprehensive Excel reports
6. Inventory Management: Transform stock data to visual dashboards
7. Performance Metrics: Convert API logs to performance trend analysis
*/

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Schema Extractor Module - Flattens nested JSON using dot notation
class SchemaExtractor {
  static flattenObject(obj, prefix = '', result = {}) {
    for (let key in obj) {
      if (obj.hasOwnProperty(key)) {
        const newKey = prefix ? `${prefix}.${key}` : key;
        
        if (obj[key] !== null && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
          this.flattenObject(obj[key], newKey, result);
        } else if (Array.isArray(obj[key])) {
          // Handle arrays by creating indexed keys or joining simple values
          if (obj[key].length > 0 && typeof obj[key][0] === 'object') {
            obj[key].forEach((item, index) => {
              if (typeof item === 'object' && item !== null) {
                this.flattenObject(item, `${newKey}.${index}`, result);
              } else {
                result[`${newKey}.${index}`] = item;
              }
            });
          } else {
            // Join simple array values
            result[newKey] = obj[key].join(';');
          }
        } else {
          result[newKey] = obj[key];
        }
      }
    }
    return result;
  }

  static extractSchema(jsonData) {
    if (Array.isArray(jsonData)) {
      // Get all unique keys from all objects
      const allKeys = new Set();
      const flattenedData = jsonData.map(item => {
        const flattened = this.flattenObject(item);
        Object.keys(flattened).forEach(key => allKeys.add(key));
        return flattened;
      });
      
      return {
        headers: Array.from(allKeys).sort(),
        data: flattenedData
      };
    } else {
      const flattened = this.flattenObject(jsonData);
      return {
        headers: Object.keys(flattened),
        data: [flattened]
      };
    }
  }
}

// CSV Writer Module - Handles CSV conversion and file operations
class CSVWriter {
  static convertToCSV(headers, data) {
    const csvRows = [];
    
    // Add headers
    csvRows.push(headers.map(h => `"${h}"`).join(','));
    
    // Add data rows
    data.forEach(row => {
      const values = headers.map(header => {
        const value = row[header] || '';
        // Properly escape CSV values
        const stringValue = String(value);
        return `"${stringValue.replace(/"/g, '""')}"`;
      });
      csvRows.push(values.join(','));
    });
    
    return csvRows.join('\n');
  }

  static async saveCSV(csvContent, filename) {
    await fs.promises.writeFile(filename, csvContent, 'utf8');
    console.log(`✅ CSV saved: ${filename}`);
  }
}

// Data Analysis Module - Analyzes data types and patterns
class DataAnalyzer {
  static analyzeDataTypes(headers, data) {
    const analysis = {};
    
    headers.forEach(header => {
      const values = data.map(row => row[header])
        .filter(val => val !== null && val !== undefined && val !== '');
      
      if (values.length === 0) {
        analysis[header] = { type: 'empty', values: [] };
        return;
      }

      // Check if numeric
      const numericValues = values.filter(val => {
        const num = Number(val);
        return !isNaN(num) && isFinite(num) && val !== '';
      }).map(Number);

      if (numericValues.length > values.length * 0.7) {
        analysis[header] = { 
          type: 'numeric', 
          values: numericValues,
          min: Math.min(...numericValues),
          max: Math.max(...numericValues),
          avg: numericValues.reduce((a, b) => a + b, 0) / numericValues.length,
          sum: numericValues.reduce((a, b) => a + b, 0)
        };
        return;
      }

      // Check if date
      const dateValues = values.filter(val => {
        const date = new Date(val);
        return !isNaN(date.getTime()) && val.toString().length > 8;
      });

      if (dateValues.length > values.length * 0.7) {
        const dates = dateValues.map(val => new Date(val));
        analysis[header] = { 
          type: 'date', 
          values: dates,
          min: new Date(Math.min(...dates)),
          max: new Date(Math.max(...dates))
        };
        return;
      }

      // Categorical
      const uniqueValues = [...new Set(values)];
      const distribution = uniqueValues.reduce((acc, val) => {
        acc[val] = values.filter(v => v === val).length;
        return acc;
      }, {});

      analysis[header] = { 
        type: 'categorical', 
        values: values,
        unique: uniqueValues,
        distribution: distribution,
        topValues: Object.entries(distribution)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
      };
    });

    return analysis;
  }

  static generateInsights(analysis) {
    const insights = [];
    
    Object.entries(analysis).forEach(([field, info]) => {
      if (info.type === 'numeric') {
        insights.push(`${field}: ${info.values.length} numeric values (${info.min} - ${info.max})`);
      } else if (info.type === 'categorical' && info.unique.length < 20) {
        insights.push(`${field}: ${info.unique.length} categories, most common: ${info.topValues[0]?.[0]}`);
      } else if (info.type === 'date') {
        const span = Math.ceil((info.max - info.min) / (1000 * 60 * 60 * 24));
        insights.push(`${field}: Date range spanning ${span} days`);
      }
    });

    return insights;
  }
}

// Excel Generator Module - Creates Excel files with charts and analysis
class ExcelGenerator {
  static async generateExcel(headers, data, filename) {
    let ExcelJS;
    try {
      ExcelJS = await import('exceljs');
    } catch (error) {
      console.log('⚠️  ExcelJS not available, installing...');
      console.log('Please run: npm install exceljs');
      throw new Error('ExcelJS dependency required for Excel generation');
    }

    const workbook = new ExcelJS.default.Workbook();
    
    // Add metadata
    workbook.creator = 'JSON to Excel Converter CLI';
    workbook.lastModifiedBy = 'JSON to Excel Converter CLI';
    workbook.created = new Date();
    
    // Create raw data sheet
    const dataSheet = workbook.addWorksheet('Raw Data');
    
    // Add headers with styling
    const headerRow = dataSheet.addRow(headers);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF366092' }
    };

    // Add data rows
    data.forEach(row => {
      const rowValues = headers.map(header => row[header] || '');
      dataSheet.addRow(rowValues);
    });

    // Auto-fit columns
    headers.forEach((header, index) => {
      const column = dataSheet.getColumn(index + 1);
      const maxLength = Math.max(
        header.length,
        ...data.slice(0, 100).map(row => String(row[header] || '').length)
      );
      column.width = Math.min(Math.max(maxLength + 2, 10), 50);
    });

    // Add borders to data
    const dataRange = dataSheet.getRows(1, data.length + 1);
    dataRange?.forEach(row => {
      row.eachCell(cell => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
    });

    // Analyze data for insights
    const analysis = DataAnalyzer.analyzeDataTypes(headers, data);
    const insights = DataAnalyzer.generateInsights(analysis);

    // Create analysis sheet
    const analysisSheet = workbook.addWorksheet('Data Analysis');
    
    let currentRow = 1;

    // Title
    analysisSheet.mergeCells('A1:D1');
    const titleCell = analysisSheet.getCell('A1');
    titleCell.value = 'Data Analysis Report';
    titleCell.font = { bold: true, size: 16 };
    titleCell.alignment = { horizontal: 'center' };
    currentRow += 3;

    // Summary section
    analysisSheet.getCell(`A${currentRow}`).value = 'Summary Statistics';
    analysisSheet.getCell(`A${currentRow}`).font = { bold: true, size: 14 };
    currentRow += 2;

    const summaryData = [
      ['Total Records', data.length],
      ['Total Fields', headers.length],
      ['Numeric Fields', Object.values(analysis).filter(a => a.type === 'numeric').length],
      ['Categorical Fields', Object.values(analysis).filter(a => a.type === 'categorical').length],
      ['Date Fields', Object.values(analysis).filter(a => a.type === 'date').length],
      ['Empty Fields', Object.values(analysis).filter(a => a.type === 'empty').length]
    ];

    summaryData.forEach(([label, value]) => {
      analysisSheet.getCell(`A${currentRow}`).value = label;
      analysisSheet.getCell(`B${currentRow}`).value = value;
      analysisSheet.getCell(`A${currentRow}`).font = { bold: true };
      currentRow++;
    });

    currentRow += 2;

    // Field analysis section
    analysisSheet.getCell(`A${currentRow}`).value = 'Field Analysis';
    analysisSheet.getCell(`A${currentRow}`).font = { bold: true, size: 14 };
    currentRow += 2;

    // Headers for field analysis
    ['Field Name', 'Type', 'Details'].forEach((header, index) => {
      const cell = analysisSheet.getCell(currentRow, index + 1);
      cell.value = header;
      cell.font = { bold: true };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
      };
    });
    currentRow++;

    Object.entries(analysis).forEach(([field, info]) => {
      analysisSheet.getCell(`A${currentRow}`).value = field;
      analysisSheet.getCell(`B${currentRow}`).value = info.type;
      
      let details = '';
      if (info.type === 'numeric') {
        details = `Min: ${info.min}, Max: ${info.max}, Avg: ${info.avg.toFixed(2)}`;
      } else if (info.type === 'categorical') {
        details = `${info.unique.length} unique values`;
      } else if (info.type === 'date') {
        details = `${info.values.length} date values`;
      }
      
      analysisSheet.getCell(`C${currentRow}`).value = details;
      currentRow++;
    });

    // Create charts sheet for data visualizations
    await this.createChartsSheet(workbook, analysis, data);

    // Save workbook
    await workbook.xlsx.writeFile(filename);
    console.log(`✅ Excel file saved: ${filename}`);
    
    return {
      numericFields: Object.values(analysis).filter(a => a.type === 'numeric').length,
      categoricalFields: Object.values(analysis).filter(a => a.type === 'categorical').length,
      dateFields: Object.values(analysis).filter(a => a.type === 'date').length,
      insights: insights
    };
  }

  static async createChartsSheet(workbook, analysis, data) {
    const chartsSheet = workbook.addWorksheet('Charts & Visualizations');
    
    let currentRow = 1;

    // Title
    chartsSheet.mergeCells('A1:F1');
    const titleCell = chartsSheet.getCell('A1');
    titleCell.value = 'Data Visualizations';
    titleCell.font = { bold: true, size: 16 };
    titleCell.alignment = { horizontal: 'center' };
    currentRow += 3;

    // Find fields suitable for different chart types
    const numericFields = Object.entries(analysis).filter(([_, info]) => info.type === 'numeric');
    const categoricalFields = Object.entries(analysis).filter(([_, info]) => 
      info.type === 'categorical' && info.unique.length <= 20
    );

    // Create bar chart data for numeric fields
    if (numericFields.length > 0) {
      chartsSheet.getCell(`A${currentRow}`).value = 'Numeric Fields Summary (Bar Chart Data)';
      chartsSheet.getCell(`A${currentRow}`).font = { bold: true, size: 14 };
      currentRow += 2;

      // Headers
      ['Field', 'Min', 'Max', 'Average', 'Sum'].forEach((header, index) => {
        const cell = chartsSheet.getCell(currentRow, index + 1);
        cell.value = header;
        cell.font = { bold: true };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE0E0E0' }
        };
      });
      currentRow++;

      numericFields.forEach(([field, info]) => {
        chartsSheet.getCell(`A${currentRow}`).value = field;
        chartsSheet.getCell(`B${currentRow}`).value = info.min;
        chartsSheet.getCell(`C${currentRow}`).value = info.max;
        chartsSheet.getCell(`D${currentRow}`).value = Number(info.avg.toFixed(2));
        chartsSheet.getCell(`E${currentRow}`).value = info.sum;
        currentRow++;
      });
      currentRow += 3;
    }

    // Create pie chart data for categorical fields
    if (categoricalFields.length > 0) {
      categoricalFields.slice(0, 3).forEach(([field, info]) => {
        chartsSheet.getCell(`A${currentRow}`).value = `${field} Distribution (Pie Chart Data)`;
        chartsSheet.getCell(`A${currentRow}`).font = { bold: true, size: 14 };
        currentRow += 2;

        // Headers
        ['Category', 'Count', 'Percentage'].forEach((header, index) => {
          const cell = chartsSheet.getCell(currentRow, index + 1);
          cell.value = header;
          cell.font = { bold: true };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE0E0E0' }
          };
        });
        currentRow++;

        const total = info.values.length;
        info.topValues.forEach(([category, count]) => {
          chartsSheet.getCell(`A${currentRow}`).value = category;
          chartsSheet.getCell(`B${currentRow}`).value = count;
          chartsSheet.getCell(`C${currentRow}`).value = `${((count / total) * 100).toFixed(1)}%`;
          currentRow++;
        });
        currentRow += 3;
      });
    }

    // Add instructions for chart creation
    currentRow += 2;
    chartsSheet.getCell(`A${currentRow}`).value = 'Chart Creation Instructions:';
    chartsSheet.getCell(`A${currentRow}`).font = { bold: true, size: 14 };
    currentRow += 2;

    const instructions = [
      '1. Select the data range above',
      '2. Go to Insert > Charts in Excel',
      '3. Choose appropriate chart type:',
      '   - Bar Chart for numeric comparisons',
      '   - Pie Chart for categorical distributions',
      '   - Line Chart for time series data',
      '4. Customize chart title and labels',
      '5. Apply formatting and colors as needed'
    ];

    instructions.forEach(instruction => {
      chartsSheet.getCell(`A${currentRow}`).value = instruction;
      currentRow++;
    });
  }
}

// CLI Prompt Module - Handles user interaction
class CLIPrompt {
  static async promptForFilename(defaultName) {
    const readline = await import('readline');
    
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve) => {
      rl.question(`Enter output filename (without extension) [${defaultName}]: `, (answer) => {
        rl.close();
        resolve(answer.trim() || defaultName);
      });
    });
  }
}

// Progress Bar Module - Simple progress indication
class ProgressBar {
  static show(message, duration = 1000) {
    process.stdout.write(`${message}...`);
    const chars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let i = 0;
    
    const interval = setInterval(() => {
      process.stdout.write(`\r${message} ${chars[i++]}`);
      i %= chars.length;
    }, 80);

    return () => {
      clearInterval(interval);
      process.stdout.write(`\r${message} ✅\n`);
    };
  }
}

// Main CLI Application
class JSONToExcelCLI {
  constructor() {
    this.args = process.argv.slice(2);
  }

  showUsage() {
    console.log('📋 JSON to Excel Converter CLI');
    console.log('');
    console.log('Usage: node main.mjs <json-file-path> [options]');
    console.log('');
    console.log('Options:');
    console.log('  -h, --help     Show this help message');
    console.log('  -v, --verbose  Enable verbose output');
    console.log('  -d, --debug    Enable debug mode');
    console.log('');
    console.log('Examples:');
    console.log('  node main.mjs data.json');
    console.log('  node main.mjs ./users.json --verbose');
    console.log('');
  }

  async run() {
    try {
      // Handle help flag
      if (this.args.includes('-h') || this.args.includes('--help')) {
        this.showUsage();
        return;
      }

      const verbose = this.args.includes('-v') || this.args.includes('--verbose');
      const debug = this.args.includes('-d') || this.args.includes('--debug');

      console.log('🚀 JSON to Excel Converter CLI\n');

      // Validate arguments
      const jsonFiles = this.args.filter(arg => !arg.startsWith('-'));
      if (jsonFiles.length === 0) {
        console.error('❌ Error: Please provide a JSON file path');
        this.showUsage();
        process.exit(1);
      }

      const jsonFilePath = jsonFiles[0];

      // Check if file exists
      if (!fs.existsSync(jsonFilePath)) {
        console.error(`❌ Error: File not found: ${jsonFilePath}`);
        process.exit(1);
      }

      if (verbose) console.log(`📂 Loading JSON file: ${jsonFilePath}`);
      
      // Read and parse JSON with progress
      const loadProgress = ProgressBar.show('Loading JSON file');
      const jsonContent = await fs.promises.readFile(jsonFilePath, 'utf8');
      let jsonData;
      
      try {
        jsonData = JSON.parse(jsonContent);
        loadProgress();
      } catch (parseError) {
        loadProgress();
        console.error(`❌ Error: Invalid JSON format in ${jsonFilePath}`);
        if (debug) console.error(parseError.stack);
        process.exit(1);
      }

      // Extract schema and flatten data
      const schemaProgress = ProgressBar.show('Flattening JSON structure');
      const { headers, data } = SchemaExtractor.extractSchema(jsonData);
      schemaProgress();
      
      console.log(`📊 Extracted ${headers.length} fields from ${data.length} records`);

      // Prompt for output filename
      const defaultFilename = path.basename(jsonFilePath, path.extname(jsonFilePath)) + '_converted';
      const baseFilename = await CLIPrompt.promptForFilename(defaultFilename);
      
      const csvFilename = `${baseFilename}.csv`;
      const excelFilename = `${baseFilename}.xlsx`;

      // Generate CSV
      const csvProgress = ProgressBar.show('Generating CSV');
      const csvContent = CSVWriter.convertToCSV(headers, data);
      await CSVWriter.saveCSV(csvContent, csvFilename);
      csvProgress();

      // Generate Excel with charts
      const excelProgress = ProgressBar.show('Generating Excel with analysis');
      const chartInfo = await ExcelGenerator.generateExcel(headers, data, excelFilename);
      excelProgress();

      // Summary
      console.log('\n🎉 Conversion completed successfully!');
      console.log(`📊 Summary:`);
      console.log(`   • Records processed: ${data.length}`);
      console.log(`   • Fields extracted: ${headers.length}`);
      console.log(`   • Numeric fields: ${chartInfo.numericFields}`);
      console.log(`   • Categorical fields: ${chartInfo.categoricalFields}`);
      console.log(`   • Date fields: ${chartInfo.dateFields}`);
      console.log(`   • CSV file: ${csvFilename}`);
      console.log(`   • Excel file: ${excelFilename}`);

      if (verbose && chartInfo.insights.length > 0) {
        console.log('\n💡 Data Insights:');
        chartInfo.insights.forEach(insight => console.log(`   • ${insight}`));
      }

    } catch (error) {
      console.error('\n❌ An error occurred:', error.message);
      
      if (error.message.includes('ExcelJS dependency required')) {
        console.log('\n📦 To install required dependencies:');
        console.log('npm install exceljs');
      }
      
      if (process.env.DEBUG || this.args.includes('--debug')) {
        console.error('\n🐛 Debug information:');
        console.error(error.stack);
      }
      process.exit(1);
    }
  }
}

// Execute CLI
const cli = new JSONToExcelCLI();
cli.run();
