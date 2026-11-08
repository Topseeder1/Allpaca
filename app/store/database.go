//go:build windows || darwin

package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	sqlite3 "github.com/mattn/go-sqlite3"
	"github.com/topseeder1/allpaca/app/types/not"
)

// currentSchemaVersion defines the current database schema version.
// Increment this when making schema changes that require migrations.
const currentSchemaVersion = 15

// database wraps the SQLite connection.
// SQLite handles its own locking for concurrent access:
// - Multiple readers can access the database simultaneously
// - Writers are serialized (only one writer at a time)
// - WAL mode allows readers to not block writers
// This means we don't need application-level locks for database operations.
type database struct {
	conn *sql.DB
}

func newDatabase(dbPath string) (*database, error) {
	conn, err := sql.Open("sqlite3", dbPath+"?_foreign_keys=on&_journal_mode=WAL&_busy_timeout=5000&_txlock=immediate")
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}

	if err := conn.Ping(); err != nil {
		conn.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}

	db := &database{conn: conn}

	if err := db.init(); err != nil {
		conn.Close()
		return nil, fmt.Errorf("initialize database: %w", err)
	}

	return db, nil
}

func (db *database) Close() error {
	_, _ = db.conn.Exec("PRAGMA wal_checkpoint(TRUNCATE);")
	return db.conn.Close()
}

func (db *database) init() error {
	if _, err := db.conn.Exec("PRAGMA foreign_keys = ON"); err != nil {
		return fmt.Errorf("enable foreign keys: %w", err)
	}

	// Table definitions only. Indexes that reference columns added by a
	// migration MUST NOT live here: on an existing database CREATE TABLE
	// IF NOT EXISTS is a no-op, so the new column is absent until migrate()
	// runs. Creating such an index inline fails with "no such column" and
	// aborts init() before migrate() can add the column. Any index on a
	// migration-added column goes in the post-migrate block below.
	schema := fmt.Sprintf(`
	CREATE TABLE IF NOT EXISTS settings (
		id INTEGER PRIMARY KEY CHECK (id = 1),
		device_id TEXT NOT NULL DEFAULT '',
		has_completed_first_run BOOLEAN NOT NULL DEFAULT 0,
		expose BOOLEAN NOT NULL DEFAULT 0,
		survey BOOLEAN NOT NULL DEFAULT TRUE,
		browser BOOLEAN NOT NULL DEFAULT 0,
		models TEXT NOT NULL DEFAULT '',
		agent BOOLEAN NOT NULL DEFAULT 0,
		tools BOOLEAN NOT NULL DEFAULT 0,
		working_dir TEXT NOT NULL DEFAULT '',
		context_length INTEGER NOT NULL DEFAULT 4096,
		window_width INTEGER NOT NULL DEFAULT 0,
		window_height INTEGER NOT NULL DEFAULT 0,
		config_migrated BOOLEAN NOT NULL DEFAULT 0,
		airplane_mode BOOLEAN NOT NULL DEFAULT 0,
		turbo_enabled BOOLEAN NOT NULL DEFAULT 0,
		websearch_enabled BOOLEAN NOT NULL DEFAULT 0,
		selected_model TEXT NOT NULL DEFAULT '',
		sidebar_open BOOLEAN NOT NULL DEFAULT 0,
		think_enabled BOOLEAN NOT NULL DEFAULT 0,
		think_level TEXT NOT NULL DEFAULT '',
		remote TEXT NOT NULL DEFAULT '', -- deprecated
		schema_version INTEGER NOT NULL DEFAULT %d
	);

	INSERT OR IGNORE INTO settings (id) VALUES (1);

	CREATE TABLE IF NOT EXISTS projects (
		id         TEXT PRIMARY KEY,
		name       TEXT NOT NULL,
		parent_id  TEXT REFERENCES projects(id) ON DELETE SET NULL,
		created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
		sort_order INTEGER NOT NULL DEFAULT 0
	);

	CREATE TABLE IF NOT EXISTS chats (
		id TEXT PRIMARY KEY,
		title TEXT NOT NULL DEFAULT '',
		created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
		archived_at TIMESTAMP,
		deleted_at TIMESTAMP,
		project_id TEXT,
		browser_state TEXT
	);

	CREATE TABLE IF NOT EXISTS messages (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		chat_id TEXT NOT NULL,
		role TEXT NOT NULL,
		content TEXT NOT NULL DEFAULT '',
		thinking TEXT NOT NULL DEFAULT '',
		stream BOOLEAN NOT NULL DEFAULT 0,
		model_name TEXT,
		model_cloud BOOLEAN, -- deprecated
		model_ollama_host BOOLEAN, -- deprecated
		created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
		thinking_time_start TIMESTAMP,
		thinking_time_end TIMESTAMP,
		tool_result TEXT,
		FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
	);

	CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);

	CREATE TABLE IF NOT EXISTS tool_calls (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		message_id INTEGER NOT NULL,
		type TEXT NOT NULL,
		function_name TEXT NOT NULL,
		function_arguments TEXT NOT NULL,
		function_result TEXT,
		FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
	);

	CREATE INDEX IF NOT EXISTS idx_tool_calls_message_id ON tool_calls(message_id);

	CREATE TABLE IF NOT EXISTS attachments (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		message_id INTEGER NOT NULL,
		filename TEXT NOT NULL,
		data BLOB NOT NULL,
		FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
	);

	CREATE INDEX IF NOT EXISTS idx_attachments_message_id ON attachments(message_id);

	CREATE TABLE IF NOT EXISTS users (
		name TEXT NOT NULL DEFAULT '',
		email TEXT NOT NULL DEFAULT '',
		plan TEXT NOT NULL DEFAULT '',
		cached_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	`, currentSchemaVersion)

	if _, err := db.conn.Exec(schema); err != nil {
		return err
	}

	if err := db.migrate(); err != nil {
		return fmt.Errorf("migrate schema: %w", err)
	}

	// Post-migration indexes. These reference columns that may be added by
	// migrate(), so they run after migrate() to guarantee the column exists
	// on both fresh and upgraded databases. IF NOT EXISTS makes this a no-op
	// for databases where migrate() already built them.
	postMigrationIndexes := `
		CREATE INDEX IF NOT EXISTS idx_projects_parent_id ON projects(parent_id);
		CREATE INDEX IF NOT EXISTS idx_chats_project_id ON chats(project_id);
	`
	if _, err := db.conn.Exec(postMigrationIndexes); err != nil {
		return fmt.Errorf("create post-migration indexes: %w", err)
	}

	if err := db.cleanupOrphanedData(); err != nil {
		return fmt.Errorf("cleanup orphaned data: %w", err)
	}

	return nil
}

