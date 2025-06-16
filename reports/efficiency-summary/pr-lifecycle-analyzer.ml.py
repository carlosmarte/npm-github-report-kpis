#!/usr/bin/env python3
"""
Pull Request Lifecycle Machine Learning Analysis
Provides advanced analytics and insights using ML techniques with proper JSON serialization
"""

import json
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from datetime import datetime, timedelta
import warnings
from pathlib import Path
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler
from sklearn.decomposition import PCA
from scipy import stats
import argparse
import sys
from typing import Dict, Any, List, Union
from rich.console import Console
from rich.markup import escape

warnings.filterwarnings('ignore')

# Custom JSON encoder to handle numpy types
class NumpyJSONEncoder(json.JSONEncoder):
    """Custom JSON encoder that converts numpy types to native Python types."""
    
    def default(self, obj):
        if isinstance(obj, np.integer):
            return int(obj)
        elif isinstance(obj, np.floating):
            return float(obj)
        elif isinstance(obj, np.ndarray):
            return obj.tolist()
        elif isinstance(obj, (pd.Series, pd.DataFrame)):
            return obj.to_dict()
        elif pd.isna(obj):
            return None
        return super().default(obj)

# Console utilities for safe printing
console = Console()

def safe_console_print(message: str, style: str = "") -> None:
    """Safely print messages to console, handling Rich markup errors."""
    escaped = escape(str(message))
    try:
        if style:
            console.print(f"[{style}]{escaped}[/{style}]")
        else:
            console.print(escaped)
    except Exception as e:
        console.print(f"[red]⚠ Print error:[/red] {escape(str(e))}")
        console.print(escaped)

def convert_to_serializable(obj: Any) -> Any:
    """Convert pandas/numpy objects to JSON-serializable types."""
    if isinstance(obj, (np.integer, pd.Int64Dtype)):
        return int(obj)
    elif isinstance(obj, (np.floating, pd.Float64Dtype)):
        return float(obj)
    elif isinstance(obj, np.ndarray):
        return obj.tolist()
    elif isinstance(obj, pd.Series):
        return {str(k): convert_to_serializable(v) for k, v in obj.to_dict().items()}
    elif isinstance(obj, pd.DataFrame):
        return {str(k): convert_to_serializable(v) for k, v in obj.to_dict().items()}
    elif isinstance(obj, dict):
        return {str(k): convert_to_serializable(v) for k, v in obj.items()}
    elif isinstance(obj, (list, tuple)):
        return [convert_to_serializable(item) for item in obj]
    elif pd.isna(obj):
        return None
    return obj

