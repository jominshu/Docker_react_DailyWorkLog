package handlers

import (
	"Daily_Work_Log/daily-work-log-go-backend/config"
	"net/http"
	"os"
	"sort"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/lib/pq"
)

var allowedPages = []string{"home", "history", "monthly", "summary", "admin", "permissions"}

func sanitizePages(pages []string) []string {
	allowed := make(map[string]bool)
	for _, p := range allowedPages {
		allowed[p] = true
	}
	result := make([]string, 0, len(pages))
	seen := make(map[string]bool)
	for _, p := range pages {
		p = strings.TrimSpace(p)
		if p == "" || seen[p] {
			continue
		}
		if allowed[p] {
			result = append(result, p)
			seen[p] = true
		}
	}
	return result
}

func defaultPages(isAdmin bool) []string {
	if isAdmin {
		return append([]string{}, allowedPages...)
	}
	return []string{"home", "history"}
}

// GetMyPermissions 回傳登入者可用分頁
func GetMyPermissions(c *gin.Context) {
	empno := c.GetString("empno")
	isAdmin := c.GetBool("is_admin")
	pages := fetchUserPages(empno, isAdmin)
	c.JSON(http.StatusOK, gin.H{
		"pages": pages,
	})
}

func fetchUserPages(empno string, isAdmin bool) []string {
	if isAdmin {
		return defaultPages(true)
	}
	if config.PostgresDB == nil {
		return defaultPages(false)
	}
	var stored pq.StringArray
	err := config.PostgresDB.QueryRow(`SELECT pages FROM page_permissions WHERE empno = $1`, empno).Scan(&stored)
	if err != nil || len(stored) == 0 {
		return defaultPages(false)
	}
	return sanitizePages(stored)
}

// HasPagePermission 檢查使用者是否可存取指定分頁
func HasPagePermission(empno string, isAdmin bool, page string) bool {
	if isAdmin {
		return true
	}
	pages := fetchUserPages(empno, false)
	for _, p := range pages {
		if p == page {
			return true
		}
	}
	return false
}

// RequirePagePermission 若無權限則輸出 403
func RequirePagePermission(c *gin.Context, page string) bool {
	if HasPagePermission(c.GetString("empno"), c.GetBool("is_admin"), page) {
		return true
	}
	c.JSON(http.StatusForbidden, gin.H{"error": "無權限"})
	return false
}

type permissionRow struct {
	EmpNo string   `json:"empno"`
	EmpNm string   `json:"empnm"`
	Dept  string   `json:"deptno"`
	Pages []string `json:"pages"`
}

// ListPermissions 列出 63% 部門員工及其權限
func ListPermissions(c *gin.Context) {
	if config.OracleDB == nil || config.PostgresDB == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "資料庫尚未連線"})
		return
	}

	compID := strings.TrimSpace(os.Getenv("AUTH_COMPID"))
	if compID == "" {
		compID = "A"
	}

	oracleQuery := `
		SELECT DISTINCT
			E.COMPID,
			R.COM_DESC,
			E.DEPTNO,
			D.DEPNM,
			E.EMPNO,
			E.EMPNM
		FROM EP_NEW.EPEMPT00 E
		LEFT JOIN EP_NEW.EPDEPT00 D
			ON E.COMPID = D.COMPID
			AND E.DEPTNO = D.DEPNO
		LEFT JOIN RE_R1.REFFACTORY R
			ON E.COMPID = R.COMPID
		WHERE E.COMPID = :1
			AND E.DEPTNO LIKE '63%'
			AND E.INOUT = '0'
		ORDER BY E.EMPNO
	`

	rows, err := config.OracleDB.Query(oracleQuery, compID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查詢員工失敗", "details": err.Error()})
		return
	}
	defer rows.Close()

	perms := make(map[string][]string)
	storeRows, err := config.PostgresDB.Query(`SELECT empno, pages FROM page_permissions`)
	if err == nil {
		defer storeRows.Close()
		for storeRows.Next() {
			var emp string
			var p pq.StringArray
			if err := storeRows.Scan(&emp, &p); err == nil {
				perms[strings.TrimSpace(emp)] = sanitizePages(p)
			}
		}
	}

	seen := make(map[string]bool)
	var employees []permissionRow
	for rows.Next() {
		var comp, comDesc, deptno, deptNm, empno, empnm string
		if err := rows.Scan(&comp, &comDesc, &deptno, &deptNm, &empno, &empnm); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "資料解析失敗", "details": err.Error()})
			return
		}
		empno = strings.TrimSpace(empno)
		if empno == "" || seen[empno] {
			continue
		}
		seen[empno] = true
		employees = append(employees, permissionRow{
			EmpNo: empno,
			EmpNm: strings.TrimSpace(empnm),
			Dept:  strings.TrimSpace(deptno),
		})
	}

	manualEmp := permissionRow{
		EmpNo: "19300279",
		EmpNm: "林武勳",
		Dept:  "60000",
	}
	if !seen[manualEmp.EmpNo] {
		employees = append(employees, manualEmp)
		seen[manualEmp.EmpNo] = true
	}

	sort.Slice(employees, func(i, j int) bool {
		return employees[i].EmpNo < employees[j].EmpNo
	})

	for idx, emp := range employees {
		employees[idx].Pages = perms[emp.EmpNo]
	}

	c.JSON(http.StatusOK, gin.H{
		"data":    employees,
		"count":   len(employees),
		"message": "查詢成功",
	})
}

type updatePermissionInput struct {
	Pages []string `json:"pages"`
}

// UpdatePermission 更新指定員工可用分頁
func UpdatePermission(c *gin.Context) {
	if config.PostgresDB == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "資料庫尚未連線"})
		return
	}
	empno := strings.TrimSpace(c.Param("empno"))
	if empno == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "工號不可為空"})
		return
	}

	var body updatePermissionInput
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "請提供頁面列表"})
		return
	}

	pages := sanitizePages(body.Pages)
	if len(pages) == 0 {
		pages = nil
	}

	_, err := config.PostgresDB.Exec(`
		INSERT INTO page_permissions (empno, pages)
		VALUES ($1, $2)
		ON CONFLICT (empno) DO UPDATE SET pages = EXCLUDED.pages, updated_at = NOW()
	`, empno, pq.Array(pages))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新失敗", "details": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "更新成功"})
}