func (db *database) migrate() error {
	version, err := db.getSchemaVersion()
	if err != nil {
		return fmt.Errorf("get schema version after migration attempt: %w", err)
	}

	for version < currentSchemaVersion {
		switch version {
		case 1:
			if err := db.migrateV1ToV2(); err != nil {
				return fmt.Errorf("migrate v1 to v2: %w", err)
			}
			version = 2
		case 2:
			if err := db.migrateV2ToV3(); err != nil {
				return fmt.Errorf("migrate v2 to v3: %w", err)
			}
			version = 3
		case 3:
			if err := db.migrateV3ToV4(); err != nil {
				return fmt.Errorf("migrate v3 to v4: %w", err)
			}
			version = 4
		case 4:
			if err := db.migrateV4ToV5(); err != nil {
				return fmt.Errorf("migrate v4 to v5: %w", err)
			}
			version = 5
		case 5:
			if err := db.migrateV5ToV6(); err != nil {
				return fmt.Errorf("migrate v5 to v6: %w", err)
			}
			version = 6
		case 6:
			if err := db.migrateV6ToV7(); err != nil {
				return fmt.Errorf("migrate v6 to v7: %w", err)
			}
			version = 7
		case 7:
			if err := db.migrateV7ToV8(); err != nil {
				return fmt.Errorf("migrate v7 to v8: %w", err)
			}
			version = 8
		case 8:
			if err := db.migrateV8ToV9(); err != nil {
				return fmt.Errorf("migrate v8 to v9: %w", err)
			}
			version = 9
		case 9:
			if err := db.migrateV9ToV10(); err != nil {
				return fmt.Errorf("migrate v9 to v10: %w", err)
			}
			version = 10
		case 10:
			if err := db.migrateV10ToV11(); err != nil {
				return fmt.Errorf("migrate v10 to v11: %w", err)
			}
			version = 11
		case 11:
			if err := db.migrateV11ToV12(); err != nil {
				return fmt.Errorf("migrate v11 to v12: %w", err)
			}
			version = 12
		case 12:
			if err := db.migrateV12ToV13(); err != nil {
				return fmt.Errorf("migrate v12 to v13: %w", err)
			}
			version = 13
		case 13:
			if err := db.migrateV13ToV14(); err != nil {
				return fmt.Errorf("migrate v13 to v14: %w", err)
			}
			version = 14
		case 14:
			if err := db.migrateV14ToV15(); err != nil {
				return fmt.Errorf("migrate v14 to v15: %w", err)
			}
			version = 15
		default:
			version = currentSchemaVersion
		}
	}

	return nil
}

func (db *database) migrateV1ToV2() error {
	_, err := db.conn.Exec(`ALTER TABLE settings ADD COLUMN context_length INTEGER NOT NULL DEFAULT 4096;`)
	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add context_length column: %w", err)
	}
	_, err = db.conn.Exec(`ALTER TABLE settings ADD COLUMN survey BOOLEAN NOT NULL DEFAULT TRUE;`)
	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add survey column: %w", err)
	}
	_, err = db.conn.Exec(`UPDATE settings SET schema_version = 2;`)
	if err != nil {
		return fmt.Errorf("update schema version: %w", err)
	}
	return nil
}

func (db *database) migrateV2ToV3() error {
	_, err := db.conn.Exec(`
		CREATE TABLE IF NOT EXISTS attachments (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			message_id INTEGER NOT NULL,
			filename TEXT NOT NULL,
			data BLOB NOT NULL,
			FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
		)
	`)
	if err != nil {
		return fmt.Errorf("create attachments table: %w", err)
	}
	_, err = db.conn.Exec(`UPDATE settings SET schema_version = 3`)
	if err != nil {
		return fmt.Errorf("update schema version: %w", err)
	}
	return nil
}

func (db *database) migrateV3ToV4() error {
	_, err := db.conn.Exec(`ALTER TABLE messages ADD COLUMN tool_result TEXT;`)
	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add tool_result column: %w", err)
	}
	_, err = db.conn.Exec(`UPDATE settings SET schema_version = 4;`)
	if err != nil {
		return fmt.Errorf("update schema version: %w", err)
	}
	return nil
}

func (db *database) migrateV4ToV5() error {
	_, err := db.conn.Exec(`ALTER TABLE settings ADD COLUMN airplane_mode BOOLEAN NOT NULL DEFAULT 0;`)
	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add airplane_mode column: %w", err)
	}
	_, err = db.conn.Exec(`UPDATE settings SET schema_version = 5;`)
	if err != nil {
		return fmt.Errorf("update schema version: %w", err)
	}
	return nil
}

func (db *database) migrateV5ToV6() error {
	cols := []string{
		`ALTER TABLE settings ADD COLUMN turbo_enabled BOOLEAN NOT NULL DEFAULT 0;`,
		`ALTER TABLE settings ADD COLUMN websearch_enabled BOOLEAN NOT NULL DEFAULT 0;`,
		`ALTER TABLE settings ADD COLUMN selected_model TEXT NOT NULL DEFAULT '';`,
		`ALTER TABLE settings ADD COLUMN sidebar_open BOOLEAN NOT NULL DEFAULT 0;`,
	}
	for _, c := range cols {
		if _, err := db.conn.Exec(c); err != nil && !duplicateColumnError(err) {
			return fmt.Errorf("add column: %w", err)
		}
	}
	_, err := db.conn.Exec(`UPDATE settings SET schema_version = 6;`)
	if err != nil {
		return fmt.Errorf("update schema version: %w", err)
	}
	return nil
}

func (db *database) migrateV6ToV7() error {
	_, err := db.conn.Exec(`CREATE INDEX IF NOT EXISTS idx_attachments_message_id ON attachments(message_id);`)
	if err != nil {
		return fmt.Errorf("create attachments index: %w", err)
	}
	_, err = db.conn.Exec(`UPDATE settings SET schema_version = 7;`)
	if err != nil {
		return fmt.Errorf("update schema version: %w", err)
	}
	return nil
}

func (db *database) migrateV7ToV8() error {
	_, err := db.conn.Exec(`ALTER TABLE settings ADD COLUMN think_enabled BOOLEAN NOT NULL DEFAULT 0;`)
	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add think_enabled column: %w", err)
	}
	_, err = db.conn.Exec(`ALTER TABLE settings ADD COLUMN think_level TEXT NOT NULL DEFAULT '';`)
	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add think_level column: %w", err)
	}
	_, err = db.conn.Exec(`UPDATE settings SET schema_version = 8;`)
	if err != nil {
		return fmt.Errorf("update schema version: %w", err)
	}
	return nil
}

func (db *database) migrateV8ToV9() error {
	_, err := db.conn.Exec(`
		ALTER TABLE chats ADD COLUMN browser_state TEXT;
		UPDATE settings SET schema_version = 9;
	`)
	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add browser_state column: %w", err)
	}
	return nil
}

