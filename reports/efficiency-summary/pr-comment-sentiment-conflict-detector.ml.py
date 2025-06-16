#!/usr/bin/env python3
"""
PR Comment Sentiment & Conflict Detector - ML Analysis Module

This module provides machine learning analysis capabilities for GitHub PR data,
including sentiment analysis, conflict prediction, and collaboration pattern detection.
"""

import json
import argparse
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from pathlib import Path
import warnings
from datetime import datetime, timedelta
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.cluster import KMeans
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report, confusion_matrix
from scipy import stats
import logging
from typing import Dict, List, Any, Optional, Tuple, Union
from rich.console import Console
from rich.markup import escape

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Suppress warnings
warnings.filterwarnings('ignore')

# Initialize console for safe printing
console = Console()

def safe_console_print(message: str, style: str = "") -> None:
    """Safely print messages to console avoiding markup errors."""
    escaped = escape(message)
    try:
        if style:
            console.print(f"[{style}]{escaped}[/{style}]")
        else:
            console.print(escaped)
    except Exception as e:
        console.print(f"[red]⚠ Print error:[/red] {escape(str(e))}")
        console.print(escaped)


def convert_to_json_serializable(obj: Any) -> Any:
    """
    Convert various data types to JSON serializable format.
    Handles numpy types, pandas objects, datetime objects, and complex nested structures.
    """
    if obj is None:
        return None
    elif isinstance(obj, (np.integer, np.int64, np.int32)):
        return int(obj)
    elif isinstance(obj, (np.floating, np.float64, np.float32)):
        return float(obj)
    elif isinstance(obj, np.bool_):
        return bool(obj)
    elif isinstance(obj, np.ndarray):
        return obj.tolist()
    elif isinstance(obj, (datetime, pd.Timestamp)):
        return obj.isoformat()
    elif isinstance(obj, pd.Timedelta):
        return obj.total_seconds()
    elif hasattr(obj, 'date') and callable(getattr(obj, 'date')):
        # Handle datetime.date objects
        return obj.strftime('%Y-%m-%d')
    elif isinstance(obj, dict):
        return {key: convert_to_json_serializable(value) for key, value in obj.items()}
    elif isinstance(obj, (list, tuple)):
        return [convert_to_json_serializable(item) for item in obj]
    elif isinstance(obj, pd.DataFrame):
        return obj.to_dict('records')
    elif isinstance(obj, pd.Series):
        return obj.tolist()
    elif hasattr(obj, '__dict__'):
        # Handle custom objects
        return convert_to_json_serializable(obj.__dict__)
    else:
        # Try to convert to string for unknown types
        try:
            return str(obj)
        except:
            return None


