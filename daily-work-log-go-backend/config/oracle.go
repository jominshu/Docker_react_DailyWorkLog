package config

import (
	"database/sql"
	"fmt"
	"log"
	"os"

	_ "github.com/sijms/go-ora/v2"
)

var OracleDB *sql.DB

func ConnectOracle() {
	user := os.Getenv("ORACLE_USER")
	password := os.Getenv("ORACLE_PASSWORD")
	host := os.Getenv("ORACLE_HOST")
	port := os.Getenv("ORACLE_PORT")
	service := os.Getenv("ORACLE_SERVICE")

	// 連線字串格式: oracle://user:password@host:port/service
	dsn := fmt.Sprintf("oracle://%s:%s@%s:%s/%s", user, password, host, port, service)

	var err error
	OracleDB, err = sql.Open("oracle", dsn)
	if err != nil {
		log.Fatal("無法連接到 Oracle:", err)
	}

	err = OracleDB.Ping()
	if err != nil {
		log.Fatal("Oracle Ping 失敗:", err)
	}

	log.Println("Oracle 連線成功")
}

func CloseOracle() {
	if OracleDB != nil {
		OracleDB.Close()
	}
}
