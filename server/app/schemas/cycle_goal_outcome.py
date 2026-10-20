"""Validation schemas for goal decisions saved in a planning-cycle review."""

from datetime import datetime
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


PostgresId = Annotated[int, Field(strict=True, gt=0, le=2_147_483_647)]
CycleGoalOutcomeAction = Literal["complete", "carryForward", "archive", "replace"]


class CycleGoalOutcomeInput(BaseModel):
    """Select an outcome for an unfinished goal in a cycle-review draft.

    The server must verify that the goal belongs to the reviewed cycle and
    is unfinished. It copies the saved goal title from PostgreSQL. Saving
    the selection does not complete, copy, or otherwise modify the goal;
    those actions belong to the review's finalization transaction.
    """

    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    goal_id: PostgresId
    action: CycleGoalOutcomeAction
    replacement_title: str | None = Field(default=None, max_length=180)

    @field_validator("replacement_title")
    @classmethod
    def blank_title_to_none(cls, value: str | None) -> str | None:
        return value or None

    @model_validator(mode="after")
    def validate_replacement_action(self) -> Self:
        """Require a replacement title only for a replace decision."""

        if self.action == "replace":
            if self.replacement_title is None:
                raise ValueError("replace requires a nonblank replacement_title")
        elif self.replacement_title is not None:
            raise ValueError("replacement_title is only allowed for replace")

        return self


class CycleGoalOutcomeRead(BaseModel):
    """Return a saved goal selection and any destination created at finalization.

    Source IDs are retained for migration matching. Original or destination
    goal links can become null after deletion while saved titles remain.
    Clients cannot supply these historical titles, timestamps, source IDs,
    or destination IDs through the normal draft-selection input.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    source_cycle_goal_outcome_id: int | None
    cycle_review_id: int
    goal_id: int | None
    goal_title: str
    action: CycleGoalOutcomeAction
    replacement_title: str | None
    destination_goal_id: int | None
    created_at: datetime
    updated_at: datetime
