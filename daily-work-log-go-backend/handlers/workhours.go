package handlers

import (
	"Daily_Work_Log/daily-work-log-go-backend/config"
	"Daily_Work_Log/daily-work-log-go-backend/models"
	"database/sql"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lib/pq"
)

// 新增工時記錄
func CreateWorkHours(c *gin.Context) {
	var input models.WorkHoursInput

	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "缺少必填欄位",
			"details": err.Error(),
		})
		return
	}

	if c.GetString("empno") != input.EmpNo {
		c.JSON(http.StatusForbidden, gin.H{
			"error": "只能新增自己的工時記錄",
		})
		return
	}

	if len(input.SupCompIDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "請至少選擇一個支援公司",
		})
		return
	}

	query := `
		INSERT INTO work_hours 
		(empno, empnm, sup_compid, sup_fact_id, sup_date, total_hours, description)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, compid, empno, empnm, sup_compid, sup_fact_id, sup_date, total_hours, description, confirmed
	`
	workHoursList := make([]models.WorkHours, 0, len(input.SupCompIDs))
	tx, err := config.PostgresDB.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "新增失敗",
			"details": err.Error(),
		})
		return
	}
	defer func() {
		if err != nil {
			tx.Rollback()
		}
	}()

	for _, compID := range input.SupCompIDs {
		compID = strings.TrimSpace(compID)
		if compID == "" {
			continue
		}
		var workHours models.WorkHours
		err = tx.QueryRow(
			query,
			input.EmpNo,
			input.EmpNm,
			compID,
			compID,
			input.SupDate,
			input.TotalHours,
			input.Description,
		).Scan(
			&workHours.ID,
			&workHours.CompID,
			&workHours.EmpNo,
			&workHours.EmpNm,
			&workHours.SupCompID,
			&workHours.SupFactID,
			&workHours.SupDate,
			&workHours.TotalHours,
			&workHours.Description,
			&workHours.Confirmed,
		)
		if err != nil {
			log.Printf("insert work_hours failed: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{
				"error":   "新增失敗",
				"details": err.Error(),
			})
			return
		}
		workHours.SupCompIDs = []string{workHours.SupCompID}
		workHoursList = append(workHoursList, workHours)
	}

	if err = tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "新增失敗",
			"details": err.Error(),
		})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message": "工時記錄新增成功",
		"data":    workHoursList,
	})
}

// 查詢特定員工的工時記錄
func GetWorkHoursByEmpNo(c *gin.Context) {
	empno := c.Param("empno")
	if c.GetString("empno") != empno {
		c.JSON(http.StatusForbidden, gin.H{
			"error": "只能查詢自己的工時記錄",
		})
		return
	}

	query := `
		SELECT id, compid, empno, empnm, sup_compid, sup_fact_id, sup_date, total_hours, description, confirmed
		FROM work_hours 
		WHERE empno = $1
		ORDER BY sup_date DESC, id DESC
	`

	rows, err := config.PostgresDB.Query(query, empno)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "查詢失敗",
			"details": err.Error(),
		})
		return
	}
	defer rows.Close()

	var workHoursList []models.WorkHours
	for rows.Next() {
		var wh models.WorkHours
		if err := rows.Scan(
			&wh.ID,
			&wh.CompID,
			&wh.EmpNo,
			&wh.EmpNm,
			&wh.SupCompID,
			&wh.SupFactID,
			&wh.SupDate,
			&wh.TotalHours,
			&wh.Description,
			&wh.Confirmed,
		); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error":   "資料解析失敗",
				"details": err.Error(),
			})
			return
		}
		workHoursList = append(workHoursList, wh)
	}

	for i := range workHoursList {
		workHoursList[i].SupCompIDs = []string{workHoursList[i].SupCompID}
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "查詢成功",
		"data":    workHoursList,
		"count":   len(workHoursList),
	})
}

