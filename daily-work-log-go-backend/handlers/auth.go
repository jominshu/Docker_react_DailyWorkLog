package handlers

import (
	"Daily_Work_Log/daily-work-log-go-backend/config"
	"Daily_Work_Log/daily-work-log-go-backend/utils"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

type LoginRequest struct {
	EmpNo      string `json:"empno"`
	EmployeeID string `json:"employeeId"`
	Password   string `json:"password"`
	UserPass   string `json:"user_pass"`
	RememberMe bool   `json:"remember_me"`
}

const (
	accessTokenTTL  = 30 * time.Minute
	refreshTokenTTL = 7 * 24 * time.Hour
	refreshCookie   = "refresh_token"
)

func generateRefreshToken() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}

func hashRefreshToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func shouldUseSecureCookie() bool {
	return strings.EqualFold(os.Getenv("COOKIE_SECURE"), "true")
}

func setRefreshCookie(c *gin.Context, token string, ttl time.Duration) {
	exp := time.Now().Add(ttl)
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     refreshCookie,
		Value:    token,
		Path:     "/api/auth",
		HttpOnly: true,
		Secure:   shouldUseSecureCookie(),
		SameSite: http.SameSiteLaxMode,
		Expires:  exp,
		MaxAge:   int(ttl.Seconds()),
	})
}

func clearRefreshCookie(c *gin.Context) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     refreshCookie,
		Value:    "",
		Path:     "/api/auth",
		HttpOnly: true,
		Secure:   shouldUseSecureCookie(),
		SameSite: http.SameSiteLaxMode,
		Expires:  time.Unix(0, 0),
		MaxAge:   -1,
	})
}

func storeRefreshToken(empNo, token string, ttl time.Duration) error {
	if config.PostgresDB == nil {
		return sql.ErrConnDone
	}
	expiresAt := time.Now().Add(ttl)
	tokenHash := hashRefreshToken(token)
	_, err := config.PostgresDB.Exec(
		`INSERT INTO refresh_tokens (token_hash, empno, expires_at) VALUES ($1, $2, $3)`,
		tokenHash,
		empNo,
		expiresAt,
	)
	return err
}

func revokeRefreshToken(token string) {
	if config.PostgresDB == nil || token == "" {
		return
	}
	tokenHash := hashRefreshToken(token)
	_, _ = config.PostgresDB.Exec(
		`UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL`,
		tokenHash,
	)
}

func fetchOracleUser(empno string) (string, string, string, string, error) {
	if config.OracleDB == nil {
		return "", "", "", "", sql.ErrConnDone
	}
	compid := strings.TrimSpace(os.Getenv("AUTH_COMPID"))
	if compid == "" {
		compid = "A"
	}
	query := `
		SELECT COMPID, DEPNO, EMPNO, USER_DESC
		FROM UD_R1.UDFUSERID
		WHERE COMPID = :1 AND EMPNO = :2
	`
	var dbCompID, depNo, empNo, userDesc string
	if err := config.OracleDB.QueryRow(query, compid, empno).Scan(&dbCompID, &depNo, &empNo, &userDesc); err != nil {
		return "", "", "", "", err
	}
	return dbCompID, depNo, empNo, userDesc, nil
}

func buildLoginResponse(empNo, displayName, compID, depNo string, isAdmin bool) (gin.H, error) {
	token, exp, err := utils.GenerateToken(empNo, displayName, compID, depNo, accessTokenTTL)
	if err != nil {
		return nil, err
	}
	return gin.H{
		"token":      token,
		"expires_at": exp.UTC().Format(time.RFC3339),
		"empno":      empNo,
		"empnm":      displayName,
		"username":   displayName,
		"compid":     compID,
		"depno":      depNo,
		"is_admin":   isAdmin,
	}, nil
}

