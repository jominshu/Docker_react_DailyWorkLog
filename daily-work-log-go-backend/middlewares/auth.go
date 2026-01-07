package middlewares

import (
	"Daily_Work_Log/daily-work-log-go-backend/config"
	"Daily_Work_Log/daily-work-log-go-backend/utils"
	"database/sql"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// AuthMiddleware 檢查 Bearer Token 並將使用者資料放入 context
func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if !strings.HasPrefix(authHeader, "Bearer ") {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "未授權，請重新登入"})
			c.Abort()
			return
		}

		token := strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer"))
		claims, err := utils.ValidateToken(token)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Token 無效或已過期"})
			c.Abort()
			return
		}

		isAdmin := false
		if config.PostgresDB != nil {
			var tmp string
			err := config.PostgresDB.QueryRow(`SELECT empno FROM work_hours_admins WHERE empno = $1`, claims.EmpNo).Scan(&tmp)
			if err == nil {
				isAdmin = true
			} else if err != sql.ErrNoRows {
				// 忽略其它錯誤
			}
		}

		c.Set("empno", claims.EmpNo)
		c.Set("empnm", claims.EmpNm)
		c.Set("compid", claims.CompID)
		c.Set("depno", claims.DepNo)
		c.Set("is_admin", isAdmin)
		c.Next()
	}
}

// AdminOnly 僅允許管理員操作
func AdminOnly() gin.HandlerFunc {
	return func(c *gin.Context) {
		if isAdmin, ok := c.Get("is_admin"); ok {
			if val, ok := isAdmin.(bool); ok && val {
				c.Next()
				return
			}
		}
		c.JSON(http.StatusForbidden, gin.H{"error": "僅限管理員使用"})
		c.Abort()
	}
}
