# Quickstart: Natural Language Custom Chart Generation

## Prerequisites
- MLflow tracking server running with SQL backend
- LLM provider API key (OpenAI, Anthropic, etc.)
- An MLflow experiment with logged metrics

## Setup

### 1. Start MLflow server with LLM configuration
```bash
export MLFLOW_LLM_ENGINE_MODEL=openai:/gpt-5-mini
export OPENAI_API_KEY=your-api-key-here

mlflow server \
  --backend-store-uri sqlite:///mlflow.db \
  --default-artifact-root ./mlruns \
  --host 0.0.0.0 \
  --port 5000
```

### 2. Log some sample metrics
```python
import mlflow
import numpy as np

# Start a run
with mlflow.start_run() as run:
    # Log some metrics
    for step in range(100):
        mlflow.log_metric("training_loss", 1.0 / (step + 1), step=step)
        mlflow.log_metric("validation_loss", 1.2 / (step + 1) + np.random.normal(0, 0.01), step=step)
        mlflow.log_metric("bleu_score", min(0.9, 0.1 * np.log(step + 1)), step=step)
    
    print(f"Run ID: {run.info.run_id}")
```

## Using the Feature

### Navigate to the Custom Chart Interface

1. Open MLflow UI at http://localhost:5000
2. Go to your experiment and select a run
3. Click on the "Model Metrics" tab
4. You'll see a new "Custom Chart" section with:
   - Text input field for natural language prompts
   - "Generate Chart" button
   - Chart display area below

### Generate Your First Chart

1. In the text input field, type:
   ```
   Plot training_loss and validation_loss over steps as line charts
   ```

2. Click the magic icon "Generate Chart"

3. You'll see:
   - Loading spinner with "Generating chart..." message with a spinning MLflow wheel
   - Progress updates as the system processes your request
   - Generated chart appears in the display area below

### Example Prompts to Try

#### Basic visualizations
- "Show training and validation accuracy as line charts"
- "Create a bar chart of final metric values"
- "Plot loss curves for all metrics ending with '_loss'"

#### Advanced visualizations
- "Create a scatter plot comparing training vs validation loss"
- "Show BLEU score progression with a trend line"
- "Generate side-by-side subplots for different metrics"

## Save and Load Charts

### Saving a Generated Chart

1. After generating a chart you like, click "Save Chart" button
2. Enter a name for your chart (e.g., "Loss Comparison")
3. Chart is automatically saved at the experiment level (available for all runs)
4. You'll see confirmation: "Chart saved successfully"

### Loading Saved Charts

1. In the "Custom Chart" section, you'll see a "Saved Charts" dropdown
2. This shows all charts saved for the current experiment (usable across any run)
3. Select a previously saved chart from the list
4. **Security Warning**: A warning dialog appears:
   ```
   This chart contains custom JavaScript code.
   
   [View Source Code] [Cancel] [Execute Chart]
   ```
5. Click "View Source Code" to review the generated JavaScript
6. Click "Execute Chart" to render it

### Managing Saved Charts

- **List**: All saved charts appear in the dropdown with creation timestamps
- **Delete**: Click the "×" next to a chart name to remove it
- **Rename**: Right-click a chart to rename it

## Chart Display Features

### Interactive Elements
- Zoom in/out by drawing rectangles
- Pan by dragging the chart
- Hover for detailed values
- Toggle series visibility by clicking legend items
- Reset zoom with double-click

### Export Options
- **PNG**: Right-click chart → "Save as PNG"
- **HTML**: Click "Export" → "Save as HTML file" 
- **Data**: Click "Export" → "Download data as CSV"

## Error Handling

### Common Error Messages

#### "No metrics found matching your request"
**What happened**: The prompt referenced metrics that don't exist in this run
**Solution**: 
- Check available metrics in the metrics table below
- Try: "Show me all available metrics as a summary chart"

#### "Request too ambiguous, please be more specific"  
**What happened**: The LLM couldn't understand what visualization you want
**Solution**:
- Be more specific: "line chart" instead of "chart"
- Include metric names: "training_loss" instead of "loss"
- Specify axes: "plot X over Y"

#### "Chart generation failed"
**What happened**: LLM service error or timeout
**Solutions**:
- Check your internet connection
- Try a simpler prompt
- Wait a moment and try again

### Troubleshooting Tips

1. **Start simple**: Begin with basic prompts like "plot metric_name over steps"
2. **Use exact metric names**: Copy-paste from the metrics table
3. **Be specific about chart types**: "line chart", "bar chart", "scatter plot"
4. **Mention axes explicitly**: "X axis should be steps, Y axis should be loss"

## Advanced Usage

### Custom Styling
Include styling instructions in your prompts:
- "Use dark theme with bright colors"
- "Make the chart colorblind-friendly"
- "Add a title and axis labels"

### Data Filtering
- "Plot only the last 50 steps"
- "Show metrics where value > 0.5"
- "Compare only training metrics"

### Multiple Metrics
- "Combine all accuracy metrics in one chart"
- "Show loss on left axis, accuracy on right axis"
- "Create subplots for each metric category"

## Testing the Feature

### Verification Steps

1. **Basic functionality**:
   - Generate a simple line chart ✓
   - Save the chart ✓
   - Load the saved chart ✓
   - View chart source code ✓

2. **Error handling**:
   - Try empty prompt → Should show error
   - Request non-existent metric → Should show helpful message
   - Invalid chart type → Should suggest alternatives

3. **Security features**:
   - Load saved chart → Warning dialog appears
   - View source code → JavaScript code is readable
   - Chart executes only after approval

## Browser Requirements

- **Supported**: Chrome 80+, Firefox 75+, Safari 13+, Edge 80+
- **JavaScript**: Must be enabled
- **Local Storage**: Used for UI preferences
- **WebGL**: Recommended for better chart performance

## Performance Notes

- **Chart generation**: Usually 5-15 seconds
- **Large datasets**: Automatically limited to 1000 points for performance
- **Multiple charts**: Can have up to 5 charts displayed simultaneously
- **Memory usage**: Each chart uses ~1-5MB depending on complexity

## Privacy and Security

- **Data**: All metric data stays in your MLflow instance
- **LLM requests**: Only chart generation prompts are sent to LLM provider
- **Generated code**: Runs in browser with limited permissions
- **Saved charts**: Stored at experiment level, accessible across all runs in the experiment