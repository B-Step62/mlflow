---
name: code-summarizer
description: Summarize a Python file's purpose, key functions, and dependencies
---

Read the specified Python file and produce a summary with these sections:

1. **Purpose**: One sentence describing what the file does.
2. **Key Functions**: List each function/class with a short (under 15 words) description. If there are more than 10, list only the most important ones. Do not elaborate on parameters, implementation details, or enumerate categories/areas the file covers.
3. **Dependencies**: List only the top-level external and standard-library module names (e.g., `os`, `click`, `mlflow.tracking`). Cap at 10 items. Do not describe what each import is used for.

Output exactly these three sections. Do not add extra sections (e.g., no "Variable Categories", "Constants", or similar).
Keep the summary concise - aim for under 200 words total. Do not include code snippets, lengthy enumerations of constants/variables/configuration areas, or narrative beyond the bullet points.