func (db *database) migrateV9ToV10() error {
	_, err := db.conn.Exec(`
		CREATE TABLE IF NOT EXISTS users (
			name TEXT NOT NULL DEFAULT '',
			email TEXT NOT NULL DEFAULT '',
			plan TEXT NOT NULL DEFAULT '',
			cached_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
		UPDATE settings SET schema_version = 10;
	`)
	if err != nil {
		return fmt.Errorf("create users table: %w", err)
	}
	return nil
}

func (db *database) migrateV10ToV11() error {
	_, err := db.conn.Exec(`ALTER TABLE settings DROP COLUMN remote`)
	if err != nil && !columnNotExists(err) {
		return fmt.Errorf("drop remote column: %w", err)
	}
	_, err = db.conn.Exec(`UPDATE settings SET schema_version = 11`)
	if err != nil {
		return fmt.Errorf("update schema version: %w", err)
	}
	return nil
}

func (db *database) migrateV11ToV12() error {
	_, err := db.conn.Exec(`ALTER TABLE settings ADD COLUMN remote TEXT NOT NULL DEFAULT ''`)
	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add remote column: %w", err)
	}
	_, err = db.conn.Exec(`UPDATE settings SET schema_version = 12`)
	if err != nil {
		return fmt.Errorf("update schema version: %w", err)
	}
	return nil
}

// migrateV12ToV13 adds archived_at to chats. NULL means "not archived".
func (db *database) migrateV12ToV13() error {
	_, err := db.conn.Exec(`ALTER TABLE chats ADD COLUMN archived_at TIMESTAMP`)
	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add archived_at column: %w", err)
	}
	_, err = db.conn.Exec(`UPDATE settings SET schema_version = 13`)
	if err != nil {
		return fmt.Errorf("update schema version: %w", err)
	}
	return nil
}

// migrateV13ToV14 adds deleted_at to chats. NULL means "not deleted".
// Deliberately not in saveChat's UPSERT column list, so writes cannot
// accidentally clear a soft-delete.
func (db *database) migrateV13ToV14() error {
	_, err := db.conn.Exec(`ALTER TABLE chats ADD COLUMN deleted_at TIMESTAMP`)
	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add deleted_at column: %w", err)
	}
	_, err = db.conn.Exec(`UPDATE settings SET schema_version = 14`)
	if err != nil {
		return fmt.Errorf("update schema version: %w", err)
	}
	return nil
}

// migrateV14ToV15 adds the projects table and chats.project_id. The
// project tree is self-referential (parent_id → projects.id, ON DELETE SET
// NULL to prevent structural deletes from ever cascading into chat loss).
// chats.project_id has NO foreign key at all: chats can outlive projects,
// and project deletion routes through explicit UPDATEs so it can never
// silently destroy a conversation.
func (db *database) migrateV14ToV15() error {
	_, err := db.conn.Exec(`
		CREATE TABLE IF NOT EXISTS projects (
			id         TEXT PRIMARY KEY,
			name       TEXT NOT NULL,
			parent_id  TEXT REFERENCES projects(id) ON DELETE SET NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			sort_order INTEGER NOT NULL DEFAULT 0
		);
	`)
	if err != nil {
		return fmt.Errorf("create projects table: %w", err)
	}

	_, err = db.conn.Exec(`ALTER TABLE chats ADD COLUMN project_id TEXT`)
	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add project_id column: %w", err)
	}

	// Indexes on migration-added columns are created here for the upgraded-
	// database path, and again in init() post-migrate for the fresh-database
	// path (which never enters this migration). IF NOT EXISTS dedupes.
	_, err = db.conn.Exec(`
		CREATE INDEX IF NOT EXISTS idx_projects_parent_id ON projects(parent_id);
		CREATE INDEX IF NOT EXISTS idx_chats_project_id ON chats(project_id);
	`)
	if err != nil {
		return fmt.Errorf("create project indexes: %w", err)
	}

	_, err = db.conn.Exec(`UPDATE settings SET schema_version = 15`)
	if err != nil {
		return fmt.Errorf("update schema version: %w", err)
	}
	return nil
}

func (db *database) cleanupOrphanedData() error {
	_, err := db.conn.Exec(`
		DELETE FROM tool_calls
		WHERE message_id NOT IN (SELECT id FROM messages)
	`)
	if err != nil {
		return fmt.Errorf("cleanup orphaned tool_calls: %w", err)
	}

	_, err = db.conn.Exec(`
		DELETE FROM attachments
		WHERE message_id NOT IN (SELECT id FROM messages)
	`)
	if err != nil {
		return fmt.Errorf("cleanup orphaned attachments: %w", err)
	}

	_, err = db.conn.Exec(`
		DELETE FROM messages
		WHERE chat_id NOT IN (SELECT id FROM chats)
	`)
	if err != nil {
		return fmt.Errorf("cleanup orphaned messages: %w", err)
	}

	return nil
}

func duplicateColumnError(err error) bool {
	if sqlite3Err, ok := err.(sqlite3.Error); ok {
		return sqlite3Err.Code == sqlite3.ErrError &&
			strings.Contains(sqlite3Err.Error(), "duplicate column name")
	}
	return false
}

func columnNotExists(err error) bool {
	if sqlite3Err, ok := err.(sqlite3.Error); ok {
		return sqlite3Err.Code == sqlite3.ErrError &&
			strings.Contains(sqlite3Err.Error(), "no such column")
	}
	return false
}

