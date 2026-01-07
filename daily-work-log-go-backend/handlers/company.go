package handlers

import (
	"Daily_Work_Log/daily-work-log-go-backend/config"
	"Daily_Work_Log/daily-work-log-go-backend/models"
	"net/http"

	"github.com/gin-gonic/gin"
)

func GetCompanies(c *gin.Context) {
	if config.OracleDB == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "資料庫尚未連線"})
		return
	}

	query := `
		SELECT DISTINCT COMPID, COM_DESC 
		FROM RE_R1.REFFACTORY 
		WHERE COM_DESC != '錸寶科技' 
			AND COM_DESC != '銓錸光電' 
			AND COMPID IN ('A','1','5','61','B','J','R','X','L','S','F','M','G','6','C','D','Z','V')
		UNION
		SELECT '0' AS COMPID, 'AMI' AS COM_DESC FROM dual
		ORDER BY COMPID
	`

	rows, err := config.OracleDB.Query(query)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "查詢失敗",
			"details": err.Error(),
		})
		return
	}
	defer rows.Close()

	var companies []models.Company
	for rows.Next() {
		var company models.Company
		if err := rows.Scan(&company.CompID, &company.ComDesc); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error":   "資料解析失敗",
				"details": err.Error(),
			})
			return
		}
		companies = append(companies, company)
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "查詢成功",
		"data":    companies,
		"count":   len(companies),
	})
}