class PRLifecycleMLAnalyzer:
    def __init__(self, data_path: Union[str, Path] = None):
        self.data: Dict[str, Any] = None
        self.features_df: pd.DataFrame = None
        self.scaler = StandardScaler()
        self.clusterer = KMeans(n_clusters=4, random_state=42)
        
        if data_path:
            self.load_data(data_path)
    
    def load_data(self, data_path: Union[str, Path]) -> bool:
        """Load PR lifecycle data from JSON file"""
        try:
            with open(data_path, 'r', encoding='utf-8') as f:
                self.data = json.load(f)
            safe_console_print(f"✅ Loaded data from {data_path}", "green")
            return True
        except FileNotFoundError:
            safe_console_print(f"❌ File not found: {data_path}", "red")
            return False
        except json.JSONDecodeError as e:
            safe_console_print(f"❌ Invalid JSON format: {e}", "red")
            return False
        except Exception as e:
            safe_console_print(f"❌ Error loading data: {e}", "red")
            return False
    
    def prepare_features(self) -> pd.DataFrame:
        """Prepare feature matrix for ML analysis"""
        if not self.data or 'detailed_analysis' not in self.data:
            raise ValueError("No data loaded or invalid data structure")
        
        prs = self.data['detailed_analysis']['pull_requests']
        safe_console_print(f"📊 Processing {len(prs)} pull requests", "blue")
        
        # Extract features for ML analysis
        features = []
        for pr in prs:
            try:
                feature_row = {
                    'number': int(pr['NUMBER']),
                    'author': str(pr['AUTHOR']),
                    'cycle_time_hours': float(pr['CYCLE_TIME_HOURS'] or 0),
                    'review_time_hours': float(pr['REVIEW_TIME_HOURS'] or 0),
                    'idle_time_hours': float(pr['IDLE_TIME_HOURS'] or 0),
                    'comment_time_hours': float(pr['TIME_TO_FIRST_COMMENT_HOURS'] or 0),
                    'review_count': int(pr['REVIEW_COUNT'] or 0),
                    'comment_count': int(pr['COMMENT_COUNT'] or 0),
                    'is_merged': 1 if pr['MERGED_AT'] else 0,
                    'created_at': str(pr['CREATED_AT']),
                    'repository': str(pr['REPOSITORY'])
                }
                
                # Add temporal features
                created_date = datetime.fromisoformat(pr['CREATED_AT'].replace('Z', '+00:00'))
                feature_row['day_of_week'] = created_date.weekday()
                feature_row['hour_of_day'] = created_date.hour
                feature_row['is_weekend'] = 1 if created_date.weekday() >= 5 else 0
                
                # Add efficiency metrics
                cycle_time = feature_row['cycle_time_hours']
                if cycle_time > 0:
                    feature_row['review_efficiency'] = feature_row['review_time_hours'] / cycle_time
                    feature_row['idle_ratio'] = feature_row['idle_time_hours'] / cycle_time
                else:
                    feature_row['review_efficiency'] = 0.0
                    feature_row['idle_ratio'] = 0.0
                
                features.append(feature_row)
                
            except (KeyError, ValueError, TypeError) as e:
                safe_console_print(f"⚠ Skipping PR {pr.get('NUMBER', 'unknown')}: {e}", "yellow")
                continue
        
        self.features_df = pd.DataFrame(features)
        safe_console_print(f"📊 Prepared {len(self.features_df)} PR records for ML analysis", "green")
        return self.features_df
    
    def normalize_data(self) -> pd.DataFrame:
        """Normalize numerical features for ML algorithms"""
        numerical_cols = [
            'cycle_time_hours', 'review_time_hours', 'idle_time_hours',
            'comment_time_hours', 'review_count', 'comment_count',
            'review_efficiency', 'idle_ratio'
        ]
        
        # Handle missing values
        self.features_df[numerical_cols] = self.features_df[numerical_cols].fillna(0)
        
        # Normalize data
        self.features_df[numerical_cols] = self.scaler.fit_transform(
            self.features_df[numerical_cols]
        )
        
        safe_console_print("🔧 Data normalization completed", "blue")
        return self.features_df
    
    def cluster_pull_requests(self) -> tuple:
        """Cluster PRs based on lifecycle characteristics"""
        # Select features for clustering
        cluster_features = [
            'cycle_time_hours', 'review_time_hours', 'idle_time_hours',
            'review_count', 'comment_count', 'review_efficiency', 'idle_ratio'
        ]
        
        X = self.features_df[cluster_features].fillna(0)
        clusters = self.clusterer.fit_predict(X)
        self.features_df['cluster'] = clusters
        
        # Label clusters based on characteristics
        cluster_labels = {}
        for cluster_id in range(4):
            cluster_data = self.features_df[self.features_df['cluster'] == cluster_id]
            if len(cluster_data) == 0:
                cluster_labels[cluster_id] = f"Empty Cluster {cluster_id}"
                continue
                
            avg_cycle = cluster_data['cycle_time_hours'].mean()
            avg_review = cluster_data['review_time_hours'].mean()
            merge_rate = cluster_data['is_merged'].mean()
            
            if avg_cycle < -0.5 and merge_rate > 0.8:
                cluster_labels[cluster_id] = "Fast Track"
            elif avg_cycle > 0.5 and avg_review > 0.5:
                cluster_labels[cluster_id] = "Complex Review"
            elif merge_rate < 0.5:
                cluster_labels[cluster_id] = "High Risk"
            else:
                cluster_labels[cluster_id] = "Standard Process"
        
        self.features_df['cluster_label'] = self.features_df['cluster'].map(cluster_labels)
        
        safe_console_print("🤖 PR clustering completed", "green")
        return clusters, cluster_labels
    
    def temporal_analysis(self) -> Dict[str, Any]:
        """Analyze temporal patterns in PR lifecycle"""
        self.features_df['created_date'] = pd.to_datetime(self.features_df['created_at'])
        
        # Day of week analysis
        dow_analysis = self.features_df.groupby('day_of_week').agg({
            'cycle_time_hours': ['mean', 'std'],
            'is_merged': 'mean',
            'number': 'count'
        }).round(2)
        
        # Hour of day analysis
        hour_analysis = self.features_df.groupby('hour_of_day').agg({
            'cycle_time_hours': ['mean', 'std'],
            'is_merged': 'mean',
            'number': 'count'
        }).round(2)
        
        return {
            'day_of_week': convert_to_serializable(dow_analysis.to_dict()),
            'hour_of_day': convert_to_serializable(hour_analysis.to_dict())
        }
    
    def identify_outliers(self) -> Dict[str, List[Dict]]:
        """Identify outlier PRs using statistical methods"""
        numerical_cols = ['cycle_time_hours', 'review_time_hours', 'idle_time_hours']
        outliers = {}
        
        for col in numerical_cols:
            # Use IQR method
            Q1 = self.features_df[col].quantile(0.25)
            Q3 = self.features_df[col].quantile(0.75)
            IQR = Q3 - Q1
            lower_bound = Q1 - 1.5 * IQR
            upper_bound = Q3 + 1.5 * IQR
            
            outlier_mask = (self.features_df[col] < lower_bound) | (self.features_df[col] > upper_bound)
            outlier_data = self.features_df[outlier_mask][['number', 'author', col]]
            outliers[col] = convert_to_serializable(outlier_data.to_dict('records'))
        
        return outliers
    
    def predict_cycle_time(self) -> Dict[str, Any]:
        """Build a simple model to predict cycle time"""
        try:
            from sklearn.ensemble import RandomForestRegressor
            from sklearn.model_selection import train_test_split
            from sklearn.metrics import mean_absolute_error, r2_score
        except ImportError:
            safe_console_print("⚠ Scikit-learn not available for prediction model", "yellow")
            return {'error': 'Scikit-learn not available'}
        
        # Prepare features
        feature_cols = [
            'review_count', 'comment_count', 'day_of_week', 
            'hour_of_day', 'is_weekend'
        ]
        
        X = self.features_df[feature_cols].fillna(0)
        y = self.features_df['cycle_time_hours'].fillna(0)
        
        if len(X) < 10:  # Need minimum samples
            safe_console_print("⚠ Insufficient data for prediction model", "yellow")
            return {'error': 'Insufficient data'}
        
        # Split data
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
        
        # Train model
        model = RandomForestRegressor(n_estimators=100, random_state=42)
        model.fit(X_train, y_train)
        
        # Predictions
        y_pred = model.predict(X_test)
        
        # Metrics
        mae = float(mean_absolute_error(y_test, y_pred))
        r2 = float(r2_score(y_test, y_pred))
        
        # Feature importance
        feature_importance = {col: float(imp) for col, imp in zip(feature_cols, model.feature_importances_)}
        
        return {
            'mae': mae,
            'r2_score': r2,
            'feature_importance': feature_importance,
            'sample_predictions': [(float(actual), float(pred)) for actual, pred in list(zip(y_test.values, y_pred))[:5]]
        }
    
    def generate_insights(self) -> List[Dict[str, Any]]:
        """Generate ML-driven insights"""
        insights = []
        
        try:
            # Cluster insights
            cluster_summary = self.features_df.groupby('cluster_label').agg({
                'number': 'count',
                'cycle_time_hours': 'mean',
                'is_merged': 'mean',
                'review_efficiency': 'mean'
            }).round(2)
            
            insights.append({
                'type': 'cluster_analysis',
                'title': 'PR Lifecycle Clusters',
                'data': convert_to_serializable(cluster_summary.to_dict('index')),
                'interpretation': 'Pull requests fall into distinct patterns based on their lifecycle characteristics'
            })
            
            # Temporal insights
            temporal_data = self.temporal_analysis()
            best_day = 0  # Default fallback
            worst_day = 0
            
            if 'day_of_week' in temporal_data and temporal_data['day_of_week']:
                merge_rates = temporal_data['day_of_week'].get('is_merged', {}).get('mean', {})
                if merge_rates:
                    best_day = max(merge_rates.keys(), key=lambda k: merge_rates[k])
                    worst_day = min(merge_rates.keys(), key=lambda k: merge_rates[k])
            
            weekend_corr = float(self.features_df['is_weekend'].corr(self.features_df['cycle_time_hours']))
            
            insights.append({
                'type': 'temporal_patterns',
                'title': 'Temporal Patterns',
                'data': {
                    'best_day_for_prs': int(best_day),
                    'worst_day_for_prs': int(worst_day),
                    'weekend_effect': weekend_corr
                },
                'interpretation': f'PRs created on day {best_day} have highest merge rates, while day {worst_day} shows lowest success'
            })
            
            # Efficiency insights
            efficiency_corr = self.features_df[['review_efficiency', 'idle_ratio', 'is_merged']].corr()
            
            insights.append({
                'type': 'efficiency_analysis',
                'title': 'Efficiency Correlations',
                'data': convert_to_serializable(efficiency_corr.to_dict()),
                'interpretation': 'Analysis of how review efficiency and idle time correlate with merge success'
            })
            
            # Outlier insights
            outliers = self.identify_outliers()
            insights.append({
                'type': 'outlier_detection',
                'title': 'Outlier Analysis',
                'data': outliers,
                'interpretation': 'PRs with unusual lifecycle characteristics that may need special attention'
            })
            
            # Predictive insights
            prediction_results = self.predict_cycle_time()
            insights.append({
                'type': 'predictive_model',
                'title': 'Cycle Time Prediction',
                'data': prediction_results,
                'interpretation': f'Model performance: R² = {prediction_results.get("r2_score", 0):.3f}'
            })
            
        except Exception as e:
            safe_console_print(f"⚠ Error generating insights: {e}", "yellow")
            insights.append({
                'type': 'error',
                'title': 'Analysis Error',
                'data': {'error': str(e)},
                'interpretation': 'An error occurred during insight generation'
            })
        
        return insights
    
    def create_visualizations(self, output_dir: Union[str, Path] = './reports') -> List[str]:
        """Create ML analysis visualizations"""
        output_path = Path(output_dir)
        output_path.mkdir(exist_ok=True)
        
        viz_files = []
        
        try:
            plt.style.use('default')
            
            # 1. Cluster visualization
            fig, ((ax1, ax2), (ax3, ax4)) = plt.subplots(2, 2, figsize=(15, 12))
            
            # Cluster scatter plot
            colors = ['red', 'blue', 'green', 'orange']
            unique_clusters = self.features_df['cluster'].unique()
            
            for i, cluster in enumerate(unique_clusters):
                cluster_data = self.features_df[self.features_df['cluster'] == cluster]
                if len(cluster_data) > 0:
                    color_idx = i % len(colors)
                    ax1.scatter(cluster_data['cycle_time_hours'], cluster_data['review_time_hours'], 
                               c=colors[color_idx], label=cluster_data['cluster_label'].iloc[0], alpha=0.6)
            
            ax1.set_xlabel('Normalized Cycle Time')
            ax1.set_ylabel('Normalized Review Time')
            ax1.set_title('PR Clusters by Lifecycle Characteristics')
            ax1.legend()
            
            # Cluster distribution
            cluster_counts = self.features_df['cluster_label'].value_counts()
            ax2.pie(cluster_counts.values, labels=cluster_counts.index, autopct='%1.1f%%')
            ax2.set_title('Distribution of PR Clusters')
            
            # Temporal patterns
            dow_merge_rates = self.features_df.groupby('day_of_week')['is_merged'].mean()
            days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
            day_labels = [days[i] if i < len(days) else f'Day{i}' for i in dow_merge_rates.index]
            ax3.bar(day_labels, dow_merge_rates.values)
            ax3.set_title('Merge Rate by Day of Week')
            ax3.set_ylabel('Merge Rate')
            ax3.tick_params(axis='x', rotation=45)
            
            # Cycle time distribution
            ax4.hist(self.features_df['cycle_time_hours'], bins=30, alpha=0.7, color='skyblue')
            ax4.set_xlabel('Normalized Cycle Time')
            ax4.set_ylabel('Frequency')
            ax4.set_title('Distribution of PR Cycle Times')
            
            plt.tight_layout()
            viz_file_1 = output_path / 'pr_ml_analysis.png'
            plt.savefig(viz_file_1, dpi=300, bbox_inches='tight')
            plt.close()
            viz_files.append(str(viz_file_1))
            
            # 2. Correlation heatmap
            plt.figure(figsize=(10, 8))
            correlation_cols = [
                'cycle_time_hours', 'review_time_hours', 'idle_time_hours',
                'review_count', 'comment_count', 'is_merged'
            ]
            corr_matrix = self.features_df[correlation_cols].corr()
            sns.heatmap(corr_matrix, annot=True, cmap='coolwarm', center=0)
            plt.title('Feature Correlation Heatmap')
            plt.tight_layout()
            viz_file_2 = output_path / 'correlation_heatmap.png'
            plt.savefig(viz_file_2, dpi=300, bbox_inches='tight')
            plt.close()
            viz_files.append(str(viz_file_2))
            
            safe_console_print(f"📊 Visualizations saved to {output_path}", "green")
            
        except Exception as e:
            safe_console_print(f"⚠ Error creating visualizations: {e}", "yellow")
        
        return viz_files
    
    def export_analysis(self, output_path: Union[str, Path] = './reports/pr_ml_analysis.json') -> str:
        """Export complete ML analysis to JSON with proper serialization"""
        try:
            # Generate insights
            insights = self.generate_insights()
            
            # Prepare cluster summary
            cluster_summary = {}
            if 'cluster_label' in self.features_df.columns:
                cluster_summary = self.features_df.groupby('cluster_label').agg({
                    'number': 'count',
                    'cycle_time_hours': ['mean', 'std'],
                    'review_time_hours': ['mean', 'std'],
                    'is_merged': 'mean'
                }).round(3)
                cluster_summary = convert_to_serializable(cluster_summary.to_dict())
            
            # Statistical summary with proper conversion
            stats_cols = ['cycle_time_hours', 'review_time_hours', 'idle_time_hours', 'is_merged']
            statistical_summary = {}
            
            for col in stats_cols:
                if col in self.features_df.columns:
                    col_stats = self.features_df[col].describe()
                    statistical_summary[f'{col}_stats'] = convert_to_serializable(col_stats.to_dict())
            
            # Correlation matrix
            correlation_matrix = {}
            if len(stats_cols) > 1:
                corr_data = self.features_df[stats_cols].corr()
                correlation_matrix = convert_to_serializable(corr_data.to_dict())
            
            analysis_results = {
                'metadata': {
                    'analysis_date': datetime.now().isoformat(),
                    'total_prs_analyzed': int(len(self.features_df)),
                    'features_used': list(self.features_df.columns),
                    'ml_analyzer_version': '2.0.0'
                },
                'insights': insights,
                'cluster_summary': cluster_summary,
                'statistical_summary': {
                    **statistical_summary,
                    'correlation_matrix': correlation_matrix
                }
            }
            
            # Save to file with custom encoder
            output_file = Path(output_path)
            output_file.parent.mkdir(parents=True, exist_ok=True)
            
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(analysis_results, f, indent=2, cls=NumpyJSONEncoder, ensure_ascii=False)
            
            safe_console_print(f"📄 ML analysis exported to {output_file}", "green")
            return str(output_file)
            
        except Exception as e:
            safe_console_print(f"❌ Error exporting analysis: {e}", "red")
            # Create minimal export on error
            error_export = {
                'metadata': {
                    'analysis_date': datetime.now().isoformat(),
                    'error': str(e),
                    'status': 'failed'
                },
                'insights': [],
                'cluster_summary': {},
                'statistical_summary': {}
            }
            
            output_file = Path(output_path)
            output_file.parent.mkdir(parents=True, exist_ok=True)
            
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(error_export, f, indent=2, ensure_ascii=False)
            
            return str(output_file)