// Login 使用 Oracle 驗證工號/密碼，成功後發放 JWT
func Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "請輸入工號與密碼",
			"details": err.Error(),
		})
		return
	}

	empno := strings.TrimSpace(req.EmpNo)
	if empno == "" {
		empno = strings.TrimSpace(req.EmployeeID)
	}
	password := strings.TrimSpace(req.Password)
	if password == "" {
		password = strings.TrimSpace(req.UserPass)
	}
	if empno == "" || password == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "請輸入工號與密碼",
		})
		return
	}

	if config.OracleDB == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error": "Oracle 尚未連線",
		})
		return
	}

	compid := strings.TrimSpace(os.Getenv("AUTH_COMPID"))
	if compid == "" {
		compid = "A"
	}

	query := `
		SELECT COMPID, DEPNO, EMPNO, USER_DESC, USER_PASS
		FROM UD_R1.UDFUSERID
		WHERE COMPID = :1 AND EMPNO = :2
	`

	var dbCompID, depNo, empNo, userDesc, userPass string
	err := config.OracleDB.QueryRow(query, compid, empno).Scan(&dbCompID, &depNo, &empNo, &userDesc, &userPass)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "工號或密碼錯誤",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "登入查詢失敗",
			"details": err.Error(),
		})
		return
	}

	if strings.TrimSpace(userPass) != password {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "工號或密碼錯誤",
		})
		return
	}

	displayName := strings.TrimSpace(userDesc)
	if displayName == "" {
		displayName = empNo
	}

	isAdmin := false
	if config.PostgresDB != nil {
		var tmp string
		if err := config.PostgresDB.QueryRow(`SELECT empno FROM work_hours_admins WHERE empno = $1`, empNo).Scan(&tmp); err == nil {
			isAdmin = true
		} else if err != sql.ErrNoRows {
			log.Printf("查詢管理員狀態失敗: %v", err)
		}
	}

	if req.RememberMe {
		if config.PostgresDB == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "資料庫尚未連線"})
			return
		}
		refreshToken, err := generateRefreshToken()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Refresh token 產生失敗"})
			return
		}
		if err := storeRefreshToken(empNo, refreshToken, refreshTokenTTL); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Refresh token 儲存失敗"})
			return
		}
		setRefreshCookie(c, refreshToken, refreshTokenTTL)
	} else {
		clearRefreshCookie(c)
	}

	payload, err := buildLoginResponse(empNo, displayName, dbCompID, depNo, isAdmin)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Token 產生失敗",
		})
		return
	}

	c.JSON(http.StatusOK, payload)
}

// RefreshToken 使用 refresh token 換取新的 access token
func RefreshToken(c *gin.Context) {
	if config.PostgresDB == nil || config.OracleDB == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "資料庫尚未連線"})
		return
	}

	refreshToken, err := c.Cookie(refreshCookie)
	if err != nil || strings.TrimSpace(refreshToken) == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "尚未登入"})
		return
	}

	tokenHash := hashRefreshToken(refreshToken)
	tx, err := config.PostgresDB.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "資料庫處理失敗"})
		return
	}
	defer tx.Rollback()

	var empNo string
	var expiresAt time.Time
	var revokedAt sql.NullTime
	err = tx.QueryRow(
		`SELECT empno, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
		tokenHash,
	).Scan(&empNo, &expiresAt, &revokedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "登入已失效"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "資料庫處理失敗"})
		return
	}

	if revokedAt.Valid || expiresAt.Before(time.Now()) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "登入已失效"})
		return
	}

	newRefreshToken, err := generateRefreshToken()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Refresh token 產生失敗"})
		return
	}

	if _, err := tx.Exec(
		`UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL`,
		tokenHash,
	); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "資料庫處理失敗"})
		return
	}
	if _, err := tx.Exec(
		`INSERT INTO refresh_tokens (token_hash, empno, expires_at) VALUES ($1, $2, $3)`,
		hashRefreshToken(newRefreshToken),
		empNo,
		time.Now().Add(refreshTokenTTL),
	); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "資料庫處理失敗"})
		return
	}

	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "資料庫處理失敗"})
		return
	}

	dbCompID, depNo, empNo, userDesc, err := fetchOracleUser(empNo)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "登入已失效"})
		return
	}

	displayName := strings.TrimSpace(userDesc)
	if displayName == "" {
		displayName = empNo
	}

	isAdmin := false
	if config.PostgresDB != nil {
		var tmp string
		if err := config.PostgresDB.QueryRow(`SELECT empno FROM work_hours_admins WHERE empno = $1`, empNo).Scan(&tmp); err == nil {
			isAdmin = true
		} else if err != sql.ErrNoRows {
			log.Printf("查詢管理員狀態失敗: %v", err)
		}
	}

	setRefreshCookie(c, newRefreshToken, refreshTokenTTL)
	payload, err := buildLoginResponse(empNo, displayName, dbCompID, depNo, isAdmin)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Token 產生失敗"})
		return
	}

	c.JSON(http.StatusOK, payload)
}

// Logout 清除 refresh token
func Logout(c *gin.Context) {
	refreshToken, _ := c.Cookie(refreshCookie)
	revokeRefreshToken(refreshToken)
	clearRefreshCookie(c)
	c.JSON(http.StatusOK, gin.H{"message": "已登出"})
}
