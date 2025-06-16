#!/usr/bin/env python3
"""
Commit-to-Merge Lead Time ML Analysis Tool

This tool performs machine learning analysis on GitHub pull request lead time data
to identify patterns, predict delivery times, and provide actionable insights.
"""

import json
import argparse
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from datetime import datetime, timedelta
import warnings
from pathlib import Path
import sys
from typing import Dict, List, Tuple, Optional
import logging

# Suppress warnings for cleaner output
warnings.filterwarnings('ignore')

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class LeadTimeMLAnalyzer:
    """Machine Learning analyzer for commit-to-merge lead times"""
    
    def __init__(self, verbose: bool = False):
        self.verbose = verbose
        self.data = None
        self.features = None
        self.insights = {}
        
    def load_data(self, file_path: str) -> pd.DataFrame:
        """Load and preprocess data from JSON report"""
        try:
            with open(file_path, 'r') as f:
                data = json.load(f)
            
            if 'detailed_analysis' not in data or 'pull_requests' not in data['detailed_analysis']:
                raise ValueError("Invalid data format: missing pull_requests data")
            
            # Convert to DataFrame
            prs = data['detailed_analysis']['pull_requests']
            df = pd.DataFrame(prs)
            
            # Clean and preprocess
            df = self._preprocess_data(df)
            
            if self.verbose:
                logger.info(f"Loaded {len(df)} pull requests from {file_path}")
                
            self.data = df
            return df
            
        except Exception as e:
            logger.error(f"Error loading data: {str(e)}")
            raise
    
    def _preprocess_data(self, df: pd.DataFrame) -> pd.DataFrame:
        """Preprocess the data for analysis"""
        # Convert timestamps
        if 'first_commit_timestamp' in df.columns:
            df['first_commit_timestamp'] = pd.to_datetime(df['first_commit_timestamp'], errors='coerce')
        if 'merge_timestamp' in df.columns:
            df['merge_timestamp'] = pd.to_datetime(df['merge_timestamp'], errors='coerce')
        
        # Fill missing values
        df['LEAD_TIME_HOURS'] = pd.to_numeric(df.get('LEAD_TIME_HOURS', 0), errors='coerce').fillna(0)
        df['LEAD_TIME_DAYS'] = pd.to_numeric(df.get('LEAD_TIME_DAYS', 0), errors='coerce').fillna(0)
        
        # Remove invalid records
        df = df[df['LEAD_TIME_HOURS'] > 0].copy()
        
        # Create additional features
        df = self._create_features(df)
        
        return df
    
    def _create_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Create engineered features for analysis"""
        # Time-based features
        if 'merge_timestamp' in df.columns:
            df['merge_hour'] = df['merge_timestamp'].dt.hour
            df['merge_day_of_week'] = df['merge_timestamp'].dt.dayofweek
            df['merge_month'] = df['merge_timestamp'].dt.month
            df['merge_year'] = df['merge_timestamp'].dt.year
        
        # Author features
        if 'author' in df.columns:
            author_stats = df.groupby('author').agg({
                'LEAD_TIME_HOURS': ['count', 'mean', 'std']
            }).round(2)
            author_stats.columns = ['author_pr_count', 'author_avg_lead_time', 'author_lead_time_std']
            df = df.merge(author_stats, left_on='author', right_index=True, how='left')
        
        # Repository features
        if 'repository' in df.columns:
            repo_stats = df.groupby('repository').agg({
                'LEAD_TIME_HOURS': ['count', 'mean', 'std']
            }).round(2)
            repo_stats.columns = ['repo_pr_count', 'repo_avg_lead_time', 'repo_lead_time_std']
            df = df.merge(repo_stats, left_on='repository', right_index=True, how='left')
        
        # Title length (proxy for complexity)
        if 'title' in df.columns:
            df['title_length'] = df['title'].str.len()
            df['title_word_count'] = df['title'].str.split().str.len()
        
        # Lead time categories
        df['lead_time_category'] = pd.cut(
            df['LEAD_TIME_HOURS'], 
            bins=[0, 24, 72, 168, float('inf')], 
            labels=['Fast', 'Medium', 'Slow', 'Very Slow']
        )
        
        return df
    
    def perform_clustering(self, n_clusters: int = 4) -> Dict:
        """Perform clustering analysis on lead times"""
        if self.data is None:
            raise ValueError("Data not loaded. Call load_data() first.")
        
        # Prepare features for clustering
        features = ['LEAD_TIME_HOURS', 'title_length', 'merge_hour', 'merge_day_of_week']
        available_features = [f for f in features if f in self.data.columns]
        
        if len(available_features) < 2:
            logger.warning("Insufficient features for clustering")
            return {}
        
        # Simple K-means implementation
        from sklearn.cluster import KMeans
        from sklearn.preprocessing import StandardScaler
        
        # Prepare data
        X = self.data[available_features].fillna(0)
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)
        
        # Perform clustering
        kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
        clusters = kmeans.fit_predict(X_scaled)
        
        # Add cluster labels to data
        self.data['cluster'] = clusters
        
        # Analyze clusters
        cluster_analysis = {}
        for i in range(n_clusters):
            cluster_data = self.data[self.data['cluster'] == i]
            cluster_analysis[f'cluster_{i}'] = {
                'count': len(cluster_data),
                'avg_lead_time_hours': float(cluster_data['LEAD_TIME_HOURS'].mean()),
                'avg_lead_time_days': float(cluster_data['LEAD_TIME_HOURS'].mean() / 24),
                'characteristics': self._describe_cluster(cluster_data, i)
            }
        
        return cluster_analysis
    
    def _describe_cluster(self, cluster_data: pd.DataFrame, cluster_id: int) -> str:
        """Generate description for a cluster"""
        avg_hours = cluster_data['LEAD_TIME_HOURS'].mean()
        
        if avg_hours < 24:
            return f"Fast Track - PRs processed within 24 hours"
        elif avg_hours < 72:
            return f"Standard Process - PRs processed within 3 days"
        elif avg_hours < 168:
            return f"Extended Review - PRs taking up to 1 week"
        else:
            return f"Long Cycle - PRs requiring extended development time"
    
    def temporal_analysis(self) -> Dict:
        """Analyze temporal patterns in lead times"""
        if self.data is None:
            raise ValueError("Data not loaded")
        
        temporal_insights = {}
        
        # Daily patterns
        if 'merge_day_of_week' in self.data.columns:
            daily_stats = self.data.groupby('merge_day_of_week')['LEAD_TIME_HOURS'].agg([
                'count', 'mean', 'median', 'std'
            ]).round(2)
            daily_stats.index = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
            temporal_insights['daily_patterns'] = daily_stats.to_dict('index')
        
        # Hourly patterns
        if 'merge_hour' in self.data.columns:
            hourly_stats = self.data.groupby('merge_hour')['LEAD_TIME_HOURS'].agg([
                'count', 'mean', 'median'
            ]).round(2)
            temporal_insights['hourly_patterns'] = hourly_stats.to_dict('index')
        
        # Monthly trends
        if 'merge_month' in self.data.columns:
            monthly_stats = self.data.groupby('merge_month')['LEAD_TIME_HOURS'].agg([
                'count', 'mean', 'median'
            ]).round(2)
            temporal_insights['monthly_trends'] = monthly_stats.to_dict('index')
        
        return temporal_insights
    
    def contributor_analysis(self) -> Dict:
        """Analyze contributor patterns"""
        if self.data is None or 'author' not in self.data.columns:
            return {}
        
        contributor_stats = self.data.groupby('author').agg({
            'LEAD_TIME_HOURS': ['count', 'mean', 'median', 'std'],
            'pr_number': 'count'
        }).round(2)
        
        contributor_stats.columns = ['pr_count', 'avg_lead_time', 'median_lead_time', 'lead_time_std', 'total_prs']
        
        # Identify patterns
        top_contributors = contributor_stats.nlargest(10, 'pr_count')
        fastest_contributors = contributor_stats[contributor_stats['pr_count'] >= 3].nsmallest(5, 'avg_lead_time')
        
        return {
            'top_contributors': top_contributors.to_dict('index'),
            'fastest_contributors': fastest_contributors.to_dict('index'),
            'total_contributors': len(contributor_stats)
        }
    
    def predictive_insights(self) -> Dict:
        """Generate predictive insights using simple statistical models"""
        if self.data is None:
            return {}
        
        insights = {}
        
        # Lead time distribution analysis
        lead_times = self.data['LEAD_TIME_HOURS'].dropna()
        
        insights['distribution_analysis'] = {
            'mean': float(lead_times.mean()),
            'median': float(lead_times.median()),
            'std': float(lead_times.std()),
            'skewness': float(lead_times.skew()),
            'kurtosis': float(lead_times.kurtosis())
        }
        
        # Anomaly detection (simple statistical approach)
        Q1 = lead_times.quantile(0.25)
        Q3 = lead_times.quantile(0.75)
        IQR = Q3 - Q1
        outlier_threshold = Q3 + 1.5 * IQR
        
        anomalies = self.data[self.data['LEAD_TIME_HOURS'] > outlier_threshold]
        
        insights['anomalies'] = {
            'count': len(anomalies),
            'threshold_hours': float(outlier_threshold),
            'percentage': float((len(anomalies) / len(self.data)) * 100)
        }
        
        # Trend analysis
        if 'merge_timestamp' in self.data.columns:
            # Weekly rolling average
            weekly_data = self.data.set_index('merge_timestamp').resample('W')['LEAD_TIME_HOURS'].mean()
            if len(weekly_data) > 1:
                trend_slope = np.polyfit(range(len(weekly_data)), weekly_data.fillna(0), 1)[0]
                insights['trend_analysis'] = {
                    'weekly_slope': float(trend_slope),
                    'trend_direction': 'improving' if trend_slope < 0 else 'declining' if trend_slope > 0 else 'stable'
                }
        
        return insights
    
    def generate_recommendations(self) -> List[str]:
        """Generate actionable recommendations based on analysis"""
        if self.data is None:
            return []
        
        recommendations = []
        
        # Average lead time recommendations
        avg_lead_time = self.data['LEAD_TIME_HOURS'].mean()
        if avg_lead_time > 168:  # More than 1 week
            recommendations.append("Consider implementing faster review processes - average lead time exceeds 1 week")
        elif avg_lead_time > 72:  # More than 3 days
            recommendations.append("Review workflow could be optimized - average lead time exceeds 3 days")
        
        # Variance recommendations
        std_lead_time = self.data['LEAD_TIME_HOURS'].std()
        if std_lead_time > avg_lead_time:
            recommendations.append("High variability in lead times detected - standardize review processes")
        
        # Contributor recommendations
        if 'author' in self.data.columns:
            author_counts = self.data['author'].value_counts()
            if len(author_counts) > 1 and author_counts.iloc[0] > len(self.data) * 0.5:
                recommendations.append("Consider distributing PR creation more evenly across team members")
        
        # Time-based recommendations
        if 'merge_day_of_week' in self.data.columns:
            weekend_merges = self.data[self.data['merge_day_of_week'].isin([5, 6])]
            if len(weekend_merges) > len(self.data) * 0.1:
                recommendations.append("Consider reducing weekend merges to improve work-life balance")
        
        return recommendations
    
    def create_visualizations(self, output_dir: str):
        """Create visualizations for the analysis"""
        output_path = Path(output_dir)
        output_path.mkdir(exist_ok=True)
        
        if self.data is None:
            logger.warning("No data available for visualization")
            return
        
        # Set style
        plt.style.use('seaborn-v0_8')
        sns.set_palette("husl")
        
        # Lead time distribution
        plt.figure(figsize=(12, 8))
        
        # Subplot 1: Histogram
        plt.subplot(2, 2, 1)
        plt.hist(self.data['LEAD_TIME_HOURS'], bins=30, alpha=0.7, edgecolor='black')
        plt.title('Lead Time Distribution')
        plt.xlabel('Lead Time (Hours)')
        plt.ylabel('Frequency')
        
        # Subplot 2: Box plot by category
        if 'lead_time_category' in self.data.columns:
            plt.subplot(2, 2, 2)
            sns.boxplot(data=self.data, x='lead_time_category', y='LEAD_TIME_HOURS')
            plt.title('Lead Time by Category')
            plt.xticks(rotation=45)
        
        # Subplot 3: Time series if available
        if 'merge_timestamp' in self.data.columns:
            plt.subplot(2, 2, 3)
            daily_avg = self.data.set_index('merge_timestamp').resample('D')['LEAD_TIME_HOURS'].mean()
            daily_avg.plot()
            plt.title('Lead Time Trend Over Time')
            plt.ylabel('Average Lead Time (Hours)')
        
        # Subplot 4: Top contributors
        if 'author' in self.data.columns:
            plt.subplot(2, 2, 4)
            top_authors = self.data['author'].value_counts().head(10)
            top_authors.plot(kind='bar')
            plt.title('Top Contributors by PR Count')
            plt.xlabel('Author')
            plt.ylabel('PR Count')
            plt.xticks(rotation=45)
        
        plt.tight_layout()
        plt.savefig(output_path / 'lead_time_analysis.png', dpi=300, bbox_inches='tight')
        plt.close()
        
        # Correlation matrix if we have enough features
        numeric_cols = self.data.select_dtypes(include=[np.number]).columns
        if len(numeric_cols) > 2:
            plt.figure(figsize=(10, 8))
            correlation_matrix = self.data[numeric_cols].corr()
            sns.heatmap(correlation_matrix, annot=True, cmap='coolwarm', center=0)
            plt.title('Feature Correlation Matrix')
            plt.tight_layout()
            plt.savefig(output_path / 'correlation_matrix.png', dpi=300, bbox_inches='tight')
            plt.close()
        
        logger.info(f"Visualizations saved to {output_path}")
    
    def generate_insights(self, n_clusters: int = 4) -> Dict:
        """Generate comprehensive ML insights"""
        if self.data is None:
            raise ValueError("Data not loaded")
        
        insights = {
            'data_summary': {
                'total_prs': len(self.data),
                'avg_lead_time_hours': float(self.data['LEAD_TIME_HOURS'].mean()),
                'median_lead_time_hours': float(self.data['LEAD_TIME_HOURS'].median()),
                'std_lead_time_hours': float(self.data['LEAD_TIME_HOURS'].std())
            },
            'clustering_analysis': self.perform_clustering(n_clusters),
            'temporal_analysis': self.temporal_analysis(),
            'contributor_analysis': self.contributor_analysis(),
            'predictive_insights': self.predictive_insights(),
            'recommendations': self.generate_recommendations(),
            'analysis_timestamp': datetime.now().isoformat()
        }
        
        self.insights = insights
        return insights
    
    def save_insights(self, output_path: str):
        """Save insights to JSON file"""
        if not self.insights:
            raise ValueError("No insights generated. Call generate_insights() first.")
        
        # Convert numpy types to Python types for JSON serialization
        def convert_types(obj):
            if isinstance(obj, dict):
                return {k: convert_types(v) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [convert_types(item) for item in obj]
            elif isinstance(obj, (np.integer, np.int64)):
                return int(obj)
            elif isinstance(obj, (np.floating, np.float64)):
                return float(obj)
            elif isinstance(obj, np.ndarray):
                return obj.tolist()
            elif pd.isna(obj):
                return None
            else:
                return obj
        
        cleaned_insights = convert_types(self.insights)
        
        try:
            with open(output_path, 'w') as f:
                json.dump(cleaned_insights, f, indent=2, default=str)
            logger.info(f"Insights saved to {output_path}")
        except Exception as e:
            logger.error(f"Error saving insights: {str(e)}")
            raise

def main():
    parser = argparse.ArgumentParser(description='ML Analysis for Commit-to-Merge Lead Times')
    parser.add_argument('--input', '-i', required=True, help='Input JSON file path')
    parser.add_argument('--output', '-o', default='./reports', help='Output directory')
    parser.add_argument('--clusters', '-c', type=int, default=4, help='Number of clusters for analysis')
    parser.add_argument('--visualize', action='store_true', help='Generate visualizations')
    parser.add_argument('--verbose', '-v', action='store_true', help='Verbose output')
    
    args = parser.parse_args()
    
    try:
        # Initialize analyzer
        analyzer = LeadTimeMLAnalyzer(verbose=args.verbose)
        
        # Load data
        print(f"📊 Loading data from {args.input}...")
        analyzer.load_data(args.input)
        
        # Generate insights
        print(f"🤖 Performing ML analysis with {args.clusters} clusters...")
        insights = analyzer.generate_insights(args.clusters)
        
        # Create output directory
        output_path = Path(args.output)
        output_path.mkdir(exist_ok=True)
        
        # Save insights
        insights_file = output_path / 'ml_insights.json'
        analyzer.save_insights(str(insights_file))
        
        # Generate visualizations if requested
        if args.visualize:
            print("📈 Generating visualizations...")
            analyzer.create_visualizations(args.output)
        
        # Print summary
        print("\n🎯 ANALYSIS SUMMARY")
        print("=" * 50)
        print(f"📊 Total PRs Analyzed: {insights['data_summary']['total_prs']}")
        print(f"⏱️  Average Lead Time: {insights['data_summary']['avg_lead_time_hours']:.1f} hours")
        print(f"📈 Median Lead Time: {insights['data_summary']['median_lead_time_hours']:.1f} hours")
        print(f"📊 Standard Deviation: {insights['data_summary']['std_lead_time_hours']:.1f} hours")
        
        if insights['clustering_analysis']:
            print(f"\n🎯 Identified {len(insights['clustering_analysis'])} distinct patterns:")
            for cluster_id, cluster_info in insights['clustering_analysis'].items():
                print(f"   • {cluster_info['characteristics']} ({cluster_info['count']} PRs)")
        
        if insights['recommendations']:
            print(f"\n💡 KEY RECOMMENDATIONS:")
            for i, rec in enumerate(insights['recommendations'], 1):
                print(f"   {i}. {rec}")
        
        print(f"\n✅ Analysis complete! Results saved to {args.output}")
        
    except Exception as e:
        logger.error(f"Analysis failed: {str(e)}")
        if args.verbose:
            import traceback
            traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()