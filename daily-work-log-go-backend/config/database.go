package config

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"strings"

	_ "github.com/lib/pq"
)

var PostgresDB *sql.DB

func ConnectPostgres() {
	host := os.Getenv("POSTGRES_HOST")
	port := os.Getenv("POSTGRES_PORT")
	user := os.Getenv("POSTGRES_USER")
	password := os.Getenv("POSTGRES_PASSWORD")
	dbname := os.Getenv("POSTGRES_DB")

	psqlInfo := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		host, port, user, password, dbname)

	var err error
	PostgresDB, err = sql.Open("postgres", psqlInfo)
	if err != nil {
		log.Fatal("無法連接到 PostgreSQL:", err)
	}

	err = PostgresDB.Ping()
	if err != nil {
		log.Fatal("PostgreSQL Ping 失敗:", err)
	}

	log.Println("PostgreSQL 連線成功")

	ensureAdminTable()
}

func ClosePostgres() {
	if PostgresDB != nil {
		PostgresDB.Close()
	}
}

func ensureAdminTable() {
	if PostgresDB == nil {
		return
	}

	_, err := PostgresDB.Exec(`
		CREATE TABLE IF NOT EXISTS work_hours_admins (
			empno TEXT PRIMARY KEY,
			empnm TEXT,
			deptno TEXT,
			created_at TIMESTAMP DEFAULT NOW()
		)
	`)
	if err != nil {
		log.Printf("建立 work_hours_admins 表失敗: %v", err)
		return
	}

	_, err = PostgresDB.Exec(`
		CREATE TABLE IF NOT EXISTS page_permissions (
			empno TEXT PRIMARY KEY,
			pages TEXT[],
			updated_at TIMESTAMP DEFAULT NOW()
		)
	`)
	if err != nil {
		log.Printf("建立 page_permissions 表失敗: %v", err)
	}

	_, err = PostgresDB.Exec(`
		CREATE TABLE IF NOT EXISTS refresh_tokens (
			token_hash TEXT PRIMARY KEY,
			empno TEXT NOT NULL,
			expires_at TIMESTAMP NOT NULL,
			revoked_at TIMESTAMP,
			created_at TIMESTAMP DEFAULT NOW()
		)
	`)
	if err != nil {
		log.Printf("建立 refresh_tokens 表失敗: %v", err)
	}

	defaultAdmin := strings.TrimSpace(os.Getenv("DEFAULT_ADMIN_EMPNO"))
	if defaultAdmin == "" {
		return
	}
	var exists bool
	if err := PostgresDB.QueryRow(`SELECT EXISTS (SELECT 1 FROM work_hours_admins WHERE empno = $1)`, defaultAdmin).Scan(&exists); err != nil {
		log.Printf("檢查預設管理員失敗: %v", err)
		return
	}
	if !exists {
		name, dept := fetchAdminSeedInfo(defaultAdmin)
		if _, err := PostgresDB.Exec(`INSERT INTO work_hours_admins (empno, empnm, deptno) VALUES ($1, $2, $3)`, defaultAdmin, name, dept); err != nil {
			log.Printf("寫入預設管理員失敗: %v", err)
		}
	}
}

func fetchAdminSeedInfo(empno string) (string, string) {
	if OracleDB == nil {
		return "", ""
	}
	compid := strings.TrimSpace(os.Getenv("AUTH_COMPID"))
	if compid == "" {
		compid = "A"
	}
	query := `
		SELECT USER_DESC, DEPNO
		FROM UD_R1.UDFUSERID
		WHERE COMPID = :1 AND EMPNO = :2
	`
	var name, dept string
	if err := OracleDB.QueryRow(query, compid, empno).Scan(&name, &dept); err != nil {
		return "", ""
	}
	return strings.TrimSpace(name), strings.TrimSpace(dept)
}
