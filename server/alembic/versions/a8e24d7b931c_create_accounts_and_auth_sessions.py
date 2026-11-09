"""Create owner accounts and revocable login sessions.

Revision ID: a8e24d7b931c
Revises: f4d8b2c913a7
"""

from alembic import op
import sqlalchemy as sa


revision = "a8e24d7b931c"
down_revision = "f4d8b2c913a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add empty auth tables without changing existing application records."""

    op.create_table(
        "accounts",
        sa.Column(
            "id",
            sa.SmallInteger(),
            server_default="1",
            autoincrement=False,
            nullable=False,
        ),
        sa.Column("username", sa.String(64), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column(
            "is_active",
            sa.Boolean(),
            server_default=sa.true(),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "password_changed_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "id = 1",
            name="ck_accounts_single_owner",
        ),
        sa.CheckConstraint(
            "username ~ '^[a-z0-9][a-z0-9_.-]{2,63}$'",
            name="ck_accounts_username_format",
        ),
        sa.CheckConstraint(
            "char_length(btrim(password_hash)) > 0",
            name="ck_accounts_password_hash_not_blank",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "username",
            name="uq_accounts_username",
        ),
    )

    op.create_table(
        "auth_sessions",
        # SQLAlchemy supplies UUIDs when the service inserts session models.
        # There is no server-side token or password generation in this step.
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("account_id", sa.SmallInteger(), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("client_type", sa.String(6), nullable=False),
        sa.Column("csrf_token_hash", sa.String(64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "token_hash ~ '^[0-9a-f]{64}$'",
            name="ck_auth_sessions_token_hash_format",
        ),
        sa.CheckConstraint(
            "client_type IN ('web', 'native')",
            name="ck_auth_sessions_client_type",
        ),
        sa.CheckConstraint(
            "csrf_token_hash IS NULL "
            "OR csrf_token_hash ~ '^[0-9a-f]{64}$'",
            name="ck_auth_sessions_csrf_hash_format",
        ),
        sa.CheckConstraint(
            "(client_type = 'web' AND csrf_token_hash IS NOT NULL) "
            "OR (client_type = 'native' AND csrf_token_hash IS NULL)",
            name="ck_auth_sessions_csrf_client_pair",
        ),
        sa.CheckConstraint(
            "expires_at > created_at",
            name="ck_auth_sessions_expiration_after_creation",
        ),
        sa.CheckConstraint(
            "last_seen_at >= created_at AND last_seen_at < expires_at",
            name="ck_auth_sessions_last_seen_range",
        ),
        sa.CheckConstraint(
            "revoked_at IS NULL OR revoked_at >= created_at",
            name="ck_auth_sessions_revocation_after_creation",
        ),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["accounts.id"],
            name="fk_auth_sessions_account_id",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "token_hash",
            name="uq_auth_sessions_token_hash",
        ),
    )

    op.create_index(
        "ix_auth_sessions_account_id",
        "auth_sessions",
        ["account_id"],
    )
    op.create_index(
        "ix_auth_sessions_expires_at",
        "auth_sessions",
        ["expires_at"],
    )


def downgrade() -> None:
    """Remove empty auth tables, refusing to erase accounts or sessions."""

    op.execute(sa.text("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM accounts)
                OR EXISTS (SELECT 1 FROM auth_sessions)
            THEN
                RAISE EXCEPTION
                    'Cannot downgrade: accounts or auth sessions would be lost';
            END IF;
        END;
        $$
    """))

    op.drop_index("ix_auth_sessions_expires_at", table_name="auth_sessions")
    op.drop_index("ix_auth_sessions_account_id", table_name="auth_sessions")
    op.drop_table("auth_sessions")
    op.drop_table("accounts")

