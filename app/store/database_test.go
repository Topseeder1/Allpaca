//go:build windows || darwin

package store

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/google/go-cmp/cmp"
	_ "github.com/mattn/go-sqlite3"
)

func TestSchemaMigrations(t *testing.T) {
	t.Run("schema comparison after migration", func(t *testing.T) {
		tmpDir := t.TempDir()
		migratedDBPath := filepath.Join(tmpDir, "migrated.db")
		migratedDB := loadV2Schema(t, migratedDBPath)
		defer migratedDB.Close()

		if err := migratedDB.migrate(); err != nil {
			t.Fatalf("migration failed: %v", err)
		}

		// Create fresh database with current schema
		freshDBPath := filepath.Join(tmpDir, "fresh.db")
		freshDB, err := newDatabase(freshDBPath)
		if err != nil {
			t.Fatalf("failed to create fresh database: %v", err)
		}
		defer freshDB.Close()

		// Extract tables and indexes from both databases, directly comparing their schemas won't work due to ordering
		migratedSchema := schemaMap(migratedDB)
		freshSchema := schemaMap(freshDB)

		if !cmp.Equal(migratedSchema, freshSchema) {
			t.Errorf("Schema difference found:\n%s", cmp.Diff(freshSchema, migratedSchema))
		}

		// Verify both databases have the same final schema version
		migratedVersion, _ := migratedDB.getSchemaVersion()
		freshVersion, _ := freshDB.getSchemaVersion()
		if migratedVersion != freshVersion {
			t.Errorf("schema version mismatch: migrated=%d, fresh=%d", migratedVersion, freshVersion)
		}
	})

	t.Run("idempotent migrations", func(t *testing.T) {
		tmpDir := t.TempDir()
		dbPath := filepath.Join(tmpDir, "test.db")
		db := loadV2Schema(t, dbPath)
		defer db.Close()

		// Run migration twice
		if err := db.migrate(); err != nil {
			t.Fatalf("first migration failed: %v", err)
		}

		if err := db.migrate(); err != nil {
			t.Fatalf("second migration failed: %v", err)
		}

		// Verify schema version is still correct
		version, err := db.getSchemaVersion()
		if err != nil {
			t.Fatalf("failed to get schema version: %v", err)
		}
		if version != currentSchemaVersion {
			t.Errorf("expected schema version %d after double migration, got %d", currentSchemaVersion, version)
		}
	})

	t.Run("init database has correct schema version", func(t *testing.T) {
		tmpDir := t.TempDir()
		dbPath := filepath.Join(tmpDir, "test.db")
		db, err := newDatabase(dbPath)
		if err != nil {
			t.Fatalf("failed to create database: %v", err)
		}
		defer db.Close()

		// Get the schema version from the newly initialized database
		version, err := db.getSchemaVersion()
		if err != nil {
			t.Fatalf("failed to get schema version: %v", err)
		}

		// Verify it matches the currentSchemaVersion constant
		if version != currentSchemaVersion {
			t.Errorf("expected schema version %d in initialized database, got %d", currentSchemaVersion, version)
		}
	})
}