class PRDataProcessor:
    """Processes and prepares PR data for ML analysis"""
    
    def __init__(self, data: Dict[str, Any]):
        self.raw_data = data
        self.processed_data: Optional[pd.DataFrame] = None
        self.features_df: Optional[pd.DataFrame] = None
        
    def load_and_prepare_data(self) -> pd.DataFrame:
        """Load and prepare data for analysis"""
        logger.info("Loading and preparing PR data...")
        
        try:
            # Extract PR data safely
            detailed_analysis = self.raw_data.get('detailed_analysis', {})
            prs = detailed_analysis.get('pull_requests', [])
            
            contributor_metrics = self.raw_data.get('contributor_metrics', {})
            contributors = contributor_metrics.get('contributors', [])
            
            sentiment_analysis = self.raw_data.get('sentiment_analysis', {})
            sentiment_data = sentiment_analysis.get('pr_sentiments', [])
            
            conflict_detection = self.raw_data.get('conflict_detection', {})
            conflicts = conflict_detection.get('conflicts', [])
            
            # Create PR DataFrame
            if not prs:
                logger.warning("No PR data found")
                return pd.DataFrame()
                
            pr_df = pd.DataFrame(prs)
            
            # Convert datetime columns safely
            datetime_cols = ['created_at', 'updated_at', 'merged_at']
            for col in datetime_cols:
                if col in pr_df.columns:
                    pr_df[col] = pd.to_datetime(pr_df[col], errors='coerce')
            
            # Add derived features with safe calculations
            pr_df['is_merged'] = pr_df['merged_at'].notna() if 'merged_at' in pr_df.columns else False
            
            if 'updated_at' in pr_df.columns and 'created_at' in pr_df.columns:
                pr_df['days_open'] = (pr_df['updated_at'] - pr_df['created_at']).dt.total_seconds() / (24 * 3600)
                pr_df['days_open'] = pr_df['days_open'].fillna(0)
            else:
                pr_df['days_open'] = 0
            
            if 'conflict_count' in pr_df.columns:
                pr_df['has_conflicts'] = pr_df['conflict_count'] > 0
            else:
                pr_df['has_conflicts'] = False
                pr_df['conflict_count'] = 0
            
            # Add day of week and hour safely
            if 'created_at' in pr_df.columns:
                pr_df['day_of_week'] = pr_df['created_at'].dt.day_name()
                pr_df['hour_created'] = pr_df['created_at'].dt.hour
            else:
                pr_df['day_of_week'] = 'Monday'
                pr_df['hour_created'] = 12
            
            # Create contributor lookup
            contributor_dict = {c.get('username', ''): c for c in contributors}
            
            # Add contributor metrics to PR data safely
            if 'author' in pr_df.columns:
                pr_df['author_pr_count'] = pr_df['author'].map(
                    lambda x: contributor_dict.get(x, {}).get('prs_authored', 0)
                )
                pr_df['author_review_count'] = pr_df['author'].map(
                    lambda x: contributor_dict.get(x, {}).get('reviews_given', 0)
                )
                pr_df['author_avg_sentiment'] = pr_df['author'].map(
                    lambda x: contributor_dict.get(x, {}).get('avg_sentiment_score', 0)
                )
            else:
                pr_df['author_pr_count'] = 0
                pr_df['author_review_count'] = 0
                pr_df['author_avg_sentiment'] = 0
            
            # Ensure all numeric columns are properly typed
            numeric_columns = ['total_comments', 'total_reviews', 'sentiment_score', 
                             'conflict_count', 'days_open', 'author_pr_count',
                             'author_review_count', 'author_avg_sentiment', 'hour_created']
            
            for col in numeric_columns:
                if col in pr_df.columns:
                    pr_df[col] = pd.to_numeric(pr_df[col], errors='coerce').fillna(0)
                else:
                    pr_df[col] = 0
            
            self.processed_data = pr_df
            logger.info(f"Successfully processed {len(pr_df)} PRs")
            return pr_df
            
        except Exception as e:
            logger.error(f"Error processing PR data: {e}")
            return pd.DataFrame()
    
    def create_feature_matrix(self) -> Tuple[pd.DataFrame, pd.DataFrame]:
        """Create feature matrix for ML analysis"""
        if self.processed_data is None:
            self.load_and_prepare_data()
        
        if self.processed_data is None or self.processed_data.empty:
            logger.warning("No processed data available for feature creation")
            return pd.DataFrame(), pd.DataFrame()
        
        df = self.processed_data.copy()
        
        # Select numerical features
        numerical_features = [
            'total_comments', 'total_reviews', 'sentiment_score',
            'conflict_count', 'days_open', 'author_pr_count',
            'author_review_count', 'author_avg_sentiment', 'hour_created'
        ]
        
        # Handle missing values
        for col in numerical_features:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0)
            else:
                df[col] = 0
        
        # Encode categorical variables safely
        try:
            le_state = LabelEncoder()
            le_day = LabelEncoder()
            
            if 'state' in df.columns and not df['state'].isna().all():
                df['state_encoded'] = le_state.fit_transform(df['state'].fillna('unknown'))
            else:
                df['state_encoded'] = 0
            
            if 'day_of_week' in df.columns and not df['day_of_week'].isna().all():
                df['day_of_week_encoded'] = le_day.fit_transform(df['day_of_week'].fillna('Monday'))
            else:
                df['day_of_week_encoded'] = 0
                
        except Exception as e:
            logger.warning(f"Error encoding categorical variables: {e}")
            df['state_encoded'] = 0
            df['day_of_week_encoded'] = 0
        
        # Create final feature matrix
        feature_cols = numerical_features + ['state_encoded', 'day_of_week_encoded']
        feature_cols = [col for col in feature_cols if col in df.columns]
        
        self.features_df = df[feature_cols].fillna(0)
        
        return self.features_df, df


