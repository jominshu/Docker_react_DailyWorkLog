package handlers

import (
	"Daily_Work_Log/daily-work-log-go-backend/config"
	"database/sql"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

type adminRequest struct {
	EmpNo  string `json:"empno"`
	EmpNm  string `json:"empnm"`
	DeptNo string `json:"deptno"`
}

type adminUpdateRequest struct {
	EmpNm  *string `json:"empnm"`
	DeptNo *string `json:"deptno"`
}

type adminResponse struct {
	EmpNo     string    `json:"empno"`
	EmpNm     string    `json:"empnm"`
	DeptNo    string    `json:"deptno"`
	CreatedAt time.Time `json:"created_at"`
}

func fetchOracleUserInfo(empno string) (string, string) {
	if config.OracleDB == nil {
		return "", ""
	}
	compid := strings.TrimSpace(os.Getenv("AUTH_COMPID"))
	query := `
		SELECT USER_DESC, DEPNO
		FROM UD_R1.UDFUSERID
		WHERE EMPNO = :1
	`
	args := []interface{}{empno}
	if compid != "" {
		query += " AND COMPID = :2"
		args = append(args, compid)
	}
	var name, dept string
	if err := config.OracleDB.QueryRow(query, args...).Scan(&name, &dept); err != nil {
		return "", ""
	}
	return strings.TrimSpace(name), strings.TrimSpace(dept)
}

// AddAdmin 新增管理員
func AddAdmin(c *gin.Context) {
	if config.PostgresDB == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "資料庫尚未連線"})
		return
	}

	var req adminRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "請提供工號"})
		return
	}

	empno := strings.TrimSpace(req.EmpNo)
	if empno == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "工號不可為空"})
		return
	}

	name := strings.TrimSpace(req.EmpNm)
	dept := strings.TrimSpace(req.DeptNo)
	if name == "" || dept == "" {
		oName, oDept := fetchOracleUserInfo(empno)
		if name == "" {
			name = oName
		}
		if dept == "" {
			dept = oDept
		}
	}

	_, err := config.PostgresDB.Exec(`
		INSERT INTO work_hours_admins (empno, empnm, deptno)
		VALUES ($1, $2, $3)
		ON CONFLICT (empno) DO UPDATE SET empnm = EXCLUDED.empnm, deptno = EXCLUDED.deptno
	`, empno, name, dept)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "新增管理員失敗",
			"details": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "管理員新增成功",
	})
}

// ListAdmins 取得管理員列表
func ListAdmins(c *gin.Context) {
	if config.PostgresDB == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "資料庫尚未連線"})
		return
	}

	rows, err := config.PostgresDB.Query(`
		SELECT empno, COALESCE(empnm, ''), COALESCE(deptno, ''), created_at
		FROM work_hours_admins
		ORDER BY empno
	`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "查詢失敗",
			"details": err.Error(),
		})
		return
	}
	defer rows.Close()

	var list []adminResponse
	for rows.Next() {
		var item adminResponse
		if err := rows.Scan(&item.EmpNo, &item.EmpNm, &item.DeptNo, &item.CreatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error":   "資料解析失敗",
				"details": err.Error(),
			})
			return
		}
		list = append(list, item)
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "查詢成功",
		"data":    list,
		"count":   len(list),
	})
}

// UpdateAdmin 更新管理員資訊
func UpdateAdmin(c *gin.Context) {
	if config.PostgresDB == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "資料庫尚未連線"})
		return
	}

	empno := strings.TrimSpace(c.Param("empno"))
	if empno == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "工號不可為空"})
		return
	}

	var req adminUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "請提供要更新的資料"})
		return
	}

	if req.EmpNm == nil && req.DeptNo == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "請提供要更新的資料"})
		return
	}

	var current adminResponse
	if err := config.PostgresDB.QueryRow(`SELECT empnm, deptno FROM work_hours_admins WHERE empno = $1`, empno).Scan(&current.EmpNm, &current.DeptNo); err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "找不到該管理員"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "查詢失敗",
			"details": err.Error(),
		})
		return
	}

	name := current.EmpNm
	dept := current.DeptNo
	if req.EmpNm != nil {
		name = strings.TrimSpace(*req.EmpNm)
	}
	if req.DeptNo != nil {
		dept = strings.TrimSpace(*req.DeptNo)
	}

	_, err := config.PostgresDB.Exec(`
		UPDATE work_hours_admins
		SET empnm = $1, deptno = $2
		WHERE empno = $3
	`, name, dept, empno)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "更新失敗",
			"details": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "更新成功"})
}

// DeleteAdmin 移除管理員
func DeleteAdmin(c *gin.Context) {
	if config.PostgresDB == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "資料庫尚未連線"})
		return
	}

	empno := strings.TrimSpace(c.Param("empno"))
	if empno == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "工號不可為空"})
		return
	}

	result, err := config.PostgresDB.Exec(`DELETE FROM work_hours_admins WHERE empno = $1`, empno)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "刪除失敗",
			"details": err.Error(),
		})
		return
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "找不到該管理員"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "刪除成功"})
}
