import re

SKILL_NAME_RULE = re.compile(r"^[a-zA-Z0-9_.-]+$")
SKILL_METADATA_FILENAME = ".mlflow_skill_info"