class ConflictPredictor:
    """ML model for predicting conflicts in PRs"""
    
    def __init__(self):
        self.model = RandomForestClassifier(
            n_estimators=100,
            random_state=42,
            max_depth=10,
            min_samples_split=5
        )
        self.scaler = StandardScaler()
        self.is_trained = False
        
    def prepare_training_data(self, features_df: pd.DataFrame, target_df: pd.DataFrame) -> Tuple[pd.DataFrame, pd.Series]:
        """Prepare training data for conflict prediction"""
        if features_df.empty or target_df.empty:
            logger.warning("Empty dataframes provided for training data preparation")
            return pd.DataFrame(), pd.Series(dtype=int)
            
        X = features_df.copy()
        
        if 'has_conflicts' in target_df.columns:
            y = target_df['has_conflicts'].astype(int)
        else:
            logger.warning("No 'has_conflicts' column found, creating dummy target")
            y = pd.Series([0] * len(X), dtype=int)
        
        # Remove rows with missing targets
        mask = y.notna()
        X = X[mask]
        y = y[mask]
        
        return X, y
    
    def train(self, X: pd.DataFrame, y: pd.Series) -> Dict[str, Any]:
        """Train the conflict prediction model"""
        if len(X) < 10:
            logger.warning("Insufficient data for training conflict predictor")
            return {
                'accuracy': 0.0,
                'classification_report': {},
                'feature_importance': {}
            }
        
        try:
            logger.info("Training conflict prediction model...")
            
            # Scale features
            X_scaled = self.scaler.fit_transform(X)
            
            # Check if we have both classes for stratification
            unique_classes = y.unique()
            if len(unique_classes) < 2:
                logger.warning("Only one class present in target variable, using random split")
                X_train, X_test, y_train, y_test = train_test_split(
                    X_scaled, y, test_size=0.2, random_state=42
                )
            else:
                X_train, X_test, y_train, y_test = train_test_split(
                    X_scaled, y, test_size=0.2, random_state=42, stratify=y
                )
            
            # Train model
            self.model.fit(X_train, y_train)
            self.is_trained = True
            
            # Evaluate
            y_pred = self.model.predict(X_test)
            accuracy = (y_pred == y_test).mean()
            
            logger.info(f"Conflict prediction accuracy: {accuracy:.3f}")
            
            # Safe feature importance extraction
            feature_importance = {}
            if hasattr(self.model, 'feature_importances_') and len(self.model.feature_importances_) == len(X.columns):
                feature_importance = dict(zip(X.columns, self.model.feature_importances_))
            
            return {
                'accuracy': float(accuracy),
                'classification_report': classification_report(y_test, y_pred, output_dict=True, zero_division=0),
                'feature_importance': feature_importance
            }
            
        except Exception as e:
            logger.error(f"Error training conflict predictor: {e}")
            return {
                'accuracy': 0.0,
                'classification_report': {},
                'feature_importance': {}
            }
    
    def predict_conflict_risk(self, X: pd.DataFrame) -> np.ndarray:
        """Predict conflict risk for new PRs"""
        if not self.is_trained or X.empty:
            return np.zeros(len(X))
        
        try:
            X_scaled = self.scaler.transform(X)
            probabilities = self.model.predict_proba(X_scaled)
            
            # Return probability of positive class (conflicts)
            if probabilities.shape[1] > 1:
                return probabilities[:, 1]
            else:
                return probabilities[:, 0]
                
        except Exception as e:
            logger.error(f"Error predicting conflict risk: {e}")
            return np.zeros(len(X))


class CollaborationAnalyzer:
    """Analyzes collaboration patterns using clustering"""
    
    def __init__(self, n_clusters: int = 5):
        self.n_clusters = n_clusters
        self.kmeans = KMeans(n_clusters=n_clusters, random_state=42)
        self.cluster_labels = [
            'Low Activity', 'Standard Process', 'High Engagement',
            'Review Heavy', 'Fast Track'
        ]
    
    def analyze_collaboration_patterns(self, features_df: pd.DataFrame, target_df: pd.DataFrame) -> Dict[str, Any]:
        """Analyze collaboration patterns using clustering"""
        logger.info("Analyzing collaboration patterns...")
        
        if features_df.empty or target_df.empty:
            logger.warning("Empty dataframes provided for collaboration analysis")
            return {}
        
        try:
            # Select relevant features for clustering
            cluster_features = [
                'total_comments', 'total_reviews', 'days_open',
                'author_pr_count', 'author_review_count'
            ]
            
            cluster_features = [f for f in cluster_features if f in features_df.columns]
            
            if len(cluster_features) < 3:
                logger.warning("Insufficient features for clustering analysis")
                return {}
            
            X_cluster = features_df[cluster_features].fillna(0)
            
            if len(X_cluster) < self.n_clusters:
                logger.warning(f"Not enough data points ({len(X_cluster)}) for {self.n_clusters} clusters")
                self.n_clusters = max(1, len(X_cluster))
                self.kmeans = KMeans(n_clusters=self.n_clusters, random_state=42)
            
            # Normalize features
            scaler = StandardScaler()
            X_normalized = scaler.fit_transform(X_cluster)
            
            # Perform clustering
            clusters = self.kmeans.fit_predict(X_normalized)
            
            # Analyze clusters
            cluster_analysis = {}
            for i in range(self.n_clusters):
                mask = clusters == i
                cluster_data = target_df[mask]
                
                if len(cluster_data) == 0:
                    continue
                
                cluster_name = self.cluster_labels[i] if i < len(self.cluster_labels) else f'Cluster_{i}'
                
                cluster_analysis[cluster_name] = {
                    'size': int(len(cluster_data)),
                    'avg_comments': float(cluster_data.get('total_comments', pd.Series([0])).mean()),
                    'avg_reviews': float(cluster_data.get('total_reviews', pd.Series([0])).mean()),
                    'avg_days_open': float(cluster_data.get('days_open', pd.Series([0])).mean()),
                    'merge_rate': float(cluster_data.get('is_merged', pd.Series([0])).mean()),
                    'conflict_rate': float(cluster_data.get('has_conflicts', pd.Series([0])).mean()),
                    'avg_sentiment': float(cluster_data.get('sentiment_score', pd.Series([0])).mean())
                }
            
            return {
                'cluster_analysis': cluster_analysis,
                'cluster_assignments': clusters.tolist(),
                'cluster_centers': self.kmeans.cluster_centers_.tolist()
            }
            
        except Exception as e:
            logger.error(f"Error in collaboration analysis: {e}")
            return {}


