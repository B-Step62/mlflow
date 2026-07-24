# Evaluation Result UI Overhaul Todo

## Checklist

- [x] Show evaluation results as full-page views instead of a split run-list/result layout.
- [x] Hide trace ID, session ID, and state columns by default in result tables.
- [x] Show token and execution-time summary charts by default in result table headers.
- [x] Show all assessment columns by default.
- [x] Remove the Assessment parent header from result tables.
- [x] Expand request/response cells to about five lines by default without a "Rows: 1" toolbar button.
- [x] Add comparison summary charts above the comparison table, including latency, cost, tokens, and assessments.
- [x] Allow comparison mode to start with more than three selected runs.
- [x] Move Compare to the top-level run-list toolbar with a disabled tooltip when no runs are selected.
- [x] Replace the list/chart selector with an always-visible chart placeholder that says "Please select run".
- [x] Replace dataset grouping with a filter-by control.
- [x] Move the run-list control bar below the chart area and keep it to one icon-led row.
- [x] Reuse existing run chart cards for the top chart area, with one chart per assessment metric.
- [x] Add a dev-only seed path for sample evaluation runs in the Default experiment.
- [x] Run focused verification after the follow-up changes.

## Prototype Notes

- Multi-run comparison is enabled from the run list and represented in the comparison summary charts. The trace-detail table still uses the existing primary-vs-secondary join until the shared trace table supports N-way row comparison.
- Sample runs can be seeded into the local dev server's Default experiment with `uv run dev/run_dev_server.py --seed-eval-runs`. The flag is skipped when the dev server is pointed at a configured backend store.

## ASCII Mocks

### 1. Result Table

```text
+----------------------------------------------------------------------------------------------+
| +--------------------+ +--------------------+ +--------------------+ +--------------------+ ->|
| | chart visual       | | Latency            | | Cost               | | groundedness       |   |
| | Please select runs | | bars by run        | | bars by run        | | bars by run        |   |
| | to view chart      | +--------------------+ +--------------------+ +--------------------+   |
+----------------------------------------------------------------------------------------------+
| [filter Filter by v] [columns Columns v] [refresh]     [compare Compare] [Actions v]         |
+----------------------------------------------------------------------------------------------+
| [ ] Run name        Status   Created at       Dataset        latency   cost   correctness     |
| [ ] gpt-5-candidate pass     2h ago           support-v4       1.2s   .041   0.91            |
| [ ] claude-baseline pass     yesterday        support-v4       1.6s   .038   0.86            |
| [ ] small-fast      fail     Jul 22           support-v4       0.8s   .020   0.74            |
+----------------------------------------------------------------------------------------------+
```

### 2. Single Result Page

```text
+----------------------------------------------------------------------------------------------+
| Experiments > Default > Evaluation runs > gpt-5-candidate                                     |
+----------------------------------------------------------------------------------------------+
| [filter Filter by v] [columns Columns v] [refresh] [search request/response]                  |
| Request       Response                         Tokens      Execution time  correctness        |
| -------------------------------------------------------------------------------------------- |
| How do I...   The safest path is to open the experiment, switch the lifecycle filter,          |
|               and restore the run from the action menu.     1,248  1.23s  pass   pass        |
| Summarize...  You can compare prompt quality by running both versions against the same         |
|               evaluation dataset and reviewing score deltas.  844  0.92s  pass   fail        |
|                                                                                            ^ |
+----------------------------------------------------------------------------------------------+
```

### 3. Comparison Page

```text
+----------------------------------------------------------------------------------------------+
| Experiments > Default > Evaluation runs > Compare 4 runs                                      |
+----------------------------------------------------------------------------------------------+
| +--------------------+ +--------------------+ +--------------------+ +--------------------+ ->|
| | Latency            | | Cost               | | Tokens             | | groundedness       |   |
| | bars by run        | | bars by run        | | bars by run        | | bars by run        |   |
| +--------------------+ +--------------------+ +--------------------+ +--------------------+   |
+----------------------------------------------------------------------------------------------+
| [filter Filter by v] [columns Columns v] [refresh] [search request/response]                  |
| Request       Run A response     Run B response     Tokens     Latency     correctness        |
| -------------------------------------------------------------------------------------------- |
| How do I...   The safest...      The fastest...      A/B        A/B         pass -> fail       |
| Summarize...  You can...         You should...       A/B        A/B         fail -> pass       |
+----------------------------------------------------------------------------------------------+
```
