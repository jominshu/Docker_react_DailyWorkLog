package main

import (
	"Daily_Work_Log/daily-work-log-go-backend/config"
	"Daily_Work_Log/daily-work-log-go-backend/routes"
	"Daily_Work_Log/daily-work-log-go-backend/web"
	"io/fs"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

func main() {
	// 載入 .env 檔案
	err := godotenv.Load()
	if err != nil {
		log.Println("警告: 無法載入 .env 檔案")
	}

	// 連接 PostgreSQL
	config.ConnectPostgres()
	defer config.ClosePostgres()

	// 連接 Oracle
	config.ConnectOracle()
	defer config.CloseOracle()

	// 建立 Gin 路由
	router := gin.Default()
	router.RedirectTrailingSlash = false
	router.RedirectFixedPath = false

	// 設定 CORS
	router.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"http://localhost:3000"},
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
		AllowCredentials: true,
	}))

	// 設定路由
	routes.SetupRoutes(router)
	setupStaticRoutes(router)

	// 啟動伺服器
	port := os.Getenv("PORT")
	if port == "" {
		port = "5000"
	}

	log.Printf("後端伺服器運行在 http://localhost:%s\n", port)
	router.Run(":" + port)
}

func setupStaticRoutes(router *gin.Engine) {
	buildFS, err := fs.Sub(web.BuildFS, "build")
	if err != nil {
		log.Fatalf("載入前端靜態資源失敗: %v", err)
	}

	staticServer := http.FS(buildFS)

	serveIndex := func(c *gin.Context) {
		data, err := fs.ReadFile(buildFS, "index.html")
		if err != nil {
			c.Status(http.StatusNotFound)
			return
		}
		c.Data(http.StatusOK, "text/html; charset=utf-8", data)
	}

	router.GET("/", serveIndex)

	router.NoRoute(func(c *gin.Context) {
		if strings.HasPrefix(c.Request.URL.Path, "/api/") {
			c.JSON(http.StatusNotFound, gin.H{"error": "API 路由不存在"})
			return
		}

		requestPath := strings.TrimPrefix(c.Request.URL.Path, "/")
		if requestPath != "" && fileExists(buildFS, requestPath) {
			c.FileFromFS(requestPath, staticServer)
			return
		}

		serveIndex(c)
	})
}

func fileExists(fsys fs.FS, path string) bool {
	f, err := fsys.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil || info.IsDir() {
		return false
	}
	return true
}
