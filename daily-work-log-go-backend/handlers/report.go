package handlers

import (
	"Daily_Work_Log/daily-work-log-go-backend/config"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lib/pq"
)

type MonthlyReportRow struct {
	EmpNo       string     `json:"empno"`
	EmpNm       string     `json:"empnm"`
	DepNo       string     `json:"depno"`
	SupDate     *time.Time `json:"sup_date,omitempty"`
	TotalHours  *float64   `json:"total_hours,omitempty"`
	Description *string    `json:"description"`
	Memo        *string    `json:"memo"`
	SupCompID   string     `json:"sup_compid,omitempty"`
	SupCompIDs  []string   `json:"sup_compids,omitempty"`
	ComDesc     string     `json:"com_desc,omitempty"`
	ComDescs    []string   `json:"com_descs,omitempty"`
}

// GetMonthlyReport 回傳指定年月、部門 63% 員工的支援明細
// Query: year=YYYY&month=1-12
func GetMonthlyReport(c *gin.Context) {
	// 授權
	if !HasPagePermission(c.GetString("empno"), c.GetBool("is_admin"), "monthly") {
		c.JSON(http.StatusForbidden, gin.H{"error": "無權限"})
		return
	}
	yearStr := strings.TrimSpace(c.Query("year"))
	monthStr := strings.TrimSpace(c.Query("month"))
	year, err := strconv.Atoi(yearStr)
	if err != nil || year < 2000 || year > 2100 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "year 參數錯誤"})
		return
	}
	monthAll := monthStr == "" || strings.EqualFold(monthStr, "all")
	month := 0
	if !monthAll {
		month, err = strconv.Atoi(monthStr)
		if err != nil || month < 1 || month > 12 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "month 參數錯誤"})
			return
		}
	}

	if config.OracleDB == nil || config.PostgresDB == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "資料庫尚未連線"})
		return
	}

	// 公司代碼 -> 公司名稱 (COM_DESC)
	companyQuery := `
		SELECT DISTINCT COMPID, COM_DESC
		FROM RE_R1.REFFACTORY
		WHERE COM_DESC != '錸寶科技'
			AND COM_DESC != '銓錸光電'
			AND COMPID IN ('A','1','5','61','B','J','R','X','L','S','F','M','G','6','C','D','Z','V')
		UNION
		SELECT '0' AS COMPID, 'AMI' AS COM_DESC FROM dual
	`
	companyRows, err := config.OracleDB.Query(companyQuery)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Oracle 查詢公司清單失敗",
			"details": err.Error(),
		})
		return
	}
	defer companyRows.Close()

	companyNameByID := make(map[string]string)
	for companyRows.Next() {
		var compID, comDesc string
		if err := companyRows.Scan(&compID, &comDesc); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error":   "Oracle 公司清單解析失敗",
				"details": err.Error(),
			})
			return
		}
		companyNameByID[strings.TrimSpace(compID)] = strings.TrimSpace(comDesc)
	}
	companyNameByID["2"] = "新寶"

	// 先從 Oracle 取得部門 63% 的在職員工清單
	// empQuery := `
	// 	SELECT EMPNO, EMPNM, DEPTNO
	// 	FROM EP_NEW.EPEMPT00
	// 	WHERE DEPTNO LIKE '63%' AND INOUT = '0'
	// 	ORDER BY EMPNO
	// `
	reportCompID := strings.TrimSpace(os.Getenv("AUTH_COMPID"))
	if reportCompID == "" {
		reportCompID = "A"
	}

	empQuery := `
		SELECT DISTINCT
			E.COMPID,
			R.COM_DESC /* 公司中文名稱 */,
			E.DEPTNO,
			D.DEPNM /* 部門中文名稱 */,
			E.EMPNO,
			E.EMPNM /* 員工中文姓名 */
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
	rows, err := config.OracleDB.Query(empQuery, reportCompID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Oracle 查詢員工清單失敗",
			"details": err.Error(),
		})
		return
	}
	defer rows.Close()

	empNos := make([]string, 0, 64)
	empNameByNo := make(map[string]string)
	empDepByNo := make(map[string]string)
	for rows.Next() {
		var compID, comDesc, deptNo, depNm, empNo, empNm string
		if err := rows.Scan(&compID, &comDesc, &deptNo, &depNm, &empNo, &empNm); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error":   "Oracle 員工清單解析失敗",
				"details": err.Error(),
			})
			return
		}
		empNo = strings.TrimSpace(empNo)
		if empNo == "" {
			continue
		}
		empNos = append(empNos, empNo)
		empNameByNo[empNo] = strings.TrimSpace(empNm)
		empDepByNo[empNo] = strings.TrimSpace(deptNo)
	}

	if len(empNos) == 0 {
		c.JSON(http.StatusOK, gin.H{
			"message": "查詢成功",
			"data":    []MonthlyReportRow{},
			"count":   0,
		})
		return
	}

	var start time.Time
	var end time.Time
	if monthAll {
		start = time.Date(year, 1, 1, 0, 0, 0, 0, time.UTC)
		end = start.AddDate(1, 0, 0)
	} else {
		start = time.Date(year, time.Month(month), 1, 0, 0, 0, 0, time.UTC)
		end = start.AddDate(0, 1, 0)
	}

	workQuery := `
		SELECT empno, empnm, sup_compid, sup_date, total_hours, description, memo
		FROM work_hours
		WHERE empno = ANY($1)
		  AND sup_date >= $2
		  AND sup_date < $3
		ORDER BY empno, sup_date, id
	`

	pgRows, err := config.PostgresDB.Query(workQuery, pq.Array(empNos), start, end)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "PostgreSQL 查詢工時失敗",
			"details": err.Error(),
		})
		return
	}
	defer pgRows.Close()

	result := make([]MonthlyReportRow, 0, 256)
	reportRowsByEmpNo := make(map[string][]MonthlyReportRow)
	for pgRows.Next() {
		var empno, empnm, supCompID string
		var supDate time.Time
		var totalHours float64
		var description *string
		var memo *string

		if err := pgRows.Scan(&empno, &empnm, &supCompID, &supDate, &totalHours, &description, &memo); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error":   "PostgreSQL 資料解析失敗",
				"details": err.Error(),
			})
			return
		}

		name := empNameByNo[empno]
		if name == "" {
			name = empnm
		}

		depno := empDepByNo[empno]
		compCodes := strings.Split(supCompID, ",")
		compDescs := make([]string, 0, len(compCodes))
		for _, code := range compCodes {
			code = strings.TrimSpace(code)
			if code == "" {
				continue
			}
			if desc, ok := companyNameByID[code]; ok && desc != "" {
				compDescs = append(compDescs, desc)
			} else {
				compDescs = append(compDescs, code)
			}
		}
		supDateCopy := supDate
		totalHoursCopy := totalHours
		reportRowsByEmpNo[empno] = append(reportRowsByEmpNo[empno], MonthlyReportRow{
			EmpNo:       empno,
			EmpNm:       name,
			DepNo:       depno,
			SupDate:     &supDateCopy,
			TotalHours:  &totalHoursCopy,
			Description: description,
			Memo:        memo,
			SupCompID:   supCompID,
			SupCompIDs:  compCodes,
			ComDesc:     strings.Join(compDescs, " / "),
			ComDescs:    compDescs,
		})
	}

	// 確保「該部門每個在職人員」都會出現在結果中；沒填工時者也會有一筆空資料
	for _, empno := range empNos {
		rows := reportRowsByEmpNo[empno]
		if len(rows) == 0 {
			result = append(result, MonthlyReportRow{
				EmpNo: empno,
				EmpNm: empNameByNo[empno],
				DepNo: empDepByNo[empno],
			})
			continue
		}
		result = append(result, rows...)
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "查詢成功",
		"data":    result,
		"count":   len(result),
	})
}
