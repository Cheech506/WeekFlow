"""Authentication isolation for the older business-endpoint test modules.

Those tests exercise tasks, goals, cycles, and backups after authentication.
Authentication and assembled-app tests must use the real guard instead.
This file is loaded by pytest only; the running API does not import it.
"""

from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest


_BUSINESS_MODULES = {
    "test_api.py",
    "test_backup_export_api.py",
    "test_backup_import_api.py",
    "test_backup_import_write_api.py",
    "test_backup_refresh_api.py",
    "test_backup_refresh_generated_tasks.py",
    "test_backup_refresh_order.py",
    "test_brain_dumps_api.py",
    "test_cycle_reviews_api.py",
    "test_goal_completion_api.py",
    "test_goal_cycle_delete_api.py",
    "test_goal_milestone_api.py",
    "test_goals_api.py",
    "test_planning_cycles_api.py",
    "test_recurrence_generation_api.py",
    "test_recurring_exceptions_api.py",
    "test_recurring_rules_api.py",
    "test_recurring_series_edit_api.py",
    "test_recurring_task_detach_api.py",
    "test_recurring_task_workflows_api.py",
    "test_task_relationships_api.py",
    "test_task_templates_api.py",
    "test_tasks_api.py",
    "test_weekly_commitments_api.py",
    "test_weekly_history_models.py",
    "test_weekly_reviews_api.py",
    "test_weekly_task_decisions_api.py",
}
_MISSING = object()


@pytest.fixture(autouse=True)
def authenticated_business_endpoint_tests(request):
    """Bypass the guard only for this explicit set of business test modules."""
    if request.node.path.name not in _BUSINESS_MODULES:
        yield
        return

    from app.main import app
    from app.routers.auth import require_authenticated_session
    from app.schemas.auth import SessionRead

    previous = app.dependency_overrides.get(require_authenticated_session, _MISSING)

    def already_authenticated():
        return SessionRead(
            session_id=UUID("00000000-0000-4000-8000-000000000001"),
            account_id=1,
            username="test-owner",
            client_type="native",
            expires_at=datetime.now(UTC) + timedelta(hours=1),
        )

    app.dependency_overrides[require_authenticated_session] = already_authenticated
    try:
        yield
    finally:
        # Some existing database fixtures clear all overrides themselves.
        # Always restore the value that was present before this fixture ran.
        if previous is _MISSING:
            app.dependency_overrides.pop(require_authenticated_session, None)
        else:
            app.dependency_overrides[require_authenticated_session] = previous
