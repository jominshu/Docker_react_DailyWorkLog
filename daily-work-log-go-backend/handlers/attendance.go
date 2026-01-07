package handlers

import (
	"Daily_Work_Log/daily-work-log-go-backend/config"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

var attendanceTimePattern = regexp.MustCompile(`^[0-9]{1,4}$`)

func parseOracleMinutes(raw interface{}) (int, bool) {
	if raw == nil {
		return 0, false
	}
	text := strings.TrimSpace(fmt.Sprint(raw))
	if text == "" || !attendanceTimePattern.MatchString(text) {
		return 0, false
	}
	value, err := strconv.Atoi(text)
	if err != nil {
		return 0, false
	}
	hours := value / 100
	mins := value % 100
	if hours < 0 || hours > 23 || mins < 0 || mins > 59 {
		return 0, false
	}
	return hours*60 + mins, true
}

func formatMinutes(minutes int) string {
	hours := minutes / 60
	mins := minutes % 60
	return fmt.Sprintf("%02d:%02d", hours, mins)
}

// GetAttendanceTime 回傳指定日期的出勤時間 (上班/下班)
// Query: date=YYYY-MM-DD
func GetAttendanceTime(c *gin.Context) {
	if config.OracleDB == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Oracle 尚未連線"})
		return
	}

	dateStr := strings.TrimSpace(c.Query("date"))
	if dateStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "date 參數錯誤"})
		return
	}
	dateValue, err := time.Parse("2006-01-02", dateStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "date 參數錯誤"})
		return
	}
	ymd := dateValue.Format("20060102")

	empno := strings.TrimSpace(c.GetString("empno"))
	if empno == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "員工工號缺失"})
		return
	}
	compid := strings.TrimSpace(c.GetString("compid"))
	if compid == "" {
		compid = strings.TrimSpace(os.Getenv("AUTH_COMPID"))
	}
	if compid == "" {
		compid = "A"
	}

	query := `
		SELECT A.BEGTM, A.ENDTM
		FROM EP_NEW.EPDAYT00 A
		WHERE A.COMPID = :1
			AND A.EMPNO = :2
			AND A.YMD = :3
		ORDER BY A.BEGTM
	`
	rows, err := config.OracleDB.Query(query, compid, empno, ymd)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Oracle 查詢出勤時間失敗",
			"details": err.Error(),
		})
		return
	}
	defer rows.Close()

	minStart := -1
	maxEnd := -1
	for rows.Next() {
		var begRaw interface{}
		var endRaw interface{}
		if err := rows.Scan(&begRaw, &endRaw); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error":   "Oracle 出勤資料解析失敗",
				"details": err.Error(),
			})
			return
		}
		if minutes, ok := parseOracleMinutes(begRaw); ok {
			if minStart == -1 || minutes < minStart {
				minStart = minutes
			}
		}
		if minutes, ok := parseOracleMinutes(endRaw); ok {
			if maxEnd == -1 || minutes > maxEnd {
				maxEnd = minutes
			}
		}
	}
	if err := rows.Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Oracle 出勤資料讀取失敗",
			"details": err.Error(),
		})
		return
	}

	startTime := ""
	endTime := ""
	if minStart >= 0 {
		startTime = formatMinutes(minStart)
	}
	if maxEnd >= 0 {
		endTime = formatMinutes(maxEnd)
	}

	c.JSON(http.StatusOK, gin.H{
		"message":    "查詢成功",
		"date":       dateStr,
		"start_time": startTime,
		"end_time":   endTime,
	})
}
