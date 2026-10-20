"""Validation schemas for cycle-review drafts, saved reports, and finalization."""

from datetime import date, datetime, timedelta
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.cycle_goal_outcome import CycleGoalOutcomeInput, CycleGoalOutcomeRead
from app.schemas.planning_cycle import PlanningCycleRead


PostgresId = Annotated[int, Field(strict=True, gt=0, le=2_147_483_647)]
SnapshotCount = Annotated[int, Field(strict=True, ge=0, le=2_147_483_647)]
CommitmentTitle = Annotated[str, Field(strict=True, max_length=180)]
Weekday = Literal[
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
]


class CycleReviewSnapshot(BaseModel):
    """Validate statistics supplied by the app, without recalculating them.

    Cycle-review drafts may refresh this snapshot. Finalizing freezes the
    saved report, including any completion adjustments made by the server.
    """

    model_config = ConfigDict(extra="forbid")

    goal_total: SnapshotCount
    goal_completed: SnapshotCount
    task_completed: SnapshotCount
    milestone_total: SnapshotCount
    milestone_completed: SnapshotCount
    weekly_reviews_completed: SnapshotCount
    longest_streak: SnapshotCount
    best_week_number: Annotated[int, Field(strict=True, ge=1, le=12)] | None
    best_week_count: SnapshotCount
    best_day: Weekday | None
    best_day_count: SnapshotCount
    high_priority_completed: SnapshotCount
    recurring_completed: SnapshotCount
    rewards_unlocked: SnapshotCount
    brain_dumps_archived: SnapshotCount

    @model_validator(mode="after")
    def require_consistent_counts(self) -> Self:
        for count_field, total_field in (
            ("goal_completed", "goal_total"),
            ("milestone_completed", "milestone_total"),
            ("high_priority_completed", "task_completed"),
            ("recurring_completed", "task_completed"),
            ("best_week_count", "task_completed"),
            ("best_day_count", "task_completed"),
            ("rewards_unlocked", "goal_completed"),
        ):
            if getattr(self, count_field) > getattr(self, total_field):
                raise ValueError(f"{count_field} cannot exceed {total_field}")

        if (self.best_week_number is None) != (self.best_week_count == 0):
            raise ValueError("best_week_number requires a positive best_week_count, or both must be empty")
        if (self.best_day is None) != (self.best_day_count == 0):
            raise ValueError("best_day requires a positive best_day_count, or both must be empty")

        return self


class CycleReviewReflection(BaseModel):
    """The seven optional written reflections in a cycle review."""

    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    biggest_accomplishment: str | None = Field(default=None, max_length=2000)
    biggest_challenge: str | None = Field(default=None, max_length=2000)
    what_worked_well: str | None = Field(default=None, max_length=2000)
    what_change_next_cycle: str | None = Field(default=None, max_length=2000)
    what_stop_doing: str | None = Field(default=None, max_length=2000)
    what_continue_doing: str | None = Field(default=None, max_length=2000)
    what_learned: str | None = Field(default=None, max_length=2000)

    @field_validator(
        "biggest_accomplishment", "biggest_challenge", "what_worked_well",
        "what_change_next_cycle", "what_stop_doing", "what_continue_doing",
        "what_learned",
    )
    @classmethod
    def blank_response_to_none(cls, value: str | None) -> str | None:
        return value or None


class NextCyclePlan(BaseModel):
    """Validate the proposed next cycle without creating it yet."""

    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    name: str | None = Field(default=None, max_length=80)
    primary_focus: str | None = Field(default=None, max_length=300)
    theme: str | None = Field(default=None, max_length=120)
    start_date: date
    first_week_commitments: list[CommitmentTitle] = Field(default_factory=list, max_length=5)

    @field_validator("name", "primary_focus", "theme")
    @classmethod
    def blank_detail_to_none(cls, value: str | None) -> str | None:
        return value or None

    @field_validator("start_date")
    @classmethod
    def require_supported_cycle_range(cls, value: date) -> date:
        # Match the current app and model: twelve inclusive weeks.
        try:
            value + timedelta(days=83)
        except OverflowError as error:
            raise ValueError("The twelve-week cycle exceeds the supported calendar") from error
        return value

    @field_validator("first_week_commitments")
    @classmethod
    def normalize_commitments(cls, value: list[str]) -> list[str]:
        """Trim entries, omit empty rows, and reject case-insensitive duplicates."""

        normalized = [item.strip() for item in value if item.strip()]
        keys = [item.lower() for item in normalized]
        if len(keys) != len(set(keys)):
            raise ValueError("first_week_commitments cannot contain duplicates")
        return normalized


class CycleReviewDraftSave(BaseModel):
    """Save the whole draft and its goal selections together.

    All sections are explicit to prevent accidentally erasing an omitted
    plan or outcome list. Use reflection={} or outcomes=[] when intended.
    A draft can select some unfinished goals; finalization must require a
    valid outcome for every unfinished goal and a valid successor date.
    """

    model_config = ConfigDict(extra="forbid")

    cycle_id: PostgresId
    reflection: CycleReviewReflection
    snapshot: CycleReviewSnapshot
    next_cycle: NextCyclePlan
    outcomes: list[CycleGoalOutcomeInput]

    @field_validator("outcomes")
    @classmethod
    def reject_duplicate_goals(cls, value: list[CycleGoalOutcomeInput]) -> list[CycleGoalOutcomeInput]:
        goal_ids = [item.goal_id for item in value]
        if len(goal_ids) != len(set(goal_ids)):
            raise ValueError("Each goal can have only one cycle outcome")
        return value


class CycleReviewRead(BaseModel):
    """Return persisted draft or finalized report fields without rewriting them."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    source_cycle_review_id: int | None
    cycle_id: int

    biggest_accomplishment: str | None
    biggest_challenge: str | None
    what_worked_well: str | None
    what_change_next_cycle: str | None
    what_stop_doing: str | None
    what_continue_doing: str | None
    what_learned: str | None

    snapshot_goal_total: int
    snapshot_goal_completed: int
    snapshot_task_completed: int
    snapshot_milestone_total: int
    snapshot_milestone_completed: int
    snapshot_weekly_reviews_completed: int
    snapshot_longest_streak: int
    snapshot_best_week_number: int | None
    snapshot_best_week_count: int
    snapshot_best_day: str | None
    snapshot_best_day_count: int
    snapshot_high_priority_completed: int
    snapshot_recurring_completed: int
    snapshot_rewards_unlocked: int
    snapshot_brain_dumps_archived: int

    next_cycle_name: str | None
    next_cycle_primary_focus: str | None
    next_cycle_theme: str | None
    next_cycle_start_date: date | None
    next_cycle_first_commitments: list[str]
    next_cycle_id: int | None

    created_at: datetime
    updated_at: datetime
    finalized_at: datetime | None


class CycleReviewDetail(BaseModel):
    """Return the saved review and its historical goal selections together."""

    review: CycleReviewRead
    outcomes: list[CycleGoalOutcomeRead]


class CycleReviewFinalizeResult(CycleReviewDetail):
    """Return the final report and successor, including safe finalization retries.

    A finalized imported report or a subsequently deleted successor can have
    no live next-cycle link. Its saved report remains available regardless.
    """

    next_cycle: PlanningCycleRead | None
    already_finalized: bool
