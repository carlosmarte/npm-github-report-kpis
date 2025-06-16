#!/usr/bin/env python3
"""
Stale PR Audit ML Analysis
Provides machine learning insights for abandoned and stale PR patterns.
"""

import json
import sys
import argparse
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
from datetime import datetime, timedelta
import warnings
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple
import logging

# Suppress warnings for cleaner output
warnings.filterwarnings('ignore')

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


class StalePRMLAnalyzer:
    """Machine learning analyzer for stale pull request patterns."""
    
    def __init__(self, verbose: bool = False) -> None:
        """Initialize the analyzer.
        
        Args:
            verbose: Enable verbose output
        """
        self.verbose = verbose
        self.insights: Dict[str, Any] = {}
        self.processed_data: Optional[pd.DataFrame] = None
        self.data: Dict[str, Any] = {}
        
    def load_data(self, input_file: str) -> Dict[str, Any]:
        """Load and validate input JSON data.
        
        Args:
            input_file: Path to the JSON file
            
        Returns:
            Loaded data dictionary
            
        Raises:
            Exception: If data loading fails
        """
        try:
            with open(input_file, 'r', encoding='utf-8') as f:
                self.data = json.load(f)
            
            if self.verbose:
                pr_count = len(self.data.get('detailed_analysis', {}).get('pull_requests', []))
                logger.info(f"✅ Loaded data with {pr_count} PRs")
            
            return self.data
        except Exception as e:
            raise Exception(f"Failed to load data: {str(e)}")
    
    def prepare_features(self) -> pd.DataFrame:
        """Extract and prepare features for ML analysis.
        
        Returns:
            DataFrame with prepared features
            
        Raises:
            Exception: If feature preparation fails
        """
        prs = self.data.get('detailed_analysis', {}).get('pull_requests', [])
        
        if not prs:
            raise Exception("No pull request data found")
        
        features = []
        for pr in prs:
            try:
                # Convert dates to datetime objects
                created_at = pd.to_datetime(pr['created_at'])
                updated_at = pd.to_datetime(pr['updated_at'])
                
                # Extract features safely
                feature_row = {
                    'pr_number': pr['number'],
                    'title_length': len(pr.get('title', '')),
                    'author': pr.get('user', {}).get('login', 'unknown'),
                    'state': pr.get('state', 'unknown'),
                    'created_hour': created_at.hour,
                    'created_day_of_week': created_at.dayofweek,
                    'inactive_days': pr.get('inactivity_duration', {}).get('days', 0),
                    'inactive_hours': pr.get('inactivity_duration', {}).get('total_hours', 0),
                    'reason_category': pr.get('inactivity_analysis', {}).get('category', 'unknown'),
                    'priority': pr.get('inactivity_analysis', {}).get('priority', 'low'),
                    'review_count': pr.get('details', {}).get('review_count', 0),
                    'comment_count': pr.get('details', {}).get('comment_count', 0),
                    'commit_count': pr.get('details', {}).get('commit_count', 0),
                    'failing_checks': pr.get('details', {}).get('failing_checks', 0),
                    'total_checks': pr.get('details', {}).get('total_checks', 0),
                    'is_draft': pr.get('draft', False),
                    'mergeable': pr.get('mergeable', None),
                    'additions': pr.get('additions', 0),
                    'deletions': pr.get('deletions', 0),
                    'changed_files': pr.get('changed_files', 0),
                    'repository': pr.get('repository_name', 
                                       pr.get('base', {}).get('repo', {}).get('full_name', 'unknown'))
                }
                
                # Calculate derived features
                feature_row['total_changes'] = feature_row['additions'] + feature_row['deletions']
                feature_row['check_failure_rate'] = (
                    feature_row['failing_checks'] / max(feature_row['total_checks'], 1)
                )
                feature_row['engagement_score'] = (
                    feature_row['review_count'] + feature_row['comment_count']
                )
                
                features.append(feature_row)
                
            except Exception as e:
                if self.verbose:
                    logger.warning(f"⚠️ Skipping PR #{pr.get('number', 'unknown')}: {str(e)}")
                continue
        
        self.processed_data = pd.DataFrame(features)
        
        if self.verbose:
            logger.info(f"✅ Prepared {len(self.processed_data)} feature rows")
            
        return self.processed_data
    
    def analyze_abandonment_patterns(self) -> Dict[str, Any]:
        """Analyze patterns in PR abandonment using statistical methods.
        
        Returns:
            Dictionary containing abandonment analysis results
            
        Raises:
            Exception: If data not prepared
        """
        if self.processed_data is None:
            raise Exception("Data not prepared. Call prepare_features() first.")
        
        df = self.processed_data.copy()
        
        # Abandonment classification
        df['is_abandoned'] = df['reason_category'].isin(['abandoned', 'stale', 'failing_ci'])
        df['is_highly_inactive'] = df['inactive_days'] > 30
        
        # Time-based patterns with fixed indexing
        hour_abandonment = df.groupby('created_hour')['is_abandoned'].agg(['count', 'mean'])
        # Ensure all hours are represented
        hour_abandonment = hour_abandonment.reindex(range(24), fill_value=0)
        
        weekday_abandonment = df.groupby('created_day_of_week')['is_abandoned'].agg(['count', 'mean'])
        # Ensure all weekdays are represented
        weekday_abandonment = weekday_abandonment.reindex(range(7), fill_value=0)
        
        time_patterns = {
            'creation_hour_distribution': hour_abandonment.to_dict(),
            'weekday_distribution': weekday_abandonment.to_dict(),
            'high_risk_hours': df[df['is_abandoned']]['created_hour'].mode().tolist() if df['is_abandoned'].any() else [],
            'high_risk_weekdays': df[df['is_abandoned']]['created_day_of_week'].mode().tolist() if df['is_abandoned'].any() else []
        }
        
        # Author patterns
        author_stats = df.groupby('author').agg({
            'is_abandoned': ['count', 'mean'],
            'inactive_days': 'mean',
            'engagement_score': 'mean'
        }).round(2)
        
        # Repository patterns
        repo_stats = df.groupby('repository').agg({
            'is_abandoned': ['count', 'mean'],
            'inactive_days': 'mean',
            'check_failure_rate': 'mean'
        }).round(2)
        
        # Size-based analysis
        size_analysis = {
            'small_prs': df[df['total_changes'] < 100]['is_abandoned'].mean() if len(df[df['total_changes'] < 100]) > 0 else 0,
            'medium_prs': df[(df['total_changes'] >= 100) & (df['total_changes'] < 500)]['is_abandoned'].mean() if len(df[(df['total_changes'] >= 100) & (df['total_changes'] < 500)]) > 0 else 0,
            'large_prs': df[df['total_changes'] >= 500]['is_abandoned'].mean() if len(df[df['total_changes'] >= 500]) > 0 else 0
        }
        
        self.insights['abandonment_patterns'] = {
            'time_patterns': time_patterns,
            'author_insights': {
                'high_abandonment_authors': author_stats[author_stats[('is_abandoned', 'mean')] > 0.5].index.tolist()[:10] if len(author_stats) > 0 else [],
                'most_active_authors': author_stats.sort_values(('engagement_score', 'mean'), ascending=False).index.tolist()[:10] if len(author_stats) > 0 else []
            },
            'repository_insights': {
                'problematic_repos': repo_stats[repo_stats[('is_abandoned', 'mean')] > 0.4].index.tolist()[:10] if len(repo_stats) > 0 else [],
                'healthiest_repos': repo_stats[repo_stats[('is_abandoned', 'mean')] < 0.2].index.tolist()[:10] if len(repo_stats) > 0 else []
            },
            'size_impact': size_analysis
        }
        
        return self.insights['abandonment_patterns']
    
    def perform_clustering(self, n_clusters: int = 4) -> Dict[str, Any]:
        """Perform K-means clustering on PR characteristics.
        
        Args:
            n_clusters: Number of clusters to create
            
        Returns:
            Dictionary containing clustering analysis results
        """
        df = self.processed_data.copy()
        
        # Select features for clustering
        cluster_features = [
            'inactive_days', 'engagement_score', 'total_changes',
            'check_failure_rate', 'commit_count'
        ]
        
        # Handle missing values and ensure we have data
        cluster_data = df[cluster_features].fillna(0)
        
        if len(cluster_data) < n_clusters:
            logger.warning(f"Not enough data points ({len(cluster_data)}) for {n_clusters} clusters. Reducing clusters.")
            n_clusters = max(1, len(cluster_data))
        
        try:
            from sklearn.preprocessing import StandardScaler
            from sklearn.cluster import KMeans
            
            # Normalize features
            scaler = StandardScaler()
            normalized_data = scaler.fit_transform(cluster_data)
            
            # Perform K-means clustering
            kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
            df['cluster'] = kmeans.fit_predict(normalized_data)
            
            # Analyze clusters
            cluster_analysis = {}
            for i in range(n_clusters):
                cluster_data_subset = df[df['cluster'] == i]
                cluster_analysis[f'cluster_{i}'] = {
                    'size': len(cluster_data_subset),
                    'avg_inactive_days': float(cluster_data_subset['inactive_days'].mean()),
                    'avg_engagement': float(cluster_data_subset['engagement_score'].mean()),
                    'avg_changes': float(cluster_data_subset['total_changes'].mean()),
                    'abandonment_rate': float(cluster_data_subset['reason_category'].isin(['abandoned', 'stale']).mean()),
                    'dominant_reason': cluster_data_subset['reason_category'].mode().iloc[0] if len(cluster_data_subset) > 0 else 'unknown',
                    'characteristics': self._describe_cluster(cluster_data_subset)
                }
            
            self.insights['clustering'] = cluster_analysis
            
        except ImportError:
            logger.error("scikit-learn not available. Skipping clustering analysis.")
            self.insights['clustering'] = {}
        except Exception as e:
            logger.error(f"Clustering failed: {e}")
            self.insights['clustering'] = {}
            
        return self.insights.get('clustering', {})
    
    def _describe_cluster(self, cluster_data: pd.DataFrame) -> List[str]:
        """Generate descriptive characteristics for a cluster.
        
        Args:
            cluster_data: DataFrame containing cluster data
            
        Returns:
            List of descriptive characteristics
        """
        characteristics = []
        
        if len(cluster_data) == 0:
            return ['Empty cluster']
        
        avg_inactive = cluster_data['inactive_days'].mean()
        avg_engagement = cluster_data['engagement_score'].mean()
        avg_changes = cluster_data['total_changes'].mean()
        
        if avg_inactive > 60:
            characteristics.append("Long-term inactive")
        elif avg_inactive > 30:
            characteristics.append("Medium-term inactive")
        else:
            characteristics.append("Recently inactive")
            
        if avg_engagement > 5:
            characteristics.append("High engagement")
        elif avg_engagement > 2:
            characteristics.append("Moderate engagement")
        else:
            characteristics.append("Low engagement")
            
        if avg_changes > 1000:
            characteristics.append("Large changes")
        elif avg_changes > 100:
            characteristics.append("Medium changes")
        else:
            characteristics.append("Small changes")
        
        return characteristics
    
    def predict_risk_scores(self) -> Dict[str, Any]:
        """Calculate risk scores for PR abandonment.
        
        Returns:
            Dictionary containing risk analysis results
        """
        df = self.processed_data.copy()
        
        # Define risk factors and weights
        risk_factors = {
            'inactive_days': 0.3,
            'check_failure_rate': 0.25,
            'engagement_score': -0.2,  # Negative because higher engagement reduces risk
            'total_changes': 0.1,
            'commit_count': -0.05
        }
        
        # Normalize factors to 0-1 scale
        normalized_df = df.copy()
        for factor in risk_factors.keys():
            if factor in df.columns:
                max_val = df[factor].max()
                if max_val > 0:
                    normalized_df[factor] = df[factor] / max_val
                else:
                    normalized_df[factor] = 0
        
        # Calculate risk scores
        risk_scores = np.zeros(len(df))
        for factor, weight in risk_factors.items():
            if factor in normalized_df.columns:
                risk_scores += normalized_df[factor] * weight
        
        # Normalize to 0-100 scale and handle negative values
        risk_scores = np.clip(risk_scores * 100, 0, 100)
        df['risk_score'] = risk_scores
        
        # Categorize risk levels
        df['risk_level'] = pd.cut(df['risk_score'], 
                                bins=[0, 25, 50, 75, 100], 
                                labels=['Low', 'Medium', 'High', 'Critical'],
                                include_lowest=True)
        
        risk_analysis = {
            'high_risk_prs': df[df['risk_score'] > 75][['pr_number', 'risk_score', 'reason_category']].to_dict('records'),
            'risk_distribution': df['risk_level'].value_counts().to_dict(),
            'avg_risk_by_category': df.groupby('reason_category')['risk_score'].mean().to_dict()
        }
        
        self.insights['risk_analysis'] = risk_analysis
        return risk_analysis
    
    def generate_recommendations(self) -> List[Dict[str, str]]:
        """Generate actionable recommendations based on analysis.
        
        Returns:
            List of recommendation dictionaries
        """
        recommendations = []
        
        # Check abandonment patterns
        if 'abandonment_patterns' in self.insights:
            patterns = self.insights['abandonment_patterns']
            
            # Time-based recommendations
            if patterns.get('time_patterns', {}).get('high_risk_hours'):
                recommendations.append({
                    'category': 'Timing',
                    'priority': 'Medium',
                    'suggestion': f"PRs created during hours {patterns['time_patterns']['high_risk_hours']} show higher abandonment rates. Consider team availability during these times."
                })
            
            # Author-based recommendations
            if patterns.get('author_insights', {}).get('high_abandonment_authors'):
                recommendations.append({
                    'category': 'Team Management',
                    'priority': 'High',
                    'suggestion': "Several authors show high PR abandonment rates. Consider mentoring or workflow training for these contributors."
                })
            
            # Repository-based recommendations
            if patterns.get('repository_insights', {}).get('problematic_repos'):
                recommendations.append({
                    'category': 'Repository Health',
                    'priority': 'High',
                    'suggestion': "Some repositories show consistently high abandonment rates. Review CI/CD pipelines and contribution guidelines."
                })
            
            # Size-based recommendations
            size_impact = patterns.get('size_impact', {})
            if size_impact.get('large_prs', 0) > 0.5:
                recommendations.append({
                    'category': 'PR Guidelines',
                    'priority': 'Medium',
                    'suggestion': "Large PRs (>500 changes) have higher abandonment rates. Encourage smaller, focused PRs."
                })
        
        # Risk-based recommendations
        if 'risk_analysis' in self.insights:
            risk_data = self.insights['risk_analysis']
            high_risk_count = len(risk_data.get('high_risk_prs', []))
            
            if high_risk_count > 5:
                recommendations.append({
                    'category': 'Immediate Action',
                    'priority': 'Critical',
                    'suggestion': f"Found {high_risk_count} high-risk PRs requiring immediate attention to prevent abandonment."
                })
        
        # Clustering-based recommendations
        if 'clustering' in self.insights:
            for cluster_name, cluster_info in self.insights['clustering'].items():
                if cluster_info.get('abandonment_rate', 0) > 0.7:
                    recommendations.append({
                        'category': 'Workflow Optimization',
                        'priority': 'High',
                        'suggestion': f"Cluster with characteristics {cluster_info.get('characteristics', [])} shows high abandonment. Consider targeted interventions."
                    })
        
        self.insights['recommendations'] = recommendations
        return recommendations
    
    def create_visualizations(self, output_dir: str) -> None:
        """Create visualization charts and save them.
        
        Args:
            output_dir: Directory to save visualizations
        """
        if self.processed_data is None:
            logger.warning("No data to visualize")
            return
        
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)
        
        df = self.processed_data.copy()
        
        # Set style
        plt.style.use('default')
        sns.set_palette("husl")
        
        try:
            # 1. Inactivity distribution
            plt.figure(figsize=(12, 6))
            plt.subplot(1, 2, 1)
            sns.histplot(data=df, x='inactive_days', bins=20, kde=True)
            plt.title('Distribution of PR Inactivity Days')
            plt.xlabel('Days Inactive')
            plt.ylabel('Count')
            
            plt.subplot(1, 2, 2)
            category_counts = df['reason_category'].value_counts()
            if len(category_counts) > 0:
                plt.pie(category_counts.values, labels=category_counts.index, autopct='%1.1f%%')
                plt.title('Inactivity Reasons Distribution')
            else:
                plt.text(0.5, 0.5, 'No data available', ha='center', va='center')
                plt.title('Inactivity Reasons Distribution')
            
            plt.tight_layout()
            plt.savefig(output_path / 'inactivity_analysis.png', dpi=300, bbox_inches='tight')
            plt.close()
            
            # 2. Engagement vs Inactivity
            plt.figure(figsize=(10, 6))
            sns.scatterplot(data=df, x='engagement_score', y='inactive_days', 
                           hue='reason_category', size='total_changes', sizes=(50, 200))
            plt.title('PR Engagement vs Inactivity')
            plt.xlabel('Engagement Score (Reviews + Comments)')
            plt.ylabel('Days Inactive')
            plt.legend(bbox_to_anchor=(1.05, 1), loc='upper left')
            plt.tight_layout()
            plt.savefig(output_path / 'engagement_vs_inactivity.png', dpi=300, bbox_inches='tight')
            plt.close()
            
            # 3. Time patterns - Fixed to handle shape mismatches
            plt.figure(figsize=(12, 4))
            
            # Hour patterns
            plt.subplot(1, 2, 1)
            hour_abandonment = df.groupby('created_hour')['reason_category'].apply(
                lambda x: (x.isin(['abandoned', 'stale'])).mean()
            ).reindex(range(24), fill_value=0)  # Ensure all 24 hours are present
            
            plt.plot(hour_abandonment.index, hour_abandonment.values, marker='o')
            plt.title('Abandonment Rate by Creation Hour')
            plt.xlabel('Hour of Day')
            plt.ylabel('Abandonment Rate')
            plt.grid(True, alpha=0.3)
            
            # Weekday patterns
            plt.subplot(1, 2, 2)
            weekday_abandonment = df.groupby('created_day_of_week')['reason_category'].apply(
                lambda x: (x.isin(['abandoned', 'stale'])).mean()
            ).reindex(range(7), fill_value=0)  # Ensure all 7 weekdays are present
            
            weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
            plt.bar(range(7), weekday_abandonment.values)
            plt.title('Abandonment Rate by Weekday')
            plt.xlabel('Day of Week')
            plt.ylabel('Abandonment Rate')
            plt.xticks(range(7), weekdays)
            
            plt.tight_layout()
            plt.savefig(output_path / 'time_patterns.png', dpi=300, bbox_inches='tight')
            plt.close()
            
            # 4. Risk analysis (if available)
            if 'risk_score' in df.columns:
                plt.figure(figsize=(10, 6))
                sns.boxplot(data=df, x='reason_category', y='risk_score')
                plt.title('Risk Score Distribution by Inactivity Reason')
                plt.xlabel('Inactivity Reason')
                plt.ylabel('Risk Score')
                plt.xticks(rotation=45)
                plt.tight_layout()
                plt.savefig(output_path / 'risk_analysis.png', dpi=300, bbox_inches='tight')
                plt.close()
            
            if self.verbose:
                logger.info(f"✅ Visualizations saved to {output_path}")
                
        except Exception as e:
            logger.error(f"Failed to create visualizations: {e}")
    
    def save_insights(self, output_file: str) -> None:
        """Save ML insights to JSON file.
        
        Args:
            output_file: Path to save insights JSON
            
        Raises:
            Exception: If saving fails
        """
        try:
            # Convert numpy types to native Python types for JSON serialization
            def convert_types(obj: Any) -> Any:
                if isinstance(obj, np.integer):
                    return int(obj)
                elif isinstance(obj, np.floating):
                    return float(obj)
                elif isinstance(obj, np.ndarray):
                    return obj.tolist()
                elif isinstance(obj, pd.Timestamp):
                    return obj.isoformat()
                elif isinstance(obj, (pd.Series, pd.DataFrame)):
                    return obj.to_dict()
                elif isinstance(obj, dict):
                    return {key: convert_types(value) for key, value in obj.items()}
                elif isinstance(obj, list):
                    return [convert_types(item) for item in obj]
                else:
                    return obj
            
            insights_clean = convert_types(self.insights)
            
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(insights_clean, f, indent=2, default=str)
            
            if self.verbose:
                logger.info(f"✅ Insights saved to {output_file}")
                
        except Exception as e:
            raise Exception(f"Failed to save insights: {str(e)}")