func TestChatDeletionWithCascade(t *testing.T) {
	t.Run("chat deletion cascades to related messages", func(t *testing.T) {
		tmpDir := t.TempDir()
		dbPath := filepath.Join(tmpDir, "test.db")
		db, err := newDatabase(dbPath)
		if err != nil {
			t.Fatalf("failed to create database: %v", err)
		}
		defer db.Close()

		// Create test chat
		testChatID := "test-chat-cascade-123"
		testChat := Chat{
			ID:        testChatID,
			Title:     "Test Chat for Cascade Delete",
			CreatedAt: time.Now(),
			Messages: []Message{
				{
					Role:      "user",
					Content:   "Hello, this is a test message",
					CreatedAt: time.Now(),
					UpdatedAt: time.Now(),
				},
				{
					Role:      "assistant",
					Content:   "Hi there! This is a response.",
					CreatedAt: time.Now(),
					UpdatedAt: time.Now(),
				},
			},
		}

		// Save the chat with messages
		if err := db.saveChat(testChat); err != nil {
			t.Fatalf("failed to save test chat: %v", err)
		}

		// Verify chat and messages exist
		chatCount := countRows(t, db, "chats")
		messageCount := countRows(t, db, "messages")

		if chatCount != 1 {
			t.Errorf("expected 1 chat, got %d", chatCount)
		}
		if messageCount != 2 {
			t.Errorf("expected 2 messages, got %d", messageCount)
		}

		// Verify specific chat exists
		var exists bool
		err = db.conn.QueryRow("SELECT EXISTS(SELECT 1 FROM chats WHERE id = ?)", testChatID).Scan(&exists)
		if err != nil {
			t.Fatalf("failed to check chat existence: %v", err)
		}
		if !exists {
			t.Error("test chat should exist before deletion")
		}

		// Verify messages exist for this chat
		messageCountForChat := countRowsWithCondition(t, db, "messages", "chat_id = ?", testChatID)
		if messageCountForChat != 2 {
			t.Errorf("expected 2 messages for test chat, got %d", messageCountForChat)
		}

		// Hard delete the chat. Soft delete only stamps deleted_at and keeps
		// rows; the cascade behavior asserted below belongs to purgeChat, which
		// is the only path that actually DELETE FROMs the chat row.
		if err := db.purgeChat(testChatID); err != nil {
			t.Fatalf("failed to purge chat: %v", err)
		}

		// Verify chat is deleted
		chatCountAfter := countRows(t, db, "chats")
		if chatCountAfter != 0 {
			t.Errorf("expected 0 chats after deletion, got %d", chatCountAfter)
		}

		// Verify messages are CASCADE deleted
		messageCountAfter := countRows(t, db, "messages")
		if messageCountAfter != 0 {
			t.Errorf("expected 0 messages after CASCADE deletion, got %d", messageCountAfter)
		}

		// Verify specific chat no longer exists
		err = db.conn.QueryRow("SELECT EXISTS(SELECT 1 FROM chats WHERE id = ?)", testChatID).Scan(&exists)
		if err != nil {
			t.Fatalf("failed to check chat existence after deletion: %v", err)
		}
		if exists {
			t.Error("test chat should not exist after deletion")
		}

		// Verify no orphaned messages remain
		orphanedCount := countRowsWithCondition(t, db, "messages", "chat_id = ?", testChatID)
		if orphanedCount != 0 {
			t.Errorf("expected 0 orphaned messages, got %d", orphanedCount)
		}
	})

	t.Run("foreign keys are enabled", func(t *testing.T) {
		tmpDir := t.TempDir()
		dbPath := filepath.Join(tmpDir, "test.db")
		db, err := newDatabase(dbPath)
		if err != nil {
			t.Fatalf("failed to create database: %v", err)
		}
		defer db.Close()

		// Verify foreign keys are enabled
		var foreignKeysEnabled int
		err = db.conn.QueryRow("PRAGMA foreign_keys").Scan(&foreignKeysEnabled)
		if err != nil {
			t.Fatalf("failed to check foreign keys: %v", err)
		}
		if foreignKeysEnabled != 1 {
			t.Errorf("expected foreign keys to be enabled (1), got %d", foreignKeysEnabled)
		}
	})

	// This test is only relevant for v8 migrations, but we keep it here for now
	// since it's a useful test to ensure that we don't introduce any new orphaned data
	t.Run("cleanup orphaned data", func(t *testing.T) {
		tmpDir := t.TempDir()
		dbPath := filepath.Join(tmpDir, "test.db")
		db, err := newDatabase(dbPath)
		if err != nil {
			t.Fatalf("failed to create database: %v", err)
		}
		defer db.Close()

		// First disable foreign keys to simulate the bug from ollama/ollama#11785
		_, err = db.conn.Exec("PRAGMA foreign_keys = OFF")
		if err != nil {
			t.Fatalf("failed to disable foreign keys: %v", err)
		}

		// Create a chat and message
		testChatID := "orphaned-test-chat"
		testMessageID := int64(999)

		_, err = db.conn.Exec("INSERT INTO chats (id, title) VALUES (?, ?)", testChatID, "Orphaned Test Chat")
		if err != nil {
			t.Fatalf("failed to insert test chat: %v", err)
		}

		_, err = db.conn.Exec("INSERT INTO messages (id, chat_id, role, content) VALUES (?, ?, ?, ?)",
			testMessageID, testChatID, "user", "test message")
		if err != nil {
			t.Fatalf("failed to insert test message: %v", err)
		}

		// Delete chat but keep message (simulating the bug from ollama/ollama#11785)
		_, err = db.conn.Exec("DELETE FROM chats WHERE id = ?", testChatID)
		if err != nil {
			t.Fatalf("failed to delete chat: %v", err)
		}

		// Verify we have orphaned message
		orphanedCount := countRowsWithCondition(t, db, "messages", "chat_id = ?", testChatID)
		if orphanedCount != 1 {
			t.Errorf("expected 1 orphaned message, got %d", orphanedCount)
		}

		// Run cleanup
		if err := db.cleanupOrphanedData(); err != nil {
			t.Fatalf("failed to cleanup orphaned data: %v", err)
		}

		// Verify orphaned message is gone
		orphanedCountAfter := countRowsWithCondition(t, db, "messages", "chat_id = ?", testChatID)
		if orphanedCountAfter != 0 {
			t.Errorf("expected 0 orphaned messages after cleanup, got %d", orphanedCountAfter)
		}
	})
}