// queryChats is the single source of truth for the chat list projection used
// by the active list, the archive, and the trash. `where` and `orderBy` are
// compile-time constants supplied by the callers below, never user input.
// Additional `args` bind to ? placeholders in `where` and follow the
// parameterized-project filter added in v15.
func (db *database) queryChats(where, orderBy string, args ...any) ([]Chat, error) {
	query := fmt.Sprintf(`
		SELECT 
			c.id, 
			c.title, 
			c.created_at,
			c.archived_at,
			c.deleted_at,
			c.project_id,
			COALESCE(first_msg.content, '') as first_user_content,
			COALESCE(datetime(MAX(m.updated_at)), datetime(c.created_at)) as last_updated
		FROM chats c
		LEFT JOIN (
			SELECT chat_id, content, MIN(id) as min_id
			FROM messages
			WHERE role = 'user'
			GROUP BY chat_id
		) first_msg ON c.id = first_msg.chat_id
		LEFT JOIN messages m ON c.id = m.chat_id
		WHERE %s
		GROUP BY c.id, c.title, c.created_at, c.archived_at, c.deleted_at, c.project_id, first_msg.content
		ORDER BY %s
	`, where, orderBy)

	rows, err := db.conn.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("query chats: %w", err)
	}
	defer rows.Close()

	var chats []Chat
	for rows.Next() {
		var chat Chat
		var createdAt time.Time
		var archivedAt, deletedAt sql.NullTime
		var projectID sql.NullString
		var firstUserContent string
		var lastUpdatedStr string

		err := rows.Scan(
			&chat.ID,
			&chat.Title,
			&createdAt,
			&archivedAt,
			&deletedAt,
			&projectID,
			&firstUserContent,
			&lastUpdatedStr,
		)
		if err != nil {
			return nil, fmt.Errorf("scan chat: %w", err)
		}

		chat.CreatedAt = createdAt
		if archivedAt.Valid {
			chat.ArchivedAt = &archivedAt.Time
		}
		if deletedAt.Valid {
			chat.DeletedAt = &deletedAt.Time
		}
		if projectID.Valid {
			pid := projectID.String
			chat.ProjectID = &pid
		}

		lastUpdated, _ := time.Parse("2006-01-02 15:04:05", lastUpdatedStr)

		chat.Messages = []Message{}
		if firstUserContent != "" {
			chat.Messages = append(chat.Messages, Message{
				Role:      "user",
				Content:   firstUserContent,
				UpdatedAt: lastUpdated,
			})
		}

		chats = append(chats, chat)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate chats: %w", err)
	}

	return chats, nil
}

// getAllChats returns unfiled chats (project_id IS NULL) that are neither
// archived nor deleted. Chats inside a project are excluded from the root
// view — they surface via getProjectChats.
func (db *database) getAllChats() ([]Chat, error) {
	return db.queryChats(
		"c.archived_at IS NULL AND c.deleted_at IS NULL AND c.project_id IS NULL",
		"last_updated DESC",
	)
}

// getProjectChats returns chats belonging to a specific project that are
// neither archived nor deleted.
func (db *database) getProjectChats(projectID string) ([]Chat, error) {
	return db.queryChats(
		"c.archived_at IS NULL AND c.deleted_at IS NULL AND c.project_id = ?",
		"last_updated DESC",
		projectID,
	)
}

// getArchivedChats returns archived chats that are not deleted,
// most recently archived first. Project filter intentionally not applied —
// archive is a global view.
func (db *database) getArchivedChats() ([]Chat, error) {
	return db.queryChats("c.archived_at IS NOT NULL AND c.deleted_at IS NULL", "c.archived_at DESC")
}

// getDeletedChats returns soft-deleted chats still within the grace window,
// most recently deleted first.
func (db *database) getDeletedChats() ([]Chat, error) {
	return db.queryChats("c.deleted_at IS NOT NULL", "c.deleted_at DESC")
}

// getChatWithOptions loads a single chat by ID. Deliberately unfiltered — a
// soft-deleted chat must still be loadable so chat() can see DeletedAt and
// auto-restore when the user replies.
func (db *database) getChatWithOptions(id string, loadAttachmentData bool) (*Chat, error) {
	query := `
		SELECT id, title, created_at, browser_state, archived_at, deleted_at, project_id
		FROM chats
		WHERE id = ?
	`

	var chat Chat
	var createdAt time.Time
	var browserState sql.NullString
	var archivedAt, deletedAt sql.NullTime
	var projectID sql.NullString

	err := db.conn.QueryRow(query, id).Scan(
		&chat.ID,
		&chat.Title,
		&createdAt,
		&browserState,
		&archivedAt,
		&deletedAt,
		&projectID,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("chat not found")
		}
		return nil, fmt.Errorf("query chat: %w", err)
	}

	chat.CreatedAt = createdAt
	if archivedAt.Valid {
		chat.ArchivedAt = &archivedAt.Time
	}
	if deletedAt.Valid {
		chat.DeletedAt = &deletedAt.Time
	}
	if projectID.Valid {
		pid := projectID.String
		chat.ProjectID = &pid
	}
	if browserState.Valid && browserState.String != "" {
		var raw json.RawMessage
		if err := json.Unmarshal([]byte(browserState.String), &raw); err == nil {
			chat.BrowserState = raw
		}
	}

	messages, err := db.getMessages(id, loadAttachmentData)
	if err != nil {
		return nil, fmt.Errorf("get messages: %w", err)
	}
	chat.Messages = messages

	return &chat, nil
}

func (db *database) saveChat(chat Chat) error {
	tx, err := db.conn.Begin()
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback()

	// COALESCE for browser_state preserves the existing payload when saving a
	// chat that doesn't include a new state. archived_at, deleted_at, and
	// project_id are intentionally absent — they're owned by their dedicated
	// mutation methods so that write paths cannot clobber trash, archive, or
	// project membership.
	query := `
		INSERT INTO chats (id, title, created_at, browser_state)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			title = excluded.title,
			browser_state = COALESCE(excluded.browser_state, chats.browser_state)
	`

	var browserState sql.NullString
	if chat.BrowserState != nil {
		browserState = sql.NullString{String: string(chat.BrowserState), Valid: true}
	}

	if _, err = tx.Exec(query, chat.ID, chat.Title, chat.CreatedAt, browserState); err != nil {
		return fmt.Errorf("save chat: %w", err)
	}

	if _, err = tx.Exec("DELETE FROM messages WHERE chat_id = ?", chat.ID); err != nil {
		return fmt.Errorf("delete messages: %w", err)
	}

	for _, msg := range chat.Messages {
		messageID, err := db.insertMessage(tx, chat.ID, msg)
		if err != nil {
			return fmt.Errorf("insert message: %w", err)
		}

		for _, toolCall := range msg.ToolCalls {
			if err := db.insertToolCall(tx, messageID, toolCall); err != nil {
				return fmt.Errorf("insert tool call: %w", err)
			}
		}
	}

	return tx.Commit()
}

func (db *database) updateChatBrowserState(chatID string, state json.RawMessage) error {
	_, err := db.conn.Exec(`UPDATE chats SET browser_state = ? WHERE id = ?`, string(state), chatID)
	if err != nil {
		return fmt.Errorf("update chat browser state: %w", err)
	}
	return nil
}