class TrendAnalyzer:
    """Analyzes temporal trends in PR data"""
    
    def analyze_temporal_trends(self, df: pd.DataFrame) -> Dict[str, Any]:
        """Analyze temporal trends"""
        logger.info("Analyzing temporal trends...")
        
        if df.empty:
            logger.warning("Empty dataframe provided for trend analysis")
            return {}
        
        try:
            trends = {}
            
            if 'created_at' not in df.columns:
                logger.warning("No 'created_at' column found for trend analysis")
                return {}
            
            # Daily trends
            df_temp = df.copy()
            df_temp['date'] = df_temp['created_at'].dt.date
            
            daily_stats = df_temp.groupby('date').agg({
                'id': 'count',
                'sentiment_score': 'mean',
                'conflict_count': 'sum',
                'total_comments': 'mean',
                'is_merged': 'mean'
            }).reset_index()
            
            # Convert dates to strings for JSON serialization
            daily_stats['date'] = daily_stats['date'].astype(str)
            trends['daily_trends'] = daily_stats.to_dict('records')
            
            # Day of week patterns
            if 'day_of_week' in df.columns:
                dow_stats = df.groupby('day_of_week').agg({
                    'id': 'count',
                    'sentiment_score': 'mean',
                    'conflict_count': 'mean',
                    'is_merged': 'mean'
                }).reset_index()
                trends['day_of_week_patterns'] = dow_stats.to_dict('records')
            
            # Hour patterns
            if 'hour_created' in df.columns:
                hour_stats = df.groupby('hour_created').agg({
                    'id': 'count',
                    'sentiment_score': 'mean',
                    'conflict_count': 'mean'
                }).reset_index()
                trends['hourly_patterns'] = hour_stats.to_dict('records')
            
            return trends
            
        except Exception as e:
            logger.error(f"Error in trend analysis: {e}")
            return {}


