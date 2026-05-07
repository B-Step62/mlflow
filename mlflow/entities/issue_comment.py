"""Issue comment entity (Linear-style activity thread on issues)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class IssueComment:
    comment_id: str
    issue_id: str
    author: str
    body: str
    kind: str  # "comment" (human), "claude" (worker turn/result), "system" (state change)
    created_timestamp: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "comment_id": self.comment_id,
            "issue_id": self.issue_id,
            "author": self.author,
            "body": self.body,
            "kind": self.kind,
            "created_timestamp": self.created_timestamp,
        }