def main():
    """Main CLI function"""
    parser = argparse.ArgumentParser(
        description='PR Lifecycle ML Analysis - Advanced analytics and insights using ML techniques',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python -m pr_ml_analyzer --input data.json --output ./reports --visualize
  python -m pr_ml_analyzer -i pr_data.json -o analysis_results -v
        """
    )
    parser.add_argument('--input', '-i', required=True, 
                       help='Input JSON file path containing PR lifecycle data')
    parser.add_argument('--output', '-o', default='./reports', 
                       help='Output directory for analysis results (default: ./reports)')
    parser.add_argument('--visualize', '-v', action='store_true', 
                       help='Create visualizations (requires matplotlib and seaborn)')
    parser.add_argument('--verbose', action='store_true',
                       help='Enable verbose output')
    
    args = parser.parse_args()
    
    try:
        # Initialize analyzer
        safe_console_print("🚀 Starting PR Lifecycle ML Analysis", "bold blue")
        analyzer = PRLifecycleMLAnalyzer(args.input)
        
        if analyzer.data is None:
            safe_console_print("❌ Failed to load data. Exiting.", "red")
            sys.exit(1)
        
        # Prepare and analyze data
        safe_console_print("🔧 Preparing features for ML analysis...", "blue")
        analyzer.prepare_features()
        
        if analyzer.features_df is None or len(analyzer.features_df) == 0:
            safe_console_print("❌ No valid features extracted. Exiting.", "red")
            sys.exit(1)
        
        analyzer.normalize_data()
        
        safe_console_print("🤖 Running ML analysis...", "blue")
        analyzer.cluster_pull_requests()
        
        # Generate insights
        insights = analyzer.generate_insights()
        safe_console_print(f"💡 Generated {len(insights)} key insights", "green")
        
        # Export results
        output_file = analyzer.export_analysis(f"{args.output}/pr_ml_analysis.json")
        
        # Create visualizations if requested
        if args.visualize:
            safe_console_print("📊 Creating visualizations...", "blue")
            viz_files = analyzer.create_visualizations(args.output)
            safe_console_print(f"📊 Created {len(viz_files)} visualization files", "green")
        
        safe_console_print("✅ ML analysis complete!", "bold green")
        safe_console_print(f"📁 Results saved to: {args.output}", "blue")
        
    except KeyboardInterrupt:
        safe_console_print("\n⚠ Analysis interrupted by user", "yellow")
        sys.exit(1)
    except Exception as e:
        safe_console_print(f"❌ Error during ML analysis: {e}", "red")
        if args.verbose:
            import traceback
            safe_console_print(traceback.format_exc(), "red")
        sys.exit(1)

if __name__ == "__main__":
    main()