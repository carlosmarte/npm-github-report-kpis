#!/usr/bin/env python3
"""
Pull Request Lifecycle Excel Report Generator
Creates interactive Excel workbooks with multiple sheets and formulas
"""

import json
import pandas as pd
import numpy as np
from datetime import datetime
import argparse
import sys
from pathlib import Path
import xlsxwriter
from xlsxwriter.utility import xl_rowcol_to_cell

class PRLifecycleExcelGenerator:
    def __init__(self):
        self.workbook = None
        self.worksheet_formats = {}
        
    def setup_formats(self):
        """Setup common cell formats"""
        self.worksheet_formats = {
            'header': self.workbook.add_format({
                'bold': True,
                'bg_color': '#1f4e79',
                'font_color': 'white',
                'border': 1,
                'align': 'center',
                'valign': 'vcenter'
            }),
            'subheader': self.workbook.add_format({
                'bold': True,
                'bg_color': '#d9e1f2',
                'border': 1,
                'align': 'center'
            }),
            'number': self.workbook.add_format({
                'num_format': '#,##0',
                'border': 1,
                'align': 'right'
            }),
            'percentage': self.workbook.add_format({
                'num_format': '0.0%',
                'border': 1,
                'align': 'right'
            }),
            'currency': self.workbook.add_format({
                'num_format': '$#,##0.00',
                'border': 1,
                'align': 'right'
            }),
            'date': self.workbook.add_format({
                'num_format': 'yyyy-mm-dd',
                'border': 1,
                'align': 'center'
            }),
            'text': self.workbook.add_format({
                'border': 1,
                'align': 'left',
                'text_wrap': True
            }),
            'formula': self.workbook.add_format({
                'border': 1,
                'align': 'right',
                'bg_color': '#f2f2f2'
            }),
            'good': self.workbook.add_format({
                'bg_color': '#c6efce',
                'font_color': '#006100',
                'border': 1,
                'align': 'right'
            }),
            'bad': self.workbook.add_format({
                'bg_color': '#ffc7ce',
                'font_color': '#9c0006',
                'border': 1,
                'align': 'right'
            }),
            'warning': self.workbook.add_format({
                'bg_color': '#ffeb9c',
                'font_color': '#9c5700',
                'border': 1,
                'align': 'right'
            })
        }
    
    def create_summary_sheet(self, data):
        """Create executive summary sheet"""
        worksheet = self.workbook.add_worksheet('Executive Summary')
        
        # Title
        worksheet.merge_range('A1:H1', 'Pull Request Lifecycle Analysis - Executive Summary', 
                            self.worksheet_formats['header'])
        
        # Analysis info
        worksheet.write('A3', 'Analysis Period:', self.worksheet_formats['subheader'])
        worksheet.write('B3', f"{data['date_range']['start_date']} to {data['date_range']['end_date']}")
        
        worksheet.write('A4', 'Generated:', self.worksheet_formats['subheader'])
        worksheet.write('B4', data['date_range']['analysis_date'])
        
        # Key Metrics
        worksheet.write('A6', 'Key Metrics', self.worksheet_formats['header'])
        
        metrics_data = [
            ['Metric', 'Value', 'Description'],
            ['Total Pull Requests', data['summary']['TOTAL_PULL_REQUESTS'], 'Total PRs analyzed'],
            ['Merged Pull Requests', data['summary']['MERGED_PULL_REQUESTS'], 'Successfully merged PRs'],
            ['Merge Success Rate', data['summary']['MERGE_SUCCESS_RATE_PERCENT']/100, 'Percentage of PRs merged'],
            ['Average Cycle Time (hours)', data['summary']['AVERAGE_CYCLE_TIME_HOURS'], 'Average time from creation to close'],
            ['Median Cycle Time (hours)', data['summary']['MEDIAN_CYCLE_TIME_HOURS'], 'Middle value of cycle times'],
            ['Average Review Time (hours)', data['summary']['AVERAGE_REVIEW_TIME_HOURS'] or 0, 'Average time to first review'],
            ['Average Idle Time (hours)', data['summary']['AVERAGE_IDLE_TIME_HOURS'], 'Average time without activity']
        ]
        
        for row, (metric, value, desc) in enumerate(metrics_data, 7):
            if row == 7:  # Header
                worksheet.write(row, 0, metric, self.worksheet_formats['subheader'])
                worksheet.write(row, 1, value, self.worksheet_formats['subheader'])
                worksheet.write(row, 2, desc, self.worksheet_formats['subheader'])
            else:
                worksheet.write(row, 0, metric, self.worksheet_formats['text'])
                if 'Rate' in metric:
                    worksheet.write(row, 1, value, self.worksheet_formats['percentage'])
                else:
                    worksheet.write(row, 1, value, self.worksheet_formats['number'])
                worksheet.write(row, 2, desc, self.worksheet_formats['text'])
        
        # Formulas section
        worksheet.write('A16', 'Calculated Metrics', self.worksheet_formats['header'])
        
        # Reference cells for formulas
        total_prs_cell = 'B8'
        merged_prs_cell = 'B9'
        
        formula_data = [
            ['Formula', 'Calculation', 'Result'],
            ['Success Rate Check', f'={merged_prs_cell}/{total_prs_cell}', f'=ROUND({merged_prs_cell}/{total_prs_cell},3)'],
            ['High Performance', f'=IF(B10>0.8,"Excellent",IF(B10>0.6,"Good","Needs Improvement"))', ''],
            ['Cycle Time Status', f'=IF(B11<72,"Fast",IF(B11<168,"Normal","Slow"))', '']
        ]
        
        for row, (formula, calc, result) in enumerate(formula_data, 17):
            if row == 17:  # Header
                worksheet.write(row, 0, formula, self.worksheet_formats['subheader'])
                worksheet.write(row, 1, calc, self.worksheet_formats['subheader'])
                worksheet.write(row, 2, result, self.worksheet_formats['subheader'])
            else:
                worksheet.write(row, 0, formula, self.worksheet_formats['text'])
                if result:
                    worksheet.write_formula(row, 1, calc, self.worksheet_formats['formula'])
                    worksheet.write_formula(row, 2, result, self.worksheet_formats['formula'])
                else:
                    worksheet.write_formula(row, 1, calc, self.worksheet_formats['formula'])
        
        # Set column widths
        worksheet.set_column('A:A', 25)
        worksheet.set_column('B:B', 15)
        worksheet.set_column('C:C', 40)
        
        return worksheet
    
    def create_detailed_data_sheet(self, data):
        """Create detailed PR data sheet"""
        worksheet = self.workbook.add_worksheet('PR Details')
        
        prs = data['detailed_analysis']['pull_requests']
        
        headers = [
            'PR Number', 'Title', 'Author', 'State', 'Repository',
            'Created Date', 'Closed Date', 'Merged Date',
            'Cycle Time (hrs)', 'Review Time (hrs)', 'Idle Time (hrs)',
            'Time to Comment (hrs)', 'Review Count', 'Comment Count'
        ]
        
        # Write headers
        for col, header in enumerate(headers):
            worksheet.write(0, col, header, self.worksheet_formats['header'])
        
        # Write data
        for row, pr in enumerate(prs, 1):
            worksheet.write(row, 0, pr['NUMBER'], self.worksheet_formats['number'])
            worksheet.write(row, 1, pr['TITLE'][:50] + '...' if len(pr['TITLE']) > 50 else pr['TITLE'], self.worksheet_formats['text'])
            worksheet.write(row, 2, pr['AUTHOR'], self.worksheet_formats['text'])
            worksheet.write(row, 3, pr['STATE'], self.worksheet_formats['text'])
            worksheet.write(row, 4, pr['REPOSITORY'], self.worksheet_formats['text'])
            worksheet.write(row, 5, pr['CREATED_AT'][:10], self.worksheet_formats['date'])
            worksheet.write(row, 6, pr['CLOSED_AT'][:10] if pr['CLOSED_AT'] else '', self.worksheet_formats['date'])
            worksheet.write(row, 7, pr['MERGED_AT'][:10] if pr['MERGED_AT'] else '', self.worksheet_formats['date'])
            
            # Cycle time with conditional formatting
            cycle_time = pr['CYCLE_TIME_HOURS']
            if cycle_time < 24:
                fmt = self.worksheet_formats['good']
            elif cycle_time < 168:
                fmt = self.worksheet_formats['warning']
            else:
                fmt = self.worksheet_formats['bad']
            worksheet.write(row, 8, cycle_time, fmt)
            
            worksheet.write(row, 9, pr['REVIEW_TIME_HOURS'] or 0, self.worksheet_formats['number'])
            worksheet.write(row, 10, pr['IDLE_TIME_HOURS'], self.worksheet_formats['number'])
            worksheet.write(row, 11, pr['TIME_TO_FIRST_COMMENT_HOURS'] or 0, self.worksheet_formats['number'])
            worksheet.write(row, 12, pr['REVIEW_COUNT'], self.worksheet_formats['number'])
            worksheet.write(row, 13, pr['COMMENT_COUNT'], self.worksheet_formats['number'])
        
        # Add summary formulas at the bottom
        last_row = len(prs) + 2
        
        worksheet.write(last_row, 0, 'TOTALS/AVERAGES:', self.worksheet_formats['subheader'])
        worksheet.write_formula(last_row, 8, f'=AVERAGE(I2:I{len(prs)+1})', self.worksheet_formats['formula'])
        worksheet.write_formula(last_row, 9, f'=AVERAGE(J2:J{len(prs)+1})', self.worksheet_formats['formula'])
        worksheet.write_formula(last_row, 10, f'=AVERAGE(K2:K{len(prs)+1})', self.worksheet_formats['formula'])
        worksheet.write_formula(last_row, 12, f'=SUM(M2:M{len(prs)+1})', self.worksheet_formats['formula'])
        worksheet.write_formula(last_row, 13, f'=SUM(N2:N{len(prs)+1})', self.worksheet_formats['formula'])
        
        # Set column widths
        worksheet.set_column('A:A', 12)  # PR Number
        worksheet.set_column('B:B', 40)  # Title
        worksheet.set_column('C:C', 15)  # Author
        worksheet.set_column('D:D', 10)  # State
        worksheet.set_column('E:E', 20)  # Repository
        worksheet.set_column('F:H', 12)  # Dates
        worksheet.set_column('I:N', 10)  # Metrics
        
        # Freeze panes
        worksheet.freeze_panes(1, 0)
        
        return worksheet
    
    def create_contributor_analysis_sheet(self, data):
        """Create contributor analysis sheet"""
        worksheet = self.workbook.add_worksheet('Contributors')
        
        contributors = data['detailed_analysis']['contributor_metrics']
        
        # Headers
        headers = [
            'Contributor', 'Total PRs', 'Merged PRs', 'Success Rate (%)',
            'Avg Cycle Time (hrs)', 'Avg Review Time (hrs)', 'Efficiency Score'
        ]
        
        for col, header in enumerate(headers):
            worksheet.write(0, col, header, self.worksheet_formats['header'])
        
        # Data
        sorted_contributors = sorted(contributors.items(), key=lambda x: x[1]['TOTAL_PRS'], reverse=True)
        
        for row, (name, metrics) in enumerate(sorted_contributors, 1):
            worksheet.write(row, 0, name, self.worksheet_formats['text'])
            worksheet.write(row, 1, metrics['TOTAL_PRS'], self.worksheet_formats['number'])
            worksheet.write(row, 2, metrics['MERGED_PRS'], self.worksheet_formats['number'])
            
            # Success rate with conditional formatting
            success_rate = metrics['MERGE_SUCCESS_RATE_PERCENT'] / 100
            if success_rate > 0.8:
                fmt = self.worksheet_formats['good']
            elif success_rate > 0.6:
                fmt = self.worksheet_formats['warning']
            else:
                fmt = self.worksheet_formats['bad']
            worksheet.write(row, 3, success_rate, fmt)
            
            worksheet.write(row, 4, metrics['AVERAGE_CYCLE_TIME_HOURS'], self.worksheet_formats['number'])
            worksheet.write(row, 5, metrics['AVERAGE_REVIEW_TIME_HOURS'], self.worksheet_formats['number'])
            
            # Efficiency score formula
            efficiency_formula = f'=(C{row+1}/B{row+1})*(1/MAX(E{row+1},1))'
            worksheet.write_formula(row, 6, efficiency_formula, self.worksheet_formats['formula'])
        
        # Add summary statistics
        last_row = len(sorted_contributors) + 3
        
        worksheet.write(last_row, 0, 'Team Statistics:', self.worksheet_formats['subheader'])
        worksheet.write(last_row + 1, 0, 'Total Contributors:', self.worksheet_formats['text'])
        worksheet.write_formula(last_row + 1, 1, f'=COUNTA(A2:A{len(sorted_contributors)+1})', self.worksheet_formats['formula'])
        
        worksheet.write(last_row + 2, 0, 'Avg Team Success Rate:', self.worksheet_formats['text'])
        worksheet.write_formula(last_row + 2, 1, f'=AVERAGE(D2:D{len(sorted_contributors)+1})', self.worksheet_formats['formula'])
        
        worksheet.write(last_row + 3, 0, 'Top Performer:', self.worksheet_formats['text'])
        worksheet.write_formula(last_row + 3, 1, f'=INDEX(A2:A{len(sorted_contributors)+1},MATCH(MAX(G2:G{len(sorted_contributors)+1}),G2:G{len(sorted_contributors)+1},0))', self.worksheet_formats['formula'])
        
        # Set column widths
        worksheet.set_column('A:A', 20)
        worksheet.set_column('B:G', 15)
        
        return worksheet
    
    def create_trends_analysis_sheet(self, data):
        """Create trends analysis sheet"""
        worksheet = self.workbook.add_worksheet('Trends')
        
        trends = data['detailed_analysis'].get('trends', [])
        
        if not trends:
            worksheet.write('A1', 'No trend data available', self.worksheet_formats['text'])
            return worksheet
        
        # Headers
        headers = ['Period', 'PR Count', 'Avg Cycle Time (hrs)', 'Avg Review Time (hrs)', 'Merge Rate (%)']
        
        for col, header in enumerate(headers):
            worksheet.write(0, col, header, self.worksheet_formats['header'])
        
        # Data
        for row, trend in enumerate(trends, 1):
            worksheet.write(row, 0, trend['period'], self.worksheet_formats['text'])
            worksheet.write(row, 1, trend['count'], self.worksheet_formats['number'])
            worksheet.write(row, 2, round(trend['avgCycleTime'], 1), self.worksheet_formats['number'])
            worksheet.write(row, 3, round(trend['avgReviewTime'], 1), self.worksheet_formats['number'])
            worksheet.write(row, 4, trend['mergeRate'] / 100, self.worksheet_formats['percentage'])
        
        # Add trend analysis formulas
        last_row = len(trends) + 3
        
        worksheet.write(last_row, 0, 'Trend Analysis:', self.worksheet_formats['subheader'])
        
        # Calculate trends using SLOPE function
        data_range = f'B2:B{len(trends)+1}'
        period_range = f'ROW(A2:A{len(trends)+1})'
        
        worksheet.write(last_row + 1, 0, 'PR Count Trend:', self.worksheet_formats['text'])
        worksheet.write_formula(last_row + 1, 1, f'=SLOPE({data_range},{period_range})', self.worksheet_formats['formula'])
        
        cycle_range = f'C2:C{len(trends)+1}'
        worksheet.write(last_row + 2, 0, 'Cycle Time Trend:', self.worksheet_formats['text'])
        worksheet.write_formula(last_row + 2, 1, f'=SLOPE({cycle_range},{period_range})', self.worksheet_formats['formula'])
        
        merge_range = f'E2:E{len(trends)+1}'
        worksheet.write(last_row + 3, 0, 'Merge Rate Trend:', self.worksheet_formats['text'])
        worksheet.write_formula(last_row + 3, 1, f'=SLOPE({merge_range},{period_range})', self.worksheet_formats['formula'])
        
        # Set column widths
        worksheet.set_column('A:A', 15)
        worksheet.set_column('B:E', 18)
        
        return worksheet
    
    def create_formulas_sheet(self, data):
        """Create formulas documentation sheet"""
        worksheet = self.workbook.add_worksheet('Formulas')
        
        # Title
        worksheet.merge_range('A1:D1', 'Formula Documentation', self.worksheet_formats['header'])
        
        # Formulas from the data
        formulas = data.get('formulas', {})
        
        headers = ['Formula Name', 'Formula', 'Description', 'Variables']
        for col, header in enumerate(headers):
            worksheet.write(2, col, header, self.worksheet_formats['subheader'])
        
        formula_docs = [
            ('Cycle Time', formulas.get('cycle_time', ''), 'Time from creation to close/merge', 'MERGE_TIME, CREATION_TIME, CLOSE_TIME'),
            ('Review Time', formulas.get('review_time', ''), 'Time to first review', 'FIRST_REVIEW_TIME, CREATION_TIME'),
            ('Idle Time', formulas.get('idle_time', ''), 'Time without activity', 'TOTAL_TIME, ACTIVE_REVIEW_TIME'),
            ('Success Rate', formulas.get('merge_success_rate', ''), 'Percentage of merged PRs', 'MERGED_PRS, TOTAL_PRS'),
            ('Average Cycle Time', formulas.get('average_cycle_time', ''), 'Mean cycle time', 'SUM(CYCLE_TIME_HOURS), TOTAL_PRS'),
            ('Median Calculation', formulas.get('median_calculation', ''), 'Middle value calculation', 'SORTED_VALUES, MIDDLE_INDEX'),
            ('Bottleneck Detection', formulas.get('bottleneck_review_delay', ''), 'Review delay identification', 'AVG_REVIEW_TIME, AVG_CYCLE_TIME'),
            ('Efficiency Score', '(MERGED_PRS/TOTAL_PRS)*(1/MAX(AVG_CYCLE_TIME,1))', 'Contributor efficiency metric', 'MERGED_PRS, TOTAL_PRS, AVG_CYCLE_TIME')
        ]
        
        for row, (name, formula, description, variables) in enumerate(formula_docs, 3):
            worksheet.write(row, 0, name, self.worksheet_formats['text'])
            worksheet.write(row, 1, formula, self.worksheet_formats['text'])
            worksheet.write(row, 2, description, self.worksheet_formats['text'])
            worksheet.write(row, 3, variables, self.worksheet_formats['text'])
        
        # Set column widths
        worksheet.set_column('A:A', 20)
        worksheet.set_column('B:B', 40)
        worksheet.set_column('C:C', 50)
        worksheet.set_column('D:D', 30)
        
        return worksheet
    
    def create_dashboard_sheet(self, data):
        """Create dashboard with key metrics and charts"""
        worksheet = self.workbook.add_worksheet('Dashboard')
        
        # Title
        worksheet.merge_range('A1:J1', 'PR Lifecycle Dashboard', self.worksheet_formats['header'])
        
        # Key metrics cards
        metrics = [
            ('Total PRs', data['summary']['TOTAL_PULL_REQUESTS'], 'B3:C4'),
            ('Merge Rate', f"{data['summary']['MERGE_SUCCESS_RATE_PERCENT']}%", 'E3:F4'),
            ('Avg Cycle Time', f"{data['summary']['AVERAGE_CYCLE_TIME_HOURS']}h", 'H3:I4'),
            ('Bottlenecks', len(data['summary']['IDENTIFIED_BOTTLENECKS']), 'B6:C7')
        ]
        
        for name, value, cell_range in metrics:
            worksheet.merge_range(cell_range, f'{name}\n{value}', self.worksheet_formats['subheader'])
        
        # Performance indicators
        worksheet.write('A9', 'Performance Indicators:', self.worksheet_formats['header'])
        
        indicators = [
            ('Health Score', f'=IF(\'Executive Summary\'!B10>0.8,"🟢 Excellent",IF(\'Executive Summary\'!B10>0.6,"🟡 Good","🔴 Needs Work"))'),
            ('Velocity', f'=IF(\'Executive Summary\'!B11<72,"🟢 Fast",IF(\'Executive Summary\'!B11<168,"🟡 Normal","🔴 Slow"))'),
            ('Review Efficiency', f'=IF(ISBLANK(\'Executive Summary\'!B12),"N/A",IF(\'Executive Summary\'!B12<24,"🟢 Fast","🟡 Slow"))')
        ]
        
        for row, (name, formula) in enumerate(indicators, 10):
            worksheet.write(row, 0, name, self.worksheet_formats['text'])
            worksheet.write_formula(row, 1, formula, self.worksheet_formats['text'])
        
        # Reference data for charts (simplified)
        worksheet.write('E9', 'Quick Stats:', self.worksheet_formats['header'])
        worksheet.write('E10', 'Top Contributor:', self.worksheet_formats['text'])
        worksheet.write_formula('F10', '=INDEX(Contributors!A:A,MATCH(MAX(Contributors!B:B),Contributors!B:B,0))', self.worksheet_formats['text'])
        
        return worksheet
    
    def generate_excel_report(self, json_path, output_path):
        """Generate comprehensive Excel report"""
        print(f"📊 Generating Excel report from {json_path}...")
        
        # Load data
        try:
            with open(json_path, 'r') as f:
                data = json.load(f)
        except Exception as e:
            raise Exception(f"Failed to load JSON data: {e}")
        
        # Create workbook
        self.workbook = xlsxwriter.Workbook(output_path)
        self.setup_formats()
        
        # Create sheets
        try:
            self.create_dashboard_sheet(data)
            self.create_summary_sheet(data)
            self.create_detailed_data_sheet(data)
            self.create_contributor_analysis_sheet(data)
            self.create_trends_analysis_sheet(data)
            self.create_formulas_sheet(data)
            
            # Close workbook
            self.workbook.close()
            
            print(f"✅ Excel report generated successfully: {output_path}")
            return output_path
            
        except Exception as e:
            self.workbook.close()
            raise Exception(f"Error creating Excel sheets: {e}")

