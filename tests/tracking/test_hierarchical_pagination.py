"""
Unit test for hierarchical pagination fix.
"""
import tempfile
import os
import shutil
import pytest

import mlflow
from mlflow.tracking import MlflowClient


class TestHierarchicalPagination:
    """Test hierarchical pagination functionality."""
    
    def setup_method(self):
        """Set up test environment."""
        self.temp_dir = tempfile.mkdtemp()
        self.tracking_uri = f"file://{self.temp_dir}/mlruns"
        mlflow.set_tracking_uri(self.tracking_uri)
        self.client = MlflowClient(tracking_uri=self.tracking_uri)
        
    def teardown_method(self):
        """Clean up test environment."""
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)
    
    def test_ensure_hierarchical_completeness_parameter_exists(self):
        """Test that the new parameter exists and can be called."""
        # This should not raise an error
        result = self.client.search_runs(
            experiment_ids=["0"],
            ensure_hierarchical_completeness=True
        )
        assert result is not None
        
    def test_ensure_hierarchical_completeness_reduces_orphaned_children(self):
        """Test that hierarchical completeness reduces orphaned children in results."""
        # Create nested hierarchy
        num_children = 25
        
        with mlflow.start_run(run_name="GrandParent"):
            with mlflow.start_run(run_name="Parent", nested=True):
                for i in range(num_children):
                    with mlflow.start_run(run_name=f"Child{i}", nested=True):
                        pass
        
        # Test WITHOUT hierarchical completeness
        results_without = self.client.search_runs(
            experiment_ids=["0"],
            order_by=["attributes.start_time DESC"],
            max_results=12,
            ensure_hierarchical_completeness=False
        )
        
        # Test WITH hierarchical completeness
        results_with = self.client.search_runs(
            experiment_ids=["0"],
            order_by=["attributes.start_time DESC"],
            max_results=12,
            ensure_hierarchical_completeness=True
        )
        
        def count_orphaned_children(runs):
            """Count child runs without their parents in the results."""
            parent_ids_in_results = {run.info.run_id for run in runs}
            orphaned = 0
            
            for run in runs:
                parent_id = run.data.tags.get("mlflow.parentRunId")
                if parent_id and parent_id not in parent_ids_in_results:
                    orphaned += 1
            
            return orphaned
        
        orphaned_without = count_orphaned_children(results_without)
        orphaned_with = count_orphaned_children(results_with)
        
        # The fix should reduce or eliminate orphaned children
        assert orphaned_with <= orphaned_without, (
            f"Hierarchical completeness should reduce orphaned children. "
            f"Without: {orphaned_without}, With: {orphaned_with}"
        )
        
        # Ideally, there should be no orphaned children with the fix
        assert orphaned_with == 0, (
            f"With hierarchical completeness enabled, there should be no orphaned children. "
            f"Found {orphaned_with} orphaned children."
        )
    
    def test_hierarchical_completeness_backward_compatibility(self):
        """Test that the default behavior is unchanged (backward compatibility)."""
        # Create some runs
        with mlflow.start_run(run_name="Parent"):
            with mlflow.start_run(run_name="Child", nested=True):
                pass
        
        # Default behavior (should be same as ensure_hierarchical_completeness=False)
        results_default = self.client.search_runs(experiment_ids=["0"])
        results_explicit_false = self.client.search_runs(
            experiment_ids=["0"], 
            ensure_hierarchical_completeness=False
        )
        
        # Should return same results
        assert len(results_default) == len(results_explicit_false)
        
        default_run_ids = {run.info.run_id for run in results_default}
        explicit_run_ids = {run.info.run_id for run in results_explicit_false}
        
        assert default_run_ids == explicit_run_ids, (
            "Default behavior should be same as ensure_hierarchical_completeness=False"
        )