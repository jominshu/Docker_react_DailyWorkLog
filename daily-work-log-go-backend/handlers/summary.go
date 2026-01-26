package handlers

import (
	"Daily_Work_Log/daily-work-log-go-backend/config"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

type SupportHoursSummaryRow struct {
	CompID     string  `json:"compid"`
	ComDesc    string  `json:"com_desc"`
	TotalHours float64 `json:"total_hours"`
}

type SupportHoursDetailRow struct {
	EmpNo       string     `json:"empno"`
	EmpNm       string     `json:"empnm"`
	CompID      string     `json:"compid"`
	ComDesc     string     `json:"com_desc"`
	SupDate     *time.Time `json:"sup_date,omitempty"`
	TotalHours  *float64   `json:"total_hours,omitempty"`
	Description *string    `json:"description"`
	Memo        *string    `json:"memo"`
}

type SupportHoursEmployeeSummaryRow struct {
	EmpNo      string    `json:"empno,omitempty"`
	EmpNm      string    `json:"empnm"`
	CompID     string    `json:"compid,omitempty"`
	ComDesc    string    `json:"com_desc"`
	Monthly    []float64 `json:"monthly"`
	TotalHours float64   `json:"total_hours"`
	IsTotal    bool      `json:"is_total,omitempty"`
}

// GetSupportHoursSummary 回傳指定年月（或整年）依公司別彙總的支援時數
// Query: year=YYYY&month=all|1-12
func GetSupportHoursSummary(c *gin.Context) {
	// 授權
	if !HasPagePermission(c.GetString("empno"), c.GetBool("is_admin"), "summary") {
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
			AND COM_DESC != '錸德科技'
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

	start := time.Date(year, 1, 1, 0, 0, 0, 0, time.UTC)
	end := start.AddDate(1, 0, 0)
	if !monthAll {
		start = time.Date(year, time.Month(month), 1, 0, 0, 0, 0, time.UTC)
		end = start.AddDate(0, 1, 0)
	}

	query := `
		SELECT sup_compid AS compid, COALESCE(SUM(total_hours), 0) AS total_hours
		FROM work_hours
		WHERE sup_date >= $1 AND sup_date < $2
		GROUP BY sup_compid
		ORDER BY total_hours DESC, compid
	`

	rows, err := config.PostgresDB.Query(query, start, end)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "PostgreSQL 查詢彙總失敗",
			"details": err.Error(),
		})
		return
	}
	defer rows.Close()

	totalByComp := make(map[string]float64)
	for rows.Next() {
		var compID string
		var total float64
		if err := rows.Scan(&compID, &total); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error":   "PostgreSQL 彙總解析失敗",
				"details": err.Error(),
			})
			return
		}
		totalByComp[strings.TrimSpace(compID)] += total
	}

	// 將所有公司（含無時數）都列出
	result := make([]SupportHoursSummaryRow, 0, len(companyNameByID))
	for compID, comDesc := range companyNameByID {
		total := totalByComp[compID]
		result = append(result, SupportHoursSummaryRow{
			CompID:     compID,
			ComDesc:    comDesc,
			TotalHours: total,
		})
	}

	// 依時數多到少排序
	sort.Slice(result, func(i, j int) bool {
		if result[i].TotalHours == result[j].TotalHours {
			return result[i].ComDesc < result[j].ComDesc
		}
		return result[i].TotalHours > result[j].TotalHours
	})

	c.JSON(http.StatusOK, gin.H{
		"message": "查詢成功",
		"data":    result,
		"count":   len(result),
	})
}