def main():
    parser = argparse.ArgumentParser(description='Generate Excel report from PR lifecycle JSON data')
    parser.add_argument('--json', required=True, help='Input JSON file path')
    parser.add_argument('--csv', help='Input CSV file path (alternative to JSON)')
    parser.add_argument('--output', '-o', default='./reports/pr_lifecycle_report.xlsx', help='Output Excel file path')
    
    args = parser.parse_args()
    
    try:
        generator = PRLifecycleExcelGenerator()
        
        if args.json:
            generator.generate_excel_report(args.json, args.output)
        elif args.csv:
            # Convert CSV to required format for Excel generation
            print("📄 CSV input detected - converting to JSON format first...")
            df = pd.read_csv(args.csv)
            
            # Create minimal JSON structure from CSV
            json_data = {
                'date_range': {
                    'start_date': df['CREATED_AT'].min()[:10] if 'CREATED_AT' in df.columns else 'Unknown',
                    'end_date': df['CREATED_AT'].max()[:10] if 'CREATED_AT' in df.columns else 'Unknown',
                    'analysis_date': datetime.now().isoformat()
                },
                'summary': {
                    'TOTAL_PULL_REQUESTS': len(df),
                    'MERGED_PULL_REQUESTS': len(df[df['MERGED_AT'].notna()]) if 'MERGED_AT' in df.columns else 0,
                    'MERGE_SUCCESS_RATE_PERCENT': (len(df[df['MERGED_AT'].notna()]) / len(df) * 100) if 'MERGED_AT' in df.columns else 0,
                    'AVERAGE_CYCLE_TIME_HOURS': df['CYCLE_TIME_HOURS'].mean() if 'CYCLE_TIME_HOURS' in df.columns else 0,
                    'MEDIAN_CYCLE_TIME_HOURS': df['CYCLE_TIME_HOURS'].median() if 'CYCLE_TIME_HOURS' in df.columns else 0,
                    'AVERAGE_REVIEW_TIME_HOURS': df['REVIEW_TIME_HOURS'].mean() if 'REVIEW_TIME_HOURS' in df.columns else 0,
                    'AVERAGE_IDLE_TIME_HOURS': df['IDLE_TIME_HOURS'].mean() if 'IDLE_TIME_HOURS' in df.columns else 0,
                    'IDENTIFIED_BOTTLENECKS': []
                },
                'total': {},
                'detailed_analysis': {
                    'pull_requests': df.to_dict('records'),
                    'contributor_metrics': {},
                    'trends': []
                },
                'formulas': {}
            }
            
            # Temporarily save as JSON and process
            temp_json = args.output.replace('.xlsx', '_temp.json')
            with open(temp_json, 'w') as f:
                json.dump(json_data, f)
            
            generator.generate_excel_report(temp_json, args.output)
            
            # Clean up temp file
            Path(temp_json).unlink()
        else:
            print("❌ Either --json or --csv must be specified")
            sys.exit(1)
            
    except Exception as e:
        print(f"❌ Error generating Excel report: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()