// softDeleteChat moves a chat into the trash for 30 days.
func (db *database) softDeleteChat(id string) error {
	result, err := db.conn.Exec(
		`UPDATE chats SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL`, id)
	if err != nil {
		return fmt.Errorf("soft delete chat: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("rows affected: %w", err)
	}
	if rows == 0 {
		var exists int
		if err := db.conn.QueryRow(`SELECT COUNT(1) FROM chats WHERE id = ?`, id).Scan(&exists); err != nil {
			return fmt.Errorf("check chat exists: %w", err)
		}
		if exists == 0 {
			return fmt.Errorf("%w: chat %s", not.Found, id)
		}
	}
	return nil
}

// restoreChat clears deleted_at, bringing a trashed chat back. Preserves
// archived_at, so a deleted-from-archive chat returns to the archive.
func (db *database) restoreChat(id string) error {
	result, err := db.conn.Exec(
		`UPDATE chats SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL`, id)
	if err != nil {
		return fmt.Errorf("restore chat: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("rows affected: %w", err)
	}
	if rows == 0 {
		var exists int
		if err := db.conn.QueryRow(`SELECT COUNT(1) FROM chats WHERE id = ?`, id).Scan(&exists); err != nil {
			return fmt.Errorf("check chat exists: %w", err)
		}
		if exists == 0 {
			return fmt.Errorf("%w: chat %s", not.Found, id)
		}
	}
	return nil
}

// purgeChat permanently removes a chat row. Cascade deletes messages, tool
// calls, and attachments. Caller is responsible for image cleanup.
func (db *database) purgeChat(id string) error {
	result, err := db.conn.Exec(`DELETE FROM chats WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("purge chat: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("rows affected: %w", err)
	}
	if rows == 0 {
		return fmt.Errorf("%w: chat %s", not.Found, id)
	}
	_, _ = db.conn.Exec("PRAGMA wal_checkpoint(TRUNCATE);")
	return nil
}

// purgeExpiredChats deletes every chat whose deleted_at is older than cutoff,
// returning the removed IDs so callers can clean up image dirs.
func (db *database) purgeExpiredChats(cutoff time.Duration) ([]string, error) {
	rows, err := db.conn.Query(
		`SELECT id FROM chats WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', ?)`,
		fmt.Sprintf("-%d seconds", int(cutoff.Seconds())),
	)
	if err != nil {
		return nil, fmt.Errorf("select expired chats: %w", err)
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan expired chat: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate expired chats: %w", err)
	}

	if len(ids) == 0 {
		return nil, nil
	}

	if _, err := db.conn.Exec(
		`DELETE FROM chats WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', ?)`,
		fmt.Sprintf("-%d seconds", int(cutoff.Seconds())),
	); err != nil {
		return nil, fmt.Errorf("purge expired chats: %w", err)
	}

	return ids, nil
}

func (db *database) archiveChat(id string) error {
	result, err := db.conn.Exec(
		`UPDATE chats SET archived_at = CURRENT_TIMESTAMP WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("archive chat: %w", err)
	}
	return archiveRowsAffected(result, id)
}

func (db *database) unarchiveChat(id string) error {
	result, err := db.conn.Exec(
		`UPDATE chats SET archived_at = NULL WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("unarchive chat: %w", err)
	}
	return archiveRowsAffected(result, id)
}

func archiveRowsAffected(result sql.Result, id string) error {
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("rows affected: %w", err)
	}
	if rows == 0 {
		return fmt.Errorf("%w: chat %s", not.Found, id)
	}
	return nil
}

// ---------- Projects ----------

// getProjects returns every project with its direct chat count. Chats that are
// archived or deleted are excluded from chat_count so the badge matches what
// the user sees when they drill in.
func (db *database) getProjects() ([]Project, error) {
	rows, err := db.conn.Query(`
		SELECT
			p.id,
			p.name,
			p.parent_id,
			p.created_at,
			p.sort_order,
			(SELECT COUNT(*) FROM chats
				WHERE project_id = p.id
				  AND deleted_at IS NULL
				  AND archived_at IS NULL) AS chat_count
		FROM projects p
		ORDER BY p.sort_order, p.name
	`)
	if err != nil {
		return nil, fmt.Errorf("query projects: %w", err)
	}
	defer rows.Close()

	var projects []Project
	for rows.Next() {
		var p Project
		var parentID sql.NullString
		if err := rows.Scan(&p.ID, &p.Name, &parentID, &p.CreatedAt, &p.SortOrder, &p.ChatCount); err != nil {
			return nil, fmt.Errorf("scan project: %w", err)
		}
		if parentID.Valid {
			pid := parentID.String
			p.ParentID = &pid
		}
		projects = append(projects, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate projects: %w", err)
	}
	return projects, nil
}

func (db *database) getProjectByID(id string) (*Project, error) {
	var p Project
	var parentID sql.NullString
	err := db.conn.QueryRow(`
		SELECT
			p.id, p.name, p.parent_id, p.created_at, p.sort_order,
			(SELECT COUNT(*) FROM chats
				WHERE project_id = p.id
				  AND deleted_at IS NULL
				  AND archived_at IS NULL) AS chat_count
		FROM projects p WHERE p.id = ?
	`, id).Scan(&p.ID, &p.Name, &parentID, &p.CreatedAt, &p.SortOrder, &p.ChatCount)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("%w: project %s", not.Found, id)
		}
		return nil, fmt.Errorf("query project: %w", err)
	}
	if parentID.Valid {
		pid := parentID.String
		p.ParentID = &pid
	}
	return &p, nil
}

func (db *database) createProject(name string, parentID *string) (*Project, error) {
	id, err := uuid.NewV7()
	if err != nil {
		return nil, fmt.Errorf("generate project id: %w", err)
	}

	var parent sql.NullString
	if parentID != nil {
		// Validate parent exists if provided.
		var exists int
		if err := db.conn.QueryRow(`SELECT COUNT(1) FROM projects WHERE id = ?`, *parentID).Scan(&exists); err != nil {
			return nil, fmt.Errorf("check parent project: %w", err)
		}
		if exists == 0 {
			return nil, fmt.Errorf("%w: parent project %s", not.Found, *parentID)
		}
		parent = sql.NullString{String: *parentID, Valid: true}
	}

	if _, err := db.conn.Exec(
		`INSERT INTO projects (id, name, parent_id) VALUES (?, ?, ?)`,
		id.String(), name, parent,
	); err != nil {
		return nil, fmt.Errorf("create project: %w", err)
	}

	return db.getProjectByID(id.String())
}