// 編輯工時記錄
func UpdateWorkHours(c *gin.Context) {
	id := c.Param("id")

	var input models.UpdateWorkHoursInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "缺少必填欄位",
			"details": err.Error(),
		})
		return
	}

	tx, err := config.PostgresDB.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "更新失敗",
			"details": err.Error(),
		})
		return
	}
	defer tx.Rollback()

	// 先取得原始資料
	var existing models.WorkHours
	querySelect := `
		SELECT id, compid, empno, empnm, sup_compid, sup_fact_id, sup_date, total_hours, description, confirmed
		FROM work_hours
		WHERE id = $1
		FOR UPDATE
	`
	err = tx.QueryRow(querySelect, id).Scan(
		&existing.ID,
		&existing.CompID,
		&existing.EmpNo,
		&existing.EmpNm,
		&existing.SupCompID,
		&existing.SupFactID,
		&existing.SupDate,
		&existing.TotalHours,
		&existing.Description,
		&existing.Confirmed,
	)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"error":   "找不到該記錄",
			"details": err.Error(),
		})
		return
	}

	if c.GetString("empno") != existing.EmpNo {
		c.JSON(http.StatusForbidden, gin.H{
			"error": "只能編輯自己的工時記錄",
		})
		return
	}

	// 只更新有提供的欄位
	compIDs := []string{existing.SupCompID}
	if input.SupCompIDs != nil {
		if len(*input.SupCompIDs) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "請至少選擇一個支援公司",
			})
			return
		}
		seen := make(map[string]bool)
		compIDs = compIDs[:0]
		for _, compID := range *input.SupCompIDs {
			compID = strings.TrimSpace(compID)
			if compID == "" || seen[compID] {
				continue
			}
			seen[compID] = true
			compIDs = append(compIDs, compID)
		}
		if len(compIDs) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "請至少選擇一個支援公司",
			})
			return
		}
	}

	oldSupDate := existing.SupDate
	oldTotalHours := existing.TotalHours
	oldDescription := existing.Description

	supDate := existing.SupDate
	if input.SupDate != nil {
		parsedDate, err := time.Parse("2006-01-02", *input.SupDate)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "sup_date 格式錯誤",
				"details": err.Error(),
			})
			return
		}
		supDate = parsedDate
	}

	totalHours := existing.TotalHours
	if input.TotalHours != nil {
		totalHours = *input.TotalHours
	}

	description := existing.Description
	if input.Description != nil {
		description = input.Description
	}

	// 更新資料
	queryUpdate := `
		UPDATE work_hours
		SET sup_compid = $1,
			sup_fact_id = $2,
			sup_date = $3,
			total_hours = $4,
			description = $5
		WHERE id = $6
		RETURNING id, compid, empno, empnm, sup_compid, sup_fact_id, sup_date, total_hours, description, confirmed
	`

	var updated models.WorkHours
	primaryCompID := strings.TrimSpace(compIDs[0])
	if primaryCompID == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "請至少選擇一個支援公司",
		})
		return
	}
	err = tx.QueryRow(queryUpdate, primaryCompID, primaryCompID, supDate, totalHours, description, id).Scan(
		&updated.ID,
		&updated.CompID,
		&updated.EmpNo,
		&updated.EmpNm,
		&updated.SupCompID,
		&updated.SupFactID,
		&updated.SupDate,
		&updated.TotalHours,
		&updated.Description,
		&updated.Confirmed,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "更新失敗",
			"details": err.Error(),
		})
		return
	}

	updated.SupCompIDs = []string{updated.SupCompID}

	if input.SupCompIDs != nil && len(compIDs) > 1 {
		_, err = tx.Exec(`
			UPDATE work_hours
			SET sup_date = $1,
				total_hours = $2,
				description = $3,
				sup_fact_id = sup_compid
			WHERE empno = $4
				AND sup_date = $5
				AND total_hours = $6
				AND description IS NOT DISTINCT FROM $7
				AND sup_compid = ANY($8)
				AND id <> $9
		`, supDate, totalHours, description, existing.EmpNo, oldSupDate, oldTotalHours, oldDescription, pq.Array(compIDs), id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error":   "更新失敗",
				"details": err.Error(),
			})
			return
		}

		_, err = tx.Exec(`
			DELETE FROM work_hours
			WHERE empno = $1
				AND sup_date = $2
				AND total_hours = $3
				AND description IS NOT DISTINCT FROM $4
				AND NOT (sup_compid = ANY($5))
				AND id <> $6
		`, existing.EmpNo, oldSupDate, oldTotalHours, oldDescription, pq.Array(compIDs), id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error":   "更新失敗",
				"details": err.Error(),
			})
			return
		}

		insertQuery := `
			INSERT INTO work_hours
			(empno, empnm, sup_compid, sup_fact_id, sup_date, total_hours, description)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
		`
		for _, compID := range compIDs {
			compID = strings.TrimSpace(compID)
			if compID == "" {
				continue
			}
			var exists bool
			err = tx.QueryRow(`
				SELECT EXISTS (
					SELECT 1
					FROM work_hours
					WHERE empno = $1
						AND sup_compid = $2
						AND sup_date = $3
						AND total_hours = $4
						AND description IS NOT DISTINCT FROM $5
				)
			`, existing.EmpNo, compID, supDate, totalHours, description).Scan(&exists)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "更新失敗",
					"details": err.Error(),
				})
				return
			}
			if exists {
				continue
			}
			if _, err := tx.Exec(
				insertQuery,
				existing.EmpNo,
				existing.EmpNm,
				compID,
				compID,
				supDate,
				totalHours,
				description,
			); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "更新失敗",
					"details": err.Error(),
				})
				return
			}
		}
		updated.SupCompIDs = append([]string{}, compIDs...)
	}

	if err = tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "更新失敗",
			"details": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "工時記錄更新成功",
		"data":    updated,
	})
}

// 刪除工時記錄
func DeleteWorkHours(c *gin.Context) {
	id := c.Param("id")

	var ownerEmpNo string
	err := config.PostgresDB.QueryRow("SELECT empno FROM work_hours WHERE id = $1", id).Scan(&ownerEmpNo)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{
				"error": "找不到該記錄",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "查詢失敗",
			"details": err.Error(),
		})
		return
	}

	if c.GetString("empno") != ownerEmpNo {
		c.JSON(http.StatusForbidden, gin.H{
			"error": "只能刪除自己的工時記錄",
		})
		return
	}

	query := `DELETE FROM work_hours WHERE id = $1 AND empno = $2`

	result, err := config.PostgresDB.Exec(query, id, ownerEmpNo)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "刪除失敗",
			"details": err.Error(),
		})
		return
	}

	// rowsAffected = 0 只會發生在同時被刪除的競態下，視為找不到
	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "找不到該記錄"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "刪除成功",
	})
}