class InsightGenerator:
    """Generates actionable insights from ML analysis"""
    
    def generate_insights(self, processed_data: pd.DataFrame, ml_results: Dict[str, Any]) -> Dict[str, Any]:
        """Generate comprehensive insights"""
        logger.info("Generating insights...")
        
        try:
            insights = {
                'summary': self._generate_summary_insights(processed_data),
                'collaboration_insights': self._generate_collaboration_insights(ml_results),
                'risk_insights': self._generate_risk_insights(processed_data, ml_results),
                'temporal_insights': self._generate_temporal_insights(ml_results),
                'recommendations': self._generate_recommendations(processed_data, ml_results)
            }
            
            return insights
            
        except Exception as e:
            logger.error(f"Error generating insights: {e}")
            return {}
    
    def _generate_summary_insights(self, df: pd.DataFrame) -> Dict[str, Any]:
        """Generate summary insights"""
        if df.empty:
            return {}
        
        try:
            return {
                'total_prs_analyzed': int(len(df)),
                'avg_sentiment_score': float(df.get('sentiment_score', pd.Series([0])).mean()),
                'conflict_rate': float((df.get('conflict_count', pd.Series([0])) > 0).mean()),
                'merge_rate': float(df.get('is_merged', pd.Series([0])).mean()),
                'avg_comments_per_pr': float(df.get('total_comments', pd.Series([0])).mean()),
                'avg_days_open': float(df.get('days_open', pd.Series([0])).mean())
            }
        except Exception as e:
            logger.error(f"Error generating summary insights: {e}")
            return {}
    
    def _generate_collaboration_insights(self, ml_results: Dict[str, Any]) -> Dict[str, Any]:
        """Generate collaboration insights"""
        try:
            collaboration_analysis = ml_results.get('collaboration_analysis', {})
            cluster_analysis = collaboration_analysis.get('cluster_analysis', {})
            
            if not cluster_analysis:
                return {}
            
            # Find most efficient cluster
            best_cluster = max(
                cluster_analysis.items(),
                key=lambda x: x[1].get('merge_rate', 0) - x[1].get('conflict_rate', 0)
            )
            
            # Find most problematic cluster
            worst_cluster = max(
                cluster_analysis.items(),
                key=lambda x: x[1].get('conflict_rate', 0)
            )
            
            return {
                'most_efficient_pattern': {
                    'name': best_cluster[0],
                    'characteristics': best_cluster[1]
                },
                'most_problematic_pattern': {
                    'name': worst_cluster[0],
                    'characteristics': worst_cluster[1]
                },
                'pattern_distribution': {name: data.get('size', 0) for name, data in cluster_analysis.items()}
            }
            
        except Exception as e:
            logger.error(f"Error generating collaboration insights: {e}")
            return {}
    
    def _generate_risk_insights(self, df: pd.DataFrame, ml_results: Dict[str, Any]) -> Dict[str, Any]:
        """Generate risk assessment insights"""
        try:
            conflict_prediction = ml_results.get('conflict_prediction', {})
            
            high_risk_threshold = 0.7
            medium_risk_threshold = 0.3
            
            risk_insights = {}
            
            if 'risk_scores' in ml_results:
                risk_scores = ml_results['risk_scores']
                
                if risk_scores:
                    high_risk_count = sum(1 for score in risk_scores if score > high_risk_threshold)
                    medium_risk_count = sum(1 for score in risk_scores if medium_risk_threshold < score <= high_risk_threshold)
                    low_risk_count = len(risk_scores) - high_risk_count - medium_risk_count
                    
                    risk_insights = {
                        'high_risk_prs': high_risk_count,
                        'medium_risk_prs': medium_risk_count,
                        'low_risk_prs': low_risk_count,
                        'avg_risk_score': float(np.mean(risk_scores))
                    }
            
            # Add feature importance if available
            if 'feature_importance' in conflict_prediction:
                feature_importance = conflict_prediction['feature_importance']
                if feature_importance:
                    risk_insights['key_risk_factors'] = dict(
                        sorted(feature_importance.items(),
                               key=lambda x: x[1], reverse=True)[:5]
                    )
            
            return risk_insights
            
        except Exception as e:
            logger.error(f"Error generating risk insights: {e}")
            return {}
    
    def _generate_temporal_insights(self, ml_results: Dict[str, Any]) -> Dict[str, Any]:
        """Generate temporal insights"""
        try:
            trend_analysis = ml_results.get('trend_analysis', {})
            
            insights = {}
            
            # Day of week insights
            dow_patterns = trend_analysis.get('day_of_week_patterns', [])
            if dow_patterns:
                busiest_day = max(dow_patterns, key=lambda x: x.get('id', 0))
                most_conflicted_day = max(dow_patterns, key=lambda x: x.get('conflict_count', 0))
                
                insights['busiest_day'] = busiest_day.get('day_of_week', 'Unknown')
                insights['most_conflicted_day'] = most_conflicted_day.get('day_of_week', 'Unknown')
            
            # Hour patterns
            hour_patterns = trend_analysis.get('hourly_patterns', [])
            if hour_patterns:
                peak_hour = max(hour_patterns, key=lambda x: x.get('id', 0))
                insights['peak_activity_hour'] = int(peak_hour.get('hour_created', 12))
            
            return insights
            
        except Exception as e:
            logger.error(f"Error generating temporal insights: {e}")
            return {}
    
    def _generate_recommendations(self, df: pd.DataFrame, ml_results: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Generate actionable recommendations"""
        try:
            recommendations = []
            
            if df.empty:
                return recommendations
            
            # Conflict-based recommendations
            avg_conflicts = df.get('conflict_count', pd.Series([0])).mean()
            if avg_conflicts > 0.5:
                recommendations.append({
                    'category': 'Conflict Reduction',
                    'priority': 'High',
                    'recommendation': 'Implement conflict resolution training and clear review guidelines',
                    'reasoning': 'High conflict rate detected in PR reviews'
                })
            
            # Sentiment-based recommendations
            avg_sentiment = df.get('sentiment_score', pd.Series([0])).mean()
            if avg_sentiment < -0.1:
                recommendations.append({
                    'category': 'Team Morale',
                    'priority': 'Medium',
                    'recommendation': 'Focus on positive communication in code reviews',
                    'reasoning': 'Overall sentiment in PR discussions is negative'
                })
            
            # Collaboration pattern recommendations
            collaboration = ml_results.get('collaboration_analysis', {})
            if collaboration:
                cluster_analysis = collaboration.get('cluster_analysis', {})
                if any(data.get('conflict_rate', 0) > 0.3 for data in cluster_analysis.values()):
                    recommendations.append({
                        'category': 'Process Improvement',
                        'priority': 'Medium',
                        'recommendation': 'Review PR workflow for high-conflict clusters',
                        'reasoning': 'Some collaboration patterns show high conflict rates'
                    })
            
            # Efficiency recommendations
            avg_days_open = df.get('days_open', pd.Series([0])).mean()
            if avg_days_open > 7:
                recommendations.append({
                    'category': 'Efficiency',
                    'priority': 'Medium',
                    'recommendation': 'Implement PR review time limits and automated reminders',
                    'reasoning': 'PRs are staying open for extended periods'
                })
            
            return recommendations
            
        except Exception as e:
            logger.error(f"Error generating recommendations: {e}")
            return []


class VisualizationGenerator:
    """Generates visualizations for ML analysis"""
    
    def __init__(self, output_dir: Union[str, Path]):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(exist_ok=True)
        
        # Set style safely
        try:
            plt.style.use('seaborn-v0_8')
        except:
            try:
                plt.style.use('seaborn')
            except:
                pass  # Use default style
        
        try:
            sns.set_palette("husl")
        except:
            pass  # Use default palette
    
    def generate_all_visualizations(self, df: pd.DataFrame, ml_results: Dict[str, Any]) -> Dict[str, str]:
        """Generate all visualizations"""
        logger.info("Generating visualizations...")
        
        visualizations = {}
        
        if df.empty:
            logger.warning("Empty dataframe provided for visualization")
            return visualizations
        
        try:
            # 1. Sentiment Distribution
            viz_path = self._plot_sentiment_distribution(df)
            if viz_path:
                visualizations['sentiment_distribution'] = str(viz_path)
            
            # 2. Conflict Analysis
            viz_path = self._plot_conflict_analysis(df)
            if viz_path:
                visualizations['conflict_analysis'] = str(viz_path)
            
            # 3. Collaboration Patterns
            if 'collaboration_analysis' in ml_results:
                viz_path = self._plot_collaboration_patterns(ml_results['collaboration_analysis'])
                if viz_path:
                    visualizations['collaboration_patterns'] = str(viz_path)
            
            # 4. Temporal Trends
            if 'trend_analysis' in ml_results:
                viz_path = self._plot_temporal_trends(ml_results['trend_analysis'])
                if viz_path:
                    visualizations['temporal_trends'] = str(viz_path)
            
            # 5. Risk Assessment
            if 'risk_scores' in ml_results:
                viz_path = self._plot_risk_assessment(ml_results['risk_scores'])
                if viz_path:
                    visualizations['risk_assessment'] = str(viz_path)
                    
        except Exception as e:
            logger.error(f"Error generating visualizations: {e}")
        
        return visualizations
    
    def _plot_sentiment_distribution(self, df: pd.DataFrame) -> Optional[Path]:
        """Plot sentiment score distribution"""
        try:
            if 'sentiment_score' not in df.columns or df.empty:
                return None
            
            plt.figure(figsize=(10, 6))
            plt.subplot(2, 2, 1)
            
            # Histogram
            sentiment_data = df['sentiment_score'].dropna()
            if len(sentiment_data) > 0:
                plt.hist(sentiment_data, bins=30, alpha=0.7, edgecolor='black')
                plt.xlabel('Sentiment Score')
                plt.ylabel('Frequency')
                plt.title('Sentiment Score Distribution')
                plt.axvline(sentiment_data.mean(), color='red', linestyle='--', label='Mean')
                plt.legend()
            
            # Box plot by state
            plt.subplot(2, 2, 2)
            if 'state' in df.columns and not df['state'].isna().all():
                try:
                    df.boxplot(column='sentiment_score', by='state', ax=plt.gca())
                    plt.title('Sentiment by PR State')
                except:
                    plt.text(0.5, 0.5, 'No state data', ha='center', va='center')
            
            # Sentiment over time
            plt.subplot(2, 2, 3)
            if 'created_at' in df.columns:
                try:
                    df_time = df.set_index('created_at')['sentiment_score'].resample('D').mean()
                    if len(df_time.dropna()) > 0:
                        df_time.plot()
                        plt.title('Sentiment Trends Over Time')
                        plt.ylabel('Average Sentiment')
                except:
                    plt.text(0.5, 0.5, 'No time data', ha='center', va='center')
            
            # Sentiment vs Conflicts
            plt.subplot(2, 2, 4)
            if 'conflict_count' in df.columns:
                plt.scatter(df['sentiment_score'], df['conflict_count'], alpha=0.6)
                plt.xlabel('Sentiment Score')
                plt.ylabel('Conflict Count')
                plt.title('Sentiment vs Conflicts')
            
            plt.tight_layout()
            output_path = self.output_dir / 'sentiment_analysis.png'
            plt.savefig(output_path, dpi=300, bbox_inches='tight')
            plt.close()
            
            return output_path
            
        except Exception as e:
            logger.error(f"Error plotting sentiment distribution: {e}")
            plt.close()
            return None
    
    def _plot_conflict_analysis(self, df: pd.DataFrame) -> Optional[Path]:
        """Plot conflict analysis"""
        try:
            if 'conflict_count' not in df.columns or df.empty:
                return None
            
            plt.figure(figsize=(12, 8))
            
            # Conflict distribution
            plt.subplot(2, 3, 1)
            conflict_counts = df['conflict_count'].value_counts().sort_index()
            if len(conflict_counts) > 0:
                plt.bar(conflict_counts.index, conflict_counts.values)
                plt.xlabel('Number of Conflicts')
                plt.ylabel('Number of PRs')
                plt.title('Conflict Distribution')
            
            # Additional plots with safe data checking
            # ... (implement other subplots with similar error handling)
            
            plt.tight_layout()
            output_path = self.output_dir / 'conflict_analysis.png'
            plt.savefig(output_path, dpi=300, bbox_inches='tight')
            plt.close()
            
            return output_path
            
        except Exception as e:
            logger.error(f"Error plotting conflict analysis: {e}")
            plt.close()
            return None
    
    def _plot_collaboration_patterns(self, collaboration_data: Dict[str, Any]) -> Optional[Path]:
        """Plot collaboration patterns"""
        try:
            cluster_analysis = collaboration_data.get('cluster_analysis', {})
            if not cluster_analysis:
                return None
            
            plt.figure(figsize=(15, 10))
            
            # Cluster sizes
            plt.subplot(2, 3, 1)
            cluster_names = list(cluster_analysis.keys())
            cluster_sizes = [data.get('size', 0) for data in cluster_analysis.values()]
            
            if cluster_sizes and sum(cluster_sizes) > 0:
                plt.pie(cluster_sizes, labels=cluster_names, autopct='%1.1f%%')
                plt.title('Collaboration Pattern Distribution')
            
            plt.tight_layout()
            output_path = self.output_dir / 'collaboration_patterns.png'
            plt.savefig(output_path, dpi=300, bbox_inches='tight')
            plt.close()
            
            return output_path
            
        except Exception as e:
            logger.error(f"Error plotting collaboration patterns: {e}")
            plt.close()
            return None
    
    def _plot_temporal_trends(self, trend_data: Dict[str, Any]) -> Optional[Path]:
        """Plot temporal trends"""
        try:
            plt.figure(figsize=(15, 10))
            
            # Daily trends
            daily_trends = trend_data.get('daily_trends', [])
            if daily_trends:
                daily_df = pd.DataFrame(daily_trends)
                if 'date' in daily_df.columns:
                    daily_df['date'] = pd.to_datetime(daily_df['date'])
                    
                    plt.subplot(2, 3, 1)
                    plt.plot(daily_df['date'], daily_df.get('id', []))
                    plt.title('Daily PR Count')
                    plt.ylabel('Number of PRs')
                    plt.xticks(rotation=45)
            
            plt.tight_layout()
            output_path = self.output_dir / 'temporal_trends.png'
            plt.savefig(output_path, dpi=300, bbox_inches='tight')
            plt.close()
            
            return output_path
            
        except Exception as e:
            logger.error(f"Error plotting temporal trends: {e}")
            plt.close()
            return None
    
    def _plot_risk_assessment(self, risk_scores: List[float]) -> Optional[Path]:
        """Plot risk assessment"""
        try:
            if not risk_scores:
                return None
                
            plt.figure(figsize=(12, 8))
            
            # Risk score distribution
            plt.subplot(2, 2, 1)
            plt.hist(risk_scores, bins=30, alpha=0.7, edgecolor='black')
            plt.xlabel('Risk Score')
            plt.ylabel('Frequency')
            plt.title('Conflict Risk Score Distribution')
            plt.axvline(np.mean(risk_scores), color='red', linestyle='--', label='Mean')
            plt.axvline(0.7, color='orange', linestyle='--', label='High Risk Threshold')
            plt.legend()
            
            plt.tight_layout()
            output_path = self.output_dir / 'risk_assessment.png'
            plt.savefig(output_path, dpi=300, bbox_inches='tight')
            plt.close()
            
            return output_path
            
        except Exception as e:
            logger.error(f"Error plotting risk assessment: {e}")
            plt.close()
            return None


def main() -> None:
    """Main function for ML analysis"""
    parser = argparse.ArgumentParser(description='PR Comment Sentiment & Conflict Detector - ML Analysis')
    parser.add_argument('--input', '-i', required=True, help='Input JSON file path')
    parser.add_argument('--output', '-o', default='./reports', help='Output directory')
    parser.add_argument('--clusters', '-c', type=int, default=5, help='Number of clusters for analysis')
    parser.add_argument('--visualize', action='store_true', help='Generate visualizations')
    parser.add_argument('--verbose', '-v', action='store_true', help='Verbose output')
    
    args = parser.parse_args()
    
    if args.verbose:
        logger.setLevel(logging.DEBUG)
    
    try:
        # Load data
        logger.info(f"Loading data from {args.input}")
        with open(args.input, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # Initialize components
        processor = PRDataProcessor(data)
        conflict_predictor = ConflictPredictor()
        collaboration_analyzer = CollaborationAnalyzer(n_clusters=args.clusters)
        trend_analyzer = TrendAnalyzer()
        insight_generator = InsightGenerator()
        
        # Process data
        features_df, target_df = processor.create_feature_matrix()
        
        if features_df.empty:
            safe_console_print("No data to process", "red")
            return
        
        logger.info(f"Processing {len(target_df)} PRs with {len(features_df.columns)} features")
        
        # ML Analysis
        ml_results = {}
        
        # 1. Conflict Prediction
        X, y = conflict_predictor.prepare_training_data(features_df, target_df)
        if len(X) >= 10:
            conflict_results = conflict_predictor.train(X, y)
            ml_results['conflict_prediction'] = conflict_results
            
            # Predict risk scores for all PRs
            risk_scores = conflict_predictor.predict_conflict_risk(features_df)
            ml_results['risk_scores'] = risk_scores.tolist()
        
        # 2. Collaboration Analysis
        collaboration_results = collaboration_analyzer.analyze_collaboration_patterns(features_df, target_df)
        ml_results['collaboration_analysis'] = collaboration_results
        
        # 3. Trend Analysis
        trend_results = trend_analyzer.analyze_temporal_trends(target_df)
        ml_results['trend_analysis'] = trend_results
        
        # 4. Generate Insights
        insights = insight_generator.generate_insights(target_df, ml_results)
        ml_results['insights'] = insights
        
        # 5. Generate Visualizations
        if args.visualize:
            viz_generator = VisualizationGenerator(args.output)
            visualizations = viz_generator.generate_all_visualizations(target_df, ml_results)
            ml_results['visualizations'] = visualizations
        
        # Save results
        output_dir = Path(args.output)
        output_dir.mkdir(exist_ok=True)
        
        # Convert all data to JSON serializable format
        ml_results = convert_to_json_serializable(ml_results)
        
        output_file = output_dir / 'ml_insights.json'
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(ml_results, f, indent=2, ensure_ascii=False)
        
        safe_console_print(f"✅ ML analysis complete! Results saved to {output_file}", "green")
        
        # Print summary
        if insights:
            safe_console_print("\n📊 ML Analysis Summary:", "blue")
            summary = insights.get('summary', {})
            for key, value in summary.items():
                safe_console_print(f"   {key.replace('_', ' ').title()}: {value}", "cyan")
            
            safe_console_print("\n🔍 Key Insights:", "blue")
            recommendations = insights.get('recommendations', [])
            for rec in recommendations[:3]:  # Show top 3 recommendations
                safe_console_print(f"   • {rec.get('category', 'General')}: {rec.get('recommendation', 'No recommendation')}", "yellow")
        
    except FileNotFoundError:
        safe_console_print(f"Input file not found: {args.input}", "red")
    except json.JSONDecodeError:
        safe_console_print(f"Invalid JSON in input file: {args.input}", "red")
    except Exception as e:
        safe_console_print(f"Analysis failed: {e}", "red")
        if args.verbose:
            import traceback
            traceback.print_exc()


if __name__ == "__main__":
    main()