package models

import "time"

type WorkHours struct {
	ID          string    `json:"id"`
	CompID      string    `json:"compid"`
	EmpNo       string    `json:"empno"`
	EmpNm       string    `json:"empnm"`
	SupCompID   string    `json:"sup_compid"`
	SupFactID   string    `json:"sup_fact_id"`
	SupCompIDs  []string  `json:"sup_compids,omitempty"`
	SupDate     time.Time `json:"sup_date"`
	TotalHours  float64   `json:"total_hours"`
	Description *string   `json:"description"`
	Memo        *string   `json:"memo"`
	Confirmed   bool      `json:"confirmed"`
}

type WorkHoursInput struct {
	EmpNo       string   `json:"empno" binding:"required"`
	EmpNm       string   `json:"empnm" binding:"required"`
	SupCompIDs  []string `json:"sup_compids"`
	SupDate     string   `json:"sup_date" binding:"required"`
	TotalHours  float64  `json:"total_hours" binding:"required"`
	Description *string  `json:"description"`
	Memo        *string  `json:"memo"`
}

type Company struct {
	CompID  string `json:"compid"`
	ComDesc string `json:"com_desc"`
}

type UpdateWorkHoursInput struct {
	SupCompIDs  *[]string `json:"sup_compids"` // 支援公司，可選 (複選)
	SupDate     *string   `json:"sup_date"`    // 日期，可選，格式 YYYY-MM-DD
	TotalHours  *float64  `json:"total_hours"` // 時數，可選
	Description *string   `json:"description"` // 工作內容，可選
	Memo        *string   `json:"memo"`        // 備註，可選
}