func (db *database) renameProject(id, name string) error {
	result, err := db.conn.Exec(`UPDATE projects SET name = ? WHERE id = ?`, name, id)
	if err != nil {
		return fmt.Errorf("rename project: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("rows affected: %w", err)
	}
	if rows == 0 {
		return fmt.Errorf("%w: project %s", not.Found, id)
	}
	return nil
}

// getProjectSubtree returns the IDs of the root project and every descendant,
// using a recursive CTE. Order of the returned slice is not guaranteed and
// callers must not depend on it.
func (db *database) getProjectSubtree(id string) ([]string, error) {
	rows, err := db.conn.Query(`
		WITH RECURSIVE subtree(id) AS (
			SELECT id FROM projects WHERE id = ?
			UNION ALL
			SELECT p.id FROM projects p INNER JOIN subtree s ON p.parent_id = s.id
		)
		SELECT id FROM subtree
	`, id)
	if err != nil {
		return nil, fmt.Errorf("query project subtree: %w", err)
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var sid string
		if err := rows.Scan(&sid); err != nil {
			return nil, fmt.Errorf("scan project subtree: %w", err)
		}
		ids = append(ids, sid)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate project subtree: %w", err)
	}
	return ids, nil
}

// deleteProject deletes the project and every descendant in one transaction.
// Chat handling depends on `mode`:
//
//   - "promote" (default): chats keep their rows and get project_id = NULL,
//     falling back to the Unfiled root view. Conversations are never touched.
//   - "delete": chats go through softDeleteChat semantics — deleted_at is
//     stamped, messages and images survive, the user has 30 days to restore
//     from Recently Deleted. Conversations are never hard-destroyed.
//
// Returns the deleted project IDs. Structural deletions can never cascade
// into chat loss — that invariant is enforced here, in SQL, not in the UI.
func (db *database) deleteProject(id, mode string) ([]string, error) {
	subtree, err := db.getProjectSubtree(id)
	if err != nil {
		return nil, err
	}
	if len(subtree) == 0 {
		return nil, fmt.Errorf("%w: project %s", not.Found, id)
	}

	placeholders := strings.Repeat("?,", len(subtree))
	placeholders = placeholders[:len(placeholders)-1]
	args := make([]any, len(subtree))
	for i, sid := range subtree {
		args[i] = sid
	}

	tx, err := db.conn.Begin()
	if err != nil {
		return nil, fmt.Errorf("begin delete project tx: %w", err)
	}
	defer tx.Rollback()

	if mode == "delete" {
		if _, err := tx.Exec(fmt.Sprintf(
			`UPDATE chats SET deleted_at = CURRENT_TIMESTAMP WHERE project_id IN (%s) AND deleted_at IS NULL`,
			placeholders), args...); err != nil {
			return nil, fmt.Errorf("soft delete chats in project subtree: %w", err)
		}
	} else {
		if _, err := tx.Exec(fmt.Sprintf(
			`UPDATE chats SET project_id = NULL WHERE project_id IN (%s)`,
			placeholders), args...); err != nil {
			return nil, fmt.Errorf("unfile chats in project subtree: %w", err)
		}
	}

	if _, err := tx.Exec(fmt.Sprintf(
		`DELETE FROM projects WHERE id IN (%s)`, placeholders), args...); err != nil {
		return nil, fmt.Errorf("delete projects: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit delete project: %w", err)
	}
	return subtree, nil
}

// moveChatToProject sets or clears a chat's project membership. Passing nil or
// an empty string removes the chat from any project, returning it to Unfiled.
func (db *database) moveChatToProject(chatID string, projectID *string) error {
	var exists int
	if err := db.conn.QueryRow(`SELECT COUNT(1) FROM chats WHERE id = ?`, chatID).Scan(&exists); err != nil {
		return fmt.Errorf("check chat exists: %w", err)
	}
	if exists == 0 {
		return fmt.Errorf("%w: chat %s", not.Found, chatID)
	}

	if projectID == nil || *projectID == "" {
		if _, err := db.conn.Exec(`UPDATE chats SET project_id = NULL WHERE id = ?`, chatID); err != nil {
			return fmt.Errorf("unfile chat: %w", err)
		}
		return nil
	}

	var projectExists int
	if err := db.conn.QueryRow(`SELECT COUNT(1) FROM projects WHERE id = ?`, *projectID).Scan(&projectExists); err != nil {
		return fmt.Errorf("check project exists: %w", err)
	}
	if projectExists == 0 {
		return fmt.Errorf("%w: project %s", not.Found, *projectID)
	}

	if _, err := db.conn.Exec(`UPDATE chats SET project_id = ? WHERE id = ?`, *projectID, chatID); err != nil {
		return fmt.Errorf("move chat to project: %w", err)
	}
	return nil
}

// projectSubtreeStats returns the number of chats and subprojects under
// (and including) the given root. Used by the delete-project dialog to
// describe what will happen.
func (db *database) projectSubtreeStats(id string) (chatCount, subprojectCount int, err error) {
	subtree, err := db.getProjectSubtree(id)
	if err != nil {
		return 0, 0, err
	}
	if len(subtree) == 0 {
		return 0, 0, fmt.Errorf("%w: project %s", not.Found, id)
	}

	placeholders := strings.Repeat("?,", len(subtree))
	placeholders = placeholders[:len(placeholders)-1]
	args := make([]any, len(subtree))
	for i, sid := range subtree {
		args[i] = sid
	}

	if err := db.conn.QueryRow(fmt.Sprintf(
		`SELECT COUNT(*) FROM chats
		 WHERE project_id IN (%s) AND deleted_at IS NULL`,
		placeholders), args...).Scan(&chatCount); err != nil {
		return 0, 0, fmt.Errorf("count chats in subtree: %w", err)
	}

	subprojectCount = len(subtree) - 1 // exclude root
	return chatCount, subprojectCount, nil
}

func (db *database) updateLastMessage(chatID string, msg Message) error {
	tx, err := db.conn.Begin()
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback()

	var messageID int64
	err = tx.QueryRow(`SELECT MAX(id) FROM messages WHERE chat_id = ?`, chatID).Scan(&messageID)
	if err != nil {
		return fmt.Errorf("get last message id: %w", err)
	}

	query := `
		UPDATE messages 
		SET content = ?, thinking = ?, model_name = ?, updated_at = ?, thinking_time_start = ?, thinking_time_end = ?, tool_result = ?
		WHERE id = ?
	`

	var thinkingTimeStart, thinkingTimeEnd sql.NullTime
	if msg.ThinkingTimeStart != nil {
		thinkingTimeStart = sql.NullTime{Time: *msg.ThinkingTimeStart, Valid: true}
	}
	if msg.ThinkingTimeEnd != nil {
		thinkingTimeEnd = sql.NullTime{Time: *msg.ThinkingTimeEnd, Valid: true}
	}

	var modelName sql.NullString
	if msg.Model != "" {
		modelName = sql.NullString{String: msg.Model, Valid: true}
	}

	var toolResultJSON sql.NullString
	if msg.ToolResult != nil {
		resultBytes, err := json.Marshal(msg.ToolResult)
		if err != nil {
			return fmt.Errorf("marshal tool result: %w", err)
		}
		toolResultJSON = sql.NullString{String: string(resultBytes), Valid: true}
	}

	result, err := tx.Exec(query,
		msg.Content, msg.Thinking, modelName, msg.UpdatedAt,
		thinkingTimeStart, thinkingTimeEnd, toolResultJSON, messageID,
	)
	if err != nil {
		return fmt.Errorf("update last message: %w", err)
	}
	if rows, _ := result.RowsAffected(); rows == 0 {
		return fmt.Errorf("no message found to update")
	}

	if _, err = tx.Exec("DELETE FROM attachments WHERE message_id = ?", messageID); err != nil {
		return fmt.Errorf("delete existing attachments: %w", err)
	}
	for _, att := range msg.Attachments {
		if err := db.insertAttachment(tx, messageID, att); err != nil {
			return fmt.Errorf("insert attachment: %w", err)
		}
	}

	if _, err = tx.Exec("DELETE FROM tool_calls WHERE message_id = ?", messageID); err != nil {
		return fmt.Errorf("delete existing tool calls: %w", err)
	}
	for _, toolCall := range msg.ToolCalls {
		if err := db.insertToolCall(tx, messageID, toolCall); err != nil {
			return fmt.Errorf("insert tool call: %w", err)
		}
	}

	return tx.Commit()
}

func (db *database) appendMessage(chatID string, msg Message) error {
	tx, err := db.conn.Begin()
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback()

	messageID, err := db.insertMessage(tx, chatID, msg)
	if err != nil {
		return fmt.Errorf("insert message: %w", err)
	}

	for _, toolCall := range msg.ToolCalls {
		if err := db.insertToolCall(tx, messageID, toolCall); err != nil {
			return fmt.Errorf("insert tool call: %w", err)
		}
	}

	return tx.Commit()
}

func (db *database) getMessages(chatID string, loadAttachmentData bool) ([]Message, error) {
	query := `
		SELECT id, role, content, thinking, stream, model_name, created_at, updated_at, thinking_time_start, thinking_time_end, tool_result
		FROM messages
		WHERE chat_id = ?
		ORDER BY id ASC
	`

	rows, err := db.conn.Query(query, chatID)
	if err != nil {
		return nil, fmt.Errorf("query messages: %w", err)
	}
	defer rows.Close()

	var messages []Message
	for rows.Next() {
		var msg Message
		var messageID int64
		var thinkingTimeStart, thinkingTimeEnd sql.NullTime
		var modelName, toolResult sql.NullString

		err := rows.Scan(
			&messageID, &msg.Role, &msg.Content, &msg.Thinking, &msg.Stream,
			&modelName, &msg.CreatedAt, &msg.UpdatedAt,
			&thinkingTimeStart, &thinkingTimeEnd, &toolResult,
		)
		if err != nil {
			return nil, fmt.Errorf("scan message: %w", err)
		}

		attachments, err := db.getAttachments(messageID, loadAttachmentData)
		if err != nil {
			return nil, fmt.Errorf("get attachments: %w", err)
		}
		msg.Attachments = attachments

		if thinkingTimeStart.Valid {
			msg.ThinkingTimeStart = &thinkingTimeStart.Time
		}
		if thinkingTimeEnd.Valid {
			msg.ThinkingTimeEnd = &thinkingTimeEnd.Time
		}
		if toolResult.Valid && toolResult.String != "" {
			var result json.RawMessage
			if err := json.Unmarshal([]byte(toolResult.String), &result); err == nil {
				msg.ToolResult = &result
			}
		}
		if modelName.Valid && modelName.String != "" {
			msg.Model = modelName.String
		}

		toolCalls, err := db.getToolCalls(messageID)
		if err != nil {
			return nil, fmt.Errorf("get tool calls: %w", err)
		}
		msg.ToolCalls = toolCalls

		messages = append(messages, msg)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate messages: %w", err)
	}

	return messages, nil
}

func (db *database) insertMessage(tx *sql.Tx, chatID string, msg Message) (int64, error) {
	query := `
		INSERT INTO messages (chat_id, role, content, thinking, stream, model_name, created_at, updated_at, thinking_time_start, thinking_time_end, tool_result)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`

	var thinkingTimeStart, thinkingTimeEnd sql.NullTime
	if msg.ThinkingTimeStart != nil {
		thinkingTimeStart = sql.NullTime{Time: *msg.ThinkingTimeStart, Valid: true}
	}
	if msg.ThinkingTimeEnd != nil {
		thinkingTimeEnd = sql.NullTime{Time: *msg.ThinkingTimeEnd, Valid: true}
	}

	var modelName sql.NullString
	if msg.Model != "" {
		modelName = sql.NullString{String: msg.Model, Valid: true}
	}

	var toolResultJSON sql.NullString
	if msg.ToolResult != nil {
		resultBytes, err := json.Marshal(msg.ToolResult)
		if err != nil {
			return 0, fmt.Errorf("marshal tool result: %w", err)
		}
		toolResultJSON = sql.NullString{String: string(resultBytes), Valid: true}
	}

	result, err := tx.Exec(query,
		chatID, msg.Role, msg.Content, msg.Thinking, msg.Stream,
		modelName, msg.CreatedAt, msg.UpdatedAt,
		thinkingTimeStart, thinkingTimeEnd, toolResultJSON,
	)
	if err != nil {
		return 0, err
	}

	messageID, err := result.LastInsertId()
	if err != nil {
		return 0, err
	}

	for _, att := range msg.Attachments {
		if err := db.insertAttachment(tx, messageID, att); err != nil {
			return 0, fmt.Errorf("insert attachment: %w", err)
		}
	}

	return messageID, nil
}

func (db *database) getAttachments(messageID int64, loadData bool) ([]File, error) {
	var query string
	if loadData {
		query = `SELECT filename, data FROM attachments WHERE message_id = ? ORDER BY id ASC`
	} else {
		query = `SELECT filename, '' as data FROM attachments WHERE message_id = ? ORDER BY id ASC`
	}

	rows, err := db.conn.Query(query, messageID)
	if err != nil {
		return nil, fmt.Errorf("query attachments: %w", err)
	}
	defer rows.Close()

	var attachments []File
	for rows.Next() {
		var file File
		if err := rows.Scan(&file.Filename, &file.Data); err != nil {
			return nil, fmt.Errorf("scan attachment: %w", err)
		}
		attachments = append(attachments, file)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate attachments: %w", err)
	}
	return attachments, nil
}

func (db *database) getToolCalls(messageID int64) ([]ToolCall, error) {
	query := `
		SELECT type, function_name, function_arguments, function_result
		FROM tool_calls
		WHERE message_id = ?
		ORDER BY id ASC
	`

	rows, err := db.conn.Query(query, messageID)
	if err != nil {
		return nil, fmt.Errorf("query tool calls: %w", err)
	}
	defer rows.Close()

	var toolCalls []ToolCall
	for rows.Next() {
		var tc ToolCall
		var functionResult sql.NullString

		if err := rows.Scan(&tc.Type, &tc.Function.Name, &tc.Function.Arguments, &functionResult); err != nil {
			return nil, fmt.Errorf("scan tool call: %w", err)
		}

		if functionResult.Valid && functionResult.String != "" {
			var result json.RawMessage
			if err := json.Unmarshal([]byte(functionResult.String), &result); err == nil {
				tc.Function.Result = &result
			}
		}

		toolCalls = append(toolCalls, tc)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate tool calls: %w", err)
	}
	return toolCalls, nil
}

func (db *database) insertAttachment(tx *sql.Tx, messageID int64, file File) error {
	_, err := tx.Exec(`INSERT INTO attachments (message_id, filename, data) VALUES (?, ?, ?)`,
		messageID, file.Filename, file.Data)
	return err
}

func (db *database) insertToolCall(tx *sql.Tx, messageID int64, tc ToolCall) error {
	var functionResult sql.NullString
	if tc.Function.Result != nil {
		resultJSON, err := json.Marshal(tc.Function.Result)
		if err != nil {
			return fmt.Errorf("marshal tool result: %w", err)
		}
		functionResult = sql.NullString{String: string(resultJSON), Valid: true}
	}

	_, err := tx.Exec(`INSERT INTO tool_calls (message_id, type, function_name, function_arguments, function_result)
		VALUES (?, ?, ?, ?, ?)`,
		messageID, tc.Type, tc.Function.Name, tc.Function.Arguments, functionResult)
	return err
}

func (db *database) getID() (string, error) {
	var id string
	if err := db.conn.QueryRow("SELECT device_id FROM settings").Scan(&id); err != nil {
		return "", fmt.Errorf("get device id: %w", err)
	}
	return id, nil
}

func (db *database) setID(id string) error {
	if _, err := db.conn.Exec("UPDATE settings SET device_id = ?", id); err != nil {
		return fmt.Errorf("set device id: %w", err)
	}
	return nil
}

func (db *database) getHasCompletedFirstRun() (bool, error) {
	var hasCompletedFirstRun bool
	if err := db.conn.QueryRow("SELECT has_completed_first_run FROM settings").Scan(&hasCompletedFirstRun); err != nil {
		return false, fmt.Errorf("get has completed first run: %w", err)
	}
	return hasCompletedFirstRun, nil
}

func (db *database) setHasCompletedFirstRun(hasCompletedFirstRun bool) error {
	if _, err := db.conn.Exec("UPDATE settings SET has_completed_first_run = ?", hasCompletedFirstRun); err != nil {
		return fmt.Errorf("set has completed first run: %w", err)
	}
	return nil
}

func (db *database) getSettings() (Settings, error) {
	var s Settings
	err := db.conn.QueryRow(`
		SELECT expose, survey, browser, models, agent, tools, working_dir, context_length, airplane_mode, turbo_enabled, websearch_enabled, selected_model, sidebar_open, think_enabled, think_level 
		FROM settings
	`).Scan(&s.Expose, &s.Survey, &s.Browser, &s.Models, &s.Agent, &s.Tools, &s.WorkingDir, &s.ContextLength, &s.AirplaneMode, &s.TurboEnabled, &s.WebSearchEnabled, &s.SelectedModel, &s.SidebarOpen, &s.ThinkEnabled, &s.ThinkLevel)
	if err != nil {
		return Settings{}, fmt.Errorf("get settings: %w", err)
	}
	return s, nil
}

func (db *database) setSettings(s Settings) error {
	_, err := db.conn.Exec(`
		UPDATE settings 
		SET expose = ?, survey = ?, browser = ?, models = ?, agent = ?, tools = ?, working_dir = ?, context_length = ?, airplane_mode = ?, turbo_enabled = ?, websearch_enabled = ?, selected_model = ?, sidebar_open = ?, think_enabled = ?, think_level = ?
	`, s.Expose, s.Survey, s.Browser, s.Models, s.Agent, s.Tools, s.WorkingDir, s.ContextLength, s.AirplaneMode, s.TurboEnabled, s.WebSearchEnabled, s.SelectedModel, s.SidebarOpen, s.ThinkEnabled, s.ThinkLevel)
	if err != nil {
		return fmt.Errorf("set settings: %w", err)
	}
	return nil
}

func (db *database) getWindowSize() (int, int, error) {
	var width, height int
	if err := db.conn.QueryRow("SELECT window_width, window_height FROM settings").Scan(&width, &height); err != nil {
		return 0, 0, fmt.Errorf("get window size: %w", err)
	}
	return width, height, nil
}

func (db *database) setWindowSize(width, height int) error {
	if _, err := db.conn.Exec("UPDATE settings SET window_width = ?, window_height = ?", width, height); err != nil {
		return fmt.Errorf("set window size: %w", err)
	}
	return nil
}

func (db *database) isConfigMigrated() (bool, error) {
	var migrated bool
	if err := db.conn.QueryRow("SELECT config_migrated FROM settings").Scan(&migrated); err != nil {
		return false, fmt.Errorf("get config migrated: %w", err)
	}
	return migrated, nil
}

func (db *database) setConfigMigrated(migrated bool) error {
	if _, err := db.conn.Exec("UPDATE settings SET config_migrated = ?", migrated); err != nil {
		return fmt.Errorf("set config migrated: %w", err)
	}
	return nil
}

func (db *database) getSchemaVersion() (int, error) {
	var version int
	if err := db.conn.QueryRow("SELECT schema_version FROM settings").Scan(&version); err != nil {
		return 0, fmt.Errorf("get schema version: %w", err)
	}
	return version, nil
}

func (db *database) setSchemaVersion(version int) error {
	if _, err := db.conn.Exec("UPDATE settings SET schema_version = ?", version); err != nil {
		return fmt.Errorf("set schema version: %w", err)
	}
	return nil
}

func (db *database) getUser() (*User, error) {
	var user User
	err := db.conn.QueryRow(`
		SELECT name, email, plan, cached_at
		FROM users
		LIMIT 1
	`).Scan(&user.Name, &user.Email, &user.Plan, &user.CachedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get user: %w", err)
	}
	return &user, nil
}

func (db *database) setUser(user User) error {
	if err := db.clearUser(); err != nil {
		return fmt.Errorf("before set: %w", err)
	}
	_, err := db.conn.Exec(`
		INSERT INTO users (name, email, plan, cached_at)
		VALUES (?, ?, ?, ?)
	`, user.Name, user.Email, user.Plan, user.CachedAt)
	if err != nil {
		return fmt.Errorf("set user: %w", err)
	}
	return nil
}

func (db *database) clearUser() error {
	if _, err := db.conn.Exec("DELETE FROM users"); err != nil {
		return fmt.Errorf("clear user: %w", err)
	}
	return nil
}