def main() -> None:
    """Main entry point for the CLI application."""
    parser = argparse.ArgumentParser(
        description='Stale PR Audit ML Analysis - Advanced machine learning insights for GitHub PR patterns'
    )
    parser.add_argument('-i', '--input', required=True, 
                       help='Input JSON report file from PR audit')
    parser.add_argument('-o', '--output', default='./reports', 
                       help='Output directory for results (default: ./reports)')
    parser.add_argument('-c', '--clusters', type=int, default=4, 
                       help='Number of clusters for analysis (default: 4)')
    parser.add_argument('-v', '--verbose', action='store_true', 
                       help='Enable verbose output')
    parser.add_argument('--visualize', action='store_true', 
                       help='Generate visualization charts')
    parser.add_argument('--version', action='version', version='%(prog)s 1.0.0')
    
    args = parser.parse_args()
    
    try:
        print("🤖 Starting ML Analysis for Stale PR Audit")
        print(f"📊 Input: {args.input}")
        print(f"📁 Output: {args.output}")
        
        # Initialize analyzer
        analyzer = StalePRMLAnalyzer(verbose=args.verbose)
        
        # Load and prepare data
        print("\n📥 Loading data...")
        analyzer.load_data(args.input)
        
        print("🔧 Preparing features...")
        analyzer.prepare_features()
        
        # Perform analyses
        print("🔍 Analyzing abandonment patterns...")
        analyzer.analyze_abandonment_patterns()
        
        print(f"🎯 Performing clustering (k={args.clusters})...")
        analyzer.perform_clustering(args.clusters)
        
        print("⚠️ Calculating risk scores...")
        analyzer.predict_risk_scores()
        
        print("💡 Generating recommendations...")
        analyzer.generate_recommendations()
        
        # Create visualizations if requested
        if args.visualize:
            print("📊 Creating visualizations...")
            analyzer.create_visualizations(args.output)
        
        # Save insights
        output_path = Path(args.output)
        output_path.mkdir(parents=True, exist_ok=True)
        insights_file = output_path / 'ml_insights.json'
        analyzer.save_insights(str(insights_file))
        
        # Print summary
        print("\n📋 ANALYSIS SUMMARY")
        print("=" * 50)
        
        if 'abandonment_patterns' in analyzer.insights:
            patterns = analyzer.insights['abandonment_patterns']
            high_risk_authors = len(patterns.get('author_insights', {}).get('high_abandonment_authors', []))
            problematic_repos = len(patterns.get('repository_insights', {}).get('problematic_repos', []))
            print(f"High-risk authors identified: {high_risk_authors}")
            print(f"Problematic repositories: {problematic_repos}")
        
        if 'clustering' in analyzer.insights:
            clusters = analyzer.insights['clustering']
            print(f"PR clusters identified: {len(clusters)}")
            for cluster_name, info in clusters.items():
                print(f"  • {cluster_name}: {info['size']} PRs, {info['avg_inactive_days']:.1f} avg inactive days")
        
        if 'risk_analysis' in analyzer.insights:
            risk_data = analyzer.insights['risk_analysis']
            high_risk = len(risk_data.get('high_risk_prs', []))
            print(f"High-risk PRs requiring attention: {high_risk}")
        
        recommendations = analyzer.insights.get('recommendations', [])
        print(f"Actionable recommendations generated: {len(recommendations)}")
        
        if recommendations:
            print("\n🎯 TOP RECOMMENDATIONS:")
            for i, rec in enumerate(recommendations[:3], 1):
                print(f"{i}. [{rec['priority']}] {rec['category']}: {rec['suggestion']}")
        
        print(f"\n✅ ML analysis complete! Results saved to: {args.output}")
        
    except Exception as e:
        logger.error(f"❌ Analysis failed: {str(e)}")
        sys.exit(1)


if __name__ == "__main__":
    main()