// GetSupportHoursDetail 回傳指定年月（或整年）單一公司別的支援明細
// Query: year=YYYY&month=all|1-12&compid=XXX
func GetSupportHoursDetail(c *gin.Context) {
	if !HasPagePermission(c.GetString("empno"), c.GetBool("is_admin"), "summary") {
		c.JSON(http.StatusForbidden, gin.H{"error": "無權限"})
		return
	}

	yearStr := strings.TrimSpace(c.Query("year"))
	monthStr := strings.TrimSpace(c.Query("month"))
	compID := strings.TrimSpace(c.Query("compid"))
	if compID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "compid 參數錯誤"})
		return
	}

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

	companyQuery := `
		SELECT DISTINCT COMPID, COM_DESC
		FROM RE_R1.REFFACTORY
		WHERE COM_DESC != '錸寶科技'
			AND COM_DESC != '銓錸光電'
			AND COM_DESC != '錸德科技'
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
		var id, desc string
		if err := companyRows.Scan(&id, &desc); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error":   "Oracle 公司清單解析失敗",
				"details": err.Error(),
			})
			return
		}
		companyNameByID[strings.TrimSpace(id)] = strings.TrimSpace(desc)
	}

	start := time.Date(year, 1, 1, 0, 0, 0, 0, time.UTC)
	end := start.AddDate(1, 0, 0)
	if !monthAll {
		start = time.Date(year, time.Month(month), 1, 0, 0, 0, 0, time.UTC)
		end = start.AddDate(0, 1, 0)
	}

	query := `
		SELECT empno, empnm, sup_compid, sup_date, total_hours, description, memo
		FROM work_hours
		WHERE sup_compid = $1
			AND sup_date >= $2
			AND sup_date < $3
		ORDER BY sup_date DESC, empno
	`

	rows, err := config.PostgresDB.Query(query, compID, start, end)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "PostgreSQL 查詢明細失敗",
			"details": err.Error(),
		})
		return
	}
	defer rows.Close()

	result := make([]SupportHoursDetailRow, 0, 64)
	for rows.Next() {
		var empno, empnm, supCompID string
		var supDate time.Time
		var totalHours float64
		var description *string
		var memo *string
		if err := rows.Scan(&empno, &empnm, &supCompID, &supDate, &totalHours, &description, &memo); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error":   "PostgreSQL 明細解析失敗",
				"details": err.Error(),
			})
			return
		}
		supDateCopy := supDate
		totalHoursCopy := totalHours
		desc := companyNameByID[strings.TrimSpace(supCompID)]
		if desc == "" {
			desc = supCompID
		}
		result = append(result, SupportHoursDetailRow{
			EmpNo:       strings.TrimSpace(empno),
			EmpNm:       strings.TrimSpace(empnm),
			CompID:      strings.TrimSpace(supCompID),
			ComDesc:     desc,
			SupDate:     &supDateCopy,
			TotalHours:  &totalHoursCopy,
			Description: description,
			Memo:        memo,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "查詢成功",
		"data":    result,
		"count":   len(result),
	})
}

// GetSupportHoursEmployeeSummary 回傳指定年月（或整年）依員工與公司別彙總的支援時數
// Query: year=YYYY&month=all|1-12
func GetSupportHoursEmployeeSummary(c *gin.Context) {
	if !HasPagePermission(c.GetString("empno"), c.GetBool("is_admin"), "summary") {
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

	companyQuery := `
		SELECT DISTINCT COMPID, COM_DESC
		FROM RE_R1.REFFACTORY
		WHERE COM_DESC != '錸寶科技'
			AND COM_DESC != '銓錸光電'
			AND COM_DESC != '錸德科技'
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

	companyOrder := []string{
		"0", "A", "1", "5", "61", "B", "J", "R", "X", "L", "S", "F", "M", "G", "6", "C", "D", "Z", "V",
	}
	companyIDs := make([]string, 0, len(companyOrder))
	for _, compID := range companyOrder {
		if _, ok := companyNameByID[compID]; ok {
			companyIDs = append(companyIDs, compID)
		}
	}

	start := time.Date(year, 1, 1, 0, 0, 0, 0, time.UTC)
	end := start.AddDate(1, 0, 0)
	if !monthAll {
		start = time.Date(year, time.Month(month), 1, 0, 0, 0, 0, time.UTC)
		end = start.AddDate(0, 1, 0)
	}

	type employeeInfo struct {
		EmpNo string
		EmpNm string
	}
	employeeRows, err := config.PostgresDB.Query(`
		SELECT DISTINCT empno, empnm
		FROM work_hours
		WHERE sup_date >= $1 AND sup_date < $2
		ORDER BY empno, empnm
	`, start, end)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "PostgreSQL 查詢員工失敗",
			"details": err.Error(),
		})
		return
	}
	defer employeeRows.Close()

	employees := make([]employeeInfo, 0, 32)
	for employeeRows.Next() {
		var emp employeeInfo
		if err := employeeRows.Scan(&emp.EmpNo, &emp.EmpNm); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error":   "PostgreSQL 員工解析失敗",
				"details": err.Error(),
			})
			return
		}
		emp.EmpNo = strings.TrimSpace(emp.EmpNo)
		emp.EmpNm = strings.TrimSpace(emp.EmpNm)
		if emp.EmpNo == "" && emp.EmpNm == "" {
			continue
		}
		employees = append(employees, emp)
	}

	type monthTotals [12]float64
	hoursByEmpComp := make(map[string]map[string]*monthTotals)

	aggregateRows, err := config.PostgresDB.Query(`
		SELECT empno, empnm, sup_compid, EXTRACT(MONTH FROM sup_date)::int AS month, SUM(total_hours) AS total_hours
		FROM work_hours
		WHERE sup_date >= $1 AND sup_date < $2
		GROUP BY empno, empnm, sup_compid, EXTRACT(MONTH FROM sup_date)
		ORDER BY empno, empnm, sup_compid
	`, start, end)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "PostgreSQL 彙總失敗",
			"details": err.Error(),
		})
		return
	}
	defer aggregateRows.Close()

	for aggregateRows.Next() {
		var empno, empnm, compID string
		var month int
		var total float64
		if err := aggregateRows.Scan(&empno, &empnm, &compID, &month, &total); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error":   "PostgreSQL 彙總解析失敗",
				"details": err.Error(),
			})
			return
		}
		if month < 1 || month > 12 {
			continue
		}
		empno = strings.TrimSpace(empno)
		compID = strings.TrimSpace(compID)
		if _, ok := companyNameByID[compID]; !ok {
			continue
		}
		compMap, ok := hoursByEmpComp[empno]
		if !ok {
			compMap = make(map[string]*monthTotals)
			hoursByEmpComp[empno] = compMap
		}
		monthMap, ok := compMap[compID]
		if !ok {
			monthMap = &monthTotals{}
			compMap[compID] = monthMap
		}
		monthMap[month-1] += total
		_ = empnm
	}

	result := make([]SupportHoursEmployeeSummaryRow, 0, len(employees)*len(companyIDs)+1)
	grandMonthly := make([]float64, 12)
	var grandTotal float64

	for _, emp := range employees {
		compMap := hoursByEmpComp[emp.EmpNo]
		for _, compID := range companyIDs {
			months := make([]float64, 12)
			var total float64
			if compMap != nil {
				if monthMap, ok := compMap[compID]; ok {
					for i := 0; i < 12; i++ {
						months[i] = monthMap[i]
						total += monthMap[i]
					}
				}
			}
			for i := 0; i < 12; i++ {
				grandMonthly[i] += months[i]
			}
			grandTotal += total
			result = append(result, SupportHoursEmployeeSummaryRow{
				EmpNo:      emp.EmpNo,
				EmpNm:      emp.EmpNm,
				CompID:     compID,
				ComDesc:    companyNameByID[compID],
				Monthly:    months,
				TotalHours: total,
			})
		}
	}

	if len(result) > 0 {
		result = append(result, SupportHoursEmployeeSummaryRow{
			EmpNm:      "總計",
			ComDesc:    "小時",
			Monthly:    grandMonthly,
			TotalHours: grandTotal,
			IsTotal:    true,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "查詢成功",
		"data":    result,
		"count":   len(result),
	})
}