// TestChatSoftDelete exercises the deferred-delete lifecycle: softDeleteChat
// stamps deleted_at without touching rows, the chat disappears from the active
// and archived lists, appears in the trash list, and restoreChat brings it
// back. Purging is tested separately in TestChatDeletionWithCascade.
func TestChatSoftDelete(t *testing.T) {
	t.Run("soft delete hides chat but preserves rows", func(t *testing.T) {
		tmpDir := t.TempDir()
		dbPath := filepath.Join(tmpDir, "test.db")
		db, err := newDatabase(dbPath)
		if err != nil {
			t.Fatalf("failed to create database: %v", err)
		}
		defer db.Close()

		testChatID := "test-chat-soft-delete-123"
		testChat := Chat{
			ID:        testChatID,
			Title:     "Test Chat for Soft Delete",
			CreatedAt: time.Now(),
			Messages: []Message{
				{Role: "user", Content: "first message", CreatedAt: time.Now(), UpdatedAt: time.Now()},
				{Role: "assistant", Content: "reply", CreatedAt: time.Now(), UpdatedAt: time.Now()},
			},
		}
		if err := db.saveChat(testChat); err != nil {
			t.Fatalf("failed to save test chat: %v", err)
		}

		// Chat starts in the active list.
		active, err := db.getAllChats()
		if err != nil {
			t.Fatalf("getAllChats before delete: %v", err)
		}
		if len(active) != 1 || active[0].ID != testChatID {
			t.Fatalf("expected test chat in active list before delete, got %+v", active)
		}

		// Soft delete.
		if err := db.softDeleteChat(testChatID); err != nil {
			t.Fatalf("softDeleteChat: %v", err)
		}

		// Row and messages must still exist — soft delete is not a purge.
		if got := countRows(t, db, "chats"); got != 1 {
			t.Errorf("expected 1 chat row after soft delete, got %d", got)
		}
		if got := countRowsWithCondition(t, db, "messages", "chat_id = ?", testChatID); got != 2 {
			t.Errorf("expected 2 messages after soft delete, got %d", got)
		}

		// deleted_at must be set.
		var deletedAt sql.NullTime
		if err := db.conn.QueryRow(
			"SELECT deleted_at FROM chats WHERE id = ?", testChatID,
		).Scan(&deletedAt); err != nil {
			t.Fatalf("failed to read deleted_at: %v", err)
		}
		if !deletedAt.Valid {
			t.Error("expected deleted_at to be set after soft delete")
		}

		// Active list must now exclude it.
		active, err = db.getAllChats()
		if err != nil {
			t.Fatalf("getAllChats after soft delete: %v", err)
		}
		if len(active) != 0 {
			t.Errorf("expected 0 active chats after soft delete, got %d", len(active))
		}

		// Trash list must include it.
		deleted, err := db.getDeletedChats()
		if err != nil {
			t.Fatalf("getDeletedChats: %v", err)
		}
		if len(deleted) != 1 || deleted[0].ID != testChatID {
			t.Errorf("expected soft-deleted chat %q in trash, got %+v", testChatID, deleted)
		}

		// Restore returns it to the active list and clears deleted_at.
		if err := db.restoreChat(testChatID); err != nil {
			t.Fatalf("restoreChat: %v", err)
		}
		active, err = db.getAllChats()
		if err != nil {
			t.Fatalf("getAllChats after restore: %v", err)
		}
		if len(active) != 1 || active[0].ID != testChatID {
			t.Errorf("expected restored chat in active list, got %+v", active)
		}

		deletedAt = sql.NullTime{}
		if err := db.conn.QueryRow(
			"SELECT deleted_at FROM chats WHERE id = ?", testChatID,
		).Scan(&deletedAt); err != nil {
			t.Fatalf("failed to read deleted_at after restore: %v", err)
		}
		if deletedAt.Valid {
			t.Error("expected deleted_at to be NULL after restore")
		}
	})

	t.Run("restore preserves archived_at", func(t *testing.T) {
		tmpDir := t.TempDir()
		dbPath := filepath.Join(tmpDir, "test.db")
		db, err := newDatabase(dbPath)
		if err != nil {
			t.Fatalf("failed to create database: %v", err)
		}
		defer db.Close()

		testChatID := "test-chat-archive-restore-123"
		if err := db.saveChat(Chat{
			ID:        testChatID,
			Title:     "Archived then deleted",
			CreatedAt: time.Now(),
			Messages: []Message{
				{Role: "user", Content: "hi", CreatedAt: time.Now(), UpdatedAt: time.Now()},
			},
		}); err != nil {
			t.Fatalf("failed to save test chat: %v", err)
		}

		// Archive, then delete. Restore must return it to the archive, not the
		// active list — that's the whole point of keeping archived_at intact
		// across a trash round-trip.
		if err := db.archiveChat(testChatID); err != nil {
			t.Fatalf("archiveChat: %v", err)
		}
		if err := db.softDeleteChat(testChatID); err != nil {
			t.Fatalf("softDeleteChat: %v", err)
		}
		if err := db.restoreChat(testChatID); err != nil {
			t.Fatalf("restoreChat: %v", err)
		}

		active, err := db.getAllChats()
		if err != nil {
			t.Fatalf("getAllChats: %v", err)
		}
		if len(active) != 0 {
			t.Errorf("expected 0 active chats after restoring an archived chat, got %d", len(active))
		}

		archived, err := db.getArchivedChats()
		if err != nil {
			t.Fatalf("getArchivedChats: %v", err)
		}
		if len(archived) != 1 || archived[0].ID != testChatID {
			t.Errorf("expected restored chat back in archive, got %+v", archived)
		}
	})

	t.Run("purge expired chats removes only old trash", func(t *testing.T) {
		tmpDir := t.TempDir()
		dbPath := filepath.Join(tmpDir, "test.db")
		db, err := newDatabase(dbPath)
		if err != nil {
			t.Fatalf("failed to create database: %v", err)
		}
		defer db.Close()

		oldID := "expired-chat"
		freshID := "fresh-deleted-chat"

		for _, id := range []string{oldID, freshID} {
			if err := db.saveChat(Chat{
				ID:        id,
				Title:     id,
				CreatedAt: time.Now(),
				Messages: []Message{
					{Role: "user", Content: "x", CreatedAt: time.Now(), UpdatedAt: time.Now()},
				},
			}); err != nil {
				t.Fatalf("failed to save chat %s: %v", id, err)
			}
			if err := db.softDeleteChat(id); err != nil {
				t.Fatalf("failed to soft delete %s: %v", id, err)
			}
		}

		// Backdate one chat's deleted_at past the 30-day cutoff.
		if _, err := db.conn.Exec(
			"UPDATE chats SET deleted_at = datetime('now', '-31 days') WHERE id = ?", oldID,
		); err != nil {
			t.Fatalf("failed to backdate deleted_at: %v", err)
		}

		removed, err := db.purgeExpiredChats(30 * 24 * time.Hour)
		if err != nil {
			t.Fatalf("purgeExpiredChats: %v", err)
		}
		if len(removed) != 1 || removed[0] != oldID {
			t.Errorf("expected only %q to be purged, got %+v", oldID, removed)
		}

		// The old chat and its messages are gone.
		if got := countRowsWithCondition(t, db, "messages", "chat_id = ?", oldID); got != 0 {
			t.Errorf("expected 0 messages for purged chat, got %d", got)
		}

		// The fresh chat is still in the trash.
		deleted, err := db.getDeletedChats()
		if err != nil {
			t.Fatalf("getDeletedChats: %v", err)
		}
		if len(deleted) != 1 || deleted[0].ID != freshID {
			t.Errorf("expected %q still in trash, got %+v", freshID, deleted)
		}
	})
}

