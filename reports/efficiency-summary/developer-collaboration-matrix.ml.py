#!/usr/bin/env python3
"""
Developer Collaboration Matrix - ML Analysis Module

This module provides machine learning insights for GitHub collaboration data using
pandas, numpy, matplotlib, and seaborn. Analyzes collaboration patterns, predicts
team dynamics, and generates visualizations.

Usage:
    python main.ml.py --input report.json --output ./reports [options]
"""

import argparse
import json
import os
import sys
import warnings
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any, Tuple, Optional

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler
from sklearn.decomposition import PCA
from sklearn.metrics import silhouette_score
import matplotlib.dates as mdates

# Suppress warnings for cleaner output
warnings.filterwarnings('ignore')

class CollaborationMLAnalyzer:
    """Machine Learning analyzer for GitHub collaboration data."""
    
    def __init__(self, verbose: bool = False):
        self.verbose = verbose
        self.scaler = StandardScaler()
        self.data = None
        self.features_df = None
        self.clusters = None
        
    def load_data(self, file_path: str) -> Dict[str, Any]:
        """Load and validate collaboration data from JSON file."""
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            if self.verbose:
                print(f"✅ Loaded data from {file_path}")
                print(f"📊 Date range: {data.get('date_range', {}).get('start_date')} to {data.get('date_range', {}).get('end_date')}")
                
            self.data = data
            return data
            
        except FileNotFoundError:
            raise FileNotFoundError(f"Input file not found: {file_path}")
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON format: {e}")
        except Exception as e:
            raise Exception(f"Error loading data: {e}")
    
    def prepare_features(self) -> pd.DataFrame:
        """Extract and prepare features for ML analysis."""
        if not self.data:
            raise ValueError("No data loaded. Call load_data() first.")
        
        collaboration_data = self.data.get('detailed_analysis', {})
        user_stats = collaboration_data.get('collaboration_matrix', {}).get('user_stats', {})
        collaboration_scores = collaboration_data.get('collaboration_scores', {})
        
        if not user_stats:
            raise ValueError("No user statistics found in data")
        
        features = []
        
        for user, stats in user_stats.items():
            # Get collaboration scores for this user
            scores = collaboration_scores.get(user, {})
            
            feature_row = {
                'user': user,
                'prs_created': int(stats.get('prs_created', 0)),
                'reviews_given': int(stats.get('reviews_given', 0)),
                'comments_made': int(stats.get('comments_made', 0)),
                'collaborators': int(stats.get('collaborators', 0)),
                'diversity_score': float(scores.get('diversity_score', 0.0)),
                'activity_score': float(scores.get('activity_score', 0.0)),
                'intensity_score': float(scores.get('intensity_score', 0.0)),
                'collaboration_score': float(scores.get('collaboration_score', 0.0))
            }
            
            # Derived features
            feature_row['review_to_pr_ratio'] = (
                feature_row['reviews_given'] / max(feature_row['prs_created'], 1)
            )
            feature_row['comment_to_pr_ratio'] = (
                feature_row['comments_made'] / max(feature_row['prs_created'], 1)
            )
            feature_row['collaboration_efficiency'] = (
                feature_row['collaborators'] / max(feature_row['activity_score'], 1)
            )
            
            features.append(feature_row)
        
        self.features_df = pd.DataFrame(features)
        
        if self.verbose:
            print(f"🔧 Prepared features for {len(self.features_df)} users")
            print(f"📈 Feature columns: {list(self.features_df.columns)}")
        
        return self.features_df
    
    def normalize_data(self, features_to_normalize: List[str] = None) -> np.ndarray:
        """Normalize feature data for ML algorithms."""
        if self.features_df is None:
            raise ValueError("Features not prepared. Call prepare_features() first.")
        
        if features_to_normalize is None:
            features_to_normalize = [
                'prs_created', 'reviews_given', 'comments_made', 'collaborators',
                'diversity_score', 'activity_score', 'intensity_score',
                'review_to_pr_ratio', 'comment_to_pr_ratio', 'collaboration_efficiency'
            ]
        
        # Handle NaN and infinite values
        feature_data = self.features_df[features_to_normalize].copy()
        feature_data = feature_data.fillna(0)
        feature_data = feature_data.replace([np.inf, -np.inf], 0)
        
        normalized_data = self.scaler.fit_transform(feature_data)
        
        if self.verbose:
            print(f"🔄 Normalized {len(features_to_normalize)} features")
        
        return normalized_data
    
    def perform_clustering(self, n_clusters: int = None, max_clusters: int = 8) -> Dict[str, Any]:
        """Perform K-means clustering on collaboration data."""
        normalized_data = self.normalize_data()
        
        if len(normalized_data) < 2:
            if self.verbose:
                print("⚠️ Not enough data points for clustering")
            return {'clusters': [], 'labels': [], 'centers': [], 'optimal_k': 1}
        
        # Determine optimal number of clusters if not specified
        if n_clusters is None:
            n_clusters = self._find_optimal_clusters(normalized_data, max_clusters)
        
        # Adjust for small datasets
        n_clusters = min(n_clusters, len(normalized_data))
        
        if n_clusters < 2:
            if self.verbose:
                print("⚠️ Insufficient data for meaningful clustering")
            return {'clusters': [], 'labels': [0] * len(normalized_data), 'centers': [], 'optimal_k': 1}
        
        # Perform clustering
        kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
        cluster_labels = kmeans.fit_predict(normalized_data)
        
        # Create cluster analysis
        clusters = []
        for i in range(n_clusters):
            cluster_users = self.features_df[cluster_labels == i]['user'].tolist()
            cluster_stats = self.features_df[cluster_labels == i].describe()
            
            clusters.append({
                'cluster_id': int(i),
                'users': cluster_users,
                'size': len(cluster_users),
                'characteristics': self._describe_cluster(cluster_stats),
                'avg_collaboration_score': float(
                    self.features_df[cluster_labels == i]['collaboration_score'].mean()
                )
            })
        
        # Calculate silhouette score for clustering quality
        if len(set(cluster_labels)) > 1:
            silhouette_avg = silhouette_score(normalized_data, cluster_labels)
        else:
            silhouette_avg = 0.0
        
        self.clusters = {
            'clusters': clusters,
            'labels': cluster_labels.tolist(),
            'centers': kmeans.cluster_centers_.tolist(),
            'optimal_k': n_clusters,
            'silhouette_score': float(silhouette_avg)
        }
        
        if self.verbose:
            print(f"🎯 Performed clustering with {n_clusters} clusters")
            print(f"📊 Silhouette score: {silhouette_avg:.3f}")
        
        return self.clusters
    
    def _find_optimal_clusters(self, data: np.ndarray, max_clusters: int) -> int:
        """Find optimal number of clusters using elbow method."""
        max_clusters = min(max_clusters, len(data) - 1)
        
        if max_clusters < 2:
            return 1
        
        inertias = []
        k_range = range(2, max_clusters + 1)
        
        for k in k_range:
            kmeans = KMeans(n_clusters=k, random_state=42, n_init=10)
            kmeans.fit(data)
            inertias.append(kmeans.inertia_)
        
        # Simple elbow detection (largest decrease in inertia)
        if len(inertias) < 2:
            return 2
        
        decreases = [inertias[i] - inertias[i + 1] for i in range(len(inertias) - 1)]
        optimal_k = k_range[decreases.index(max(decreases))]
        
        return optimal_k
    
    def _describe_cluster(self, stats: pd.DataFrame) -> Dict[str, str]:
        """Generate cluster characteristics description."""
        characteristics = {}
        
        # Analyze key metrics
        collaboration_score = stats.loc['mean', 'collaboration_score']
        activity_score = stats.loc['mean', 'activity_score']
        diversity_score = stats.loc['mean', 'diversity_score']
        
        if collaboration_score > 15:
            characteristics['collaboration_level'] = 'High Collaborators'
        elif collaboration_score > 8:
            characteristics['collaboration_level'] = 'Moderate Collaborators'
        else:
            characteristics['collaboration_level'] = 'Emerging Collaborators'
        
        if activity_score > 20:
            characteristics['activity_level'] = 'Highly Active'
        elif activity_score > 10:
            characteristics['activity_level'] = 'Moderately Active'
        else:
            characteristics['activity_level'] = 'Low Activity'
        
        if diversity_score > 5:
            characteristics['network_reach'] = 'Broad Network'
        elif diversity_score > 2:
            characteristics['network_reach'] = 'Moderate Network'
        else:
            characteristics['network_reach'] = 'Limited Network'
        
        return characteristics
    
    def analyze_temporal_patterns(self) -> Dict[str, Any]:
        """Analyze temporal collaboration patterns."""
        if not self.data:
            raise ValueError("No data loaded. Call load_data() first.")
        
        temporal_data = self.data.get('detailed_analysis', {}).get('temporal_analysis', {})
        
        patterns = {
            'monthly_trends': self._analyze_monthly_trends(temporal_data.get('by_month', {})),
            'weekly_patterns': self._analyze_weekly_patterns(temporal_data.get('by_day_of_week', {})),
            'hourly_distribution': self._analyze_hourly_patterns(temporal_data.get('by_hour', {}))
        }
        
        return patterns
    
    def _analyze_monthly_trends(self, monthly_data: Dict[str, int]) -> Dict[str, Any]:
        """Analyze monthly collaboration trends."""
        if not monthly_data:
            return {'trend': 'No data', 'peak_month': None, 'total_months': 0}
        
        months = sorted(monthly_data.keys())
        values = [monthly_data[month] for month in months]
        
        # Calculate trend
        if len(values) > 1:
            x = np.arange(len(values))
            slope, _ = np.polyfit(x, values, 1)
            trend = 'Increasing' if slope > 0 else 'Decreasing' if slope < 0 else 'Stable'
        else:
            trend = 'Insufficient data'
        
        peak_month = max(monthly_data.items(), key=lambda x: x[1])[0] if monthly_data else None
        
        return {
            'trend': trend,
            'peak_month': peak_month,
            'total_months': len(months),
            'average_per_month': float(np.mean(values)) if values else 0.0
        }
    
    def _analyze_weekly_patterns(self, weekly_data: Dict[str, int]) -> Dict[str, Any]:
        """Analyze weekly collaboration patterns."""
        if not weekly_data:
            return {'most_active_day': None, 'weekend_activity': 0.0}
        
        weekend_days = ['Saturday', 'Sunday']
        weekend_activity = sum(weekly_data.get(day, 0) for day in weekend_days)
        total_activity = sum(weekly_data.values())
        weekend_percentage = (weekend_activity / total_activity * 100) if total_activity > 0 else 0.0
        
        most_active_day = max(weekly_data.items(), key=lambda x: x[1])[0] if weekly_data else None
        
        return {
            'most_active_day': most_active_day,
            'weekend_activity_percentage': float(weekend_percentage),
            'activity_distribution': dict(weekly_data)
        }
    
    def _analyze_hourly_patterns(self, hourly_data: Dict[str, int]) -> Dict[str, Any]:
        """Analyze hourly collaboration patterns."""
        if not hourly_data:
            return {'peak_hour': None, 'work_hours_percentage': 0.0}
        
        # Convert string keys to integers
        hourly_int_data = {int(k): v for k, v in hourly_data.items() if k.isdigit()}
        
        if not hourly_int_data:
            return {'peak_hour': None, 'work_hours_percentage': 0.0}
        
        work_hours = list(range(9, 18))  # 9 AM to 5 PM
        work_hours_activity = sum(hourly_int_data.get(hour, 0) for hour in work_hours)
        total_activity = sum(hourly_int_data.values())
        work_hours_percentage = (work_hours_activity / total_activity * 100) if total_activity > 0 else 0.0
        
        peak_hour = max(hourly_int_data.items(), key=lambda x: x[1])[0] if hourly_int_data else None
        
        return {
            'peak_hour': peak_hour,
            'work_hours_percentage': float(work_hours_percentage),
            'hourly_distribution': hourly_int_data
        }
    
    def generate_insights(self) -> Dict[str, Any]:
        """Generate comprehensive ML insights."""
        insights = {
            'clustering_analysis': self.clusters or {},
            'temporal_patterns': self.analyze_temporal_patterns(),
            'collaboration_recommendations': self._generate_recommendations(),
            'statistical_summary': self._generate_statistical_summary(),
            'anomaly_detection': self._detect_anomalies()
        }
        
        return insights
    
    def _generate_recommendations(self) -> List[Dict[str, str]]:
        """Generate actionable recommendations based on analysis."""
        recommendations = []
        
        if self.features_df is None or len(self.features_df) == 0:
            return recommendations
        
        # Analyze collaboration distribution
        high_collaborators = self.features_df[
            self.features_df['collaboration_score'] > self.features_df['collaboration_score'].quantile(0.8)
        ]
        low_collaborators = self.features_df[
            self.features_df['collaboration_score'] < self.features_df['collaboration_score'].quantile(0.2)
        ]
        
        if len(low_collaborators) > 0:
            recommendations.append({
                'type': 'collaboration_improvement',
                'priority': 'high',
                'description': f'Consider mentoring programs for {len(low_collaborators)} users with low collaboration scores',
                'affected_users': low_collaborators['user'].tolist()[:5]  # Limit to 5 for readability
            })
        
        # Check for isolated contributors
        isolated_users = self.features_df[self.features_df['collaborators'] <= 1]
        if len(isolated_users) > 0:
            recommendations.append({
                'type': 'network_expansion',
                'priority': 'medium',
                'description': f'Help {len(isolated_users)} isolated contributors expand their collaboration network',
                'affected_users': isolated_users['user'].tolist()[:5]
            })
        
        # Review ratio analysis
        low_reviewers = self.features_df[
            (self.features_df['prs_created'] > 0) & 
            (self.features_df['review_to_pr_ratio'] < 0.5)
        ]
        if len(low_reviewers) > 0:
            recommendations.append({
                'type': 'review_participation',
                'priority': 'medium',
                'description': f'Encourage {len(low_reviewers)} contributors to participate more in code reviews',
                'affected_users': low_reviewers['user'].tolist()[:5]
            })
        
        return recommendations
    
    def _generate_statistical_summary(self) -> Dict[str, Any]:
        """Generate statistical summary of collaboration data."""
        if self.features_df is None or len(self.features_df) == 0:
            return {}
        
        numeric_columns = [
            'prs_created', 'reviews_given', 'comments_made', 'collaborators',
            'collaboration_score', 'diversity_score', 'activity_score'
        ]
        
        summary = {}
        for col in numeric_columns:
            if col in self.features_df.columns:
                data = self.features_df[col].replace([np.inf, -np.inf], np.nan).dropna()
                if len(data) > 0:
                    summary[col] = {
                        'mean': float(data.mean()),
                        'median': float(data.median()),
                        'std': float(data.std()) if len(data) > 1 else 0.0,
                        'min': float(data.min()),
                        'max': float(data.max()),
                        'q25': float(data.quantile(0.25)),
                        'q75': float(data.quantile(0.75))
                    }
        
        return summary
    
    def _detect_anomalies(self) -> List[Dict[str, Any]]:
        """Detect collaboration anomalies using statistical methods."""
        anomalies = []
        
        if self.features_df is None or len(self.features_df) == 0:
            return anomalies
        
        # Z-score based anomaly detection
        numeric_cols = ['collaboration_score', 'activity_score', 'diversity_score']
        
        for col in numeric_cols:
            if col in self.features_df.columns:
                data = self.features_df[col].replace([np.inf, -np.inf], np.nan).dropna()
                if len(data) > 2:  # Need at least 3 points for meaningful z-score
                    z_scores = np.abs((data - data.mean()) / data.std())
                    outlier_indices = z_scores[z_scores > 2.5].index
                    
                    for idx in outlier_indices:
                        user = self.features_df.loc[idx, 'user']
                        value = float(self.features_df.loc[idx, col])
                        anomalies.append({
                            'user': user,
                            'metric': col,
                            'value': value,
                            'type': 'outlier',
                            'description': f'Unusual {col.replace("_", " ")} value for {user}'
                        })
        
        return anomalies
    
    def create_visualizations(self, output_dir: str) -> List[str]:
        """Create and save visualization plots."""
        if self.features_df is None:
            raise ValueError("Features not prepared. Call prepare_features() first.")
        
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)
        
        saved_plots = []
        
        # Set style
        plt.style.use('default')
        sns.set_palette("husl")
        
        try:
            # 1. Collaboration Score Distribution
            plt.figure(figsize=(10, 6))
            sns.histplot(data=self.features_df, x='collaboration_score', bins=20, kde=True)
            plt.title('Distribution of Collaboration Scores')
            plt.xlabel('Collaboration Score')
            plt.ylabel('Frequency')
            plot_path = output_path / 'collaboration_score_distribution.png'
            plt.savefig(plot_path, dpi=300, bbox_inches='tight')
            plt.close()
            saved_plots.append(str(plot_path))
            
            # 2. Collaboration vs Activity Scatter
            plt.figure(figsize=(10, 8))
            scatter = plt.scatter(
                self.features_df['activity_score'],
                self.features_df['collaboration_score'],
                c=self.features_df['diversity_score'],
                cmap='viridis',
                alpha=0.7,
                s=60
            )
            plt.colorbar(scatter, label='Diversity Score')
            plt.xlabel('Activity Score')
            plt.ylabel('Collaboration Score')
            plt.title('Collaboration vs Activity (colored by Diversity)')
            
            # Add user labels for top collaborators
            top_collaborators = self.features_df.nlargest(5, 'collaboration_score')
            for _, user in top_collaborators.iterrows():
                plt.annotate(
                    user['user'],
                    (user['activity_score'], user['collaboration_score']),
                    xytext=(5, 5),
                    textcoords='offset points',
                    fontsize=8,
                    alpha=0.8
                )
            
            plot_path = output_path / 'collaboration_vs_activity.png'
            plt.savefig(plot_path, dpi=300, bbox_inches='tight')
            plt.close()
            saved_plots.append(str(plot_path))
            
            # 3. Cluster Visualization (if clusters exist)
            if self.clusters and len(self.clusters.get('labels', [])) > 1:
                # PCA for dimensionality reduction
                normalized_data = self.normalize_data()
                if normalized_data.shape[1] > 2:
                    pca = PCA(n_components=2)
                    pca_data = pca.fit_transform(normalized_data)
                else:
                    pca_data = normalized_data
                
                plt.figure(figsize=(10, 8))
                cluster_labels = self.clusters['labels']
                scatter = plt.scatter(
                    pca_data[:, 0],
                    pca_data[:, 1],
                    c=cluster_labels,
                    cmap='tab10',
                    alpha=0.7,
                    s=60
                )
                plt.xlabel('First Principal Component')
                plt.ylabel('Second Principal Component')
                plt.title('User Clusters (PCA Visualization)')
                plt.colorbar(scatter, label='Cluster')
                
                plot_path = output_path / 'user_clusters.png'
                plt.savefig(plot_path, dpi=300, bbox_inches='tight')
                plt.close()
                saved_plots.append(str(plot_path))
            
            # 4. Feature Correlation Heatmap
            plt.figure(figsize=(12, 8))
            correlation_features = [
                'prs_created', 'reviews_given', 'comments_made', 'collaborators',
                'collaboration_score', 'diversity_score', 'activity_score'
            ]
            available_features = [f for f in correlation_features if f in self.features_df.columns]
            
            if len(available_features) > 1:
                corr_matrix = self.features_df[available_features].corr()
                sns.heatmap(
                    corr_matrix,
                    annot=True,
                    cmap='coolwarm',
                    center=0,
                    square=True,
                    fmt='.2f'
                )
                plt.title('Feature Correlation Matrix')
                plt.tight_layout()
                
                plot_path = output_path / 'feature_correlation.png'
                plt.savefig(plot_path, dpi=300, bbox_inches='tight')
                plt.close()
                saved_plots.append(str(plot_path))
            
            # 5. Top Contributors Bar Chart
            plt.figure(figsize=(12, 6))
            top_10 = self.features_df.nlargest(10, 'collaboration_score')
            
            bars = plt.bar(range(len(top_10)), top_10['collaboration_score'])
            plt.xlabel('Contributors')
            plt.ylabel('Collaboration Score')
            plt.title('Top 10 Contributors by Collaboration Score')
            plt.xticks(range(len(top_10)), top_10['user'], rotation=45, ha='right')
            
            # Color bars by score level
            for i, bar in enumerate(bars):
                if top_10.iloc[i]['collaboration_score'] > 15:
                    bar.set_color('green')
                elif top_10.iloc[i]['collaboration_score'] > 8:
                    bar.set_color('orange')
                else:
                    bar.set_color('red')
            
            plt.tight_layout()
            plot_path = output_path / 'top_contributors.png'
            plt.savefig(plot_path, dpi=300, bbox_inches='tight')
            plt.close()
            saved_plots.append(str(plot_path))
            
        except Exception as e:
            if self.verbose:
                print(f"⚠️ Warning: Error creating some visualizations: {e}")
        
        if self.verbose:
            print(f"📊 Created {len(saved_plots)} visualization plots")
        
        return saved_plots
    
    def save_insights(self, insights: Dict[str, Any], output_dir: str, filename: str = "ml_insights.json") -> str:
        """Save ML insights to JSON file."""
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)
        
        filepath = output_path / filename
        
        # Clean insights data to avoid JSON serialization issues
        cleaned_insights = self._clean_for_json(insights)
        
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(cleaned_insights, f, indent=2, ensure_ascii=False)
        
        if self.verbose:
            print(f"💾 Saved ML insights to {filepath}")
        
        return str(filepath)
    
    def _clean_for_json(self, obj):
        """Clean data for JSON serialization, handling numpy types and NaN values."""
        if isinstance(obj, dict):
            return {k: self._clean_for_json(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [self._clean_for_json(item) for item in obj]
        elif isinstance(obj, np.integer):
            return int(obj)
        elif isinstance(obj, np.floating):
            if np.isnan(obj) or np.isinf(obj):
                return None
            return float(obj)
        elif isinstance(obj, np.ndarray):
            return obj.tolist()
        elif pd.isna(obj):
            return None
        elif obj is np.inf or obj is -np.inf:
            return None
        else:
            return obj

def main():
    """Main execution function."""
    parser = argparse.ArgumentParser(
        description='Developer Collaboration Matrix - ML Analysis Module',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python main.ml.py --input ./reports/data.json --output ./reports
  python main.ml.py --input data.json --output ./ml_analysis --clusters 4 --verbose
  python main.ml.py --input report.json --output ./insights --visualize
        """
    )
    
    parser.add_argument(
        '--input', '-i',
        required=True,
        help='Input JSON file path from main.report.mjs'
    )
    
    parser.add_argument(
        '--output', '-o',
        default='./ml_analysis',
        help='Output directory for insights and visualizations (default: ./ml_analysis)'
    )
    
    parser.add_argument(
        '--clusters', '-c',
        type=int,
        help='Number of clusters for analysis (auto-determined if not specified)'
    )
    
    parser.add_argument(
        '--visualize',
        action='store_true',
        help='Generate visualization plots'
    )
    
    parser.add_argument(
        '--verbose', '-v',
        action='store_true',
        help='Enable verbose output'
    )
    
    args = parser.parse_args()
    
    try:
        # Initialize analyzer
        analyzer = CollaborationMLAnalyzer(verbose=args.verbose)
        
        if args.verbose:
            print("🚀 Starting ML analysis of collaboration data...")
        
        # Load and process data
        data = analyzer.load_data(args.input)
        features_df = analyzer.prepare_features()
        
        if len(features_df) == 0:
            print("❌ No collaboration data found in input file")
            sys.exit(1)
        
        # Perform clustering analysis
        clusters = analyzer.perform_clustering(n_clusters=args.clusters)
        
        # Generate comprehensive insights
        insights = analyzer.generate_insights()
        
        # Add metadata
        insights['metadata'] = {
            'analysis_timestamp': datetime.now().isoformat(),
            'input_file': args.input,
            'total_users_analyzed': len(features_df),
            'ml_model_info': {
                'clustering_algorithm': 'K-Means',
                'normalization_method': 'StandardScaler',
                'feature_count': len(features_df.columns) - 1  # Exclude 'user' column
            }
        }
        
        # Save insights
        insights_file = analyzer.save_insights(insights, args.output)
        
        # Generate visualizations if requested
        plot_files = []
        if args.visualize:
            try:
                plot_files = analyzer.create_visualizations(args.output)
            except Exception as e:
                print(f"⚠️ Warning: Failed to create visualizations: {e}")
        
        # Print summary
        print(f"\n🎯 ML ANALYSIS SUMMARY:")
        print(f"📊 Users analyzed: {len(features_df)}")
        
        if clusters and clusters.get('clusters'):
            print(f"🎪 Clusters identified: {len(clusters['clusters'])}")
            print(f"📈 Clustering quality (silhouette): {clusters.get('silhouette_score', 0):.3f}")
            
            # Show cluster summary
            for cluster in clusters['clusters']:
                print(f"  • Cluster {cluster['cluster_id']}: {cluster['size']} users ({cluster.get('characteristics', {}).get('collaboration_level', 'Unknown')})")
        
        if insights.get('collaboration_recommendations'):
            print(f"💡 Recommendations generated: {len(insights['collaboration_recommendations'])}")
        
        print(f"\n✅ Analysis complete!")
        print(f"📄 Insights saved: {insights_file}")
        
        if plot_files:
            print(f"📊 Visualizations created: {len(plot_files)} plots")
            for plot_file in plot_files:
                print(f"  • {plot_file}")
        
    except FileNotFoundError as e:
        print(f"❌ File not found: {e}")
        sys.exit(1)
    except ValueError as e:
        print(f"❌ Data error: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        if args.verbose:
            import traceback
            traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()