// GetEmployeeWorkHoursTotal 回傳部門 63% 員工在指定期間的工作時數總計
// Query: year=YYYY&month=all|1-12
func GetEmployeeWorkHoursTotal(c *gin.Context) {
	if !HasPagePermission(c.GetString("empno"), c.GetBool("is_admin"), "summary") {
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

	if config.OracleDB == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "資料庫尚未連線"})
		return
	}

	compID := strings.TrimSpace(os.Getenv("AUTH_COMPID"))
	if compID == "" {
		compID = "A"
	}

	start := time.Date(year, 1, 1, 0, 0, 0, 0, time.UTC)
	end := start.AddDate(1, 0, 0).AddDate(0, 0, -1)
	if !monthAll {
		start = time.Date(year, time.Month(month), 1, 0, 0, 0, 0, time.UTC)
		end = start.AddDate(0, 1, 0).AddDate(0, 0, -1)
	}
	startStr := start.Format("20060102")
	endStr := end.Format("20060102")

	query := `
		SELECT COALESCE(SUM(
			GREATEST(
				(base.end_minutes - base.start_minutes - 60) / 60,
				0
			)
		), 0) AS total_hours
		FROM (
			SELECT
				CASE
					WHEN REGEXP_LIKE(TRIM(TO_CHAR(A.BEGTM)), '^[0-9]{1,4}$') THEN
						TO_NUMBER(SUBSTR(LPAD(TRIM(TO_CHAR(A.BEGTM)), 4, '0'), 1, 2)) * 60
						+ TO_NUMBER(SUBSTR(LPAD(TRIM(TO_CHAR(A.BEGTM)), 4, '0'), 3, 2))
					ELSE NULL
				END AS start_minutes,
				CASE
					WHEN REGEXP_LIKE(TRIM(TO_CHAR(A.ENDTM)), '^[0-9]{1,4}$') THEN
						TO_NUMBER(SUBSTR(LPAD(TRIM(TO_CHAR(A.ENDTM)), 4, '0'), 1, 2)) * 60
						+ TO_NUMBER(SUBSTR(LPAD(TRIM(TO_CHAR(A.ENDTM)), 4, '0'), 3, 2))
					ELSE NULL
				END AS end_minutes
			FROM EP_NEW.EPDAYT00 A
			JOIN EP_NEW.EPEMPT00 B
				ON B.EMPNO = A.EMPNO
				AND B.COMPID = A.COMPID
			WHERE B.COMPID = :1
				AND B.DEPTNO LIKE '63%'
				AND A.YMD >= :2
				AND A.YMD <= :3
				AND A.BEGTM IS NOT NULL
				AND A.ENDTM IS NOT NULL
		) base
		WHERE base.start_minutes IS NOT NULL
			AND base.end_minutes IS NOT NULL
	`

	var totalHours float64
	if err := config.OracleDB.QueryRow(query, compID, startStr, endStr).Scan(&totalHours); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Oracle 查詢員工工作時數失敗",
			"details": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":     "查詢成功",
		"total_hours": totalHours,
	})
}
