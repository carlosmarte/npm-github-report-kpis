#!/usr/bin/env python3
"""
Machine Learning Analysis for Merge Readiness & Quality Score
Provides advanced insights using pandas, numpy, matplotlib, seaborn
"""

import json
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
import argparse
import os
from datetime import datetime, timedelta
from pathlib import Path
import warnings
from scipy import stats
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler
from sklearn.decomposition import PCA
import sys

warnings.filterwarnings('ignore')

class MergeReadinessMLAnalyzer:
    def __init__(self, verbose=False):
        self.verbose = verbose
        self.insights = {}
        
        # Set up matplotlib/seaborn styling
        plt.style.use('seaborn-v0_8')
        sns.set_palette("husl")
        
    def load_data(self, input_file):
        """Load and validate JSON data"""
        try:
            with open(input_file, 'r') as f:
                data = json.load(f)
            
            if self.verbose:
                print(f"✅ Loaded data from {input_file}")
                
            return data
        except Exception as e:
            raise Exception(f"Failed to load data: {str(e)}")
    
    def prepare_features(self, data):
        """Extract and prepare features for ML analysis"""
        features = []
        
        # Extract detailed analysis data
        detailed = data.get('detailed_analysis', {})
        
        # Lead time metrics
        lead_metrics = detailed.get('lead_time_metrics', {})
        features.append({
            'metric_type': 'lead_time',
            'avg_value': float(lead_metrics.get('avg_lead_time_hours', 0)),
            'median_value': float(lead_metrics.get('median_lead_time_hours', 0)),
            'p75_value': float(lead_metrics.get('p75_lead_time_hours', 0)),
            'p95_value': float(lead_metrics.get('p95_lead_time_hours', 0)),
            'min_value': float(lead_metrics.get('min_lead_time_hours', 0)),
            'max_value': float(lead_metrics.get('max_lead_time_hours', 0)),
            'total_samples': int(lead_metrics.get('total_pairs', 0))
        })
        
        # Responsiveness metrics
        resp_metrics = detailed.get('responsiveness_metrics', {})
        features.append({
            'metric_type': 'responsiveness',
            'avg_value': float(resp_metrics.get('avg_response_time_hours', 0)),
            'median_value': float(resp_metrics.get('median_response_time_hours', 0)),
            'p75_value': 0,  # Calculate from data if available
            'p95_value': float(resp_metrics.get('p95_response_time_hours', 0)),
            'min_value': 0,
            'max_value': 0,
            'total_samples': int(resp_metrics.get('contributor_count', 0))
        })
        
        # Quality metrics
        quality_metrics = detailed.get('quality_metrics', {})
        features.append({
            'metric_type': 'quality',
            'avg_value': float(quality_metrics.get('overall_score', 0)),
            'median_value': 0,
            'p75_value': 0,
            'p95_value': 0,
            'min_value': 0,
            'max_value': 100,
            'total_samples': int(quality_metrics.get('total_prs', 0))
        })
        
        return pd.DataFrame(features)
    
    def normalize_data(self, df):
        """Normalize numerical features"""
        numeric_cols = ['avg_value', 'median_value', 'p75_value', 'p95_value', 'min_value', 'max_value']
        
        scaler = StandardScaler()
        df_normalized = df.copy()
        df_normalized[numeric_cols] = scaler.fit_transform(df[numeric_cols])
        
        return df_normalized, scaler
    
    def perform_clustering(self, df, n_clusters=3):
        """Perform K-means clustering analysis"""
        numeric_cols = ['avg_value', 'median_value', 'p75_value', 'p95_value']
        
        # Prepare data for clustering
        cluster_data = df[numeric_cols].fillna(0)
        
        if len(cluster_data) < n_clusters:
            n_clusters = max(1, len(cluster_data))
        
        kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
        clusters = kmeans.fit_predict(cluster_data)
        
        df_clustered = df.copy()
        df_clustered['cluster'] = clusters
        
        # Label clusters based on performance
        cluster_labels = {}
        for i in range(n_clusters):
            cluster_avg = df_clustered[df_clustered['cluster'] == i]['avg_value'].mean()
            if cluster_avg < 24:  # Less than 1 day
                cluster_labels[i] = 'Fast Track'
            elif cluster_avg < 72:  # Less than 3 days
                cluster_labels[i] = 'Standard Process'
            else:
                cluster_labels[i] = 'Needs Improvement'
        
        df_clustered['cluster_label'] = df_clustered['cluster'].map(cluster_labels)
        
        return df_clustered, kmeans, cluster_labels
    
    def analyze_trends(self, data):
        """Analyze temporal trends"""
        trends = data.get('detailed_analysis', {}).get('trends', {})
        
        weekly_trends = trends.get('weekly', [])
        monthly_trends = trends.get('monthly', [])
        
        insights = {
            'weekly_analysis': self._analyze_trend_data(weekly_trends, 'weekly'),
            'monthly_analysis': self._analyze_trend_data(monthly_trends, 'monthly')
        }
        
        return insights
    
    def _analyze_trend_data(self, trend_data, period_type):
        """Analyze trend data for patterns"""
        if not trend_data:
            return {'trend_direction': 'no_data', 'seasonality': 'unknown'}
        
        df = pd.DataFrame(trend_data)
        if 'avg_lead_time' not in df.columns:
            return {'trend_direction': 'no_data', 'seasonality': 'unknown'}
        
        # Calculate trend direction using linear regression
        x = np.arange(len(df))
        y = df['avg_lead_time'].values
        
        if len(y) > 1:
            slope, intercept, r_value, p_value, std_err = stats.linregress(x, y)
            
            if p_value < 0.05:  # Significant trend
                trend_direction = 'improving' if slope < 0 else 'declining'
            else:
                trend_direction = 'stable'
        else:
            trend_direction = 'insufficient_data'
        
        # Detect seasonality (basic)
        if len(y) >= 4:
            seasonality_score = np.std(y) / np.mean(y) if np.mean(y) > 0 else 0
            seasonality = 'high' if seasonality_score > 0.5 else 'low'
        else:
            seasonality = 'unknown'
        
        return {
            'trend_direction': trend_direction,
            'seasonality': seasonality,
            'correlation_strength': float(r_value) if 'r_value' in locals() else 0.0,
            'data_points': int(len(df))
        }
    
    def detect_anomalies(self, df):
        """Detect anomalies using statistical methods"""
        anomalies = []
        
        for metric_type in df['metric_type'].unique():
            metric_data = df[df['metric_type'] == metric_type]
            
            # Use IQR method for anomaly detection
            Q1 = metric_data['avg_value'].quantile(0.25)
            Q3 = metric_data['avg_value'].quantile(0.75)
            IQR = Q3 - Q1
            
            lower_bound = Q1 - 1.5 * IQR
            upper_bound = Q3 + 1.5 * IQR
            
            metric_anomalies = metric_data[
                (metric_data['avg_value'] < lower_bound) | 
                (metric_data['avg_value'] > upper_bound)
            ]
            
            for _, anomaly in metric_anomalies.iterrows():
                anomalies.append({
                    'metric_type': str(anomaly['metric_type']),
                    'value': float(anomaly['avg_value']),
                    'expected_range': f"{float(lower_bound):.2f} - {float(upper_bound):.2f}",
                    'severity': 'high' if abs(anomaly['avg_value'] - metric_data['avg_value'].mean()) > 2 * metric_data['avg_value'].std() else 'medium'
                })
        
        return anomalies
    
    def generate_predictions(self, df, data):
        """Generate predictions for future performance"""
        predictions = {}
        
        # Extract trends for prediction
        trends = data.get('detailed_analysis', {}).get('trends', {})
        monthly_trends = trends.get('monthly', [])
        
        if len(monthly_trends) >= 3:
            df_trends = pd.DataFrame(monthly_trends)
            
            # Simple linear regression for next period prediction
            x = np.arange(len(df_trends))
            y = df_trends['avg_lead_time'].values
            
            if len(y) > 1:
                slope, intercept, _, _, _ = stats.linregress(x, y)
                next_value = slope * len(x) + intercept
                
                predictions['next_month_lead_time'] = {
                    'predicted_hours': float(max(0, next_value)),
                    'confidence': 'medium' if len(y) >= 6 else 'low',
                    'trend': 'improving' if slope < 0 else 'declining'
                }
        
        # Predict based on current metrics
        summary = data.get('summary', {})
        current_score = summary.get('merge_readiness_score', 0)
        
        predictions['performance_category'] = self._categorize_performance(current_score)
        
        return predictions
    
    def _categorize_performance(self, score):
        """Categorize performance based on score"""
        if score >= 85:
            return {'category': 'excellent', 'recommendation': 'maintain_current_practices'}
        elif score >= 70:
            return {'category': 'good', 'recommendation': 'minor_optimizations'}
        elif score >= 50:
            return {'category': 'needs_improvement', 'recommendation': 'process_review_required'}
        else:
            return {'category': 'critical', 'recommendation': 'immediate_intervention_needed'}
    
    def create_visualizations(self, df, data, output_dir):
        """Create visualization plots"""
        visualizations = []
        
        try:
            # 1. Lead Time Distribution
            plt.figure(figsize=(10, 6))
            lead_data = data.get('detailed_analysis', {}).get('lead_time_metrics', {})
            
            if lead_data.get('total_pairs', 0) > 0:
                # Create synthetic distribution for visualization
                avg = lead_data.get('avg_lead_time_hours', 24)
                median = lead_data.get('median_lead_time_hours', 20)
                
                # Generate sample data based on statistics
                sample_data = np.random.gamma(2, avg/2, 100)
                
                plt.hist(sample_data, bins=20, alpha=0.7, color='skyblue', edgecolor='black')
                plt.axvline(avg, color='red', linestyle='--', label=f'Average: {avg}h')
                plt.axvline(median, color='green', linestyle='--', label=f'Median: {median}h')
                plt.xlabel('Lead Time (hours)')
                plt.ylabel('Frequency')
                plt.title('Lead Time Distribution')
                plt.legend()
                plt.grid(True, alpha=0.3)
                
                viz_path = os.path.join(output_dir, 'lead_time_distribution.png')
                plt.savefig(viz_path, dpi=300, bbox_inches='tight')
                visualizations.append(viz_path)
                plt.close()
            
            # 2. Trends Over Time
            trends = data.get('detailed_analysis', {}).get('trends', {})
            monthly_trends = trends.get('monthly', [])
            
            if monthly_trends:
                plt.figure(figsize=(12, 6))
                df_trends = pd.DataFrame(monthly_trends)
                
                plt.plot(range(len(df_trends)), df_trends['avg_lead_time'], 
                        marker='o', linewidth=2, markersize=6)
                plt.xlabel('Time Period')
                plt.ylabel('Average Lead Time (hours)')
                plt.title('Lead Time Trends Over Time')
                plt.grid(True, alpha=0.3)
                
                # Add trend line
                x = np.arange(len(df_trends))
                z = np.polyfit(x, df_trends['avg_lead_time'], 1)
                p = np.poly1d(z)
                plt.plot(x, p(x), '--', alpha=0.7, color='red', label='Trend Line')
                plt.legend()
                
                viz_path = os.path.join(output_dir, 'trends_over_time.png')
                plt.savefig(viz_path, dpi=300, bbox_inches='tight')
                visualizations.append(viz_path)
                plt.close()
            
            # 3. Quality Metrics Radar Chart
            quality_metrics = data.get('detailed_analysis', {}).get('quality_metrics', {})
            
            if quality_metrics:
                fig, ax = plt.subplots(figsize=(8, 8), subplot_kw=dict(projection='polar'))
                
                metrics = ['Overall Score', 'Merge Success Rate', 'Avg Comments', 'Comment/LOC Ratio']
                values = [
                    quality_metrics.get('overall_score', 0),
                    quality_metrics.get('merge_success_rate', 0),
                    min(100, quality_metrics.get('avg_comments_per_pr', 0) * 10),  # Scale to 0-100
                    min(100, quality_metrics.get('comment_to_loc_ratio', 0) * 100)  # Scale to 0-100
                ]
                
                angles = np.linspace(0, 2 * np.pi, len(metrics), endpoint=False)
                values += values[:1]  # Complete the circle
                angles = np.concatenate((angles, [angles[0]]))
                
                ax.plot(angles, values, 'o-', linewidth=2)
                ax.fill(angles, values, alpha=0.25)
                ax.set_xticks(angles[:-1])
                ax.set_xticklabels(metrics)
                ax.set_ylim(0, 100)
                ax.set_title('Quality Metrics Overview', y=1.08)
                
                viz_path = os.path.join(output_dir, 'quality_radar.png')
                plt.savefig(viz_path, dpi=300, bbox_inches='tight')
                visualizations.append(viz_path)
                plt.close()
            
        except Exception as e:
            print(f"⚠️ Warning: Could not create some visualizations: {str(e)}")
        
        return visualizations
    
    def analyze(self, input_file, output_dir, n_clusters=3, create_viz=False):
        """Main analysis function"""
        print("🔬 Starting ML Analysis...")
        
        # Load data
        data = self.load_data(input_file)
        
        # Prepare features
        df = self.prepare_features(data)
        
        if self.verbose:
            print(f"📊 Prepared {len(df)} feature sets")
        
        # Normalize data
        df_normalized, scaler = self.normalize_data(df)
        
        # Perform clustering
        df_clustered, kmeans, cluster_labels = self.perform_clustering(df_normalized, n_clusters)
        
        # Analyze trends
        trend_insights = self.analyze_trends(data)
        
        # Detect anomalies
        anomalies = self.detect_anomalies(df)
        
        # Generate predictions
        predictions = self.generate_predictions(df, data)
        
        # Create visualizations if requested
        visualizations = []
        if create_viz:
            visualizations = self.create_visualizations(df, data, output_dir)
        
        # Compile insights
        self.insights = {
            'analysis_timestamp': datetime.now().isoformat(),
            'data_summary': {
                'total_metrics': int(len(df)),
                'clusters_identified': int(len(cluster_labels)),
                'anomalies_detected': int(len(anomalies))
            },
            'clustering_analysis': {
                'cluster_labels': {str(k): str(v) for k, v in cluster_labels.items()},
                'recommendations': self._generate_cluster_recommendations(df_clustered)
            },
            'trend_analysis': trend_insights,
            'anomaly_detection': anomalies,
            'predictions': predictions,
            'performance_insights': self._generate_performance_insights(data),
            'visualizations': visualizations,
            'statistical_summary': self._generate_statistical_summary(df)
        }
        
        return self.insights
    
    def _generate_cluster_recommendations(self, df_clustered):
        """Generate recommendations based on clustering"""
        recommendations = []
        
        for cluster_id in df_clustered['cluster'].unique():
            cluster_data = df_clustered[df_clustered['cluster'] == cluster_id]
            cluster_label = cluster_data['cluster_label'].iloc[0]
            avg_performance = cluster_data['avg_value'].mean()
            
            if cluster_label == 'Fast Track':
                recommendations.append({
                    'cluster': str(cluster_label),
                    'action': 'maintain_excellence',
                    'priority': 'low',
                    'description': 'Continue current practices that enable fast delivery'
                })
            elif cluster_label == 'Standard Process':
                recommendations.append({
                    'cluster': str(cluster_label),
                    'action': 'optimize_process',
                    'priority': 'medium', 
                    'description': 'Look for opportunities to streamline workflow'
                })
            else:
                recommendations.append({
                    'cluster': str(cluster_label),
                    'action': 'immediate_improvement',
                    'priority': 'high',
                    'description': 'Requires urgent attention to reduce delays'
                })
        
        return recommendations
    
    def _generate_performance_insights(self, data):
        """Generate performance insights"""
        summary = data.get('summary', {})
        
        insights = []
        
        # Lead time insights
        avg_lead_time = summary.get('avg_lead_time_hours', 0)
        if avg_lead_time > 72:  # > 3 days
            insights.append({
                'category': 'lead_time',
                'severity': 'high',
                'message': f'Average lead time of {avg_lead_time} hours exceeds recommended threshold',
                'recommendation': 'Review issue assignment and sprint planning processes'
            })
        elif avg_lead_time > 24:  # > 1 day
            insights.append({
                'category': 'lead_time',
                'severity': 'medium',
                'message': f'Lead time of {avg_lead_time} hours has room for improvement',
                'recommendation': 'Consider implementing faster handoff processes'
            })
        
        # Quality insights
        quality_score = summary.get('quality_score', 0)
        if quality_score < 50:
            insights.append({
                'category': 'quality',
                'severity': 'high',
                'message': f'Quality score of {quality_score} is below acceptable standards',
                'recommendation': 'Implement stricter review processes and coding standards'
            })
        
        # Merge readiness insights
        readiness_score = summary.get('merge_readiness_score', 0)
        if readiness_score < 70:
            insights.append({
                'category': 'readiness',
                'severity': 'medium',
                'message': f'Merge readiness score of {readiness_score} indicates process inefficiencies',
                'recommendation': 'Focus on reducing bottlenecks and improving collaboration'
            })
        
        return insights
    
    def _generate_statistical_summary(self, df):
        """Generate statistical summary"""
        numeric_cols = ['avg_value', 'median_value', 'p75_value', 'p95_value']
        
        summary = {}
        for col in numeric_cols:
            if col in df.columns:
                summary[col] = {
                    'mean': float(df[col].mean()),
                    'std': float(df[col].std()),
                    'min': float(df[col].min()),
                    'max': float(df[col].max()),
                    'skewness': float(stats.skew(df[col].dropna()))
                }
        
        return summary
    
    def save_insights(self, output_file):
        """Save insights to JSON file"""
        # Convert numpy types to Python native types to avoid JSON serialization errors
        def convert_types(obj):
            if isinstance(obj, dict):
                return {k: convert_types(v) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [convert_types(v) for v in obj]
            elif isinstance(obj, (np.integer, np.int64, np.int32)):
                return int(obj)
            elif isinstance(obj, (np.floating, np.float64, np.float32)):
                return float(obj)
            elif isinstance(obj, np.ndarray):
                return obj.tolist()
            else:
                return obj
        
        cleaned_insights = convert_types(self.insights)
        
        try:
            with open(output_file, 'w') as f:
                json.dump(cleaned_insights, f, indent=2, default=str)
            
            if self.verbose:
                print(f"💾 Insights saved to {output_file}")
                
        except Exception as e:
            raise Exception(f"Failed to save insights: {str(e)}")

def main():
    parser = argparse.ArgumentParser(description='ML Analysis for Merge Readiness Data')
    parser.add_argument('-i', '--input', required=True, help='Input JSON file path')
    parser.add_argument('-o', '--output', default='./reports', help='Output directory')
    parser.add_argument('-c', '--clusters', type=int, default=3, help='Number of clusters')
    parser.add_argument('-v', '--verbose', action='store_true', help='Verbose output')
    parser.add_argument('--visualize', action='store_true', help='Create visualizations')
    
    args = parser.parse_args()
    
    try:
        # Create output directory
        os.makedirs(args.output, exist_ok=True)
        
        # Initialize analyzer
        analyzer = MergeReadinessMLAnalyzer(verbose=args.verbose)
        
        # Run analysis
        insights = analyzer.analyze(
            args.input, 
            args.output, 
            n_clusters=args.clusters,
            create_viz=args.visualize
        )
        
        # Save insights
        output_file = os.path.join(args.output, 'ml_insights.json')
        analyzer.save_insights(output_file)
        
        # Print summary
        print("\n🎯 ML ANALYSIS RESULTS")
        print("=" * 40)
        print(f"📊 Metrics Analyzed: {insights['data_summary']['total_metrics']}")
        print(f"🎯 Clusters Found: {insights['data_summary']['clusters_identified']}")
        print(f"⚠️  Anomalies Detected: {insights['data_summary']['anomalies_detected']}")
        print(f"🔮 Predictions Generated: {len(insights['predictions'])}")
        
        if args.visualize:
            print(f"📈 Visualizations Created: {len(insights['visualizations'])}")
        
        print(f"\n💾 Full analysis saved to: {output_file}")
        
    except Exception as e:
        print(f"❌ Analysis failed: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    main()