func countRows(t *testing.T, db *database, table string) int {
	t.Helper()
	var count int
	err := db.conn.QueryRow(fmt.Sprintf("SELECT COUNT(*) FROM %s", table)).Scan(&count)
	if err != nil {
		t.Fatalf("failed to count rows in %s: %v", table, err)
	}
	return count
}

func countRowsWithCondition(t *testing.T, db *database, table, condition string, args ...interface{}) int {
	t.Helper()
	var count int
	query := fmt.Sprintf("SELECT COUNT(*) FROM %s WHERE %s", table, condition)
	err := db.conn.QueryRow(query, args...).Scan(&count)
	if err != nil {
		t.Fatalf("failed to count rows with condition: %v", err)
	}
	return count
}

// Test helpers for schema migration testing

// schemaMap returns both tables/columns and indexes (ignoring order)
func schemaMap(db *database) map[string]interface{} {
	result := make(map[string]any)

	result["tables"] = columnMap(db)
	result["indexes"] = indexMap(db)

	return result
}

// columnMap returns a map of table names to their column sets (ignoring order)
func columnMap(db *database) map[string][]string {
	result := make(map[string][]string)

	// Get all table names
	tableQuery := `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
	rows, _ := db.conn.Query(tableQuery)
	defer rows.Close()

	for rows.Next() {
		var tableName string
		rows.Scan(&tableName)

		// Get columns for this table
		colQuery := fmt.Sprintf("PRAGMA table_info(%s)", tableName)
		colRows, _ := db.conn.Query(colQuery)

		var columns []string
		for colRows.Next() {
			var cid int
			var name, dataType sql.NullString
			var notNull, primaryKey int
			var defaultValue sql.NullString

			colRows.Scan(&cid, &name, &dataType, &notNull, &defaultValue, &primaryKey)

			// Create a normalized column description
			colDesc := fmt.Sprintf("%s %s", name.String, dataType.String)
			if notNull == 1 {
				colDesc += " NOT NULL"
			}
			if defaultValue.Valid && defaultValue.String != "" {
				// Skip DEFAULT for schema_version as it doesn't get updated during migrations
				if name.String != "schema_version" {
					colDesc += " DEFAULT " + defaultValue.String
				}
			}
			if primaryKey == 1 {
				colDesc += " PRIMARY KEY"
			}

			columns = append(columns, colDesc)
		}
		colRows.Close()

		// Sort columns to ignore order differences
		sort.Strings(columns)
		result[tableName] = columns
	}

	return result
}

// indexMap returns a map of index names to their definitions
func indexMap(db *database) map[string]string {
	result := make(map[string]string)

	// Get all indexes (excluding auto-created primary key indexes)
	indexQuery := `SELECT name, sql FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY name`
	rows, _ := db.conn.Query(indexQuery)
	defer rows.Close()

	for rows.Next() {
		var name, sql string
		rows.Scan(&name, &sql)

		// Normalize the SQL by removing extra whitespace
		sql = strings.Join(strings.Fields(sql), " ")
		result[name] = sql
	}

	return result
}

// loadV2Schema loads the version 2 schema from testdata/schema.sql
func loadV2Schema(t *testing.T, dbPath string) *database {
	t.Helper()

	// Read the v1 schema file
	schemaFile := filepath.Join("testdata", "schema.sql")
	schemaSQL, err := os.ReadFile(schemaFile)
	if err != nil {
		t.Fatalf("failed to read schema file: %v", err)
	}

	// Open database connection
	conn, err := sql.Open("sqlite3", dbPath+"?_foreign_keys=on&_journal_mode=WAL&_busy_timeout=5000&_txlock=immediate")
	if err != nil {
		t.Fatalf("failed to open database: %v", err)
	}

	// Execute the v1 schema
	_, err = conn.Exec(string(schemaSQL))
	if err != nil {
		conn.Close()
		t.Fatalf("failed to execute v1 schema: %v", err)
	}

	return &database{conn: conn}
}